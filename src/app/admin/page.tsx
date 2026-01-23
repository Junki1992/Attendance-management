"use client";

import Link from "next/link";

export default function AdminDashboard() {
    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>管理ダッシュボード</h2>

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>シフト表</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        提出状況の確認、未提出者への催促、確定と通知、CSVコピーができます。
                    </p>
                    <Link href="/admin/shifts" className="btn btn-primary">
                        シフト表を開く
                    </Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>36協定アラート</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        現在、<strong>2名</strong>のスタッフが週40時間を超えるシフトになっています。
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--destructive)' }}>
                        ⚠️ 要確認
                    </div>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>チャット</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        スタッフからの連絡: <strong>3件</strong>
                    </p>
                    <Link href="/admin/chat" className="btn btn-outline">
                        メッセージを確認
                    </Link>
                </div>
            </div>
        </div>
    );
}
