"use client";

import { useState, useEffect, useRef } from "react";
import { ChatMessage, sendMessageWithRoom, subscribeMessages } from "@/services/chatService";
import { useAuth } from "@/context/AuthContext";
import { markMessageNotificationsAsRead } from "@/services/notificationService";

interface ChatWindowProps {
    className?: string;
    partnerName: string;   // Name of the person we are chatting with
    partnerId: string;     // ID of the person we are chatting with
}

export default function ChatWindow({ className, partnerName, partnerId }: ChatWindowProps) {
    const { user } = useAuth();
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

        const unsubscribe = subscribeMessages(user.uid, partnerId, (msgs) => {
            setMessages(msgs);
            // Scroll to bottom on new message
            setTimeout(() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        });

        return () => unsubscribe();
    }, [user, partnerId]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || !user) return;

        try {
            await sendMessageWithRoom(inputText, user.uid, partnerId, user.name);
            setInputText("");
        } catch (error) {
            console.error(error);
            alert("送信に失敗しました");
        }
    };

    if (!user) return <div>Auth required</div>;

    const useFullHeight = className?.includes("h-full");
    return (
        <div
            className={`flex flex-col bg-white rounded-lg shadow border border-gray-200 ${className ?? ""}`}
            style={{
                height: useFullHeight ? "100%" : "500px",
                minHeight: useFullHeight ? 0 : undefined,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
            }}
        >
            {/* Header */}
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-hover)', fontWeight: 600 }}>
                {partnerName}
            </div>

            {/* Messages Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                        メッセージはまだありません
                    </div>
                )}
                
                {messages.map((msg) => {
                    const isMe = msg.senderId === user.uid;
                    return (
                        <div key={msg.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                            <div style={{ 
                                backgroundColor: isMe ? 'var(--primary)' : '#E5E7EB', 
                                color: isMe ? 'white' : 'black',
                                padding: '0.5rem 1rem', 
                                borderRadius: '1rem',
                                borderBottomRightRadius: isMe ? '0' : '1rem',
                                borderBottomLeftRadius: isMe ? '1rem' : '0'
                            }}>
                                {msg.text}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: isMe ? 'right' : 'left', marginTop: '0.2rem' }}>
                                {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSend} style={{ padding: '1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="メッセージを入力..."
                    style={{ 
                        flex: 1, 
                        padding: '0.5rem', 
                        borderRadius: '0.5rem', 
                        border: '1px solid var(--border)',
                        outline: 'none'
                    }}
                />
                <button 
                    type="submit" 
                    className="btn btn-primary"
                    disabled={!inputText.trim()}
                >
                    送信
                </button>
            </form>
        </div>
    );
}
