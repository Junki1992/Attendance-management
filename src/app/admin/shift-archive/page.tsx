"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import {
    listArchivedShiftUsers,
    getAllArchivedShiftsForMonth,
    commitShiftArchiveTsvImport,
    type ShiftArchiveUserMeta,
} from "@/services/shiftArchiveService";
import type { Shift, ShiftWorkType } from "@/services/shiftService";
import { getShiftWorkType, getShiftWorkTypeLabel } from "@/services/shiftService";
import type { ParsedSheetCell } from "@/lib/shiftSheetTsv";
import { archiveUserKeyFromDisplayName } from "@/lib/archiveUserKey";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";
import styles from "./shift-archive.module.css";

const MOBILE_BREAKPOINT = 768;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatCellLabel(shift: Shift): string {
    if (!shift || (shift.startTime === "00:00" && shift.endTime === "00:00")) return "OFF";
    const sH = parseInt(shift.startTime.slice(0, 2), 10);
    const eH = parseInt(shift.endTime.slice(0, 2), 10);
    const timeStr = `${sH}-${eH}`;
    const workLabel = getShiftWorkType(shift) !== "office" ? ` ${getShiftWorkTypeLabel(shift)}` : "";
    return timeStr + workLabel;
}

function statusLabel(s: Shift["status"]): string {
    if (s === "confirmed") return "確定";
    if (s === "submitted") return "提出済";
    return "下書き";
}

function formatArchivedAt(ts: Timestamp): string {
    try {
        const d = ts.toDate();
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
        return "—";
    }
}

type ManualMode = "off" | ShiftWorkType;

type ManualDayState = {
    mode: ManualMode;
    startTime: string;
    endTime: string;
};

function defaultManualDayState(): ManualDayState {
    return { mode: "off", startTime: "10:00", endTime: "18:00" };
}

function formatManualCellLabel(s: ManualDayState): string {
    if (s.mode === "off") return "OFF";
    if (s.mode === "absence") return "当欠";
    const sH = parseInt(s.startTime.slice(0, 2), 10);
    const eH = parseInt(s.endTime.slice(0, 2), 10);
    const timeStr = `${sH}-${eH}`;
    const workLabel = s.mode === "remote" ? " 在宅" : "";
    return timeStr + workLabel;
}

/** `<input type="time">` の値が環境により `HH:MM:SS` になることがあるので HH:MM に揃える */
function timeInputValueToHm(raw: string): string {
    const t = raw.trim();
    if (t.length >= 5 && t[4] === ":") {
        return t.slice(0, 5);
    }
    return t;
}

/** "9:30" / "09:30" → "09:30" */
function normalizeHm(raw: string): string | null {
    const t = raw.trim();
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
        return null;
    }
    const h = parseInt(m[1]!, 10);
    const min = m[2]!;
    const mi = parseInt(min, 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) {
        return null;
    }
    return `${String(h).padStart(2, "0")}:${min}`;
}

/** 一括適用前の検証（出社・在宅は時間必須） */
function validateManualTemplate(state: ManualDayState): string | null {
    if (state.mode === "off" || state.mode === "absence") {
        return null;
    }
    if (!normalizeHm(state.startTime) || !normalizeHm(state.endTime)) {
        return "出社・在宅のときは開始・終了を HH:MM（例 10:00）で入力してください。";
    }
    return null;
}

function buildArchiveRowsFromManual(
    year: number,
    monthIndex: number,
    byDay: Record<number, ManualDayState>
): { ok: true; data: Array<{ dateStr: string; cell: ParsedSheetCell }> } | { ok: false; error: string } {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const out: Array<{ dateStr: string; cell: ParsedSheetCell }> = [];

    for (let d = 1; d <= lastDay; d++) {
        const r = byDay[d];
        if (!r) {
            continue;
        }

        const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

        if (r.mode === "off") {
            out.push({ dateStr, cell: { kind: "off" } });
            continue;
        }

        if (r.mode === "absence") {
            out.push({
                dateStr,
                cell: { kind: "shift", startTime: "00:00", endTime: "00:00", workType: "absence" },
            });
            continue;
        }

        const st = normalizeHm(r.startTime);
        const et = normalizeHm(r.endTime);
        if (!st || !et) {
            return { ok: false, error: `${d}日: 開始・終了は HH:MM（例 10:00）で入力してください` };
        }
        out.push({
            dateStr,
            cell: { kind: "shift", startTime: st, endTime: et, workType: r.mode },
        });
    }

    if (out.length === 0) {
        return { ok: false, error: "保存する日がありません。カレンダーの日をタップして入力してください。" };
    }
    return { ok: true, data: out };
}

export default function AdminShiftArchivePage() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [users, setUsers] = useState<ShiftArchiveUserMeta[]>([]);
    const [allMonthShifts, setAllMonthShifts] = useState<Shift[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingShifts, setLoadingShifts] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    const [manualYear, setManualYear] = useState(now.getFullYear());
    const [manualMonth, setManualMonth] = useState(now.getMonth());
    /** 空: 未選択 / Firebase UID または name_* / "__name__" = 手動で名前入力 */
    const [manualStaffChoice, setManualStaffChoice] = useState("");
    const [manualFreeName, setManualFreeName] = useState("");
    const [manualByDay, setManualByDay] = useState<Record<number, ManualDayState>>({});
    const [savingManual, setSavingManual] = useState(false);
    const [saveNotice, setSaveNotice] = useState<string | null>(null);

    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [draft, setDraft] = useState<ManualDayState>(defaultManualDayState);

    const [selectMode, setSelectMode] = useState(false);
    const [selectedDays, setSelectedDays] = useState<Set<number>>(() => new Set());
    const [bulkModalOpen, setBulkModalOpen] = useState(false);
    const [bulkDraft, setBulkDraft] = useState<ManualDayState>(defaultManualDayState);

    const lastDayOfManualMonth = new Date(manualYear, manualMonth + 1, 0).getDate();
    const DAYS = useMemo(
        () => Array.from({ length: lastDayOfManualMonth }, (_, i) => i + 1),
        [lastDayOfManualMonth]
    );

    const pickedArchiveMeta = useMemo(() => {
        if (!manualStaffChoice || manualStaffChoice === "__name__") {
            return null;
        }
        return users.find((u) => u.userId === manualStaffChoice) ?? null;
    }, [manualStaffChoice, users]);

    const manualRowDisplayName = useMemo(() => {
        if (manualStaffChoice === "__name__") {
            return manualFreeName.trim() || "（名前未入力）";
        }
        if (pickedArchiveMeta) {
            return pickedArchiveMeta.archivedUserName;
        }
        return "（スタッフを選択）";
    }, [manualStaffChoice, manualFreeName, pickedArchiveMeta]);

    const canSubmitManualStaff =
        Boolean(manualStaffChoice) &&
        (manualStaffChoice !== "__name__" || manualFreeName.trim().length > 0);

    useEffect(() => {
        setManualByDay({});
        setSelectedDays(new Set());
        setBulkModalOpen(false);
    }, [manualYear, manualMonth]);

    useEffect(() => {
        if (!selectMode) {
            setBulkModalOpen(false);
        }
    }, [selectMode]);

    const loadUsers = useCallback(async () => {
        setLoadingList(true);
        setError(null);
        try {
            const list = await listArchivedShiftUsers();
            setUsers(list);
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : "一覧の取得に失敗しました");
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        setLoadingShifts(true);
        setError(null);
        getAllArchivedShiftsForMonth(year, month)
            .then(setAllMonthShifts)
            .catch((e) => {
                console.error(e);
                setError(e instanceof Error ? e.message : "シフトの取得に失敗しました");
                setAllMonthShifts([]);
            })
            .finally(() => setLoadingShifts(false));
    }, [year, month]);

    const shiftsByUserAndDate = useMemo(() => {
        const m: Record<string, Record<string, Shift>> = {};
        for (const s of allMonthShifts) {
            if (!m[s.userId]) {
                m[s.userId] = {};
            }
            m[s.userId][s.date] = s;
        }
        return m;
    }, [allMonthShifts]);

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

    const changeManualMonth = (delta: number) => {
        let m = manualMonth + delta;
        let y = manualYear;
        if (m > 11) {
            m = 0;
            y += 1;
        } else if (m < 0) {
            m = 11;
            y -= 1;
        }
        setManualMonth(m);
        setManualYear(y);
    };

    const openDay = (day: number) => {
        if (selectMode) {
            setSelectedDays((prev) => {
                const next = new Set(prev);
                if (next.has(day)) {
                    next.delete(day);
                } else {
                    next.add(day);
                }
                return next;
            });
            return;
        }
        setEditingDay(day);
        const existing = manualByDay[day];
        setDraft(existing ? { ...existing } : defaultManualDayState());
    };

    const selectAllDaysInMonth = () => {
        setSelectedDays(new Set(DAYS));
    };

    const clearDaySelection = () => {
        setSelectedDays(new Set());
    };

    const applyBulkToSelection = () => {
        const err = validateManualTemplate(bulkDraft);
        if (err) {
            setSaveNotice(err);
            return;
        }
        const count = selectedDays.size;
        if (count === 0) {
            return;
        }
        setManualByDay((prev) => {
            const next = { ...prev };
            for (const d of selectedDays) {
                next[d] = { ...bulkDraft };
            }
            return next;
        });
        setBulkModalOpen(false);
        setSelectedDays(new Set());
        setSaveNotice(`${count} 日に一括で反映しました。`);
    };

    const clearSelectedDaysData = () => {
        const count = selectedDays.size;
        if (count === 0) {
            return;
        }
        if (!confirm(`選択中の ${count} 日分の入力を消します。よろしいですか？`)) {
            return;
        }
        setManualByDay((prev) => {
            const next = { ...prev };
            for (const d of selectedDays) {
                delete next[d];
            }
            return next;
        });
        setSelectedDays(new Set());
        setSaveNotice(`${count} 日分の入力を消しました。`);
    };

    const closeModal = () => {
        setEditingDay(null);
    };

    const saveDraftToDay = () => {
        if (editingDay == null) {
            return;
        }
        const d = editingDay;
        setManualByDay((prev) => ({ ...prev, [d]: { ...draft } }));
        closeModal();
    };

    const clearDay = () => {
        if (editingDay == null) {
            return;
        }
        const d = editingDay;
        setManualByDay((prev) => {
            const next = { ...prev };
            delete next[d];
            return next;
        });
        closeModal();
    };

    const handleManualSave = async () => {
        if (!manualStaffChoice) {
            setSaveNotice("スタッフを選択してください。");
            return;
        }
        let targetUserId: string;
        let archivedUserName: string;
        if (manualStaffChoice === "__name__") {
            const nameTrim = manualFreeName.trim();
            if (!nameTrim) {
                setSaveNotice("名前を入力してください。");
                return;
            }
            targetUserId = archiveUserKeyFromDisplayName(nameTrim);
            archivedUserName = nameTrim;
        } else {
            const meta = users.find((u) => u.userId === manualStaffChoice);
            if (!meta) {
                setSaveNotice("選択したスタッフが一覧に見つかりません。一覧を更新してから再度お試しください。");
                return;
            }
            targetUserId = meta.userId;
            archivedUserName = meta.archivedUserName;
        }
        const built = buildArchiveRowsFromManual(manualYear, manualMonth, manualByDay);
        if (!built.ok) {
            setSaveNotice(built.error);
            return;
        }
        setSavingManual(true);
        setSaveNotice(null);
        try {
            const { written } = await commitShiftArchiveTsvImport({
                targetUserId,
                archivedUserName,
                rows: built.data,
            });
            setSaveNotice(`${written} 件を退職者シフトに保存しました。`);
            loadUsers();
            setYear(manualYear);
            setMonth(manualMonth);
            const refreshed = await getAllArchivedShiftsForMonth(manualYear, manualMonth);
            setAllMonthShifts(refreshed);
        } catch (e) {
            console.error(e);
            setSaveNotice(e instanceof Error ? e.message : "保存に失敗しました");
        } finally {
            setSavingManual(false);
        }
    };

    const saveNoticeIsSuccess =
        saveNotice?.includes("保存しました") ||
        saveNotice?.includes("削除しました") ||
        saveNotice?.includes("一括で反映しました") ||
        saveNotice?.includes("入力を消しました");
    const saveNoticeIsError = Boolean(saveNotice && !saveNoticeIsSuccess);

    /** 登録カレンダー・閲覧カレンダー共通のセル配色（シフト表と同じ土日祝の考え方） */
    const getCalendarCellPalette = (calYear: number, calMonth0: number, day: number, hasData: boolean) => {
        const date = new Date(calYear, calMonth0, day);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isHoliday = isJapaneseHoliday(date);
        const baseBg = hasData
            ? "#EEF2FF"
            : isHoliday
              ? "rgba(254, 215, 170, 0.8)"
              : isWeekend
                ? "rgba(191, 219, 254, 0.8)"
                : "var(--surface-hover)";
        const headerBg = isHoliday ? "rgba(254, 215, 170, 0.8)" : isWeekend ? "rgba(191, 219, 254, 0.8)" : undefined;
        const headerColor = isHoliday ? "#EA580C" : isWeekend ? "#2563EB" : undefined;
        return { baseBg, headerBg, headerColor, isWeekend, isHoliday };
    };

    const mobileDaysArray = useMemo(() => {
        const firstDayOfWeek = new Date(manualYear, manualMonth, 1).getDay();
        const leading: (number | null)[] = Array.from({ length: firstDayOfWeek }, () => null);
        return [...leading, ...DAYS];
    }, [manualYear, manualMonth, DAYS]);

    const detailDays = useMemo(() => {
        const last = new Date(year, month + 1, 0).getDate();
        return Array.from({ length: last }, (_, i) => i + 1);
    }, [year, month]);

    const detailMobileDaysArray = useMemo(() => {
        const firstDayOfWeek = new Date(year, month, 1).getDay();
        const leading: (number | null)[] = Array.from({ length: firstDayOfWeek }, () => null);
        return [...leading, ...detailDays];
    }, [year, month, detailDays]);

    return (
        <div className={styles.page}>
            <header className={styles.pageHeader}>
                <h1 className={styles.pageTitle}>退職者シフト</h1>
                <p className={styles.pageLead}>
                    退職・削除済みのスタッフのシフトを閲覧します（現役のシフト表とは別データ）。
                    <strong>設定画面からユーザーを削除</strong>したとき、その人のシフトは自動でここにコピーされます。
                    この仕組み導入前に削除されたユーザーは表示されません。
                </p>
            </header>

            <section className={`${styles.section} ${styles.sectionImport}`} aria-labelledby="manual-heading">
                <div className={styles.sectionHeader}>
                    <h2 id="manual-heading" className={styles.sectionTitle}>
                        <span className={styles.sectionTitleBadge}>登録</span>
                        手動で退職者シフトを登録
                    </h2>
                </div>
                <div className={styles.sectionBody}>
                    <div className={styles.hint}>
                        まず<strong>スタッフ名</strong>は、削除済み・退職者シフト一覧にいる人を<strong>プルダウンで選択</strong>します（設定から削除された人もここに出ます）。
                        管理者の<strong>シフト表と同じく</strong>、月のカレンダー上の<strong>日をクリック</strong>して OFF / 出社・在宅・当欠と時間を入力します。
                        <strong>複数選択</strong>をオンにすると日をタップして複数選び、<strong>一括で設定</strong>できます。
                        未入力の日は保存されません。月を変えると入力中の内容はクリアされます。
                    </div>

                    <div className={styles.formGrid}>
                        <div className={styles.field}>
                            <label className={styles.fieldLabel} htmlFor="manual-staff-select">
                                スタッフ名
                            </label>
                            <select
                                id="manual-staff-select"
                                className={`${styles.input} ${styles.select}`}
                                style={{ width: "100%", maxWidth: "100%" }}
                                value={manualStaffChoice}
                                onChange={(e) => setManualStaffChoice(e.target.value)}
                                disabled={loadingList}
                            >
                                <option value="">
                                    {loadingList ? "一覧を読み込み中…" : "スタッフを選択"}
                                </option>
                                {users.map((u) => (
                                    <option key={u.userId} value={u.userId}>
                                        {u.archivedUserName}
                                    </option>
                                ))}
                                <option value="__name__">一覧にない（名前を手動入力）</option>
                            </select>
                            {manualStaffChoice === "__name__" && (
                                <input
                                    type="text"
                                    className={styles.input}
                                    style={{ marginTop: "0.5rem" }}
                                    placeholder="例: 〇〇 〇〇"
                                    value={manualFreeName}
                                    onChange={(e) => setManualFreeName(e.target.value)}
                                    autoComplete="name"
                                    aria-label="手動入力するスタッフ名"
                                />
                            )}
                            {!loadingList && users.length === 0 && (
                                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
                                    まだ退職者シフト一覧に誰もいません。設定からユーザーを削除すると自動で追加されます。「一覧にない」から名前だけ登録することもできます。
                                </p>
                            )}
                        </div>
                    </div>

                    <div className={styles.calendarToolbar}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => changeManualMonth(-1)}
                                style={{ padding: "0.25rem 0.5rem" }}
                            >
                                ‹
                            </button>
                            <h3 style={{ fontSize: isMobile ? "1.1rem" : "1.25rem", margin: 0, fontWeight: 600 }}>
                                {manualYear}年 {manualMonth + 1}月
                            </h3>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => changeManualMonth(1)}
                                style={{ padding: "0.25rem 0.5rem" }}
                            >
                                ›
                            </button>
                        </div>
                    </div>

                    <div className={styles.selectionToolbar}>
                        <label>
                            <input
                                type="checkbox"
                                checked={selectMode}
                                onChange={(e) => {
                                    const on = e.target.checked;
                                    setSelectMode(on);
                                    if (!on) {
                                        setSelectedDays(new Set());
                                    }
                                }}
                            />
                            複数選択モード
                        </label>
                        {selectMode && (
                            <>
                                <span className={styles.selectionCount}>選択中 {selectedDays.size} 日</span>
                                <button type="button" className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "0.3rem 0.55rem" }} onClick={selectAllDaysInMonth}>
                                    今月すべて選択
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.55rem" }}
                                    disabled={selectedDays.size === 0}
                                    onClick={clearDaySelection}
                                >
                                    選択解除
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.55rem" }}
                                    disabled={selectedDays.size === 0}
                                    onClick={() => {
                                        setBulkDraft(defaultManualDayState());
                                        setBulkModalOpen(true);
                                    }}
                                >
                                    一括で設定…
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.55rem" }}
                                    disabled={selectedDays.size === 0}
                                    onClick={clearSelectedDaysData}
                                >
                                    選択した日をクリア
                                </button>
                            </>
                        )}
                    </div>

                    {isMobile ? (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(7, 1fr)",
                                gap: "2px",
                                fontSize: "0.72rem",
                                marginBottom: "1rem",
                            }}
                        >
                            {WEEKDAY_LABELS.map((d, colIndex) => (
                                <div
                                    key={d}
                                    style={{
                                        textAlign: "center",
                                        padding: "0.25rem",
                                        backgroundColor:
                                            colIndex === 0 || colIndex === 6 ? "rgba(147, 197, 253, 0.6)" : "var(--surface-hover)",
                                        borderRadius: "2px",
                                        fontWeight: 600,
                                    }}
                                >
                                    {d}
                                </div>
                            ))}
                            {mobileDaysArray.map((day, index) => {
                                if (day === null) {
                                    return <div key={`e-${index}`} style={{ minHeight: "40px" }} />;
                                }
                                const st = manualByDay[day];
                                const hasData = !!st;
                                const { baseBg } = getCalendarCellPalette(manualYear, manualMonth, day, hasData);
                                const isSel = selectMode && selectedDays.has(day);
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => openDay(day)}
                                        className={isSel ? styles.calendarCellSelected : undefined}
                                        style={{
                                            minHeight: "44px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: "0.2rem",
                                            borderRadius: "4px",
                                            backgroundColor: baseBg,
                                            border: "1px solid var(--border)",
                                            cursor: "pointer",
                                            color: "inherit",
                                            font: "inherit",
                                        }}
                                    >
                                        <span style={{ fontSize: "0.65rem", opacity: 0.85 }}>{day}</span>
                                        <span style={{ fontWeight: 600, lineHeight: 1.2 }}>
                                            {hasData ? formatManualCellLabel(st) : "—"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className={styles.calendarScroll}>
                            <table className={styles.calendarTable}>
                                <thead>
                                    <tr>
                                        <th
                                            style={{
                                                padding: "0.5rem",
                                                border: "1px solid var(--border)",
                                                minWidth: "88px",
                                                position: "sticky",
                                                left: 0,
                                                backgroundColor: "var(--surface)",
                                                zIndex: 2,
                                                textAlign: "left",
                                            }}
                                        >
                                            勤務
                                        </th>
                                        {DAYS.map((d) => {
                                            const date = new Date(manualYear, manualMonth, d);
                                            const { headerBg, headerColor } = getCalendarCellPalette(manualYear, manualMonth, d, false);
                                            return (
                                                <th
                                                    key={d}
                                                    style={{
                                                        padding: "0.25rem",
                                                        border: "1px solid var(--border)",
                                                        minWidth: "34px",
                                                        textAlign: "center",
                                                        backgroundColor: headerBg,
                                                        color: headerColor,
                                                        fontWeight: date.getDay() === 0 || date.getDay() === 6 || isJapaneseHoliday(date) ? 600 : undefined,
                                                    }}
                                                >
                                                    {d}
                                                    <span style={{ fontSize: "0.7em", display: "block" }}>
                                                        ({WEEKDAY_LABELS[date.getDay()]})
                                                    </span>
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td
                                            style={{
                                                padding: "0.5rem",
                                                border: "1px solid var(--border)",
                                                fontWeight: 500,
                                                position: "sticky",
                                                left: 0,
                                                backgroundColor: "var(--surface)",
                                                zIndex: 1,
                                                verticalAlign: "middle",
                                            }}
                                        >
                                            {manualRowDisplayName}
                                        </td>
                                        {DAYS.map((d) => {
                                            const st = manualByDay[d];
                                            const hasData = !!st;
                                            const { baseBg } = getCalendarCellPalette(manualYear, manualMonth, d, hasData);
                                            const isSel = selectMode && selectedDays.has(d);
                                            return (
                                                <td
                                                    key={d}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={isSel ? styles.calendarCellSelected : undefined}
                                                    onClick={() => openDay(d)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            openDay(d);
                                                        }
                                                    }}
                                                    style={{
                                                        border: "1px solid var(--border)",
                                                        textAlign: "center",
                                                        backgroundColor: baseBg,
                                                        cursor: "pointer",
                                                        padding: "0.35rem 0.2rem",
                                                        verticalAlign: "middle",
                                                    }}
                                                    title={selectMode ? "クリックで選択に追加/解除" : "クリックで入力"}
                                                >
                                                    {hasData ? (
                                                        <span
                                                            style={{
                                                                display: "flex",
                                                                flexDirection: "column",
                                                                alignItems: "center",
                                                                gap: "0.1rem",
                                                                fontWeight: 500,
                                                            }}
                                                        >
                                                            {formatManualCellLabel(st)}
                                                        </span>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className={styles.actions}>
                        {saveNotice && (
                            <div
                                className={`${styles.alert} ${saveNoticeIsError ? styles.alertError : styles.alertSuccess}`}
                                style={{ marginBottom: 0, flex: "1 1 16rem" }}
                            >
                                {saveNotice}
                            </div>
                        )}
                        <button
                            type="button"
                            className="btn"
                            disabled={savingManual || !canSubmitManualStaff}
                            onClick={handleManualSave}
                        >
                            {savingManual ? "保存中…" : "退職者シフトに保存"}
                        </button>
                    </div>
                </div>
            </section>

            {bulkModalOpen && (
                <div
                    className={styles.modalBackdrop}
                    role="presentation"
                    onClick={(e) => e.target === e.currentTarget && setBulkModalOpen(false)}
                >
                    <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title">
                        <h3 id="bulk-edit-title" className={styles.modalTitle}>
                            選択した {selectedDays.size} 日に一括で反映
                        </h3>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
                            下の内容が、選択中のすべての日にコピーされます。
                        </p>
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>勤務</span>
                            <select
                                className={styles.select}
                                style={{ width: "100%" }}
                                value={bulkDraft.mode}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setBulkDraft((prev) => ({
                                        ...prev,
                                        mode: v === "off" ? "off" : (v as ShiftWorkType),
                                    }));
                                }}
                            >
                                <option value="off">OFF</option>
                                <option value="office">出社</option>
                                <option value="remote">在宅</option>
                                <option value="absence">当欠</option>
                            </select>
                        </div>
                        <div className={styles.formGrid} style={{ marginTop: "0.75rem" }}>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>開始</span>
                                <input
                                    type="time"
                                    className={styles.input}
                                    style={{ width: "100%" }}
                                    step={60}
                                    disabled={bulkDraft.mode === "off" || bulkDraft.mode === "absence"}
                                    value={bulkDraft.startTime}
                                    onChange={(e) =>
                                        setBulkDraft((p) => ({ ...p, startTime: timeInputValueToHm(e.target.value) }))
                                    }
                                />
                            </div>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>終了</span>
                                <input
                                    type="time"
                                    className={styles.input}
                                    style={{ width: "100%" }}
                                    step={60}
                                    disabled={bulkDraft.mode === "off" || bulkDraft.mode === "absence"}
                                    value={bulkDraft.endTime}
                                    onChange={(e) =>
                                        setBulkDraft((p) => ({ ...p, endTime: timeInputValueToHm(e.target.value) }))
                                    }
                                />
                            </div>
                        </div>
                        <div className={styles.modalActions}>
                            <button type="button" className="btn" onClick={applyBulkToSelection}>
                                一括で反映
                            </button>
                            <button type="button" className="btn btn-outline" onClick={() => setBulkModalOpen(false)}>
                                キャンセル
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editingDay != null && (
                <div
                    className={styles.modalBackdrop}
                    role="presentation"
                    onClick={(e) => e.target === e.currentTarget && closeModal()}
                >
                    <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="day-edit-title">
                        <h3 id="day-edit-title" className={styles.modalTitle}>
                            {manualYear}年{manualMonth + 1}月{editingDay}日（{WEEKDAY_LABELS[new Date(manualYear, manualMonth, editingDay).getDay()]}）
                        </h3>
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>勤務</span>
                            <select
                                className={styles.select}
                                style={{ width: "100%" }}
                                value={draft.mode}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setDraft((prev) => ({
                                        ...prev,
                                        mode: v === "off" ? "off" : (v as ShiftWorkType),
                                    }));
                                }}
                            >
                                <option value="off">OFF</option>
                                <option value="office">出社</option>
                                <option value="remote">在宅</option>
                                <option value="absence">当欠</option>
                            </select>
                        </div>
                        <div className={styles.formGrid} style={{ marginTop: "0.75rem" }}>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>開始</span>
                                <input
                                    type="time"
                                    className={styles.input}
                                    style={{ width: "100%" }}
                                    step={60}
                                    disabled={draft.mode === "off" || draft.mode === "absence"}
                                    value={draft.startTime}
                                    onChange={(e) =>
                                        setDraft((p) => ({ ...p, startTime: timeInputValueToHm(e.target.value) }))
                                    }
                                />
                            </div>
                            <div className={styles.field}>
                                <span className={styles.fieldLabel}>終了</span>
                                <input
                                    type="time"
                                    className={styles.input}
                                    style={{ width: "100%" }}
                                    step={60}
                                    disabled={draft.mode === "off" || draft.mode === "absence"}
                                    value={draft.endTime}
                                    onChange={(e) =>
                                        setDraft((p) => ({ ...p, endTime: timeInputValueToHm(e.target.value) }))
                                    }
                                />
                            </div>
                        </div>
                        <div className={styles.modalActions}>
                            <button type="button" className="btn" onClick={saveDraftToDay}>
                                確定
                            </button>
                            <button type="button" className="btn btn-outline" onClick={clearDay}>
                                この日を削除
                            </button>
                            <button type="button" className="btn btn-outline" onClick={closeModal}>
                                キャンセル
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {error && <div className={styles.globalError}>{error}</div>}

            <section className={styles.section} aria-labelledby="archive-grid-heading">
                <div className={styles.sectionHeader}>
                    <h2 id="archive-grid-heading" className={styles.sectionTitle}>
                        退職者シフト一覧
                    </h2>
                </div>
                <div className={styles.sectionBody}>
                    {loadingList ? (
                        <p className={styles.loadingText}>読み込み中…</p>
                    ) : users.length === 0 ? (
                        <p className={styles.emptyState}>まだ退職者シフトのデータがありません。</p>
                    ) : (
                        <>
                            <div className={styles.detailHeader}>
                                <div>
                                    <p
                                        style={{
                                            fontSize: "0.875rem",
                                            color: "var(--text-muted)",
                                            margin: 0,
                                            maxWidth: "36rem",
                                            lineHeight: 1.55,
                                        }}
                                    >
                                        管理者のシフト表と同じく<strong>行が人・列が日付</strong>です。セルにマウスを乗せると状態・時給を表示します（閲覧のみ）。
                                    </p>
                                </div>
                                <div className={styles.monthNav}>
                                    <button type="button" className="btn btn-outline" onClick={() => changeMonth(-1)}>
                                        ‹
                                    </button>
                                    <span className={styles.monthNavLabel}>
                                        {year}年{month + 1}月
                                    </span>
                                    <button type="button" className="btn btn-outline" onClick={() => changeMonth(1)}>
                                        ›
                                    </button>
                                </div>
                            </div>

                            {loadingShifts ? (
                                <p className={styles.loadingText}>シフトを読み込み中…</p>
                            ) : (
                                <>
                                    {allMonthShifts.length === 0 && (
                                        <p className={styles.emptyState} style={{ marginBottom: "0.75rem" }}>
                                            この月に登録されたシフトはありません（表は登録済みの全員分を表示します）。
                                        </p>
                                    )}
                                    {isMobile ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                                            {users.map((u) => {
                                                const rowMap = shiftsByUserAndDate[u.userId] ?? {};
                                                return (
                                                    <div
                                                        key={u.userId}
                                                        className="card"
                                                        style={{
                                                            padding: "0.75rem",
                                                            border: "1px solid var(--border)",
                                                            borderRadius: "var(--radius-md)",
                                                        }}
                                                    >
                                                        <div style={{ marginBottom: "0.5rem" }}>
                                                            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{u.archivedUserName}</div>
                                                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                                                全期間 {u.archivedShiftCount} 件 · {formatArchivedAt(u.archivedAt)}
                                                            </div>
                                                        </div>
                                                        <div
                                                            style={{
                                                                display: "grid",
                                                                gridTemplateColumns: "repeat(7, 1fr)",
                                                                gap: "2px",
                                                                fontSize: "0.72rem",
                                                            }}
                                                        >
                                                            {WEEKDAY_LABELS.map((d, colIndex) => (
                                                                <div
                                                                    key={d}
                                                                    style={{
                                                                        textAlign: "center",
                                                                        padding: "0.25rem",
                                                                        backgroundColor:
                                                                            colIndex === 0 || colIndex === 6
                                                                                ? "rgba(147, 197, 253, 0.6)"
                                                                                : "var(--surface-hover)",
                                                                        borderRadius: "2px",
                                                                        fontWeight: 600,
                                                                    }}
                                                                >
                                                                    {d}
                                                                </div>
                                                            ))}
                                                            {detailMobileDaysArray.map((day, index) => {
                                                                if (day === null) {
                                                                    return <div key={`${u.userId}-e-${index}`} style={{ minHeight: "40px" }} />;
                                                                }
                                                                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                                                                const s = rowMap[dateStr];
                                                                const hasData = !!s;
                                                                const { baseBg } = getCalendarCellPalette(year, month, day, hasData);
                                                                const tip = s
                                                                    ? `${statusLabel(s.status)}${s.hourlyWage != null ? ` / 時給 ${s.hourlyWage}円` : ""}`
                                                                    : undefined;
                                                                return (
                                                                    <div
                                                                        key={`${u.userId}-${day}`}
                                                                        title={tip}
                                                                        style={{
                                                                            minHeight: "40px",
                                                                            display: "flex",
                                                                            flexDirection: "column",
                                                                            alignItems: "center",
                                                                            justifyContent: "center",
                                                                            padding: "0.2rem",
                                                                            borderRadius: "4px",
                                                                            backgroundColor: baseBg,
                                                                            border: "1px solid var(--border)",
                                                                        }}
                                                                    >
                                                                        <span style={{ fontSize: "0.6rem", opacity: 0.85 }}>{day}</span>
                                                                        <span style={{ fontWeight: 600, lineHeight: 1.15, textAlign: "center" }}>
                                                                            {s ? formatCellLabel(s) : "—"}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className={styles.calendarScroll}>
                                            <table className={styles.calendarTable} style={{ minWidth: "720px" }}>
                                                <thead>
                                                    <tr>
                                                        <th
                                                            style={{
                                                                padding: "0.5rem",
                                                                border: "1px solid var(--border)",
                                                                minWidth: "11rem",
                                                                position: "sticky",
                                                                left: 0,
                                                                backgroundColor: "var(--surface)",
                                                                zIndex: 3,
                                                                textAlign: "left",
                                                            }}
                                                        >
                                                            スタッフ
                                                        </th>
                                                        {detailDays.map((d) => {
                                                            const date = new Date(year, month, d);
                                                            const { headerBg, headerColor } = getCalendarCellPalette(year, month, d, false);
                                                            return (
                                                                <th
                                                                    key={d}
                                                                    style={{
                                                                        padding: "0.25rem",
                                                                        border: "1px solid var(--border)",
                                                                        minWidth: "34px",
                                                                        textAlign: "center",
                                                                        backgroundColor: headerBg,
                                                                        color: headerColor,
                                                                        fontWeight:
                                                                            date.getDay() === 0 ||
                                                                            date.getDay() === 6 ||
                                                                            isJapaneseHoliday(date)
                                                                                ? 600
                                                                                : undefined,
                                                                    }}
                                                                >
                                                                    {d}
                                                                    <span style={{ fontSize: "0.7em", display: "block" }}>
                                                                        ({WEEKDAY_LABELS[date.getDay()]})
                                                                    </span>
                                                                </th>
                                                            );
                                                        })}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {users.map((u) => {
                                                        const rowMap = shiftsByUserAndDate[u.userId] ?? {};
                                                        return (
                                                            <tr key={u.userId}>
                                                                <td
                                                                    style={{
                                                                        padding: "0.5rem",
                                                                        border: "1px solid var(--border)",
                                                                        position: "sticky",
                                                                        left: 0,
                                                                        backgroundColor: "var(--surface)",
                                                                        zIndex: 2,
                                                                        verticalAlign: "middle",
                                                                    }}
                                                                >
                                                                    <div style={{ fontWeight: 600 }}>{u.archivedUserName}</div>
                                                                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                                                        全期間 {u.archivedShiftCount} 件
                                                                    </div>
                                                                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                                                                        {formatArchivedAt(u.archivedAt)}
                                                                    </div>
                                                                </td>
                                                                {detailDays.map((d) => {
                                                                    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                                                                    const s = rowMap[dateStr];
                                                                    const hasData = !!s;
                                                                    const { baseBg } = getCalendarCellPalette(year, month, d, hasData);
                                                                    const tip = s
                                                                        ? `${statusLabel(s.status)}${s.hourlyWage != null ? ` / 時給 ${s.hourlyWage}円` : ""}`
                                                                        : undefined;
                                                                    return (
                                                                        <td
                                                                            key={d}
                                                                            style={{
                                                                                border: "1px solid var(--border)",
                                                                                textAlign: "center",
                                                                                backgroundColor: baseBg,
                                                                                padding: "0.35rem 0.2rem",
                                                                                verticalAlign: "middle",
                                                                            }}
                                                                            title={tip}
                                                                        >
                                                                            {s ? (
                                                                                <span
                                                                                    style={{
                                                                                        display: "flex",
                                                                                        flexDirection: "column",
                                                                                        alignItems: "center",
                                                                                        gap: "0.1rem",
                                                                                        fontWeight: 500,
                                                                                    }}
                                                                                >
                                                                                    {formatCellLabel(s)}
                                                                                </span>
                                                                            ) : (
                                                                                "—"
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}
