"use client";

import { useState } from "react";

// Helper to get days in month
function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

export default function ShiftCalendar() {
    const [currentDate] = useState(new Date());
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed

    const daysInMonth = getDaysInMonth(year, month);
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Mock initial shifts state
    const [shifts, setShifts] = useState<{ [key: number]: string }>({});

    const handleShiftClick = (day: number) => {
        // Determine next state: blank -> 09:00-18:00 -> 10:00-19:00 -> blank (simplified)
        const current = shifts[day];
        let next = "";
        if (!current) next = "09:00 - 18:00";
        else if (current === "09:00 - 18:00") next = "10:00 - 19:00";
        else if (current === "10:00 - 19:00") next = "OFF";
        else next = "";

        setShifts(prev => ({
            ...prev,
            [day]: next
        }));
    };

    const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"];

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.25rem' }}>{year}年 {month + 1}月</h3>
                <button className="btn btn-primary">提出内容を保存</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', backgroundColor: 'var(--border)', border: '1px solid var(--border)' }}>
                {/* Headers */}
                {dayOfWeek.map(d => (
                    <div key={d} style={{ backgroundColor: 'var(--surface-hover)', padding: '0.5rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 600 }}>
                        {d}
                    </div>
                ))}

                {/* Calendar Grid (Simplified: starts from Day 1, ignoring week start offset for MVP) */}
                {daysArray.map(day => {
                    const date = new Date(year, month, day);
                    const dow = date.getDay();
                    const isWeekend = dow === 0 || dow === 6;

                    return (
                        <div
                            key={day}
                            onClick={() => handleShiftClick(day)}
                            style={{
                                backgroundColor: 'var(--surface)',
                                minHeight: '100px',
                                padding: '0.5rem',
                                cursor: 'pointer',
                                color: isWeekend ? 'var(--destructive)' : 'inherit',
                                position: 'relative',
                                transition: 'background-color 0.2s'
                            }}
                            className="calendar-cell"
                        >
                            <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{day}</div>

                            {shifts[day] && (
                                <div style={{
                                    backgroundColor: shifts[day] === 'OFF' ? '#F3F4F6' : '#EEF2FF',
                                    color: shifts[day] === 'OFF' ? '#4B5563' : '#4F46E5',
                                    padding: '0.25rem',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                    textAlign: 'center',
                                    fontWeight: 500
                                }}>
                                    {shifts[day]}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
