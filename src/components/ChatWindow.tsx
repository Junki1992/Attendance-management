"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChatMessage, sendMessageWithRoom, subscribeMessages, subscribeMessagesFromPartners, subscribeMyMessages } from "@/services/chatService";
import { useAuth } from "@/context/AuthContext";
import { markMessageNotificationsAsRead } from "@/services/notificationService";
import Avatar from "@/components/Avatar";
import { storage } from "@/lib/firebase/firebase";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";

interface ChatWindowProps {
    className?: string;
    partnerName: string;
    partnerId: string;
    /** 複数指定時は「この誰かから届いたメッセージ」を全て表示（例: スタッフチャットで全管理者） */
    partnerIds?: string[];
    /** true の場合、相手を固定せず自分が送受信した全メッセージを表示 */
    subscribeAllForMe?: boolean;
    partnerPhotoURL?: string | null;
    /** 戻るボタンを表示するか（チャット画面でヘッダー非表示のとき） */
    showBackButton?: boolean;
    /** true の場合、常に画面幅いっぱいに表示（スタッフチャット用） */
    forceFullWidth?: boolean;
}

export default function ChatWindow({ className, partnerName, partnerId, partnerIds, subscribeAllForMe, partnerPhotoURL, showBackButton, forceFullWidth }: ChatWindowProps) {
    const { user } = useAuth();
    const router = useRouter();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);

    useEffect(() => {
        if (!user || !partnerId) return;

        const roomId = [user.uid, partnerId].sort().join("_");
        
        // チャット画面を開いた時に、このチャットルームのメッセージ通知を既読にする
        markMessageNotificationsAsRead(user.uid, roomId).catch((err) => {
            console.error("[ChatWindow] Failed to mark notifications as read:", err);
        });

        const onMessages = (msgs: ChatMessage[]) => {
            setMessages(msgs);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        };
        const unsubscribe = subscribeAllForMe
            ? subscribeMyMessages(user.uid, onMessages)
            : (partnerIds && partnerIds.length > 0
                ? subscribeMessagesFromPartners(user.uid, partnerIds, onMessages)
                : subscribeMessages(user.uid, partnerId, onMessages));

        return () => unsubscribe();
    }, [user, partnerId, partnerIds, subscribeAllForMe]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || !user) return;

        try {
            await sendMessageWithRoom(inputText, user.uid, partnerId, user.name);
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
            // send message with file meta (empty text)
            await sendMessageWithRoom("", user.uid, partnerId, user.name, {
                url,
                name: f.name,
                type: f.type,
                size: f.size,
            });
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
                
                {messages.map((msg) => {
                    const isMe = msg.senderId === user.uid;
                    return (
                        <div key={msg.id} style={{ 
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
                            </div>
                        </div>
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
                    }}
                >
                    {/* paperclip icon */}
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 01-7.78 0 5.5 5.5 0 010-7.78l8.49-8.49a3.5 3.5 0 014.95 4.95L10.5 18.95a2 2 0 01-2.83 0 2 2 0 010-2.83l7.08-7.08" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
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
                    style={{
                        borderRadius: isFullWidthMode && isMobile ? '0' : undefined,
                        flexShrink: 0,
                        padding: '0.75rem 1.5rem',
                        whiteSpace: 'nowrap',
                    }}
                >
                    送信
                </button>
            </form>
        </div>
    );
}
