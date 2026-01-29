"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChatMessage, sendMessageWithRoom, subscribeMessages, subscribeMessagesFromPartners, subscribeMyMessages } from "@/services/chatService";
import { useAuth } from "@/context/AuthContext";
import { markMessageNotificationsAsRead } from "@/services/notificationService";
import Avatar from "@/components/Avatar";

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
                                {msg.text}
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
                    }}
                />
                <button 
                    type="submit" 
                    className="btn btn-primary"
                    disabled={!inputText.trim()}
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
