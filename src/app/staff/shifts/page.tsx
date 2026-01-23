"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserShifts, saveShift, deleteShift, Shift } from "@/services/shiftService";
import { getUserProfile } from "@/services/userService";
import { isPastSubmitDeadline } from "@/services/settingsService";

// Helper to get days in month
function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

export default function ShiftCalendar() {
    const { user } = useAuth();
    const [currentDate] = useState(new Date());
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed

    const daysInMonth = getDaysInMonth(year, month);
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Local state for UI: Day -> Display String
    const [shifts, setShifts] = useState<{ [key: number]: string }>({});
    const [loading, setLoading] = useState(false);
    const [hourlyWage, setHourlyWage] = useState(1000);
    const [deadlinePassed, setDeadlinePassed] = useState(false);

    // Fetch shifts, user profile, and 締切 check
    useEffect(() => {
        if (!user) return;

        const init = async () => {
            try {
                const [profile, data, past] = await Promise.all([
                    getUserProfile(user.uid),
                    getUserShifts(user.uid, year, month),
                    isPastSubmitDeadline(year, month),
                ]);
                if (profile?.hourlyWage) setHourlyWage(profile.hourlyWage);
                setDeadlinePassed(past);

                const shiftMap: { [key: number]: string } = {};
                data.forEach((s) => {
                    const day = parseInt(s.date.split("-")[2], 10);
                    if (s.startTime === "00:00" && s.endTime === "00:00") {
                        shiftMap[day] = "OFF";
                    } else {
                        shiftMap[day] = `${s.startTime} - ${s.endTime}`;
                    }
                });
                setShifts(shiftMap);
            } catch (error) {
                console.error("Failed to fetch data", error);
            }
        };

        init();
    }, [user, year, month]);

    const handleShiftClick = (day: number) => {
        if (deadlinePassed) return;
        // Determine next state: blank -> 09:00 - 18:00 -> 10:00 - 19:00 -> OFF -> blank
        const current = shifts[day];
        let next = "";
        if (!current) next = "09:00 - 18:00";
        else if (current === "09:00 - 18:00") next = "10:00 - 19:00";
        else if (current === "10:00 - 19:00") next = "OFF";
        else next = ""; // Blank (delete)

        setShifts(prev => ({
            ...prev,
            [day]: next
        }));
    };

    const handleSave = async () => {
        if (!user || deadlinePassed) return;
        setLoading(true);
        try {
            const promises = Object.entries(shifts).map(async ([dayStr, label]) => {
                const day = parseInt(dayStr, 10);
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                let start = "";
                let end = "";

                if (label === "OFF") {
                    start = "00:00";
                    end = "00:00";
                } else if (label.includes(" - ")) {
                    const parts = label.split(" - ");
                    start = parts[0] ?? "";
                    end = parts[1] ?? "";
                } else {
                    return deleteShift(user.uid, dateStr);
                }

                const shiftData: Shift = {
                    userId: user.uid,
                    date: dateStr,
                    startTime: start,
                    endTime: end,
                    status: 'submitted',
                };

                return saveShift(shiftData);
            });

            await Promise.all(promises);
            alert("シフトを保存しました！");
        } catch (error) {
            console.error("Error saving:", error);
            alert("保存に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    // Calculate Estimated Salary
    const calculateSalary = () => {
        let totalHours = 0;
        Object.values(shifts).forEach(label => {
            if (!label || label === "OFF" || !label.includes("-")) return;
            const [start, end] = label.split(" - ");
            const [sH, sM] = start.split(":").map(Number);
            const [eH, eM] = end.split(":").map(Number);
            let hours = (eH + eM/60) - (sH + sM/60);
            if (hours > 6) hours -= 1; // 1h break
            if (hours > 0) totalHours += hours;
        });
        return Math.floor(totalHours * hourlyWage);
    };

    const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"];

    return (
        <div className="card">
            {deadlinePassed && (
                <div
                    style={{
                        padding: "0.75rem 1rem",
                        marginBottom: "1rem",
                        backgroundColor: "#FEF3C7",
                        border: "1px solid #F59E0B",
                        borderRadius: "var(--radius-md)",
                        color: "#92400E",
                        fontWeight: 500,
                    }}
                >
                    この月のシフト提出は締め切りを過ぎているため、編集できません。
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                    <h3 style={{ fontSize: "1.25rem" }}>{year}年 {month + 1}月</h3>
                    <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                        概算給与: <span style={{ fontWeight: "bold", color: "var(--primary)" }}>¥{calculateSalary().toLocaleString()}</span> (時給 ¥{hourlyWage})
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={loading || deadlinePassed}
                >
                    {loading ? "保存中..." : deadlinePassed ? "締切済" : "提出内容を保存"}
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", backgroundColor: "var(--border)", border: "1px solid var(--border)", opacity: deadlinePassed ? 0.85 : 1 }}>
                {/* Headers */}
                {dayOfWeek.map(d => (
                    <div key={d} style={{ backgroundColor: 'var(--surface-hover)', padding: '0.5rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 600 }}>
                        {d}
                    </div>
                ))}

                {/* Calendar Grid */}
                {daysArray.map(day => {
                    const date = new Date(year, month, day);
                    const dow = date.getDay();
                    const isWeekend = dow === 0 || dow === 6;

                    return (
                        <div
                            key={day}
                            onClick={() => handleShiftClick(day)}
                            style={{
                                backgroundColor: "var(--surface)",
                                minHeight: "100px",
                                padding: "0.5rem",
                                cursor: deadlinePassed ? "default" : "pointer",
                                color: isWeekend ? "var(--destructive)" : "inherit",
                                position: "relative",
                                transition: "background-color 0.2s",
                            }}
                            className="calendar-cell"
                        >
                            <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{day}</div>

                            {shifts[day] && (
                                <div style={{
                                    backgroundColor: shifts[day] === 'OFF' ? '#F3F4F6' : '#EEF2FF',
                                    color: shifts[day] === 'OFF' ? '#4B5563' : '#4F46E5',
                                    padding: '0.1rem',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                    textAlign: 'center',
                                    fontWeight: 500,
                                    lineHeight: '1.2'
                                }}>
                                    {shifts[day] === 'OFF' ? 'OFF' : '9-18'}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
