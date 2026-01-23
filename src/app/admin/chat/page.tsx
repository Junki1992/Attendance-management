"use client";

import { useState } from "react";

// Mock Data
const MOCK_USERS = [
    { id: 1, name: "佐藤 一郎", lastMsg: "明日のシフト代われませんか？", unread: true, time: "10:30" },
    { id: 2, name: "鈴木 次郎", lastMsg: "承知いたしました。", unread: false, time: "昨日" },
    { id: 3, name: "田中 花子", lastMsg: "お疲れ様です。", unread: false, time: "1/20" },
];

const MOCK_MESSAGES = [
    { id: 1, sender: 'staff', text: "お疲れ様です。明日のシフトですが、急用で開始を1時間遅らせてもらえないでしょうか？", time: "10:30" },
    { id: 2, sender: 'admin', text: "佐藤さん、お疲れ様です。明日の件、了解しました。10時出勤に変更しておきますね。", time: "10:35" },
    { id: 3, sender: 'staff', text: "ありがとうございます！助かります。", time: "10:36" },
];

export default function AdminChatPage() {
    const [selectedUser, setSelectedUser] = useState<number | null>(1); // Default to first user

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 100px)', gap: '1rem' }}>
            {/* Sidebar: User List */}
            <div className="card" style={{ width: '300px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-hover)' }}>
                    <h3 style={{ fontSize: '1rem' }}>スタッフ一覧</h3>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {MOCK_USERS.map(user => (
                        <div
                            key={user.id}
                            onClick={() => setSelectedUser(user.id)}
                            style={{
                                padding: '1rem',
                                borderBottom: '1px solid var(--border)',
                                cursor: 'pointer',
                                backgroundColor: selectedUser === user.id ? '#EEF2FF' : 'transparent',
                                transition: 'background-color 0.2s'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.name}</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.time}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>
                                    {user.lastMsg}
                                </p>
                                {user.unread && (
                                    <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--primary)', borderRadius: '50%' }}></span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Chat Area */}
            <div className="card" style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {selectedUser ? (
                    <>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600 }}>
                                {MOCK_USERS.find(u => u.id === selectedUser)?.name}
                            </span>
                            <span style={{ fontSize: '0.8rem', backgroundColor: '#E0E7FF', color: '#4338CA', padding: '0.1rem 0.5rem', borderRadius: '1rem' }}>
                                スタッフ
                            </span>
                        </div>

                        <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', backgroundColor: '#F9FAFB', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {MOCK_MESSAGES.map(msg => {
                                const isMe = msg.sender === 'admin';
                                return (
                                    <div key={msg.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                                        <div style={{
                                            backgroundColor: isMe ? 'var(--primary)' : 'white',
                                            color: isMe ? 'white' : 'var(--text-main)',
                                            padding: '0.75rem 1rem',
                                            borderRadius: '1rem',
                                            borderTopRightRadius: isMe ? '0' : '1rem',
                                            borderTopLeftRadius: isMe ? '1rem' : '0',
                                            boxShadow: 'var(--shadow-sm)',
                                            border: isMe ? 'none' : '1px solid var(--border)'
                                        }}>
                                            {msg.text}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', textAlign: isMe ? 'right' : 'left' }}>
                                            {msg.time}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', backgroundColor: 'white' }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    placeholder="メッセージを入力..."
                                    className="input"
                                    style={{ flex: 1 }}
                                />
                                <button className="btn btn-primary" style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}>
                                    ➤
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
                        左側のリストからスタッフを選択してください
                    </div>
                )}
            </div>
        </div>
    );
}
