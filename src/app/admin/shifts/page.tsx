"use client";

import { useState } from "react";

const STAFF_LIST = [
    { id: 1, name: "佐藤 一郎" },
    { id: 2, name: "鈴木 次郎" },
    { id: 3, name: "田中 花子" },
    { id: 4, name: "高橋 由美" },
];

const DAYS_IN_MONTH = 31; // Mocking January
const DAYS = Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1);

export default function AdminShiftGrid() {
    // Mock Data: UserID -> Day -> Hours
    // 0 means OFF, 8 means 9-18, etc.
    const [shifts, setShifts] = useState<{ [key: string]: number }>({
        "1-5": 8, "1-6": 8, "1-7": 8, "1-8": 8, "1-9": 9, // Sato: 41h (Over 40h)
        "2-5": 8, "2-6": 8, "2-7": 8, "2-8": 8, "2-9": 8,
    });

    const getShift = (uid: number, day: number) => shifts[`${uid}-${day}`] || 0;

    // 36 Agreement Logic (Simplified)
    const isDailyOver = (hours: number) => hours > 8;
    const isWeeklyOver = (uid: number) => {
        // Just summing all hours for mock demo
        let total = 0;
        DAYS.forEach(d => total += getShift(uid, d));
        return total > 40;
    };

    return (
        <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem' }}>2026年 1月 シフト表</h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn btn-outline">CSVコピー</button>
                    <button className="btn btn-primary">確定して通知</button>
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'var(--surface)', fontSize: '0.8rem' }}>
                <thead>
                    <tr>
                        <th style={{ padding: '0.5rem', border: '1px solid var(--border)', minWidth: '100px', position: 'sticky', left: 0, backgroundColor: 'var(--surface)', zIndex: 1 }}>スタッフ</th>
                        {DAYS.map(d => (
                            <th key={d} style={{ padding: '0.25rem', border: '1px solid var(--border)', minWidth: '30px', textAlign: 'center' }}>
                                {d}
                            </th>
                        ))}
                        <th style={{ padding: '0.5rem', border: '1px solid var(--border)', minWidth: '60px' }}>合計</th>
                    </tr>
                </thead>
                <tbody>
                    {STAFF_LIST.map(user => {
                        const totalHours = DAYS.reduce((acc, d) => acc + getShift(user.id, d), 0);
                        const weeklyWarning = totalHours > 40;

                        return (
                            <tr key={user.id}>
                                <td style={{
                                    padding: '0.5rem',
                                    border: '1px solid var(--border)',
                                    fontWeight: 500,
                                    position: 'sticky',
                                    left: 0,
                                    backgroundColor: 'var(--surface)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    {user.name}
                                    {weeklyWarning && <span title="週40時間超過" style={{ fontSize: '1rem' }}>⚠️</span>}
                                </td>
                                {DAYS.map(d => {
                                    const hours = getShift(user.id, d);
                                    const isOver = isDailyOver(hours);
                                    return (
                                        <td
                                            key={d}
                                            style={{
                                                border: '1px solid var(--border)',
                                                textAlign: 'center',
                                                backgroundColor: isOver ? '#FEE2E2' : (hours > 0 ? '#EEF2FF' : 'transparent'),
                                                color: isOver ? '#EF4444' : 'inherit',
                                                cursor: 'pointer'
                                            }}
                                            title={isOver ? '1日8時間超過' : ''}
                                        >
                                            {hours > 0 ? hours : ''}
                                        </td>
                                    );
                                })}
                                <td style={{
                                    padding: '0.5rem',
                                    border: '1px solid var(--border)',
                                    fontWeight: 600,
                                    color: weeklyWarning ? 'var(--destructive)' : 'inherit',
                                    textAlign: 'center'
                                }}>
                                    {totalHours}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
