"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { subscribeSettings } from "@/services/settingsService";

export default function StaffDashboard() {
    const [deadlineLabel, setDeadlineLabel] = useState<string | null>(null);

    useEffect(() => {
        const unsub = subscribeSettings((s) => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const lastDay = new Date(year, month + 1, 0).getDate();
            const d = Math.min(s.shiftSubmitDeadlineDay, lastDay);
            setDeadlineLabel(`${month + 1}月${d}日`);
        });
        return () => unsub();
    }, []);

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>ダッシュボード</h2>

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>今月のシフト提出</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        来月の希望シフトを提出してください。
                        {deadlineLabel && (
                            <>
                                <br />
                                <strong>締切: {deadlineLabel}</strong>
                            </>
                        )}
                    </p>
                    <Link href="/staff/shifts" className="btn btn-primary">
                        シフトを提出する
                    </Link>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>確定シフトを見る</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        確定済みのシフトと勤務時間・概算給与を確認できます。
                    </p>
                    <Link href="/staff/confirmed-shifts" className="btn btn-outline">
                        確定シフトを確認
                    </Link>
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
