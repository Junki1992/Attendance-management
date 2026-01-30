"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserShifts, saveShift, deleteShift, Shift } from "@/services/shiftService";
import { getUserProfile } from "@/services/userService";
import { isPastSubmitDeadline } from "@/services/settingsService";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

export default function ShiftCalendar() {
    const { user } = useAuth();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [shifts, setShifts] = useState<{ [key: number]: string }>({});
    const [loading, setLoading] = useState(false);
    const [hourlyWage, setHourlyWage] = useState(1000);
    const [deadlinePassed, setDeadlinePassed] = useState(false);
    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [modalStart, setModalStart] = useState("09:00");
    const [modalEnd, setModalEnd] = useState("18:00");
    const [modalIsOff, setModalIsOff] = useState(false);
    const [bulkStart, setBulkStart] = useState("09:00");
    const [bulkEnd, setBulkEnd] = useState("18:00");
    const [bulkIsOff, setBulkIsOff] = useState(false);
    const [bulkSelectedDays, setBulkSelectedDays] = useState<number[]>([]);
    const [dragStartDay, setDragStartDay] = useState<number | null>(null);
    const [dragCurrentDay, setDragCurrentDay] = useState<number | null>(null);
    const openModalRef = useRef<(day: number) => void>(() => {});

    const daysInMonth = getDaysInMonth(year, month);
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const leadingBlanks = Array.from({ length: firstDayOfWeek }, () => null);
    const daysArray: (number | null)[] = [...leadingBlanks, ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

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

    useEffect(() => {
        setBulkSelectedDays([]);
        setDragStartDay(null);
        setDragCurrentDay(null);
    }, [year, month]);

    useEffect(() => {
        if (dragStartDay === null) return;
        const onMouseUp = () => {
            const start = dragStartDay;
            const current = dragCurrentDay ?? start;
            const lo = Math.min(start, current);
            const hi = Math.max(start, current);
            const moved = dragCurrentDay !== null && dragCurrentDay !== dragStartDay;
            if (moved) {
                setBulkSelectedDays(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
            } else {
                openModalRef.current(start);
            }
            setDragStartDay(null);
            setDragCurrentDay(null);
        };
        window.addEventListener("mouseup", onMouseUp);
        return () => window.removeEventListener("mouseup", onMouseUp);
    }, [dragStartDay, dragCurrentDay]);

    const changeMonth = (delta: number) => {
        let m = month + delta;
        let y = year;
        if (m > 11) {
            m = 0;
            y += 1;
        } else if (m < 0) {
            m = 11;
            y -= 1;
        }
        setMonth(m);
        setYear(y);
    };

    const handleShiftClick = (day: number) => {
        if (deadlinePassed) return;
        const current = shifts[day];
        if (current === "OFF") {
            setModalIsOff(true);
            setModalStart("09:00");
            setModalEnd("18:00");
        } else if (current && current.includes(" - ")) {
            const [s, e] = current.split(" - ");
            setModalStart(s ?? "09:00");
            setModalEnd(e ?? "18:00");
            setModalIsOff(false);
        } else {
            setModalStart("09:00");
            setModalEnd("18:00");
            setModalIsOff(false);
        }
        setEditingDay(day);
    };
    openModalRef.current = handleShiftClick;

    const applyModalShift = () => {
        if (editingDay === null) return;
        if (modalIsOff) {
            setShifts((prev) => ({ ...prev, [editingDay]: "OFF" }));
        } else {
            const startM = parseInt(modalStart.slice(0, 2), 10) * 60 + parseInt(modalStart.slice(3), 10);
            const endM = parseInt(modalEnd.slice(0, 2), 10) * 60 + parseInt(modalEnd.slice(3), 10);
            if (startM >= endM) {
                alert("終了時刻は開始時刻より後にしてください。");
                return;
            }
            setShifts((prev) => ({ ...prev, [editingDay]: `${modalStart} - ${modalEnd}` }));
        }
        setEditingDay(null);
    };

    const formatShiftLabel = (label: string) => {
        if (!label || label === "OFF") return "OFF";
        return label.replace(" - ", "-");
    };

    const bulkSelectWeekdays = () => {
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
            const dow = new Date(year, month, d).getDay();
            return dow >= 1 && dow <= 5;
        });
        setBulkSelectedDays(days);
    };
    const bulkSelectWeekends = () => {
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
            const dow = new Date(year, month, d).getDay();
            return dow === 0 || dow === 6;
        });
        setBulkSelectedDays(days);
    };
    const bulkSelectAll = () => setBulkSelectedDays(Array.from({ length: daysInMonth }, (_, i) => i + 1));
    const bulkClearSelection = () => setBulkSelectedDays([]);

    const applyBulkShift = () => {
        if (deadlinePassed) return;
        const targetDays = bulkSelectedDays.filter((d) => d >= 1 && d <= daysInMonth);
        if (targetDays.length === 0) {
            alert("適用する日を1日以上選択してください。");
            return;
        }
        const value = bulkIsOff ? "OFF" : `${bulkStart} - ${bulkEnd}`;
        if (!bulkIsOff) {
            const startM = parseInt(bulkStart.slice(0, 2), 10) * 60 + parseInt(bulkStart.slice(3), 10);
            const endM = parseInt(bulkEnd.slice(0, 2), 10) * 60 + parseInt(bulkEnd.slice(3), 10);
            if (startM >= endM) {
                alert("終了時刻は開始時刻より後にしてください。");
                return;
            }
        }
        setShifts((prev) => {
            const next = { ...prev };
            targetDays.forEach((d) => (next[d] = value));
            return next;
        });
        alert(`${targetDays.length}日分を一括で設定しました。内容を確認して「提出内容を保存」で送信してください。`);
    };

    const handleSave = async () => {
        if (!user || deadlinePassed) return;
        setLoading(true);
        try {
            const promises = Object.entries(shifts).map(async ([dayStr, label]) => {
                const day = parseInt(dayStr, 10);
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                let start = "",
                    end = "";
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
                    status: "submitted",
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

    const calculateSalary = () => {
        let totalHours = 0;
        Object.values(shifts).forEach((label) => {
            if (!label || label === "OFF" || !label.includes("-")) return;
            const [start, end] = label.split(" - ");
            const [sH, sM] = start.split(":").map(Number);
            const [eH, eM] = end.split(":").map(Number);
            let hours = eH + eM / 60 - (sH + sM / 60);
            if (hours > 6) hours -= 1;
            if (hours > 0) totalHours += hours;
        });
        return Math.floor(totalHours * hourlyWage);
    };

    const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"];

    return (
        <div className="card" style={{ overflow: "visible", maxWidth: "100%", minWidth: 0 }}>
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

            {!deadlinePassed && (
                <div
                    style={{
                        marginBottom: "1rem",
                        padding: "0.75rem 1rem",
                        backgroundColor: "var(--surface-hover)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                    }}
                >
                    <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>一括設定</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                        カレンダーでドラッグして日付を選択 → 勤務時間を指定して「一括適用」
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 0.75rem", marginBottom: "0.5rem" }}>
                        <button type="button" className="btn btn-outline" onClick={bulkSelectWeekdays} style={{ fontSize: "0.75rem" }}>
                            平日を選択
                        </button>
                        <button type="button" className="btn btn-outline" onClick={bulkSelectWeekends} style={{ fontSize: "0.75rem" }}>
                            土日を選択
                        </button>
                        <button type="button" className="btn btn-outline" onClick={bulkSelectAll} style={{ fontSize: "0.75rem" }}>
                            全選択
                        </button>
                        <button type="button" className="btn btn-outline" onClick={bulkClearSelection} style={{ fontSize: "0.75rem" }}>
                            クリア
                        </button>
                        {bulkSelectedDays.length > 0 && (
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{bulkSelectedDays.length}日選択中</span>
                        )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 0.75rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", fontSize: "0.875rem" }}>
                            <input type="checkbox" checked={bulkIsOff} onChange={(e) => setBulkIsOff(e.target.checked)} />
                            OFF（休み）
                        </label>
                        {!bulkIsOff && (
                            <>
                                <input
                                    type="time"
                                    value={bulkStart}
                                    onChange={(e) => setBulkStart(e.target.value)}
                                    style={{ padding: "0.35rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "0.875rem" }}
                                />
                                <span style={{ fontSize: "0.875rem" }}>～</span>
                                <input
                                    type="time"
                                    value={bulkEnd}
                                    onChange={(e) => setBulkEnd(e.target.value)}
                                    style={{ padding: "0.35rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "0.875rem" }}
                                />
                            </>
                        )}
                        <button type="button" className="btn btn-outline" onClick={applyBulkShift} style={{ fontSize: "0.875rem" }}>
                            一括適用
                        </button>
                    </div>
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button type="button" onClick={() => changeMonth(-1)} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "var(--radius-md)", padding: "0.35rem 0.6rem", cursor: "pointer", fontSize: "1rem", color: "var(--text-main)", lineHeight: 1 }}>
                        ◀
                    </button>
                    <h3 style={{ fontSize: "1.25rem", minWidth: "120px", textAlign: "center" }}>{year}年 {month + 1}月</h3>
                    <button type="button" onClick={() => changeMonth(1)} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "var(--radius-md)", padding: "0.35rem 0.6rem", cursor: "pointer", fontSize: "1rem", color: "var(--text-main)", lineHeight: 1 }}>
                        ▶
                    </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                        概算給与: <span style={{ fontWeight: "bold", color: "var(--primary)" }}>¥{calculateSalary().toLocaleString()}</span> (時給 ¥{hourlyWage})
                    </div>
                    <button className="btn btn-primary" onClick={handleSave} disabled={loading || deadlinePassed}>
                        {loading ? "保存中..." : deadlinePassed ? "締切済" : "提出内容を保存"}
                    </button>
                </div>
            </div>

            <div
                style={{
                    overflowX: "auto",
                    overflowY: "visible",
                    marginLeft: "-0.25rem",
                    marginRight: "-0.25rem",
                    paddingLeft: "0.25rem",
                    paddingRight: "0.25rem",
                    WebkitOverflowScrolling: "touch",
                    borderRadius: "var(--radius-md)",
                }}
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                        gap: "1px",
                        backgroundColor: "var(--border)",
                        border: "1px solid var(--border)",
                        opacity: deadlinePassed ? 0.85 : 1,
                        userSelect: dragStartDay !== null ? "none" : undefined,
                        minWidth: "280px",
                    }}
                >
                    {dayOfWeek.map((d) => (
                        <div key={d} style={{ backgroundColor: "var(--surface-hover)", padding: "0.4rem 0.25rem", textAlign: "center", fontSize: "0.8rem", fontWeight: 600, minWidth: 0 }}>
                            {d}
                        </div>
                    ))}
                    {daysArray.map((day, index) => {
                        if (day === null) {
                            return <div key={`empty-${index}`} style={{ backgroundColor: "var(--surface-hover)", minHeight: "80px", padding: "0.4rem", minWidth: 0 }} />;
                        }
                        const date = new Date(year, month, day);
                        const dow = date.getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        const isHoliday = isJapaneseHoliday(date);
                        const isRed = isWeekend || isHoliday;
                        const isBulkSelected = bulkSelectedDays.includes(day);
                        const dragLo = dragStartDay !== null ? Math.min(dragStartDay, dragCurrentDay ?? dragStartDay) : 0;
                        const dragHi = dragStartDay !== null ? Math.max(dragStartDay, dragCurrentDay ?? dragStartDay) : 0;
                        const isInDragRange = dragStartDay !== null && day >= dragLo && day <= dragHi;
                        const cellBg =
                            isInDragRange
                                ? "rgba(79, 70, 229, 0.25)"
                                : isBulkSelected
                                  ? "rgba(79, 70, 229, 0.15)"
                                  : "var(--surface)";
                        const cellBorder = isBulkSelected || isInDragRange ? "2px solid var(--primary)" : undefined;
                        return (
                            <div
                                key={day}
                                onMouseDown={() => !deadlinePassed && setDragStartDay(day)}
                                onMouseEnter={() => dragStartDay !== null && setDragCurrentDay(day)}
                                style={{
                                    backgroundColor: cellBg,
                                    minHeight: "80px",
                                    padding: "0.4rem 0.25rem",
                                    cursor: deadlinePassed ? "default" : "pointer",
                                    position: "relative",
                                    transition: "background-color 0.15s",
                                    border: cellBorder,
                                    boxSizing: "border-box",
                                    minWidth: 0,
                                }}
                            >
                                <div style={{ fontWeight: isRed ? "bold" : 500, fontSize: "0.85rem", marginBottom: "0.25rem", color: isRed ? "#DC2626" : "var(--text-main)" }}>{day}</div>
                                {shifts[day] && (
                                    <div
                                        style={{
                                            backgroundColor: shifts[day] === "OFF" ? "#F3F4F6" : "#EEF2FF",
                                            color: shifts[day] === "OFF" ? "#4B5563" : "#4F46E5",
                                            padding: "0.15rem 0.2rem",
                                            borderRadius: "4px",
                                            fontSize: "0.65rem",
                                            textAlign: "center",
                                            fontWeight: 500,
                                            lineHeight: "1.2",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {formatShiftLabel(shifts[day])}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 時刻選択モーダル */}
            {editingDay !== null && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        backgroundColor: "rgba(0,0,0,0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 50,
                    }}
                    onClick={() => setEditingDay(null)}
                >
                    <div
                        className="card"
                        style={{ minWidth: "280px", maxWidth: "90%" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>{month + 1}月{editingDay}日　勤務時間</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                                <input type="checkbox" checked={modalIsOff} onChange={(e) => setModalIsOff(e.target.checked)} />
                                OFF（休み）
                            </label>
                            {!modalIsOff && (
                                <>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                        <label style={{ fontSize: "0.875rem" }}>開始</label>
                                        <input
                                            type="time"
                                            value={modalStart}
                                            onChange={(e) => setModalStart(e.target.value)}
                                            style={{ padding: "0.35rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
                                        />
                                        <label style={{ fontSize: "0.875rem" }}>終了</label>
                                        <input
                                            type="time"
                                            value={modalEnd}
                                            onChange={(e) => setModalEnd(e.target.value)}
                                            style={{ padding: "0.35rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
                                        />
                                    </div>
                                </>
                            )}
                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                                <button type="button" className="btn btn-primary" onClick={applyModalShift}>
                                    適用
                                </button>
                                <button type="button" className="btn btn-outline" onClick={() => setEditingDay(null)}>
                                    キャンセル
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
