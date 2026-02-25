"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  confirmShifts,
  confirmShiftsForUser,
  rejectShiftsForUser,
  saveShift,
  subscribeAllShifts,
  getUnsubmittedStaff,
  getMonthlyWorkSummary,
  getShiftWorkType,
  getShiftWorkTypeLabel,
  Shift,
  type ShiftWorkType,
  type ConfirmBlock,
} from "@/services/shiftService";
import { getAllStaff, getUserProfile, StaffItem } from "@/services/userService";
import { createNotification, getShiftConfirmedNotifications, Notification } from "@/services/notificationService";
import { getShiftSubmitComments, type ShiftSubmitCommentItem } from "@/services/shiftSubmitCommentService";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";
import { DEFAULT_HOURLY_WAGE } from "@/lib/app-config";

const MOBILE_BREAKPOINT = 768;

function calcHours(s: Shift): number | "OFF" {
  if (getShiftWorkType(s) === "absence") return 0;
  if (s.startTime === "00:00" && s.endTime === "00:00") return "OFF";
  const [sH, sM] = s.startTime.split(":").map(Number);
  const [eH, eM] = s.endTime.split(":").map(Number);
  let h = eH + eM / 60 - (sH + sM / 60);
  if (h > 6) h -= 1;
  return h > 0 ? Math.round(h * 10) / 10 : 0;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function getConfirmBlockLabel(block: ConfirmBlock): string {
  if (block === "all") return "全月";
  if (block === "first") return "1～15日分";
  return "16日～月末";
}

function getConfirmMessage(block: ConfirmBlock, month: number, hadEdited: boolean): string {
  const m = month + 1;
  if (hadEdited) {
    if (block === "all") return `${m}月のシフトが変更されました。確認してください。`;
    if (block === "first") return `${m}月1～15日分のシフトが変更されました。確認してください。`;
    return `${m}月16日～月末のシフトが変更されました。確認してください。`;
  }
  if (block === "all") return `${m}月のシフトが確定しました。確認してください。`;
  if (block === "first") return `${m}月1～15日分のシフトが確定しました。確認してください。`;
  return `${m}月16日～月末のシフトが確定しました。確認してください。`;
}

/** 表のセル用：勤務時間を「11-19」「11-19 在宅」のように表示（ぱっと見で何時～何時か分かるように） */
function formatShiftCellLabel(shift: Shift | null | undefined): string {
  if (!shift || (shift.startTime === "00:00" && shift.endTime === "00:00")) return "OFF";
  const sH = parseInt(shift.startTime.slice(0, 2), 10);
  const eH = parseInt(shift.endTime.slice(0, 2), 10);
  const timeStr = `${sH}-${eH}`;
  const workLabel = getShiftWorkType(shift) !== "office" ? ` ${getShiftWorkTypeLabel(shift)}` : "";
  return timeStr + workLabel;
}

/** スプレッドシート用のセル表記（例: 10-18\n（出社/休憩1h）、13-18\n(在宅)） */
function formatShiftForSheet(s: Shift): string {
  if (s.startTime === "00:00" && s.endTime === "00:00") return "";
  const loc = getShiftWorkTypeLabel(s);
  const [sH, sM] = s.startTime.split(":").map(Number);
  const [eH, eM] = s.endTime.split(":").map(Number);
  const durationHours = eH + eM / 60 - (sH + sM / 60);
  const breakNote = durationHours >= 6 ? "/休憩1h" : "";
  return `${sH}-${eH}\n（${loc}${breakNote}）`;
}

function escapeCsvCell(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** TSV貼り付け時、改行をセル内に収めるため改行・タブ・"を含むセルはクォートする */
function escapeTsvCell(val: string): string {
  if (val.includes("\t") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export default function AdminShiftGrid() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftData, setShiftData] = useState<{ [key: string]: number }>({});
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [unsubmitted, setUnsubmitted] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmingUserId, setConfirmingUserId] = useState<string | null>(null);
  const [confirmingSelected, setConfirmingSelected] = useState(false);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);
  const [csvCopied, setCsvCopied] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<ConfirmBlock>("all");
  const [error, setError] = useState<string | null>(null);
  const [confirmedNotifs, setConfirmedNotifs] = useState<Notification[]>([]);
  const [notifUserIdToName, setNotifUserIdToName] = useState<Record<string, string>>({});
  const [workSummary, setWorkSummary] = useState<{ userId: string; name: string; totalHours: number; hourlyWage: number; salary: number }[]>([]);
  const [editingCell, setEditingCell] = useState<{ userId: string; day: number } | null>(null);
  const [editingCellHourlyWage, setEditingCellHourlyWage] = useState<number | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [cellModalStart, setCellModalStart] = useState("09:00");
  const [cellModalEnd, setCellModalEnd] = useState("18:00");
  const [cellModalWorkType, setCellModalWorkType] = useState<ShiftWorkType>("office");
  const [cellModalOffEditExpanded, setCellModalOffEditExpanded] = useState(false);
  const [cellModalWasOff, setCellModalWasOff] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [submitComments, setSubmitComments] = useState<ShiftSubmitCommentItem[]>([]);

  useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!editingCell) {
      setEditingCellHourlyWage(null);
      return;
    }
    const shift = shifts.find(
      (s) => s.userId === editingCell.userId && parseInt(s.date.split("-")[2], 10) === editingCell.day
    );
    setCellModalStart(shift?.startTime ?? "09:00");
    setCellModalEnd(shift?.endTime ?? "18:00");
    setCellModalWorkType(shift ? getShiftWorkType(shift) : "office");
    setCellModalOffEditExpanded(false);
    setCellModalWasOff(shift?.startTime === "00:00" && shift?.endTime === "00:00");
    const wage = shift?.hourlyWage ?? workSummary.find((r) => r.userId === editingCell.userId)?.hourlyWage ?? null;
    if (wage != null) {
      setEditingCellHourlyWage(wage);
    } else {
      setEditingCellHourlyWage(null);
      getUserProfile(editingCell.userId).then((p) => setEditingCellHourlyWage(p?.hourlyWage ?? DEFAULT_HOURLY_WAGE));
    }
  }, [editingCell, shifts, workSummary]);

  const lastDay = new Date(year, month + 1, 0).getDate();
  const DAYS = Array.from({ length: lastDay }, (_, i) => i + 1);

  useEffect(() => {
    getAllStaff().then(setStaffList);
  }, []);

  useEffect(() => {
    getUnsubmittedStaff(year, month).then(setUnsubmitted);
  }, [year, month]);

  useEffect(() => {
    getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
  }, [year, month]);

  useEffect(() => {
    if (confirmedNotifs.length === 0) {
      setNotifUserIdToName({});
      return;
    }
    const uids = [...new Set(confirmedNotifs.map((n) => n.userId).filter(Boolean))] as string[];
    Promise.all(
      uids.map((uid) =>
        getUserProfile(uid).then((p) =>
          [uid, (p ? (p.name || uid) : "削除済みのユーザー") as string] as const
        )
      )
    )
      .then((entries) => setNotifUserIdToName(Object.fromEntries(entries)))
      .catch(() => {});
  }, [confirmedNotifs]);

  useEffect(() => {
    getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => setWorkSummary([]));
  }, [year, month]);

  useEffect(() => {
    getShiftSubmitComments(year, month + 1).then(setSubmitComments).catch(() => setSubmitComments([]));
  }, [year, month]);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAllShifts(year, month, (s) => {
      setShifts(s);
      const map: { [key: string]: number } = {};
      // 管理画面には提出済み・確定済みのみ表示。draft は表示しない
      s.filter((sh) => sh.status !== "draft").forEach((sh) => {
        const h = calcHours(sh);
        if (h === "OFF") return;
        const day = parseInt(sh.date.split("-")[2], 10);
        map[`${sh.userId}-${day}`] = h as number;
      });
      setShiftData(map);
      setError(null);
      setLoading(false);
    });
    return () => unsub();
  }, [year, month]);

  const getShift = useCallback(
    (uid: string, day: number) => shiftData[`${uid}-${day}`] || 0,
    [shiftData]
  );

  /** このユーザーに当月シフトが1件以上あるか（提出済み・確定済みのみ。下書きは除く） */
  const hasShiftsInMonth = useCallback(
    (userId: string) => shifts.some((s) => s.userId === userId && s.status !== "draft"),
    [shifts]
  );

  /** このユーザーに提出済み（未確定）のシフトが1件以上あるか（却下ボタン表示用） */
  const hasSubmittedShifts = useCallback(
    (userId: string) => shifts.some((s) => s.userId === userId && s.status === "submitted"),
    [shifts]
  );

  /** このユーザーの当月シフトがすべて確定済みで、確定後に編集されていなければ true（シフトなしは false） */
  const isFullyConfirmed = useCallback(
    (userId: string) => {
      const userShifts = shifts.filter((s) => s.userId === userId && s.status !== "draft");
      if (userShifts.length === 0) return false;
      return userShifts.every((s) => s.status === "confirmed" && !s.editedAfterConfirmed);
    },
    [shifts]
  );

  /** 指定ブロック内に未確定シフトがあるか */
  const isInBlock = useCallback(
    (dateStr: string, block: ConfirmBlock) => {
      const day = parseInt(dateStr.split("-")[2]!, 10);
      if (block === "first") return day <= 15;
      if (block === "second") return day >= 16;
      return true;
    },
    []
  );

  /** 確定対象が1人以上いるか（選択中のブロック内でシフトがあり、まだ確定していない人） */
  const hasShiftsToConfirm = useMemo(() => {
    if (confirmBlock === "all") {
      return staffList.some((s) => hasShiftsInMonth(s.id) && !isFullyConfirmed(s.id));
    }
    return staffList.some((s) => {
      const userShifts = shifts.filter((x) => x.userId === s.id && x.status !== "draft");
      const inBlock = userShifts.filter((x) => isInBlock(x.date, confirmBlock));
      if (inBlock.length === 0) return false;
      return inBlock.some((x) => x.status !== "confirmed");
    });
  }, [staffList, shifts, confirmBlock, hasShiftsInMonth, isFullyConfirmed, isInBlock]);

  const toggleSelected = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

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

  const handleConfirm = async () => {
    const blockLabel = getConfirmBlockLabel(confirmBlock);
    if (!confirm(`${year}年${month + 1}月の${blockLabel}のシフトを確定し、アルバイトへ通知を送りますか？`))
      return;
    setConfirming(true);
    try {
      const affectedUserIds = await confirmShifts(year, month, confirmBlock);
      if (process.env.NODE_ENV === "development") {
        console.log("[admin/shifts] handleConfirm: affectedUserIds", affectedUserIds);
      }
      if (affectedUserIds.length === 0) {
        alert("確定するシフトがありませんでした。");
        return;
      }
      const message = getConfirmMessage(confirmBlock, month, false);
      await Promise.all(
        affectedUserIds.map((uid) =>
          createNotification(uid, "shift_confirmed", message)
        )
      );
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      alert(`${affectedUserIds.length}名のアルバイトに通知を送りました！`);
    } catch (e) {
      console.error("[admin/shifts] handleConfirm: error", e);
      alert("確定処理に失敗しました");
    } finally {
      setConfirming(false);
    }
  };

  const handleConfirmOne = async (userId: string) => {
    setConfirmingUserId(userId);
    try {
      const hadEdited = shifts.some(
        (s) =>
          s.userId === userId &&
          s.editedAfterConfirmed &&
          (confirmBlock === "all" || isInBlock(s.date, confirmBlock))
      );
      const hasShifts = await confirmShiftsForUser(userId, year, month, confirmBlock);
      if (!hasShifts) {
        alert(`このアルバイトの${getConfirmBlockLabel(confirmBlock)}に確定するシフトがありません。`);
        return;
      }
      const message = getConfirmMessage(confirmBlock, month, hadEdited);
      await createNotification(userId, "shift_confirmed", message);
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      alert("確定通知を送りました。");
    } catch (e) {
      console.error(e);
      alert("確定通知の送信に失敗しました");
    } finally {
      setConfirmingUserId(null);
    }
  };

  const handleRejectSubmit = async () => {
    const uid = rejectingUserId;
    if (!uid || !rejectComment.trim()) {
      alert("却下理由を入力してください。");
      return;
    }
    setConfirmingUserId(uid);
    try {
      const ok = await rejectShiftsForUser(uid, year, month);
      const message = ok
        ? `${month + 1}月のシフトが却下されました。\n理由: ${rejectComment.trim()}`
        : `${month + 1}月のシフトに修正が必要です。\n理由: ${rejectComment.trim()}\n内容を確認して提出してください。`;
      await createNotification(uid, "shift_rejected", message);
      if (!ok) {
        setRejectingUserId(null);
        setRejectComment("");
        setConfirmingUserId(null);
        alert("下書きのみのためステータスは変更しませんでしたが、通知を送りました。");
        return;
      }
      setRejectingUserId(null);
      setRejectComment("");
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
      alert("却下し、通知を送りました。");
    } catch (e) {
      console.error(e);
      alert("却下の送信に失敗しました");
    } finally {
      setConfirmingUserId(null);
    }
  };

  /** 指定ユーザーが選択ブロック内に未確定シフトを持つか */
  const hasUnconfirmedInBlock = useCallback(
    (uid: string) => {
      const userShifts = shifts.filter((x) => x.userId === uid && x.status !== "draft");
      const inBlock = confirmBlock === "all" ? userShifts : userShifts.filter((x) => isInBlock(x.date, confirmBlock));
      return inBlock.some((x) => x.status !== "confirmed");
    },
    [shifts, confirmBlock, isInBlock]
  );

  const handleConfirmSelected = async () => {
    const ids = Array.from(selectedUserIds).filter(
      (uid) => hasShiftsInMonth(uid) && !isFullyConfirmed(uid) && hasUnconfirmedInBlock(uid)
    );
    if (ids.length === 0) {
      const hint =
        confirmBlock === "all"
          ? "シフトがあり、まだ確定していない人にチェックを入れてください"
          : `${getConfirmBlockLabel(confirmBlock)}に未確定シフトがある人にチェックを入れてください`;
      alert(`送信対象を選択してください（${hint}）。`);
      return;
    }
    const blockLabel = getConfirmBlockLabel(confirmBlock);
    if (!confirm(`選択した ${ids.length} 名に${blockLabel}の確定通知を送りますか？`)) return;
    setConfirmingSelected(true);
    try {
      let sentCount = 0;
      for (const uid of ids) {
        const hadEdited = shifts.some(
          (s) =>
            s.userId === uid &&
            s.editedAfterConfirmed &&
            (confirmBlock === "all" || isInBlock(s.date, confirmBlock))
        );
        const hasShifts = await confirmShiftsForUser(uid, year, month, confirmBlock);
        if (!hasShifts) continue;
        const message = getConfirmMessage(confirmBlock, month, hadEdited);
        await createNotification(uid, "shift_confirmed", message);
        sentCount += 1;
      }
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      setSelectedUserIds(new Set());
      alert(`${sentCount} 名に確定通知を送りました。`);
    } catch (e) {
      console.error(e);
      alert("確定通知の送信に失敗しました");
    } finally {
      setConfirmingSelected(false);
    }
  };

  const handleRemind = async () => {
    if (unsubmitted.length === 0) return;
    setReminding(true);
    try {
      await Promise.all(
        unsubmitted.map((u) =>
          createNotification(
            u.id,
            "remind_submit",
            `${month + 1}月のシフト提出がまだです。お早めに提出してください。`
          )
        )
      );
      alert(`${unsubmitted.length}名に催促通知を送りました`);
    } catch (e) {
      console.error(e);
      alert("催促に失敗しました");
    } finally {
      setReminding(false);
    }
  };

  const buildCsv = (): string => {
    const confirmed = shifts.filter((s) => s.status === "confirmed");
    const nameMap = Object.fromEntries(staffList.map((s) => [s.id, s.name]));
    // Googleスプレッドシート形式（タブ区切り）: 1行目=日付,スタッフ1,スタッフ2,... 2行目以降=日付,各スタッフのシフト（改行含むセルはクォートでセル内改行になる）
    const header = ["日付", ...staffList.map((s) => nameMap[s.id] || s.id)].join("\t");
    const rows = DAYS.map((d) => {
      const date = new Date(year, month, d);
      const dateLabel = `${month + 1}/${d}(${WEEKDAY_LABELS[date.getDay()]})`;
      const cells = staffList.map((staff) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const s = confirmed.find((x) => x.userId === staff.id && x.date === dateStr);
        if (!s) return "";
        return escapeTsvCell(formatShiftForSheet(s));
      });
      return [dateLabel, ...cells].join("\t");
    });
    return [header, ...rows].join("\n");
  };

  const handleCopyCsv = async () => {
    try {
      const csv = buildCsv();
      await navigator.clipboard.writeText(csv);
      setCsvCopied(true);
      setTimeout(() => setCsvCopied(false), 2000);
    } catch (e) {
      console.error(e);
      alert("コピーに失敗しました");
    }
  };

  const isDailyOver = (hours: number) => hours > 8;

  /** 週40時間超過: カレンダー週（日〜土）ごとの合計が40h超の週があるか */
  const isWeeklyOver = useCallback(
    (uid: string) => {
      const weekTotals: Record<number, number> = {};
      DAYS.forEach((d) => {
        const date = new Date(year, month, d);
        const dayOfWeek = date.getDay();
        const weekStart = new Date(year, month, d - dayOfWeek);
        const weekId = weekStart.getTime();
        weekTotals[weekId] = (weekTotals[weekId] ?? 0) + getShift(uid, d);
      });
      return Object.values(weekTotals).some((t) => t > 40);
    },
    [year, month, DAYS, getShift]
  );

  const alert36 = useMemo(() => {
    const daily: { name: string; day: number; hours: number }[] = [];
    const weekly: { name: string; weekLabel: string; total: number }[] = [];
    const violatedUserIds = new Set<string>();
    staffList.forEach((s) => {
      const weekTotals: Record<number, { total: number; weekStart: Date }> = {};
      DAYS.forEach((d) => {
        const h = getShift(s.id, d);
        if (h > 8) {
          daily.push({ name: s.name, day: d, hours: h });
          violatedUserIds.add(s.id);
        }

        const date = new Date(year, month, d);
        const dayOfWeek = date.getDay();
        const weekStart = new Date(year, month, d - dayOfWeek);
        const weekId = weekStart.getTime();
        if (!weekTotals[weekId]) weekTotals[weekId] = { total: 0, weekStart };
        weekTotals[weekId].total += h;
      });
      Object.values(weekTotals).forEach(({ total, weekStart }) => {
        if (total > 40) {
          const ws = weekStart;
          const we = new Date(ws);
          we.setDate(we.getDate() + 6);
          const weekLabel = `${ws.getMonth() + 1}/${ws.getDate()}〜${we.getMonth() + 1}/${we.getDate()}`;
          weekly.push({ name: s.name, weekLabel, total });
          violatedUserIds.add(s.id);
        }
      });
    });
    return { daily, weekly, violatedUserIds };
  }, [staffList, DAYS, getShift, year, month]);

  /** 36協定に抵触しているユーザーは確定不可 */
  const userHas36Violation = useCallback(
    (uid: string) => alert36.violatedUserIds.has(uid),
    [alert36.violatedUserIds]
  );

  /** 確定対象のうち1人でも36協定抵触がいれば一括確定・選択送信を無効にする */
  const hasConfirmableWith36Violation = useMemo(
    () =>
      staffList.some(
        (s) => hasShiftsInMonth(s.id) && !isFullyConfirmed(s.id) && userHas36Violation(s.id)
      ),
    [staffList, hasShiftsInMonth, isFullyConfirmed, userHas36Violation]
  );
  const selectedHas36Violation = useMemo(
    () => Array.from(selectedUserIds).some((uid) => userHas36Violation(uid)),
    [selectedUserIds, userHas36Violation]
  );

  return (
    <div>
      {/* 36協定アラート（最上部に常設） */}
      <div
        className="card"
        style={{
          marginBottom: "1rem",
          borderColor: alert36.daily.length > 0 || alert36.weekly.length > 0 ? "#F59E0B" : "var(--border)",
          backgroundColor: alert36.daily.length > 0 || alert36.weekly.length > 0 ? "#FFFBEB" : "var(--surface)",
        }}
      >
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>36協定アラート</span>
          {(alert36.daily.length > 0 || alert36.weekly.length > 0) && <span style={{ color: "var(--destructive)" }}>⚠️ 要確認</span>}
        </h3>
        {alert36.daily.length === 0 && alert36.weekly.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: 0 }}>1日8時間超・週40時間超の該当者はありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.875rem" }}>
            {alert36.daily.length > 0 && (
              <div>
                <strong>1日8時間超過:</strong>{" "}
                {alert36.daily.map((x) => `${x.name} ${month + 1}/${x.day} (${x.hours}h)`).join("、")}
              </div>
            )}
            {alert36.weekly.length > 0 && (
              <div>
                <strong>週40時間超過:</strong>{" "}
                {alert36.weekly.map((x) => `${x.name} ${x.weekLabel} ${x.total}h`).join("、")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 未提出者リスト */}
      {unsubmitted.length > 0 && (
        <div
          className="card"
          style={{ marginBottom: "1rem", backgroundColor: "#FEF3C7" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <strong>未提出者（{unsubmitted.length}名）</strong>
              <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>
                {unsubmitted.map((u) => u.name).join("、")}
              </span>
            </div>
            <button
              className="btn btn-outline"
              onClick={handleRemind}
              disabled={reminding}
            >
              {reminding ? "送信中..." : "催促通知を送る"}
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: isMobile ? "visible" : "auto" }}>
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className="btn btn-outline"
              onClick={() => changeMonth(-1)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              ‹
            </button>
            <h2 style={{ fontSize: isMobile ? "1.25rem" : "1.5rem", margin: 0 }}>
              {year}年 {month + 1}月 シフト表
            </h2>
            <button
              className="btn btn-outline"
              onClick={() => changeMonth(1)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              ›
            </button>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem" }}>
              <span style={{ color: "var(--text-muted)" }}>確定範囲:</span>
              <select
                value={confirmBlock}
                onChange={(e) => setConfirmBlock(e.target.value as ConfirmBlock)}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                  fontSize: "0.875rem",
                }}
              >
                <option value="all">全月</option>
                <option value="first">1～15日分</option>
                <option value="second">16日～月末</option>
              </select>
            </label>
            <button
              className="btn btn-outline"
              onClick={handleCopyCsv}
              disabled={loading}
              style={isMobile ? { flex: 1, minWidth: "120px" } : undefined}
            >
              {csvCopied ? "コピーしました" : "CSVコピー"}
            </button>
            <button
              className="btn btn-outline"
              onClick={handleConfirmSelected}
              disabled={loading || confirming || confirmingSelected || selectedUserIds.size === 0 || selectedHas36Violation}
              title={selectedHas36Violation ? "36協定に抵触している人が含まれているため確定できません" : selectedUserIds.size === 0 ? "下の表で送りたい人にチェックを入れてください" : `選択した ${selectedUserIds.size} 名に送る`}
              style={isMobile ? { flex: 1, minWidth: "120px" } : undefined}
            >
              {confirmingSelected ? "送信中..." : `選択した人に送る${selectedUserIds.size > 0 ? ` (${selectedUserIds.size}人)` : ""}`}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={loading || confirming || !hasShiftsToConfirm || hasConfirmableWith36Violation}
              title={hasConfirmableWith36Violation ? "36協定に抵触している人がいるため確定できません" : !hasShiftsToConfirm ? "全員のシフトがすでに確定済みです" : undefined}
              style={isMobile ? { flex: 1, minWidth: "120px" } : undefined}
            >
              {confirming ? "処理中..." : "確定して通知"}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#FEE2E2",
              color: "#B91C1C",
              marginBottom: "1rem",
              borderRadius: "0.5rem",
            }}
          >
            エラー: {error}
          </div>
        )}

        {!loading && submitComments.length > 0 && (
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}>
              提出コメント（{submitComments.length}件）
            </summary>
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem", fontSize: "0.9rem", color: "var(--text-main)" }}>
              {submitComments.map((c) => (
                <li key={c.userId} style={{ marginBottom: "0.35rem" }}>
                  <strong>{c.name}:</strong> {c.comment}
                </li>
              ))}
            </ul>
          </details>
        )}

        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            読み込み中...
          </div>
        ) : isMobile ? (
          (() => {
            const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"];
            const firstDayOfWeek = new Date(year, month, 1).getDay();
            const leadingBlanks = Array.from({ length: firstDayOfWeek }, () => null);
            const daysArray: (number | null)[] = [...leadingBlanks, ...DAYS];
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {staffList.map((user) => {
                  const totalHours = DAYS.reduce((acc, d) => acc + getShift(user.id, d), 0);
                  const weeklyWarning = isWeeklyOver(user.id);
                  return (
                    <div key={user.id} className="card" style={{ padding: "0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.25rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                          {user.name}
                          {weeklyWarning && <span style={{ marginLeft: "0.25rem" }} title="週40時間超過">⚠️</span>}
                        </span>
                        <span style={{ fontSize: "0.875rem", color: weeklyWarning ? "var(--destructive)" : "var(--text-muted)", fontWeight: 500 }}>
                          合計 {totalHours}h
                        </span>
                      </div>
                      {hasShiftsInMonth(user.id) && (isFullyConfirmed(user.id) || confirmingUserId === user.id || (confirmingSelected && selectedUserIds.has(user.id)) || (confirming && !isFullyConfirmed(user.id))) && (
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem 0" }}>確定済み</p>
                      )}
                      {hasShiftsInMonth(user.id) && !isFullyConfirmed(user.id) && confirmingUserId !== user.id && !(confirmingSelected && selectedUserIds.has(user.id)) && !confirming && (
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem" }}
                            disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId || userHas36Violation(user.id)}
                            onClick={() => !userHas36Violation(user.id) && handleConfirmOne(user.id)}
                            title={userHas36Violation(user.id) ? "36協定に抵触しているため確定できません" : undefined}
                          >
                            確定通知を送る
                          </button>
                          {hasSubmittedShifts(user.id) && (
                            <button
                              type="button"
                              className="btn"
                              style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem", backgroundColor: "var(--destructive)", color: "white", border: "none" }}
                              disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId}
                              onClick={() => { setRejectingUserId(user.id); setRejectComment(""); }}
                            >
                              却下
                            </button>
                          )}
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", fontSize: "0.7rem" }}>
                        {dayOfWeek.map((d, colIndex) => (
                          <div
                            key={d}
                            style={{
                              textAlign: "center",
                              padding: "0.2rem",
                              backgroundColor: colIndex === 0 || colIndex === 6 ? "rgba(147, 197, 253, 0.6)" : "var(--surface-hover)",
                              borderRadius: "2px",
                              fontWeight: 600,
                            }}
                          >
                            {d}
                          </div>
                        ))}
                        {daysArray.map((day, index) => {
                          if (day === null) {
                            return <div key={`empty-${index}`} style={{ minHeight: "32px" }} />;
                          }
                          const date = new Date(year, month, day);
                          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                          const isHoliday = isJapaneseHoliday(date);
                          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                          const shift = shifts.find((s) => s.userId === user.id && s.date === dateStr && s.status !== "draft");
                          const h = shift ? calcHours(shift) : 0;
                          const numHours = h === "OFF" ? 0 : (h as number);
                          const isOver = isDailyOver(numHours);
                          const hasData = !!shift;
                          const isEditedLate = !!shift?.editedAfterDeadline;
                          const baseBg = isOver ? "#FEE2E2" : numHours > 0 ? "#EEF2FF" : (isHoliday ? "rgba(254, 215, 170, 0.8)" : isWeekend ? "rgba(191, 219, 254, 0.8)" : "var(--surface-hover)");
                          return (
                            <div
                              key={day}
                              onClick={hasData ? () => setEditingCell({ userId: user.id, day }) : undefined}
                              style={{
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "0.2rem",
                                borderRadius: "4px",
                                backgroundColor: baseBg,
                                color: isOver || isEditedLate ? "#B91C1C" : "inherit",
                                cursor: hasData ? "pointer" : "default",
                              }}
                            >
                              {h === "OFF" ? "OFF" : numHours > 0 ? formatShiftCellLabel(shift) : ""}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              backgroundColor: "var(--surface)",
              fontSize: "0.8rem",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    minWidth: "100px",
                    position: "sticky",
                    left: 0,
                    backgroundColor: "var(--surface)",
                    zIndex: 1,
                  }}
                >
                  アルバイト
                </th>
                {DAYS.map((d) => {
                  const date = new Date(year, month, d);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isHoliday = isJapaneseHoliday(date);
                  const headerBg = isHoliday ? "rgba(254, 215, 170, 0.8)" : isWeekend ? "rgba(191, 219, 254, 0.8)" : undefined;
                  const headerColor = isHoliday ? "#EA580C" : isWeekend ? "#2563EB" : undefined;
                  return (
                    <th
                      key={d}
                      style={{
                        padding: "0.25rem",
                        border: "1px solid var(--border)",
                        minWidth: "30px",
                        textAlign: "center",
                        backgroundColor: headerBg,
                        color: headerColor,
                        fontWeight: isWeekend || isHoliday ? 600 : undefined,
                      }}
                    >
                      {d}
                    </th>
                  );
                })}
                <th
                  style={{
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    minWidth: "60px",
                  }}
                >
                  合計
                </th>
                <th
                  style={{
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    minWidth: "72px",
                    fontSize: "0.75rem",
                  }}
                  title="この人にだけ確定通知を送る"
                >
                  確定通知
                </th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((user) => {
                const totalHours = DAYS.reduce(
                  (acc, d) => acc + getShift(user.id, d),
                  0
                );
                const weeklyWarning = isWeeklyOver(user.id);

                return (
                  <tr key={user.id}>
                    <td
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        fontWeight: 500,
                        position: "sticky",
                        left: 0,
                        backgroundColor: "var(--surface)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          cursor: isFullyConfirmed(user.id) || userHas36Violation(user.id) ? "not-allowed" : "pointer",
                          opacity: isFullyConfirmed(user.id) || userHas36Violation(user.id) ? 0.7 : 1,
                        }}
                        title={userHas36Violation(user.id) ? "36協定に抵触しているため確定できません" : !hasShiftsInMonth(user.id) ? "シフトがありません" : isFullyConfirmed(user.id) ? "この人はすでに確定済みです" : "確定通知を送る人にチェック"}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => hasShiftsInMonth(user.id) && !isFullyConfirmed(user.id) && !userHas36Violation(user.id) && toggleSelected(user.id)}
                          disabled={!hasShiftsInMonth(user.id) || isFullyConfirmed(user.id) || userHas36Violation(user.id)}
                        />
                      </label>
                      {user.name}
                      {weeklyWarning && (
                        <span
                          title="週40時間超過"
                          style={{ fontSize: "1rem" }}
                        >
                          ⚠️
                        </span>
                      )}
                    </td>
                    {DAYS.map((d) => {
                      const date = new Date(year, month, d);
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                      const isHoliday = isJapaneseHoliday(date);
                      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const shift = shifts.find((s) => s.userId === user.id && s.date === dateStr && s.status !== "draft");
                      const h = shift ? calcHours(shift) : 0;
                      const numHours = h === "OFF" ? 0 : (h as number);
                      const isOver = isDailyOver(numHours);
                      const hasData = !!shift;
                      const isEditedLate = !!shift?.editedAfterDeadline;
                      const cellTitle = isOver ? "1日8時間超過" : isEditedLate ? "締切後に管理者が編集" : hasData ? "クリックで編集" : "クリックでシフトを追加";
                      const baseCellBg = isOver
                        ? "#FEE2E2"
                        : numHours > 0
                          ? "#EEF2FF"
                          : isHoliday
                            ? "rgba(254, 215, 170, 0.8)"
                            : isWeekend
                              ? "rgba(191, 219, 254, 0.8)"
                              : "var(--surface-hover)";
                      return (
                        <td
                          key={d}
                          onClick={() => setEditingCell({ userId: user.id, day: d })}
                          style={{
                            border: "1px solid var(--border)",
                            textAlign: "center",
                            backgroundColor: baseCellBg,
                            color: isOver || isEditedLate ? "#B91C1C" : "inherit",
                            cursor: "pointer",
                          }}
                          title={cellTitle}
                        >
                          {h === "OFF" ? "OFF" : numHours > 0 ? (
                            <span>{formatShiftCellLabel(shift)}</span>
                          ) : "—"}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        fontWeight: 600,
                        color: weeklyWarning
                          ? "var(--destructive)"
                          : "inherit",
                        textAlign: "center",
                      }}
                    >
                      {totalHours}
                    </td>
                    <td
                      style={{
                        padding: "0.35rem",
                        border: "1px solid var(--border)",
                        textAlign: "center",
                        verticalAlign: "middle",
                      }}
                    >
                      {!hasShiftsInMonth(user.id) ? (
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }} title="シフトがありません">—</span>
                      ) : isFullyConfirmed(user.id) || confirmingUserId === user.id || (confirmingSelected && selectedUserIds.has(user.id)) || (confirming && !isFullyConfirmed(user.id)) ? (
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }} title="この人はすでに確定済みです">
                          確定済み
                        </span>
                      ) : (
                        <span style={{ display: "flex", gap: "0.35rem", justifyContent: "center", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                            disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId || userHas36Violation(user.id)}
                            onClick={() => !userHas36Violation(user.id) && handleConfirmOne(user.id)}
                            title={userHas36Violation(user.id) ? "36協定に抵触しているため確定できません" : `${user.name}さんに確定通知を送る`}
                          >
                            {confirmingUserId === user.id ? "送信中..." : "送る"}
                          </button>
                          {hasSubmittedShifts(user.id) && (
                            <button
                              type="button"
                              className="btn"
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", backgroundColor: "var(--destructive)", color: "white", border: "none" }}
                              disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId}
                              onClick={() => { setRejectingUserId(user.id); setRejectComment(""); }}
                              title={`${user.name}さんの提出シフトを却下する（理由必須）`}
                            >
                              却下
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 確定通知の既読状況 */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>確定通知の既読状況（直近）</h3>
        {confirmedNotifs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>確定通知はまだありません</p>
        ) : (
          <div style={isMobile ? { overflowX: "auto", WebkitOverflowScrolling: "touch" } : undefined}>
          <table style={{ width: "100%", minWidth: isMobile ? "280px" : undefined, fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>アルバイト</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center" }}>既読</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>通知日時</th>
              </tr>
            </thead>
            <tbody>
              {confirmedNotifs.map((n) => (
                <tr key={n.id}>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>
                    {notifUserIdToName[n.userId] || staffList.find((s) => s.id === n.userId)?.name || n.userId}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center" }}>
                    <span style={{ color: n.read ? "var(--secondary)" : "var(--destructive)", fontWeight: 500 }}>
                      {n.read ? "既読" : "未読"}
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString("ja-JP") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* 月別給与集計（確定シフトベース） */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>{year}年{month + 1}月 給与集計</h3>
        {workSummary.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>確定シフトがないため、集計はありません</p>
        ) : (
          <div style={isMobile ? { overflowX: "auto", WebkitOverflowScrolling: "touch" } : undefined}>
          <table style={{ width: "100%", minWidth: isMobile ? "320px" : undefined, fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>アルバイト</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>勤務時間</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>時給</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>給与</th>
              </tr>
            </thead>
            <tbody>
              {workSummary.map((r) => (
                <tr key={r.userId}>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>{r.name}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>{r.totalHours}h</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>¥{r.hourlyWage.toLocaleString()}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right", fontWeight: 500 }}>¥{r.salary.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* シフト却下モーダル（理由必須） */}
      {rejectingUserId && (
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
          onClick={() => { if (!confirmingUserId) { setRejectingUserId(null); setRejectComment(""); } }}
        >
          <div
            className="card"
            style={{ minWidth: "320px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
              {month + 1}月のシフトを却下
            </h3>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              {staffList.find((s) => s.id === rejectingUserId)?.name ?? rejectingUserId} さん
            </p>
            <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              却下理由（必須）
            </label>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="例: 〇〇の日時を修正してください"
              rows={4}
              style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem", resize: "vertical", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!!confirmingUserId}
                onClick={() => { setRejectingUserId(null); setRejectComment(""); }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: "var(--destructive)", color: "white", border: "none" }}
                disabled={!rejectComment.trim() || !!confirmingUserId}
                onClick={handleRejectSubmit}
              >
                {confirmingUserId === rejectingUserId ? "送信中..." : "却下して通知"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* セル編集モーダル（管理者・締切後編集は赤字で表示） */}
      {editingCell && (
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
            onClick={() => !savingCell && setEditingCell(null)}
          >
            <div
              className="card"
              style={{ minWidth: "280px", maxWidth: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>
                {month + 1}月{editingCell.day}日　{staffList.find((s) => s.id === editingCell.userId)?.name ?? editingCell.userId}
              </h3>
              {editingCellHourlyWage != null && (
                <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                  時給: <strong>¥{editingCellHourlyWage.toLocaleString()}</strong>
                </p>
              )}
              {(() => {
                const isOff = cellModalWasOff;
                const applyWorkingHours = async () => {
                  const startM = parseInt(cellModalStart.slice(0, 2), 10) * 60 + parseInt(cellModalStart.slice(3), 10);
                  const endM = parseInt(cellModalEnd.slice(0, 2), 10) * 60 + parseInt(cellModalEnd.slice(3), 10);
                  if (startM >= endM) {
                    alert("終了時刻は開始時刻より後にしてください。");
                    return;
                  }
                  setSavingCell(true);
                  try {
                    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(editingCell.day).padStart(2, "0")}`;
                    const existingShift = shifts.find((s) => s.userId === editingCell.userId && s.date === dateStr);
                    const editedAfterConfirmed = existingShift?.status === "confirmed";
                    await saveShift(
                      {
                        userId: editingCell.userId,
                        date: dateStr,
                        startTime: cellModalStart,
                        endTime: cellModalEnd,
                        status: "confirmed",
                        workType: cellModalWorkType,
                        ...(editedAfterConfirmed && { editedAfterConfirmed: true }),
                      },
                      { byAdmin: true }
                    );
                    setEditingCell(null);
                  } catch (e) {
                    console.error(e);
                    alert("更新に失敗しました");
                  } finally {
                    setSavingCell(false);
                  }
                };
                const setToOff = async () => {
                  setSavingCell(true);
                  try {
                    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(editingCell.day).padStart(2, "0")}`;
                    const existingShift = shifts.find((s) => s.userId === editingCell.userId && s.date === dateStr);
                    const editedAfterConfirmed = existingShift?.status === "confirmed";
                    await saveShift(
                      {
                        userId: editingCell.userId,
                        date: dateStr,
                        startTime: "00:00",
                        endTime: "00:00",
                        status: "confirmed",
                        workType: "office",
                        ...(editedAfterConfirmed && { editedAfterConfirmed: true }),
                      },
                      { byAdmin: true }
                    );
                    setEditingCell(null);
                  } catch (e) {
                    console.error(e);
                    alert("更新に失敗しました");
                  } finally {
                    setSavingCell(false);
                  }
                };
                return (
                  <>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>勤務時間を設定（締切後は赤字で記録）</p>
                    {isOff ? (
                      <div style={{ marginBottom: "1rem" }}>
                        <p style={{ fontSize: "1.15rem", color: "var(--text-main)", fontWeight: 700, marginBottom: "0.75rem" }}>
                          この日はOFFです
                        </p>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="checkbox"
                            checked={cellModalOffEditExpanded}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setCellModalOffEditExpanded(checked);
                              if (checked) {
                                setCellModalStart("09:00");
                                setCellModalEnd("18:00");
                              }
                            }}
                          />
                          変更
                        </label>
                        {cellModalOffEditExpanded && (
                          <>
                            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem", marginBottom: "0.5rem" }}>勤務日に変更する場合は、下の時間を設定して適用してください。</p>
                            <div style={{ marginBottom: "0.5rem" }}>
                              <div style={{ fontSize: "0.95rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>勤務時間を設定</div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                <input
                                  type="time"
                                  value={cellModalStart}
                                  onChange={(e) => setCellModalStart(e.target.value)}
                                  style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1.1rem" }}
                                />
                                <span style={{ fontSize: "1.1rem" }}>～</span>
                                <input
                                  type="time"
                                  value={cellModalEnd}
                                  onChange={(e) => setCellModalEnd(e.target.value)}
                                  style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1.1rem" }}
                                />
                                <button
                                  className="btn btn-outline"
                                  disabled={savingCell}
                                  onClick={applyWorkingHours}
                                >
                                  適用
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ marginBottom: "0.75rem" }}>
                          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>勤務形態</div>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            {(["office", "remote", "absence"] as const).map((w) => (
                              <label key={w} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", fontSize: "0.9rem" }}>
                                <input
                                  type="radio"
                                  name="cellWorkType"
                                  checked={cellModalWorkType === w}
                                  onChange={() => setCellModalWorkType(w)}
                                />
                                {w === "office" ? "出社" : w === "remote" ? "在宅" : "当欠"}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          <div style={{ marginBottom: "0.25rem" }}>
                            <div style={{ fontSize: "0.95rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>時間を設定</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              <input
                                type="time"
                                value={cellModalStart}
                                onChange={(e) => setCellModalStart(e.target.value)}
                                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1.1rem" }}
                              />
                              <span style={{ fontSize: "1.1rem" }}>～</span>
                              <input
                                type="time"
                                value={cellModalEnd}
                                onChange={(e) => setCellModalEnd(e.target.value)}
                                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1.1rem" }}
                              />
                              <button
                                className="btn btn-outline"
                                disabled={savingCell}
                                onClick={applyWorkingHours}
                              >
                                適用
                              </button>
                            </div>
                          </div>
                          <div style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                            <button
                              className="btn btn-outline"
                              disabled={savingCell}
                              onClick={setToOff}
                            >
                              この日をOFFにする
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
              <button
                className="btn btn-outline"
                style={{ marginTop: "1rem", width: "100%" }}
                onClick={() => setEditingCell(null)}
                disabled={savingCell}
              >
                キャンセル
              </button>
            </div>
          </div>
      )}
    </div>
  );
}
