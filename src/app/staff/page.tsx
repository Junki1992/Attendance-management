"use client";

import Link from "next/link";

export default function StaffDashboard() {
    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>ダッシュボード</h2>

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>今月のシフト提出</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        来月の希望シフトを提出してください。
                        <br />
                        <strong>締切: 1月25日</strong>
                    </p>
                    <Link href="/staff/shifts" className="btn btn-primary">
                        シフトを提出する
                    </Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>確定シフト</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        次回出勤: 1月24日 09:00 - 18:00
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <span style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: 'var(--secondary)',
                            color: 'white',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem'
                        }}>
                            確認済み
                        </span>
                    </div>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>管理者からのメッセージ</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        未読のメッセージはありません。
                    </p>
                    <Link href="/staff/chat" className="btn btn-outline">
                        チャットを開く
                    </Link>
                </div>
            </div>
        </div>
    );
}
