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
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>変更申請</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        確定後のシフト変更申請を承認・却下できます。承認するとシフト表に反映されます。
                    </p>
                    <Link href="/admin/shift-change-requests" className="btn btn-outline">
                        申請一覧を開く
                    </Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>36協定アラート</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        シフト表で8h超・週40h超を確認できます。
                    </p>
                    <Link href="/admin/shifts" className="link-hover-slide" style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>シフト表で確認 →</Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>チャット</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        アルバイトからの連絡を確認できます。
                    </p>
                    <Link href="/admin/chat" className="btn btn-outline">
                        メッセージを確認
                    </Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>設定</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        シフト提出の締切日（各月の何日までか）を変更できます。
                    </p>
                    <Link href="/admin/settings" className="btn btn-outline">
                        設定を開く
                    </Link>
                </div>
            </div>
        </div>
    );
}
