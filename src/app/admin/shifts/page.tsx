"use client";

import { useState, useEffect } from "react";
import { getAllShifts, Shift } from "@/services/shiftService";

// Mock User List (In reality, fetch from 'users' collection)
const STAFF_LIST = [
    { id: "staff-456", name: "アルバイト 花子 (You)" }, // Matches AuthContext mock
    { id: "1", name: "佐藤 一郎" }, // Legacy mocks
    { id: "2", name: "鈴木 次郎" },
];

const DAYS_IN_MONTH = 31; // Mocking January
const DAYS = Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1);

export default function AdminShiftGrid() {
    // Data: UserID -> Day -> Hours (number)
    const [shiftData, setShiftData] = useState<{ [key: string]: number }>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch for Year 2026, Month 0 (January) as per current mock context
                const year = 2026; // or get current year
                const month = 0;   // or get current month

                // Assuming we want to show current month context. 
                // The staff view was using "new Date()" which is Jan 2026 according to system time?
                // Wait, system time is 2026-01-23. So yes, Jan 2026.

                const shifts = await getAllShifts(year, month);

                const map: { [key: string]: number } = {};

                shifts.forEach(s => {
                    if (s.startTime === "00:00" && s.endTime === "00:00") return; // OFF

                    const day = parseInt(s.date.split('-')[2], 10);
                    const key = `${s.userId}-${day}`;

                    // Calculate hours
                    const [startH, startM] = s.startTime.split(':').map(Number);
                    const [endH, endM] = s.endTime.split(':').map(Number);

                    let hours = (endH + endM / 60) - (startH + startM / 60);
                    // Handle break deduction? Assuming 1h break for >6h shift
                    if (hours > 6) hours -= 1;

                    // Round to 1 decimal for display
                    if (hours > 0) map[key] = Math.round(hours * 10) / 10;
                });

                setShiftData(map);
            } catch (error) {
                console.error("Failed to fetch all shifts", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const getShift = (uid: string, day: number) => shiftData[`${uid}-${day}`] || 0;

    // 36 Agreement Logic (Simplified)
    const isDailyOver = (hours: number) => hours > 8;
    const isWeeklyOver = (uid: string) => {
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

            {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>読み込み中...</div>
            ) : (
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
            )}
        </div>
    );
}
