"use client";

// Mock Messages (Same as admin view essentially, but simpler context)
const MOCK_MESSAGES = [
    { id: 1, sender: 'staff', text: "お疲れ様です。明日のシフトですが、急用で開始を1時間遅らせてもらえないでしょうか？", time: "10:30" },
    { id: 2, sender: 'admin', text: "佐藤さん、お疲れ様です。明日の件、了解しました。10時出勤に変更しておきますね。", time: "10:35" },
    { id: 3, sender: 'staff', text: "ありがとうございます！助かります。", time: "10:36" },
];

export default function StaffChatPage() {
    return (
        <div className="card" style={{ height: 'calc(100vh - 120px)', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600 }}>管理者 (店長)</span>
                <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--secondary)', borderRadius: '50%' }} title="オンライン"></span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', backgroundColor: '#F9FAFB', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* System Message Example */}
                <div style={{ textAlign: 'center', margin: '1rem 0' }}>
                    <span style={{ backgroundColor: '#E5E7EB', padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.75rem', color: '#4B5563' }}>
                        2026年1月22日
                    </span>
                </div>

                {MOCK_MESSAGES.map(msg => {
                    const isMe = msg.sender === 'staff';
                    return (
                        <div key={msg.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
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
                                {msg.time} {isMe && <span>· 既読</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Input */}
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', backgroundColor: 'white' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-outline" style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}>
                        +
                    </button>
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
        </div>
    );
}
