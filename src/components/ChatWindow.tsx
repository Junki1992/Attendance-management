"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { ChatMessage, sendMessageWithRoom, subscribeMessages, subscribeMessagesFromPartners, subscribeMyMessages } from "@/services/chatService";
import { setRoomLastRead, subscribeRoomMeta, scheduleRoomLastRead } from "@/services/chatService";
import { useAuth } from "@/context/AuthContext";
import { markMessageNotificationsAsRead } from "@/services/notificationService";
import Avatar from "@/components/Avatar";
import { storage } from "@/lib/firebase/firebase";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";

interface ChatWindowProps {
    className?: string;
    partnerName: string;
    partnerId: string;
    /** 複数指定時は「この誰かから届いたメッセージ」を全て表示（例: アルバイトチャットで全管理者） */
    partnerIds?: string[];
    /** true の場合、相手を固定せず自分が送受信した全メッセージを表示 */
    subscribeAllForMe?: boolean;
    partnerPhotoURL?: string | null;
    /** 戻るボタンを表示するか（チャット画面でヘッダー非表示のとき） */
    showBackButton?: boolean;
    /** true の場合、常に画面幅いっぱいに表示（アルバイトチャット用） */
    forceFullWidth?: boolean;
}

export default function ChatWindow({ className, partnerName, partnerId, partnerIds, subscribeAllForMe, partnerPhotoURL, showBackButton, forceFullWidth }: ChatWindowProps) {
    const { user } = useAuth();
    const router = useRouter();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    /** onMessages で既読を1回書き込んだか（スナップショットごとの重複書き込みを防ぐ） */
    const lastReadWrittenForRoomRef = useRef<string | null>(null);
    /** メッセージ変更 effect で即時既読を1回書き込んだか */
    const effectImmediateReadRef = useRef(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [roomMeta, setRoomMeta] = useState<Record<string, any>>({});
    /** subscribeAllForMe 時: 各相手の lastRead を保持（相手ID → その相手の既読タイムスタンプ） */
    const [partnerLastReadByPartner, setPartnerLastReadByPartner] = useState<Record<string, any>>({});

    // 受信者がチャットを開いたら必ず既読を書き込む（ref は立てない＝失敗時は onMessages / 下の effect でリトライ）
    useEffect(() => {
        if (!user || !partnerId) return;
        lastReadWrittenForRoomRef.current = null;
        effectImmediateReadRef.current = false;
        if (subscribeAllForMe && partnerIds && partnerIds.length > 0) {
            partnerIds.forEach((p) => {
                const roomId = [user.uid, p].sort().join("_");
                setRoomLastRead(roomId, user.uid).catch((err) => console.error("[ChatWindow] setRoomLastRead failed:", err));
            });
        } else {
            const roomId = [user.uid, partnerId].sort().join("_");
            setRoomLastRead(roomId, user.uid).catch((err) => console.error("[ChatWindow] setRoomLastRead failed:", err));
        }
    }, [user?.uid, partnerId, subscribeAllForMe, partnerIds]);

    useEffect(() => {
        if (!user || !partnerId) return;

        const roomId = [user.uid, partnerId].sort().join("_");
        markMessageNotificationsAsRead(user.uid, roomId).catch((err) => {
            console.error("[ChatWindow] Failed to mark notifications as read:", err);
        });

        const onMessages = (msgs: ChatMessage[]) => {
            setMessages(msgs);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            // 受信者がチャットを開いてメッセージが届いたら即座に既読を書き込む（送信者に既読を表示するため）
            if (msgs.length > 0 && user) {
                if (subscribeAllForMe && partnerIds && partnerIds.length > 0) {
                    if (lastReadWrittenForRoomRef.current !== "partners-done") {
                        lastReadWrittenForRoomRef.current = "partners-done";
                        partnerIds.forEach((p) => {
                            const roomId = [user.uid, p].sort().join("_");
                            setRoomLastRead(roomId, user.uid).catch((err) => console.error("[ChatWindow] setRoomLastRead (onMessages) failed:", err));
                        });
                    }
                } else {
                    const roomId = [user.uid, partnerId].sort().join("_");
                    if (lastReadWrittenForRoomRef.current !== roomId) {
                        lastReadWrittenForRoomRef.current = roomId;
                        setRoomLastRead(roomId, user.uid).catch((err) => console.error("[ChatWindow] setRoomLastRead (onMessages) failed:", err));
                    }
                }
            }
        };
        const unsubscribe = subscribeAllForMe
            ? subscribeMyMessages(user.uid, onMessages)
            : (partnerIds && partnerIds.length > 0
                ? subscribeMessagesFromPartners(user.uid, partnerIds, onMessages)
                : subscribeMessages(user.uid, partnerId, onMessages));

        return () => unsubscribe();
    }, [user, partnerId, partnerIds, subscribeAllForMe]);

    // subscribe to room meta (lastReadBy) — 1対1のときは1ルームのみ
    useEffect(() => {
        if (!user || !partnerId) return;
        if (subscribeAllForMe && partnerIds && partnerIds.length > 0) {
            // アルバイト側: 複数管理者とのルーム分だけ購読
            const unsubs: (() => void)[] = [];
            partnerIds.forEach((p) => {
                const roomId = [user.uid, p].sort().join("_");
                const unsub = subscribeRoomMeta(roomId, (meta) => {
                    const lastReadBy = meta || {};
                    setPartnerLastReadByPartner((prev) => ({ ...prev, [p]: lastReadBy[p] }));
                });
                unsubs.push(unsub);
            });
            return () => unsubs.forEach((u) => u());
        }
        const roomId = [user.uid, partnerId].sort().join("_");
        const unsubMeta = subscribeRoomMeta(roomId, (meta) => {
            setRoomMeta(meta || {});
        });
        return () => unsubMeta();
    }, [user, partnerId, subscribeAllForMe, partnerIds]);

    // update my lastRead when messages change (only if there are new messages)
    const toMillis = (obj: any): number => {
        if (!obj) return 0;
        if (typeof obj?.toMillis === "function") return obj.toMillis();
        if (typeof obj?.seconds === "number") return obj.seconds * 1000;
        if (obj instanceof Date) return obj.getTime();
        return 0;
    };

    /** 日付区切り用ラベル（今日 / 昨日 / 2025年1月28日） */
    const formatDateLabel = (createdAt: any): string => {
        const date = createdAt?.toDate ? createdAt.toDate() : (createdAt?.seconds ? new Date(createdAt.seconds * 1000) : null);
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        const today = new Date();
        const y = date.getFullYear();
        const m = date.getMonth();
        const d = date.getDate();
        const ty = today.getFullYear();
        const tm = today.getMonth();
        const td = today.getDate();
        if (y === ty && m === tm && d === td) return "今日";
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (y === yesterday.getFullYear() && m === yesterday.getMonth() && d === yesterday.getDate()) return "昨日";
        if (y === ty) return `${m + 1}月${d}日`;
        return `${y}年${m + 1}月${d}日`;
    };

    /** createdAt から YYYY-MM-DD を取得（日付区切りの比較用） */
    const getDateKey = (createdAt: any): string => {
        const date = createdAt?.toDate ? createdAt.toDate() : (createdAt?.seconds ? new Date(createdAt.seconds * 1000) : null);
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };

    useEffect(() => {
        if (!user || !partnerId) return;
        const roomId = [user.uid, partnerId].sort().join("_");
        const lastMsgTime = messages.length ? toMillis(messages[messages.length - 1].createdAt) : 0;
        const myLastRead = roomMeta[user.uid] ? toMillis(roomMeta[user.uid]) : 0;
        if (lastMsgTime > myLastRead) {
            // 未読があるとき：1回は即時書き込み（既読を必ず付ける）、その後は debounce で更新
            if (!effectImmediateReadRef.current) {
                effectImmediateReadRef.current = true;
                setRoomLastRead(roomId, user.uid).catch((err) => {
                    console.error("[ChatWindow] setRoomLastRead (effect) failed:", err);
                    effectImmediateReadRef.current = false;
                });
            }
            try {
                scheduleRoomLastRead(roomId, user.uid);
            } catch (err) {
                console.error("[ChatWindow] scheduleRoomLastRead failed:", err);
            }
        }
    }, [messages, roomMeta, user, partnerId]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || !user) return;

        try {
            // アルバイトチャット（複数管理者）のときは全管理者に届くよう、全員に送信する
            if (subscribeAllForMe && partnerIds && partnerIds.length > 0) {
                await Promise.all(
                    partnerIds.map((receiverId) =>
                        sendMessageWithRoom(inputText, user.uid, receiverId, user.name)
                    )
                );
            } else {
                await sendMessageWithRoom(inputText, user.uid, partnerId, user.name);
            }
            setInputText("");
        } catch (error) {
            console.error(error);
            const msg = error instanceof Error ? error.message : "送信に失敗しました";
            alert(msg);
        }
    };

    const openFilePicker = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f || !user) return;

        // allow only images and PDFs
        const allowed = f.type.startsWith("image/") || f.type === "application/pdf";
        if (!allowed) {
            alert("画像またはPDFのみアップロードできます");
            e.currentTarget.value = "";
            return;
        }

        setUploading(true);
        setUploadProgress(0);

        try {
            const roomId = [user.uid, partnerId].sort().join("_");
            const path = `chat/${roomId}/${Date.now()}_${f.name}`;
            const sRef = storageRef(storage, path);
            const uploadTask = uploadBytesResumable(sRef, f);

            await new Promise<void>((resolve, reject) => {
                uploadTask.on(
                    "state_changed",
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        setUploadProgress(Math.round(progress));
                    },
                    (err) => {
                        console.error("[ChatWindow] upload failed:", err);
                        reject(err);
                    },
                    () => {
                        resolve();
                    }
                );
            });

            const url = await getDownloadURL(sRef);
            const fileMeta = { url, name: f.name, type: f.type, size: f.size };
            // アルバイトチャット（複数管理者）のときは全管理者に届くよう、全員に送信する
            if (subscribeAllForMe && partnerIds && partnerIds.length > 0) {
                await Promise.all(
                    partnerIds.map((receiverId) =>
                        sendMessageWithRoom("", user.uid, receiverId, user.name, fileMeta)
                    )
                );
            } else {
                await sendMessageWithRoom("", user.uid, partnerId, user.name, fileMeta);
            }
        } catch (err) {
            console.error(err);
            alert("ファイルの送信に失敗しました");
        } finally {
            setUploading(false);
            setUploadProgress(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    if (!user) return <div>Auth required</div>;

    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    
    const isFullWidthMode = forceFullWidth === true;
    const baseStyle: React.CSSProperties = isFullWidthMode ? {
        flex: "1 1 0",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--surface)",
        border: "none",
        borderRadius: "0",
        boxShadow: "none",
        margin: 0,
        padding: 0,
        boxSizing: "border-box",
        overflow: "hidden",
    } : {
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        boxShadow: "var(--shadow-sm)",
        overflowX: "hidden",
    };
    
    // Send button style adjusts for mobile to be smaller
    const sendButtonStyle: React.CSSProperties = {
        borderRadius: isFullWidthMode && isMobile ? '0' : undefined,
        flexShrink: 0,
        padding: isMobile ? '0.45rem 0.9rem' : '0.75rem 1.5rem',
        fontSize: isMobile ? '0.95rem' : undefined,
        whiteSpace: 'nowrap',
    };
    
    return (
        <div
            className={isFullWidthMode ? "chat-window-fullwidth" : `flex flex-col bg-white rounded-lg shadow border border-gray-200 ${className ?? ""}`}
            style={baseStyle}
        >
            {/* Header */}
            <div style={{ 
                padding: isFullWidthMode ? '1rem 3rem' : '1rem', 
                borderBottom: '1px solid var(--border)', 
                backgroundColor: 'var(--surface-hover)', 
                fontWeight: 600, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.75rem', 
                flexShrink: 0,
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                overflowX: 'hidden',
            }}>
                {showBackButton && (
                    <button
                        onClick={() => router.back()}
                        style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '0.25rem',
                            marginRight: '0.25rem',
                            fontSize: '1.2rem',
                            color: 'var(--text-main)',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                        aria-label="戻る"
                    >
                        ←
                    </button>
                )}
                <Avatar photoURL={partnerPhotoURL} name={partnerName} size="sm" />
                <span style={{ fontSize: isMobile ? '0.95rem' : '1rem' }}>{partnerName}</span>
            </div>

            {/* Messages Area */}
            <div style={{ 
                flex: '1 1 0',
                overflowY: 'auto', 
                overflowX: 'hidden', 
                padding: isFullWidthMode ? (isMobile ? '1rem 0.75rem' : '1rem 3rem') : '1rem', 
                paddingBottom: isFullWidthMode && isMobile ? '4.5rem' : '1rem',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '0.75rem', 
                minHeight: 0,
                maxHeight: 'none',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                position: 'relative',
            }}>
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                        メッセージはまだありません
                    </div>
                )}
                
                {messages.map((msg, index) => {
                    const prevDateKey = index > 0 ? getDateKey(messages[index - 1].createdAt) : "";
                    const thisDateKey = getDateKey(msg.createdAt);
                    const showDateSeparator = thisDateKey && thisDateKey !== prevDateKey;
                    const isMe = msg.senderId === user.uid;
                    return (
                        <Fragment key={msg.id}>
                            {showDateSeparator && (
                                <div style={{
                                    alignSelf: "center",
                                    fontSize: "0.75rem",
                                    color: "var(--text-muted)",
                                    marginTop: index > 0 ? "1rem" : "0.25rem",
                                    marginBottom: "0.25rem",
                                    padding: "0.25rem 0.75rem",
                                    backgroundColor: "var(--surface-hover)",
                                    borderRadius: "1rem",
                                }}>
                                    {formatDateLabel(msg.createdAt)}
                                </div>
                            )}
                            <div style={{ 
                                alignSelf: isMe ? 'flex-end' : 'flex-start', 
                                maxWidth: isMobile ? '75%' : '70%',
                                minWidth: '120px',
                                width: 'fit-content',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: isMe ? 'flex-end' : 'flex-start',
                                boxSizing: 'border-box',
                            }}>
                                <div style={{ 
                                    backgroundColor: isMe ? 'var(--primary)' : '#E5E7EB', 
                                    color: isMe ? 'white' : 'black',
                                    padding: '0.625rem 1rem', 
                                    borderRadius: '1rem',
                                    borderBottomRightRadius: isMe ? '0.25rem' : '1rem',
                                    borderBottomLeftRadius: isMe ? '1rem' : '0.25rem',
                                    wordBreak: 'break-word',
                                    wordWrap: 'break-word',
                                    overflowWrap: 'break-word',
                                    lineHeight: '1.5',
                                    maxWidth: '100%',
                                    boxSizing: 'border-box',
                                }}>
                                    {msg.fileURL ? (
                                        <>
                                            {msg.fileType && msg.fileType.startsWith('image/') ? (
                                                <img src={msg.fileURL} alt={msg.fileName ?? 'image'} style={{ maxWidth: isMobile ? '70vw' : '60%', height: 'auto', borderRadius: '0.5rem' }} />
                                            ) : (
                                                <a href={msg.fileURL} target="_blank" rel="noreferrer" style={{ color: isMe ? 'white' : 'inherit', textDecoration: 'underline' }}>
                                                    {msg.fileName ?? 'ファイルをダウンロード'}
                                                </a>
                                            )}
                                            {msg.text && (
                                                <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                                            )}
                                        </>
                                    ) : (
                                        msg.text
                                    )}
                                </div>
                                <div style={{ 
                                    fontSize: '0.75rem', 
                                    color: 'var(--text-muted)', 
                                    textAlign: isMe ? 'right' : 'left', 
                                    marginTop: '0.25rem',
                                    paddingLeft: isMe ? 0 : '0.25rem',
                                    paddingRight: isMe ? '0.25rem' : 0,
                                    maxWidth: '100%',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word',
                                }}>
                                    {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                                    {isMe && (() => {
                                        const messagePartner = subscribeAllForMe ? msg.receiverId : partnerId;
                                        const partnerLastRead = subscribeAllForMe
                                            ? (messagePartner ? partnerLastReadByPartner[messagePartner] : undefined)
                                            : roomMeta[partnerId];
                                        const msgTime = msg.createdAt ? toMillis(msg.createdAt) : 0;
                                        const partnerReadTime = partnerLastRead ? toMillis(partnerLastRead) : 0;
                                        const isRead = partnerReadTime > 0 && partnerReadTime >= msgTime;
                                        if (!isRead) return null;
                                        return (
                                            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                既読
                                            </span>
                                        );
                                    })()}
                                </div>
                            </div>
                        </Fragment>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {/* Input Area - Fixed Footer */}
            <form 
                onSubmit={handleSend} 
                style={{ 
                    padding: isFullWidthMode ? (isMobile ? '0.75rem' : '1rem 3rem') : '1rem', 
                    borderTop: '1px solid var(--border)', 
                    display: 'flex', 
                    gap: '0.75rem',
                    flexShrink: 0,
                    flexGrow: 0,
                    backgroundColor: 'var(--surface)',
                    width: '100%',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                        position: isFullWidthMode && isMobile ? 'fixed' : 'relative',
                    bottom: isFullWidthMode && isMobile ? 0 : undefined,
                    left: isFullWidthMode && isMobile ? 0 : undefined,
                    right: isFullWidthMode && isMobile ? 0 : undefined,
                    zIndex: isFullWidthMode && isMobile ? 100 : 10,
                    overflowX: 'hidden',
                }}
            >
                <input
                    type="file"
                    accept="image/*,application/pdf"
                    ref={(el) => { fileInputRef.current = el; }}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />
                <button
                    type="button"
                    onClick={openFilePicker}
                    aria-label="ファイルを添付"
                    title="ファイルを添付"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.45rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        cursor: 'pointer',
                        width: '40px',
                        height: '40px',
                        boxSizing: 'border-box',
                        color: 'var(--text-muted)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                    <i className="fa-solid fa-paperclip" aria-hidden style={{ fontSize: 18, color: 'inherit' }} />
                </button>
                {uploading && uploadProgress !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>アップロード {uploadProgress}%</div>
                    </div>
                )}
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="メッセージを入力..."
                    style={{ 
                        flex: 1, 
                        minWidth: 0,
                        padding: '0.75rem 1rem', 
                        borderRadius: isFullWidthMode && isMobile ? '0' : '0.5rem', 
                        border: isFullWidthMode && isMobile ? 'none' : '1px solid var(--border)',
                        outline: 'none',
                        fontSize: '16px', // iOS Safari の自動ズームを防ぐため16px以上
                        backgroundColor: 'var(--surface)',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        opacity: uploading ? 0.6 : 1,
                        pointerEvents: uploading ? 'none' : undefined,
                    }}
                />
                <button 
                    type="submit" 
                    className="btn btn-primary"
                    disabled={!inputText.trim() || uploading}
                    style={sendButtonStyle}
                >
                    送信
                </button>
            </form>
        </div>
    );
}
