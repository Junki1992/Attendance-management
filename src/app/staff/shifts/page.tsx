"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserShifts, saveShift, deleteShift, Shift } from "@/services/shiftService";
import { getUserProfile, getAdminIds } from "@/services/userService";
import { createNotification } from "@/services/notificationService";
import { isPastSubmitDeadline } from "@/services/settingsService";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function calcHours(label: string): number {
    if (!label || label === "OFF" || !label.includes("-")) return 0;
    const [start, end] = label.split(" - ");
    const [sH, sM] = start.split(":").map(Number);
    const [eH, eM] = end.split(":").map(Number);
    let h = eH + eM / 60 - (sH + sM / 60);
    if (h > 6) h -= 1;
    return h > 0 ? h : 0;
}

/** 指定日が今日より前か（月内でも過去日は編集不可） */
function isPastDate(year: number, month: number, day: number): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cellDate = new Date(year, month, day);
    cellDate.setHours(0, 0, 0, 0);
    return cellDate < today;
}

export default function ShiftCalendar() {
    const { user } = useAuth();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [shifts, setShifts] = useState<{ [key: number]: string }>({});
    const [remoteByDay, setRemoteByDay] = useState<{ [key: number]: boolean }>({});
    const [confirmedByDay, setConfirmedByDay] = useState<{ [key: number]: boolean }>({});
    const [loading, setLoading] = useState(false);
    const [hourlyWage, setHourlyWage] = useState(1000);
    const [deadlinePassed, setDeadlinePassed] = useState(false);
    const [bulkStart, setBulkStart] = useState("09:00");
    const [bulkEnd, setBulkEnd] = useState("18:00");
    const [bulkIsOff, setBulkIsOff] = useState(false);
    const [bulkIsRemote, setBulkIsRemote] = useState(false);
    const [bulkSelectedDays, setBulkSelectedDays] = useState<number[]>([]);
    const [detailModalDay, setDetailModalDay] = useState<number | null>(null);
    const [lastSavedShifts, setLastSavedShifts] = useState<{ [key: number]: string }>({});
    const [lastSavedRemoteByDay, setLastSavedRemoteByDay] = useState<{ [key: number]: boolean }>({});
    const dragStartDayRef = useRef<number | null>(null);
    const hasMovedRef = useRef(false);
    const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

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
                const remoteMap: { [key: number]: boolean } = {};
                const confirmedMap: { [key: number]: boolean } = {};
                data.forEach((s) => {
                    const day = parseInt(s.date.split("-")[2], 10);
                    if (s.startTime === "00:00" && s.endTime === "00:00") {
                        shiftMap[day] = "OFF";
                    } else {
                        shiftMap[day] = `${s.startTime} - ${s.endTime}`;
                    }
                    if (s.isRemote) remoteMap[day] = true;
                    if (s.status === "confirmed") confirmedMap[day] = true;
                });
                setShifts(shiftMap);
                setRemoteByDay(remoteMap);
                setConfirmedByDay(confirmedMap);
                setLastSavedShifts(shiftMap);
                setLastSavedRemoteByDay(remoteMap);
            } catch (error) {
                console.error("Failed to fetch data", error);
            }
        };
        init();
    }, [user, year, month]);

    useEffect(() => {
        setBulkSelectedDays([]);
    }, [year, month]);

    const monthIsConfirmed = Object.keys(confirmedByDay).length > 0;

    const getRangeDays = useCallback((from: number, to: number) => {
        const [min, max] = from <= to ? [from, to] : [to, from];
        return Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
            (d) => d >= 1 && d <= daysInMonth
        );
    }, [daysInMonth]);

    const handleDayPointerDown = useCallback((e: React.PointerEvent, day: number) => {
        e.preventDefault();
        dragStartDayRef.current = day;
        hasMovedRef.current = false;
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    useEffect(() => {
        const DRAG_THRESHOLD = 5;
        const handlePointerMove = (e: PointerEvent) => {
            if (deadlinePassed || monthIsConfirmed) return;
            const start = dragStartDayRef.current;
            const pos = pointerStartRef.current;
            if (start === null || pos === null) return;
            const dx = e.clientX - pos.x;
            const dy = e.clientY - pos.y;
            if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) hasMovedRef.current = true;
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const dayEl = target?.closest("[data-day]");
            const dayStr = dayEl?.getAttribute("data-day");
            if (dayStr) {
                const day = parseInt(dayStr, 10);
                const range = getRangeDays(start, day).filter((d) => !confirmedByDay[d] && !isPastDate(year, month, d));
                if (range.length > 1) {
                    setBulkSelectedDays(range);
                } else if (range.length === 1) {
                    setBulkSelectedDays((prev) =>
                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                    );
                }
            }
        };
        const handlePointerUp = (e: PointerEvent) => {
            const start = dragStartDayRef.current;
            if (start === null) return;
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const dayEl = target?.closest("[data-day]");
            const dayStr = dayEl?.getAttribute("data-day");
            const day = dayStr ? parseInt(dayStr, 10) : null;
            if (!hasMovedRef.current && day !== null) {
                if (confirmedByDay[day]) {
                    setDetailModalDay(day);
                } else if (!deadlinePassed && !monthIsConfirmed && !isPastDate(year, month, day)) {
                    setBulkSelectedDays((prev) =>
                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                    );
                }
            }
            dragStartDayRef.current = null;
            pointerStartRef.current = null;
        };
        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
        document.addEventListener("pointercancel", handlePointerUp);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerup", handlePointerUp);
            document.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [deadlinePassed, monthIsConfirmed, getRangeDays, confirmedByDay, year, month]);

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

    const formatShiftLabel = (label: string) => {
        if (!label || label === "OFF") return "OFF";
        return label.replace(" - ", "-");
    };

    const bulkSelectWeekdays = () => {
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
            const dow = new Date(year, month, d).getDay();
            return dow >= 1 && dow <= 5 && !confirmedByDay[d] && !isPastDate(year, month, d);
        });
        setBulkSelectedDays(days);
    };
    const bulkSelectWeekends = () => {
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
            const dow = new Date(year, month, d).getDay();
            return (dow === 0 || dow === 6) && !confirmedByDay[d] && !isPastDate(year, month, d);
        });
        setBulkSelectedDays(days);
    };
    const bulkSelectAll = () => setBulkSelectedDays(Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => !confirmedByDay[d] && !isPastDate(year, month, d)));
    const bulkClearSelection = () => setBulkSelectedDays([]);

    const applyBulkShift = () => {
        if (deadlinePassed || monthIsConfirmed) return;
        const targetDays = bulkSelectedDays.filter((d) => d >= 1 && d <= daysInMonth && !confirmedByDay[d] && !isPastDate(year, month, d));
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
        setRemoteByDay((prev) => {
            const next = { ...prev };
            targetDays.forEach((d) => (next[d] = bulkIsOff ? false : bulkIsRemote));
            return next;
        });
        alert(`${targetDays.length}日分を一括で設定しました。内容を確認して「提出内容を保存」で送信してください。`);
    };

    const handleSave = async () => {
        if (!user || deadlinePassed || monthIsConfirmed) return;
        setLoading(true);
        try {
            const promises = Object.entries(shifts)
                .filter(([dayStr]) => {
                    const d = parseInt(dayStr, 10);
                    return !confirmedByDay[d] && !isPastDate(year, month, d);
                })
                .map(async ([dayStr, label]) => {
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
                    isRemote: remoteByDay[day] ?? false,
                };
                return saveShift(shiftData);
            });
            await Promise.all(promises);
            setLastSavedShifts({ ...shifts });
            setLastSavedRemoteByDay({ ...remoteByDay });
            try {
                const adminIds = await getAdminIds();
                const message = `${user.name}さんが${month + 1}月のシフトを提出しました`;
                await Promise.all(adminIds.map((adminId) => createNotification(adminId, "shift_submitted", message)));
            } catch (notifErr) {
                console.warn("[staff/shifts] 管理者への通知作成に失敗", notifErr);
            }
            alert("シフトを保存しました！");
        } catch (error) {
            console.error("Error saving:", error);
            alert("保存に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    const hasShiftsToSave = Object.keys(shifts).some((dayStr) => {
        const d = parseInt(dayStr, 10);
        return !confirmedByDay[d] && !isPastDate(year, month, d);
    });

    const hasChanges = (() => {
        for (let d = 1; d <= daysInMonth; d++) {
            if (confirmedByDay[d] || isPastDate(year, month, d)) continue;
            const cur = shifts[d];
            const last = lastSavedShifts[d];
            const curRemote = remoteByDay[d] ?? false;
            const lastRemote = lastSavedRemoteByDay[d] ?? false;
            if (cur !== last || curRemote !== lastRemote) return true;
        }
        return false;
    })();

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
            {monthIsConfirmed && (
                <div
                    style={{
                        padding: "0.75rem 1rem",
                        marginBottom: "1rem",
                        backgroundColor: "#D1FAE5",
                        border: "1px solid #10B981",
                        borderRadius: "var(--radius-md)",
                        color: "#065F46",
                        fontWeight: 500,
                    }}
                >
                    この月のシフトは確定しています。
                </div>
            )}
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

            {detailModalDay != null && (
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
                    onClick={() => setDetailModalDay(null)}
                >
                    <div
                        className="card"
                        style={{ width: "90%", maxWidth: "360px" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ marginBottom: "1rem" }}>
                            {month + 1}月{detailModalDay}日
                            {dayOfWeek[new Date(year, month, detailModalDay).getDay()]}のシフト
                        </h3>
                        {(() => {
                            const label = shifts[detailModalDay];
                            const isConfirmed = confirmedByDay[detailModalDay];
                            if (!label) {
                                return (
                                    <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                                        この日のシフトは未入力です
                                    </p>
                                );
                            }
                            const isOff = label === "OFF";
                            const hours = calcHours(label);
                            return (
                                <>
                                    <div style={{ marginBottom: "1rem" }}>
                                        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                                            {isConfirmed ? "確定シフト" : "提出シフト"}
                                        </div>
                                        <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                                            {isOff ? "OFF" : label.replace(" - ", " ～ ")}
                                        </div>
                                        {!isOff && (
                                            <>
                                                <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                                                    {remoteByDay[detailModalDay] ? "在宅勤務" : "出社"}
                                                </div>
                                                <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                                                    勤務時間: <strong>{hours.toFixed(1)}h</strong>
                                                </div>
                                                <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                                                    時給: <strong>¥{hourlyWage.toLocaleString()}</strong>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                        <button className="btn btn-primary" onClick={() => setDetailModalDay(null)}>
                                            閉じる
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {!deadlinePassed && !monthIsConfirmed && (
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
                        日付をドラッグで範囲選択、またはクリックで個別に選択・解除 → 勤務時間を指定して「一括適用」
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
                        <button type="button" className="btn btn-outline" onClick={bulkClearSelection} disabled={bulkSelectedDays.length === 0} style={{ fontSize: "0.75rem" }}>
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
                                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", fontSize: "0.875rem" }}>
                                    <input type="checkbox" checked={bulkIsRemote} onChange={(e) => setBulkIsRemote(e.target.checked)} />
                                    在宅
                                </label>
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
                        <button type="button" className="btn btn-outline" onClick={applyBulkShift} disabled={bulkSelectedDays.length === 0} style={{ fontSize: "0.875rem" }}>
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
                    <button className="btn btn-primary" onClick={handleSave} disabled={loading || deadlinePassed || monthIsConfirmed || !hasShiftsToSave || !hasChanges}>
                        {loading ? "保存中..." : monthIsConfirmed ? "確定済" : deadlinePassed ? "締切済" : "提出内容を保存"}
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
                        const isConfirmed = confirmedByDay[day];
                        const isPast = isPastDate(year, month, day);
                        const isBulkSelected = bulkSelectedDays.includes(day);
                        const cellBg = isBulkSelected ? "rgba(79, 70, 229, 0.2)" : "var(--surface)";
                        const cellBorder = isBulkSelected ? "2px solid var(--primary)" : undefined;
                        const isEditable = !deadlinePassed && !isConfirmed && !monthIsConfirmed && !isPast;
                        return (
                            <div
                                key={day}
                                role="button"
                                tabIndex={0}
                                data-day={day}
                                title={isPast ? "過去の日付は編集できません" : isConfirmed ? "クリックで詳細表示" : isEditable ? "クリックで選択・解除" : undefined}
                                onPointerDown={(e) => handleDayPointerDown(e, day)}
                                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && day !== null && confirmedByDay[day]) { e.preventDefault(); setDetailModalDay(day); } }}
                                style={{
                                    backgroundColor: isPast ? "var(--surface-hover)" : cellBg,
                                    opacity: isPast ? 0.7 : 1,
                                    minHeight: "80px",
                                    padding: "0.4rem 0.25rem",
                                    cursor: isEditable || isConfirmed ? "pointer" : (isPast ? "default" : (monthIsConfirmed ? "not-allowed" : "default")),
                                    position: "relative",
                                    transition: "background-color 0.15s",
                                    border: cellBorder,
                                    boxSizing: "border-box",
                                    minWidth: 0,
                                }}
                            >
                                <div style={{ fontWeight: isRed ? "bold" : 500, fontSize: "0.85rem", marginBottom: "0.25rem", color: isRed ? "#DC2626" : "var(--text-main)" }}>{day}</div>
                                {(() => {
                                    const displayLabel = shifts[day] ?? (monthIsConfirmed ? "OFF" : null);
                                    if (!displayLabel) return null;
                                    return (
                                        <div
                                            style={{
                                                backgroundColor: isConfirmed ? "#D1FAE5" : (displayLabel === "OFF" ? "#F3F4F6" : "#EEF2FF"),
                                                color: isConfirmed ? "#065F46" : (displayLabel === "OFF" ? "#4B5563" : "#4F46E5"),
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
                                            {formatShiftLabel(displayLabel)}{remoteByDay[day] ? " 在宅" : ""}{isConfirmed ? " 確定" : ""}
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
}
