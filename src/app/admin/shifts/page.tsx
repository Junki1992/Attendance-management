"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";
import {
  confirmShifts,
  confirmShiftsForUser,
  rejectShiftsForUser,
  unconfirmShiftsForUser,
  saveShift,
  getAllShiftsFromServer,
  subscribeAllShifts,
  getUnsubmittedStaff,
  getMonthlyWorkSummary,
  getShiftWorkType,
  getShiftWorkTypeLabel,
  Shift,
  type ShiftWorkType,
  type ConfirmBlock,
} from "@/services/shiftService";
import {
  SHIFT_ARCHIVE_USERS_COLLECTION,
  getArchivedUserNamesForIds,
} from "@/services/shiftArchiveService";
import {
  canonicalUserIdForShiftDoc,
  normalizeShiftDateFromFirestore,
  resolveShiftDateString,
  shiftModelInCalendarMonth,
} from "@/lib/shiftDateNormalize";
import {
  shiftBelongsToStaffRow,
  findShiftForGridCell,
  collectFirestoreOwnerIdsForStaffRow,
  computeOrphanUserIdsForTable,
  shiftCountsTowardUserIdRow,
} from "@/lib/adminShiftRowMatch";
import { getAllStaff, getUserProfile, StaffItem } from "@/services/userService";
import { isNotificationExcludedUserId } from "@/lib/notificationExclusions";
import { createNotification, getShiftConfirmedNotifications, Notification } from "@/services/notificationService";
import { getShiftSubmitComments, type ShiftSubmitCommentItem } from "@/services/shiftSubmitCommentService";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";
import { DEFAULT_HOURLY_WAGE } from "@/lib/app-config";

const MOBILE_BREAKPOINT = 768;

/**
 * 確定・却下・取り消しの通知を送らない機能は一時無効。
 * 復活させる場合: sessionStorage キー `adminShiftsSuppressStaffShiftNotifs` とチェックボックス UI を復元する。
 */
function readSuppressStaffShiftNotifsFromSession(): boolean {
  return false;
}

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
  /** 一覧外UID → shiftArchiveUsers の退職時氏名（現行スタッフ行への紐づけ用） */
  const [orphanUidToArchivedName, setOrphanUidToArchivedName] = useState<Record<string, string>>({});
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [unsubmitted, setUnsubmitted] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmingUserId, setConfirmingUserId] = useState<string | null>(null);
  const [confirmingSelected, setConfirmingSelected] = useState(false);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [unconfirmingUserId, setUnconfirmingUserId] = useState<string | null>(null);
  const [unconfirmBlock, setUnconfirmBlock] = useState<ConfirmBlock>("first");
  const [actionModalUserId, setActionModalUserId] = useState<string | null>(null);
  const [confirmModalUserId, setConfirmModalUserId] = useState<string | null>(null);
  const [confirmModalBulk, setConfirmModalBulk] = useState<"selected" | "all" | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);
  const [csvCopied, setCsvCopied] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<ConfirmBlock>("first");
  const [error, setError] = useState<string | null>(null);
  const [confirmedNotifs, setConfirmedNotifs] = useState<Notification[]>([]);
  const [confirmedNotifsPage, setConfirmedNotifsPage] = useState(1);
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

  const lastDay = new Date(year, month + 1, 0).getDate();
  const DAYS = Array.from({ length: lastDay }, (_, i) => i + 1);

  /** 当月シフトはあるが users（role=staff）一覧に userId が無い行（表示用に補完） */
  const [orphanStaffNames, setOrphanStaffNames] = useState<Record<string, string>>({});

  const staffIdSet = useMemo(() => new Set(staffList.map((s) => s.id)), [staffList]);
  const staffIdToName = useMemo(() => Object.fromEntries(staffList.map((s) => [s.id, s.name])), [staffList]);

  useEffect(() => {
    const orphanUids = [...new Set(shifts.map((s) => s.userId).filter((uid) => !staffIdSet.has(uid)))];
    if (orphanUids.length === 0) {
      setOrphanUidToArchivedName({});
      return;
    }
    let cancelled = false;
    (async () => {
      const fromArchive = await getArchivedUserNamesForIds(orphanUids);
      const merged: Record<string, string> = { ...fromArchive };
      await Promise.all(
        orphanUids.map(async (uid) => {
          if (merged[uid]) return;
          try {
            const u = await getDocFromServer(doc(db, "users", uid));
            if (u.exists()) {
              const n = String((u.data() as { name?: string }).name ?? "").trim();
              if (n) merged[uid] = n;
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setOrphanUidToArchivedName(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [shifts, staffIdSet]);

  /** shiftArchiveUsers / users ドキュメント / シフト上の archivedUserName を統合した照合用マップ */
  const orphanNamesResolved = useMemo(() => {
    const m = { ...orphanUidToArchivedName };
    shifts.forEach((s) => {
      if (staffIdSet.has(s.userId)) return;
      const an = typeof s.archivedUserName === "string" ? s.archivedUserName.trim() : "";
      if (an) m[s.userId] = m[s.userId] || an;
    });
    return m;
  }, [orphanUidToArchivedName, shifts, staffIdSet]);

  const orphanUserIdsInMonth = useMemo(
    () => computeOrphanUserIdsForTable(shifts, staffList, staffIdSet, year, month, orphanNamesResolved),
    [shifts, staffList, staffIdSet, year, month, orphanNamesResolved]
  );

  useEffect(() => {
    if (orphanUserIdsInMonth.length === 0) {
      setOrphanStaffNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        orphanUserIdsInMonth.map(async (uid) => {
          try {
            const snap = await getDocFromServer(doc(db, SHIFT_ARCHIVE_USERS_COLLECTION, uid));
            const nm = snap.exists()
              ? String((snap.data() as { archivedUserName?: string }).archivedUserName ?? "").trim()
              : "";
            next[uid] = nm ? `${nm}（一覧外ID）` : `ID: ${uid.slice(0, 10)}…`;
          } catch {
            next[uid] = `ID: ${uid.slice(0, 10)}…`;
          }
        })
      );
      if (!cancelled) setOrphanStaffNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [orphanUserIdsInMonth]);

  const displayStaffList = useMemo((): StaffItem[] => {
    const extras: StaffItem[] = orphanUserIdsInMonth.map((id) => ({
      id,
      name: orphanStaffNames[id] ?? "名前取得中…",
      photoURL: undefined,
    }));
    return [...staffList, ...extras];
  }, [staffList, orphanUserIdsInMonth, orphanStaffNames]);

  useEffect(() => {
    if (!editingCell) {
      setEditingCellHourlyWage(null);
      return;
    }
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(editingCell.day).padStart(2, "0")}`;
    const staffRow = displayStaffList.find((s) => s.id === editingCell.userId);
    const shift = staffRow
      ? findShiftForGridCell(staffRow, dateStr, shifts, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      : undefined;
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
  }, [
    editingCell,
    shifts,
    workSummary,
    displayStaffList,
    staffIdSet,
    orphanNamesResolved,
    staffIdToName,
    year,
    month,
  ]);

  const shiftDataComputed = useMemo(() => {
    const map: Record<string, number> = {};
    const add = (visualUserId: string, sh: Shift) => {
      if (sh.status === "draft") return;
      const h = calcHours(sh);
      if (h === "OFF") return;
      const sid = sh.id ?? "";
      const uid = canonicalUserIdForShiftDoc(sid, sh.userId);
      const dayStr = resolveShiftDateString(sh.date, sid, uid) || sh.date;
      const day = parseInt(dayStr.split("-")[2]!, 10);
      if (!Number.isFinite(day)) return;
      map[`${visualUserId}-${day}`] = h as number;
    };
    shifts.forEach((sh) => {
      if (shiftCountsTowardUserIdRow(sh, staffIdSet, orphanNamesResolved, staffIdToName)) {
        add(sh.userId, sh);
      }
      staffList.forEach((staff) => {
        if (!shiftBelongsToStaffRow(sh, staff.id, staff.name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)) return;
        add(staff.id, sh);
      });
    });
    return map;
  }, [shifts, staffList, staffIdSet, orphanNamesResolved, staffIdToName]);

  useEffect(() => {
    getAllStaff().then(setStaffList);
  }, []);

  useEffect(() => {
    getUnsubmittedStaff(year, month).then(setUnsubmitted);
  }, [year, month]);

  useEffect(() => {
    setConfirmedNotifsPage(1);
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
    const applyShifts = (s: Shift[]) => {
      setShifts(s);
      setError(null);
      setLoading(false);
    };
    // 初回はサーバーから取得して確定状態を正しく表示（キャッシュだと確定済みなのに「送る」のままになることがある）
    getAllShiftsFromServer(year, month).then(applyShifts).catch((e) => {
      console.warn("getAllShiftsFromServer failed, falling back to subscription only", e);
      setLoading(false);
    });
    const unsub = subscribeAllShifts(year, month, (s, meta) => {
      // 空のキャッシュスナップショットでサーバー取得済みの表示を潰さない
      if (meta?.fromCache && s.length === 0) return;
      applyShifts(s);
    });
    return () => unsub();
  }, [year, month]);

  const getShift = useCallback(
    (uid: string, day: number) => shiftDataComputed[`${uid}-${day}`] || 0,
    [shiftDataComputed]
  );

  const rowDisplayName = useCallback(
    (uid: string) => displayStaffList.find((s) => s.id === uid)?.name ?? "",
    [displayStaffList]
  );

  /** このユーザーに当月シフトが1件以上あるか（提出済み・確定済みのみ。下書きは除く） */
  const hasShiftsInMonth = useCallback(
    (userId: string) => {
      const name = rowDisplayName(userId);
      return shifts.some(
        (s) =>
          s.status !== "draft" &&
          shiftModelInCalendarMonth(s, year, month) &&
          shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
    },
    [shifts, year, month, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

  /** 名前で旧UIDと紐づいたシフトがある人は「未提出」に出さない。通知除外 UID は一覧にも載せない */
  const unsubmittedDisplay = useMemo(
    () =>
      unsubmitted.filter(
        (u) => !hasShiftsInMonth(u.id) && !isNotificationExcludedUserId(u.id)
      ),
    [unsubmitted, hasShiftsInMonth]
  );

  /** このユーザーに提出済み（未確定）のシフトが1件以上あるか（却下ボタン表示用） */
  const hasSubmittedShifts = useCallback(
    (userId: string) => {
      const name = rowDisplayName(userId);
      return shifts.some(
        (s) =>
          s.status === "submitted" &&
          shiftModelInCalendarMonth(s, year, month) &&
          shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
    },
    [shifts, year, month, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

  /** このユーザーの当月シフトがすべて確定済みで、確定後に編集されていなければ true（シフトなしは false） */
  const isFullyConfirmed = useCallback(
    (userId: string) => {
      const name = rowDisplayName(userId);
      const userShifts = shifts.filter(
        (s) =>
          s.status !== "draft" &&
          shiftModelInCalendarMonth(s, year, month) &&
          shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
      if (userShifts.length === 0) return false;
      return userShifts.every((s) => s.status === "confirmed" && !s.editedAfterConfirmed);
    },
    [shifts, year, month, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
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

  /** 指定ユーザーが指定ブロック内に確定済みシフトを1件以上持つか（取り消し可能か） */
  const hasConfirmedShiftsInBlock = useCallback(
    (uid: string, block: ConfirmBlock) => {
      const name = rowDisplayName(uid);
      const userShifts = shifts.filter(
        (s) =>
          s.status !== "draft" &&
          shiftBelongsToStaffRow(s, uid, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
      const inBlock = block === "all" ? userShifts : userShifts.filter((s) => isInBlock(s.date, block));
      return inBlock.some((s) => s.status === "confirmed");
    },
    [shifts, isInBlock, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

  useEffect(() => {
    if (!unconfirmingUserId) return;
    const blocks: ConfirmBlock[] = ["first", "second"];
    const firstAvailable = blocks.find((b) => hasConfirmedShiftsInBlock(unconfirmingUserId, b));
    setUnconfirmBlock(firstAvailable ?? "first");
  }, [unconfirmingUserId, hasConfirmedShiftsInBlock]);

  /** 選択中の確定ブロックがこのユーザーに対してすでに確定済みか（ブロック内のシフトがすべて確定＆編集なし） */
  const isBlockConfirmedForUser = useCallback(
    (userId: string) => {
      const name = rowDisplayName(userId);
      const userShifts = shifts.filter(
        (s) =>
          s.status !== "draft" &&
          shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
      const inBlock = confirmBlock === "all" ? userShifts : userShifts.filter((s) => isInBlock(s.date, confirmBlock));
      if (inBlock.length === 0) return false;
      return inBlock.every((s) => s.status === "confirmed" && !s.editedAfterConfirmed);
    },
    [shifts, confirmBlock, isInBlock, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

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
    setConfirmModalBulk(null);
    const blockLabel = getConfirmBlockLabel(confirmBlock);
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
      const skipNotif = readSuppressStaffShiftNotifsFromSession();
      if (!skipNotif) {
        await Promise.all(
          affectedUserIds.map((uid) => createNotification(uid, "shift_confirmed", message))
        );
      }
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      alert(
        skipNotif
          ? `${affectedUserIds.length}名分を確定しました。スタッフへの通知はスキップしました（「通知を送らない」がオン）。`
          : `${affectedUserIds.length}名のアルバイトに通知を送りました！`
      );
    } catch (e) {
      console.error("[admin/shifts] handleConfirm: error", e);
      alert("確定処理に失敗しました");
    } finally {
      setConfirming(false);
    }
  };

  const handleConfirmOne = async (userId: string) => {
    setConfirmModalUserId(null);
    setConfirmingUserId(userId);
    try {
      const name = rowDisplayName(userId);
      const owners = collectFirestoreOwnerIdsForStaffRow(
        shifts,
        userId,
        name,
        year,
        month,
        staffIdSet,
        orphanNamesResolved,
        staffIdToName,
        staffList
      );
      const hadEdited = shifts.some(
        (s) =>
          shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList) &&
          s.editedAfterConfirmed &&
          (confirmBlock === "all" || isInBlock(s.date, confirmBlock))
      );
      let anyConfirmed = false;
      for (const ownerId of owners) {
        const ok = await confirmShiftsForUser(ownerId, year, month, confirmBlock);
        if (ok) anyConfirmed = true;
      }
      if (!anyConfirmed) {
        alert(`このアルバイトの${getConfirmBlockLabel(confirmBlock)}に確定するシフトがありません。`);
        return;
      }
      // 購読の反映を待たず、確定済み表示にすぐ切り替える
      setShifts((prev) =>
        prev.map((s) => {
          if (!shiftBelongsToStaffRow(s, userId, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)) return s;
          if (confirmBlock === "all" || isInBlock(s.date, confirmBlock)) {
            return { ...s, status: "confirmed" as const, editedAfterConfirmed: false };
          }
          return s;
        })
      );
      const message = getConfirmMessage(confirmBlock, month, hadEdited);
      const skipOne = readSuppressStaffShiftNotifsFromSession();
      if (!skipOne) {
        await createNotification(userId, "shift_confirmed", message);
      }
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      alert(skipOne ? "確定しました。スタッフへの通知はスキップしました。" : "確定通知を送りました。");
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
      const name = rowDisplayName(uid);
      const owners = collectFirestoreOwnerIdsForStaffRow(
        shifts,
        uid,
        name,
        year,
        month,
        staffIdSet,
        orphanNamesResolved,
        staffIdToName,
        staffList
      );
      const targetOwners = owners.length > 0 ? owners : [uid];
      let ok = false;
      for (const ownerId of targetOwners) {
        const r = await rejectShiftsForUser(ownerId, year, month);
        if (r) ok = true;
      }
      const message = ok
        ? `${month + 1}月のシフトが却下されました。\n理由: ${rejectComment.trim()}`
        : `${month + 1}月のシフトに修正が必要です。\n理由: ${rejectComment.trim()}\n内容を確認して提出してください。`;
      const skipReject = readSuppressStaffShiftNotifsFromSession();
      if (!skipReject) {
        await createNotification(uid, "shift_rejected", message);
      }
      if (!ok) {
        setRejectingUserId(null);
        setRejectComment("");
        setConfirmingUserId(null);
        alert(
          skipReject
            ? "下書きのみのためステータスは変更しませんでした。通知もスキップしました。"
            : "下書きのみのためステータスは変更しませんでしたが、通知を送りました。"
        );
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
      alert(skipReject ? "却下しました（通知はスキップ）。" : "却下し、通知を送りました。");
    } catch (e) {
      console.error(e);
      alert("却下の送信に失敗しました");
    } finally {
      setConfirmingUserId(null);
    }
  };

  const handleUnconfirm = async () => {
    const uid = unconfirmingUserId;
    if (!uid) return;
    setConfirmingUserId(uid);
    try {
      const name = rowDisplayName(uid);
      const owners = collectFirestoreOwnerIdsForStaffRow(
        shifts,
        uid,
        name,
        year,
        month,
        staffIdSet,
        orphanNamesResolved,
        staffIdToName,
        staffList
      );
      const targetOwners = owners.length > 0 ? owners : [uid];
      let ok = false;
      for (const ownerId of targetOwners) {
        const u = await unconfirmShiftsForUser(ownerId, year, month, unconfirmBlock);
        if (u) ok = true;
      }
      if (!ok) {
        setUnconfirmingUserId(null);
        setConfirmingUserId(null);
        alert(`${getConfirmBlockLabel(unconfirmBlock)}に確定済みシフトがありません。`);
        return;
      }
      const blockLabel = getConfirmBlockLabel(unconfirmBlock);
      const message =
        unconfirmBlock === "all"
          ? `${month + 1}月のシフトの確定が取り消されました。内容を確認して再度提出してください。`
          : unconfirmBlock === "first"
            ? `${month + 1}月1～15日分のシフトの確定が取り消されました。内容を確認して再度提出してください。`
            : `${month + 1}月16日～月末のシフトの確定が取り消されました。内容を確認して再度提出してください。`;
      const skipUnc = readSuppressStaffShiftNotifsFromSession();
      if (!skipUnc) {
        await createNotification(uid, "shift_unconfirmed", message);
      }
      setUnconfirmingUserId(null);
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      alert(
        skipUnc
          ? `${blockLabel}の確定を取り消しました（通知はスキップ）。バイト側で再編集できます。`
          : `${blockLabel}の確定を取り消しました。バイト側で再編集できます。`
      );
    } catch (e) {
      console.error(e);
      alert("確定取り消しに失敗しました");
    } finally {
      setConfirmingUserId(null);
    }
  };

  /** 指定ユーザーが選択ブロック内にシフトを1件以上持つか */
  const hasShiftsInBlock = useCallback(
    (uid: string) => {
      const name = rowDisplayName(uid);
      const userShifts = shifts.filter(
        (x) =>
          x.status !== "draft" &&
          shiftBelongsToStaffRow(x, uid, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
      const inBlock = confirmBlock === "all" ? userShifts : userShifts.filter((x) => isInBlock(x.date, confirmBlock));
      return inBlock.length > 0;
    },
    [shifts, confirmBlock, isInBlock, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

  /** 指定ユーザーが前半 or 後半のどちらかにでも確定済みシフトを持つか（取り消し可能か） */
  const hasAnyConfirmedShifts = useCallback(
    (uid: string) =>
      hasConfirmedShiftsInBlock(uid, "first") || hasConfirmedShiftsInBlock(uid, "second"),
    [hasConfirmedShiftsInBlock]
  );

  /** 指定ユーザーが指定ブロック内に未確定シフトを持つか */
  const hasUnconfirmedInBlockFor = useCallback(
    (uid: string, block: ConfirmBlock) => {
      const name = rowDisplayName(uid);
      const userShifts = shifts.filter(
        (x) =>
          x.status !== "draft" &&
          shiftBelongsToStaffRow(x, uid, name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
      );
      const inBlock = block === "all" ? userShifts : userShifts.filter((x) => isInBlock(x.date, block));
      return inBlock.some((x) => x.status !== "confirmed");
    },
    [shifts, isInBlock, rowDisplayName, staffIdSet, orphanNamesResolved, staffIdToName, staffList]
  );

  /** 指定ユーザーが選択ブロック内に未確定シフトを持つか（一括・個別確定の実行時に使用） */
  const hasUnconfirmedInBlock = useCallback(
    (uid: string) => hasUnconfirmedInBlockFor(uid, confirmBlock),
    [confirmBlock, hasUnconfirmedInBlockFor]
  );

  /** 前半 or 後半のどちらかにでも未確定シフトがあるか（表で「送る」を出す判定） */
  const hasUnconfirmedInAnyBlock = useCallback(
    (uid: string) => hasUnconfirmedInBlockFor(uid, "first") || hasUnconfirmedInBlockFor(uid, "second"),
    [hasUnconfirmedInBlockFor]
  );

  /** 確定対象が1人以上いるか（前半 or 後半のどちらかに未確定シフトがある人。範囲はモーダルで選択） */
  const hasShiftsToConfirm = useMemo(
    () => displayStaffList.some((s) => hasShiftsInMonth(s.id) && hasUnconfirmedInAnyBlock(s.id)),
    [displayStaffList, hasShiftsInMonth, hasUnconfirmedInAnyBlock]
  );

  const handleConfirmSelected = async () => {
    const ids = Array.from(selectedUserIds).filter(
      (uid) => hasShiftsInMonth(uid) && !isBlockConfirmedForUser(uid) && hasUnconfirmedInBlock(uid)
    );
    if (ids.length === 0) {
      alert(`${getConfirmBlockLabel(confirmBlock)}に未確定シフトがある人が選択されていません。`);
      return;
    }
    setConfirmModalBulk(null);
    const blockLabel = getConfirmBlockLabel(confirmBlock);
    setConfirmingSelected(true);
    try {
      const skipBulk = readSuppressStaffShiftNotifsFromSession();
      let confirmedPeople = 0;
      let notifiedPeople = 0;
      for (const uid of ids) {
        const nm = rowDisplayName(uid);
        const hadEdited = shifts.some(
          (s) =>
            shiftBelongsToStaffRow(s, uid, nm, staffIdSet, orphanNamesResolved, staffIdToName, staffList) &&
            s.editedAfterConfirmed &&
            (confirmBlock === "all" || isInBlock(s.date, confirmBlock))
        );
        const owners = collectFirestoreOwnerIdsForStaffRow(
          shifts,
          uid,
          nm,
          year,
          month,
          staffIdSet,
          orphanNamesResolved,
          staffIdToName,
          staffList
        );
        let anyOk = false;
        for (const ownerId of owners) {
          const ok = await confirmShiftsForUser(ownerId, year, month, confirmBlock);
          if (ok) anyOk = true;
        }
        if (!anyOk) continue;
        confirmedPeople += 1;
        const message = getConfirmMessage(confirmBlock, month, hadEdited);
        if (!skipBulk) {
          await createNotification(uid, "shift_confirmed", message);
          notifiedPeople += 1;
        }
      }
      // 購読の反映を待たず、確定済み表示にすぐ切り替える
      if (confirmedPeople > 0) {
        setShifts((prev) =>
          prev.map((s) => {
            const hit = ids.some((staffId) => {
              const sn = rowDisplayName(staffId);
              return (
                shiftBelongsToStaffRow(s, staffId, sn, staffIdSet, orphanNamesResolved, staffIdToName, staffList) &&
                (confirmBlock === "all" || isInBlock(s.date, confirmBlock))
              );
            });
            if (!hit) return s;
            return { ...s, status: "confirmed" as const, editedAfterConfirmed: false };
          })
        );
      }
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      setSelectedUserIds(new Set());
      alert(
        skipBulk
          ? `${confirmedPeople} 名分を確定しました。スタッフへの通知はスキップしました。`
          : `${notifiedPeople} 名に確定通知を送りました。`
      );
    } catch (e) {
      console.error(e);
      alert("確定通知の送信に失敗しました");
    } finally {
      setConfirmingSelected(false);
    }
  };

  const handleRemind = async () => {
    if (unsubmittedDisplay.length === 0) return;
    setReminding(true);
    try {
      await Promise.all(
        unsubmittedDisplay.map((u) =>
          createNotification(
            u.id,
            "remind_submit",
            `${month + 1}月のシフト提出がまだです。お早めに提出してください。`
          )
        )
      );
      alert(`${unsubmittedDisplay.length}名に催促通知を送りました`);
    } catch (e) {
      console.error(e);
      alert("催促に失敗しました");
    } finally {
      setReminding(false);
    }
  };

  const buildCsv = (): string => {
    const confirmed = shifts.filter((s) => s.status === "confirmed");
    const nameMap = Object.fromEntries(displayStaffList.map((s) => [s.id, s.name]));
    // Googleスプレッドシート形式（タブ区切り）: 1行目=日付,スタッフ1,スタッフ2,... 2行目以降=日付,各スタッフのシフト（改行含むセルはクォートでセル内改行になる）
    const header = ["日付", ...displayStaffList.map((s) => nameMap[s.id] || s.id)].join("\t");
    const rows = DAYS.map((d) => {
      const date = new Date(year, month, d);
      const dateLabel = `${month + 1}/${d}(${WEEKDAY_LABELS[date.getDay()]})`;
      const cells = displayStaffList.map((staff) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const s = confirmed.find((x) => {
          const xd = resolveShiftDateString(x.date, x.id ?? "", x.userId) || x.date;
          return (
            xd === dateStr &&
            shiftBelongsToStaffRow(x, staff.id, staff.name, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
          );
        });
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
    displayStaffList.forEach((s) => {
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
  }, [displayStaffList, DAYS, getShift, year, month]);

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
      {unsubmittedDisplay.length > 0 && (
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
              <strong>未提出者（{unsubmittedDisplay.length}名）</strong>
              <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>
                {unsubmittedDisplay.map((u) => u.name).join("、")}
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
            <button
              className="btn btn-outline"
              onClick={handleCopyCsv}
              disabled={loading}
              style={isMobile ? { flex: 1, minWidth: "120px" } : undefined}
            >
              {csvCopied ? "コピーしました" : "CSVコピー"}
            </button>
            {/* 一旦非表示 */}
            <button
              className="btn btn-outline"
              onClick={() => {
                const ids = Array.from(selectedUserIds).filter(
                  (uid) => hasShiftsInMonth(uid) && hasUnconfirmedInAnyBlock(uid)
                );
                if (ids.length === 0) {
                  alert("送信対象を選択してください（未確定のシフトがある人にチェックを入れてください）。");
                  return;
                }
                setConfirmBlock("first");
                setConfirmModalBulk("selected");
              }}
              disabled={loading || confirming || confirmingSelected || selectedUserIds.size === 0}
              title={selectedUserIds.size === 0 ? "下の表で確定通知を送りたい人にチェックを入れてください" : `選択した ${selectedUserIds.size} 名に送る（モーダルで範囲を選択）`}
              style={{ display: "none", ...(isMobile ? { flex: 1, minWidth: "120px" } : {}) }}
            >
              {confirmingSelected ? "送信中..." : `選択した人に送る${selectedUserIds.size > 0 ? ` (${selectedUserIds.size}人)` : ""}`}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!hasShiftsToConfirm) return;
                setConfirmBlock("first");
                setConfirmModalBulk("all");
              }}
              disabled={loading || confirming || !hasShiftsToConfirm}
              title={!hasShiftsToConfirm ? "未確定のシフトがある人がいません" : undefined}
              style={{ display: "none", ...(isMobile ? { flex: 1, minWidth: "120px" } : {}) }}
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

        {!loading && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }} role="note">
            凡例: <span style={{ color: "#B91C1C", fontWeight: 600 }}>8h超</span>＝1日8時間超過　<span style={{ color: "#B91C1C", fontWeight: 600 }}>締切後</span>＝締切後に管理者が編集
          </p>
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
                {displayStaffList.map((user) => {
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
                      {hasShiftsInMonth(user.id) && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem" }}
                            disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId || !!unconfirmingUserId || !!confirmModalUserId || !!confirmModalBulk || !!actionModalUserId}
                            onClick={() => setActionModalUserId(user.id)}
                          >
                            送る
                          </button>
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
                          const shift = findShiftForGridCell(user, dateStr, shifts, staffIdSet, orphanNamesResolved, staffIdToName, staffList);
                          const h = shift ? calcHours(shift) : 0;
                          const numHours = h === "OFF" ? 0 : (h as number);
                          const isOver = isDailyOver(numHours);
                          const hasData = !!shift;
                          const isEditedLate = !!shift?.editedAfterDeadline;
                          const isConfirmed = shift?.status === "confirmed";
                          const baseBg = isOver ? "#FEE2E2" : numHours > 0 ? "#EEF2FF" : (isHoliday ? "rgba(254, 215, 170, 0.8)" : isWeekend ? "rgba(191, 219, 254, 0.8)" : "var(--surface-hover)");
                          return (
                            <div
                              key={day}
                              onClick={hasData ? () => setEditingCell({ userId: user.id, day }) : undefined}
                              style={{
                                minHeight: "36px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "0.2rem",
                                borderRadius: "4px",
                                backgroundColor: baseBg,
                                borderLeft: isConfirmed ? "3px solid rgba(34, 197, 94, 0.7)" : undefined,
                                color: isOver || isEditedLate ? "#B91C1C" : "inherit",
                                cursor: hasData ? "pointer" : "default",
                              }}
                            >
                              <span style={{ fontSize: "0.6rem", opacity: 0.85, lineHeight: 1 }}>{day}</span>
                              {h === "OFF" ? "OFF" : numHours > 0 ? (
                                <>
                                  {formatShiftCellLabel(shift)}
                                  {isOver && <span style={{ fontSize: "0.5rem", fontWeight: 600, color: "#B91C1C", display: "block" }}>8h超</span>}
                                  {isEditedLate && !isOver && <span style={{ fontSize: "0.5rem", fontWeight: 600, color: "#B91C1C", display: "block" }}>締切後</span>}
                                </>
                              ) : ""}
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
                      <span style={{ fontSize: "0.7em", display: "block" }}>({WEEKDAY_LABELS[date.getDay()]})</span>
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
                  title="確定通知を送る / 取り消し（送るはモーダルで範囲を選択）"
                >
                  確定通知
                </th>
              </tr>
            </thead>
            <tbody>
              {displayStaffList.map((user) => {
                const totalHours = DAYS.reduce(
                  (acc, d) => acc + getShift(user.id, d),
                  0
                );
                const weeklyWarning = isWeeklyOver(user.id);

                return (
                  <tr
                    key={user.id}
                    style={{
                      backgroundColor: selectedUserIds.has(user.id) ? "rgba(79, 70, 229, 0.1)" : undefined,
                    }}
                  >
                    <td
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        fontWeight: 500,
                        position: "sticky",
                        left: 0,
                        backgroundColor: selectedUserIds.has(user.id) ? "rgba(79, 70, 229, 0.1)" : "var(--surface)",
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
                          cursor: !hasShiftsInMonth(user.id) ? "not-allowed" : "pointer",
                          opacity: !hasShiftsInMonth(user.id) ? 0.7 : 1,
                        }}
                        title={!hasShiftsInMonth(user.id) ? "シフトがありません" : "行を選択（確定・取り消しはモーダルで操作）"}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => hasShiftsInMonth(user.id) && toggleSelected(user.id)}
                          disabled={!hasShiftsInMonth(user.id)}
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
                      const shift = findShiftForGridCell(user, dateStr, shifts, staffIdSet, orphanNamesResolved, staffIdToName, staffList);
                      const h = shift ? calcHours(shift) : 0;
                      const numHours = h === "OFF" ? 0 : (h as number);
                      const isOver = isDailyOver(numHours);
                      const hasData = !!shift;
                      const isEditedLate = !!shift?.editedAfterDeadline;
                      const isConfirmed = shift?.status === "confirmed";
                      const cellTitle = isOver ? "1日8時間超過" : isEditedLate ? "締切後に管理者が編集" : isConfirmed ? (shift?.editedAfterConfirmed ? "確定済み（確定後に編集）・クリックで編集" : "確定済み・クリックで編集") : hasData ? "クリックで編集" : "クリックでシフトを追加";
                      const baseCellBg = isOver
                        ? "#FEE2E2"
                        : numHours > 0
                          ? "#EEF2FF"
                          : isHoliday
                            ? "rgba(254, 215, 170, 0.8)"
                            : isWeekend
                              ? "rgba(191, 219, 254, 0.8)"
                              : "var(--surface-hover)";
                      const cellBg = selectedUserIds.has(user.id) ? "rgba(79, 70, 229, 0.12)" : baseCellBg;
                      return (
                        <td
                          key={d}
                          onClick={() => setEditingCell({ userId: user.id, day: d })}
                          style={{
                            border: "1px solid var(--border)",
                            borderLeft: selectedUserIds.has(user.id) ? "3px solid rgba(79, 70, 229, 0.5)" : isConfirmed ? "3px solid rgba(34, 197, 94, 0.7)" : undefined,
                            textAlign: "center",
                            backgroundColor: cellBg,
                            color: isOver || isEditedLate ? "#B91C1C" : "inherit",
                            cursor: "pointer",
                          }}
                          title={cellTitle}
                        >
                          {h === "OFF" ? "OFF" : numHours > 0 ? (
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.1rem" }}>
                              <span>{formatShiftCellLabel(shift)}</span>
                              {isOver && <span style={{ fontSize: "0.55rem", fontWeight: 600, color: "#B91C1C" }}>8h超</span>}
                              {isEditedLate && !isOver && <span style={{ fontSize: "0.55rem", fontWeight: 600, color: "#B91C1C" }}>締切後</span>}
                            </span>
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
                        backgroundColor: selectedUserIds.has(user.id) ? "rgba(79, 70, 229, 0.1)" : undefined,
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
                        backgroundColor: selectedUserIds.has(user.id) ? "rgba(79, 70, 229, 0.1)" : undefined,
                      }}
                    >
                      {!hasShiftsInMonth(user.id) ? (
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }} title="シフトがありません">—</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                          disabled={!!confirmingUserId || confirming || confirmingSelected || !!rejectingUserId || !!unconfirmingUserId || !!confirmModalUserId || !!confirmModalBulk || !!actionModalUserId}
                          onClick={() => setActionModalUserId(user.id)}
                          title="確定・取り消し・却下はモーダルで操作"
                        >
                          {confirmingUserId === user.id ? "送信中..." : "送る"}
                        </button>
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
          <>
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
                {confirmedNotifs
                  .slice((confirmedNotifsPage - 1) * 10, confirmedNotifsPage * 10)
                  .map((n) => (
                  <tr key={n.id}>
                    <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>
                      {notifUserIdToName[n.userId] || displayStaffList.find((s) => s.id === n.userId)?.name || n.userId}
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
            {confirmedNotifs.length > 10 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  disabled={confirmedNotifsPage <= 1}
                  onClick={() => setConfirmedNotifsPage((p) => Math.max(1, p - 1))}
                >
                  ‹ 前へ
                </button>
                <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  {confirmedNotifsPage} / {Math.ceil(confirmedNotifs.length / 10)}
                </span>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  disabled={confirmedNotifsPage >= Math.ceil(confirmedNotifs.length / 10)}
                  onClick={() => setConfirmedNotifsPage((p) => Math.min(Math.ceil(confirmedNotifs.length / 10), p + 1))}
                >
                  次へ ›
                </button>
              </div>
            )}
          </>
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
              {displayStaffList.find((s) => s.id === rejectingUserId)?.name ?? rejectingUserId} さん
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

      {/* 確定通知セル用：確定・取り消し・却下を選ぶ操作モーダル */}
      {actionModalUserId && (
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
          onClick={() => { if (!confirmingUserId && !rejectingUserId) setActionModalUserId(null); }}
        >
          <div
            className="card"
            style={{ minWidth: "280px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-main)" }}>
              {displayStaffList.find((s) => s.id === actionModalUserId)?.name ?? actionModalUserId} さん
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {actionModalUserId && hasUnconfirmedInAnyBlock(actionModalUserId) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: "center" }}
                  disabled={!!confirmingUserId}
                  onClick={() => {
                    setConfirmBlock(hasUnconfirmedInBlockFor(actionModalUserId, "first") ? "first" : "second");
                    setConfirmModalUserId(actionModalUserId);
                    setActionModalUserId(null);
                  }}
                >
                  確定通知を送る
                </button>
              )}
              {actionModalUserId && hasAnyConfirmedShifts(actionModalUserId) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: "center" }}
                  disabled={!!confirmingUserId}
                  onClick={() => {
                    setUnconfirmingUserId(actionModalUserId);
                    setActionModalUserId(null);
                  }}
                >
                  取り消し
                </button>
              )}
              {actionModalUserId && hasSubmittedShifts(actionModalUserId) && (
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: "center", backgroundColor: "var(--destructive)", color: "white", border: "none" }}
                  disabled={!!confirmingUserId}
                  onClick={() => {
                    setRejectingUserId(actionModalUserId);
                    setRejectComment("");
                    setActionModalUserId(null);
                  }}
                >
                  却下
                </button>
              )}
            </div>
            <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setActionModalUserId(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 確定確認モーダル */}
      {confirmModalUserId && (
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
          onClick={() => { if (!confirmingUserId) setConfirmModalUserId(null); }}
        >
          <div
            className="card"
            style={{ minWidth: "320px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-main)" }}>
              確定通知を送る
            </h3>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.95rem", color: "var(--text-main)" }}>
              <strong>確定範囲:</strong>
              <select
                value={confirmBlock}
                onChange={(e) => setConfirmBlock(e.target.value as ConfirmBlock)}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                  fontSize: "0.95rem",
                }}
              >
                <option value="first">1～15日分</option>
                <option value="second">16日～月末</option>
              </select>
            </label>
            <p style={{ fontSize: "0.95rem", marginBottom: "0.75rem", color: "var(--text-main)" }}>
              {displayStaffList.find((s) => s.id === confirmModalUserId)?.name ?? confirmModalUserId} さんに送信します。よろしいですか？
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!!confirmingUserId}
                onClick={() => setConfirmModalUserId(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!confirmingUserId}
                onClick={() => confirmModalUserId && handleConfirmOne(confirmModalUserId)}
              >
                {confirmingUserId === confirmModalUserId ? "送信中..." : "確定する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一括確定確認モーダル（選択して確定 / 全員確定） */}
      {confirmModalBulk && (
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
          onClick={() => { if (!confirming && !confirmingSelected) setConfirmModalBulk(null); }}
        >
          <div
            className="card"
            style={{ minWidth: "320px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-main)" }}>
              確定通知を送る
            </h3>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.95rem", color: "var(--text-main)" }}>
              <strong>確定範囲:</strong>
              <select
                value={confirmBlock}
                onChange={(e) => setConfirmBlock(e.target.value as ConfirmBlock)}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                  fontSize: "0.95rem",
                }}
              >
                <option value="first">1～15日分</option>
                <option value="second">16日～月末</option>
              </select>
            </label>
            <p style={{ fontSize: "0.95rem", marginBottom: "0.5rem", color: "var(--text-main)" }}>
              {confirmModalBulk === "selected"
                ? `選択した ${Array.from(selectedUserIds).filter((uid) => hasShiftsInMonth(uid) && hasUnconfirmedInBlock(uid)).length} 名に送信`
                : `${year}年${month + 1}月のシフトを全員に送信`}
            </p>
            <p style={{ fontSize: "0.95rem", marginBottom: "1rem", color: "var(--text-main)" }}>
              よろしいですか？
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={confirming || confirmingSelected}
                onClick={() => setConfirmModalBulk(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={confirming || confirmingSelected}
                onClick={() => {
                  if (confirmModalBulk === "selected") handleConfirmSelected();
                  else if (confirmModalBulk === "all") handleConfirm();
                }}
              >
                {confirming || confirmingSelected ? "処理中..." : "確定する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 確定取り消しモーダル */}
      {unconfirmingUserId && (
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
          onClick={() => { if (!confirmingUserId) setUnconfirmingUserId(null); }}
        >
          <div
            className="card"
            style={{ minWidth: "320px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-main)" }}>
              確定を取り消し
            </h3>
            <p style={{ fontSize: "0.95rem", marginBottom: "0.5rem", color: "var(--text-main)" }}>
              {displayStaffList.find((s) => s.id === unconfirmingUserId)?.name ?? unconfirmingUserId} さん
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.95rem", color: "var(--text-main)" }}>
              <strong>取り消し範囲:</strong>
              <select
                value={unconfirmBlock}
                onChange={(e) => setUnconfirmBlock(e.target.value as ConfirmBlock)}
                style={{
                  padding: "0.35rem 0.5rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                  fontSize: "0.875rem",
                }}
              >
                <option value="first" disabled={!unconfirmingUserId || !hasConfirmedShiftsInBlock(unconfirmingUserId, "first")}>
                  {unconfirmingUserId && !hasConfirmedShiftsInBlock(unconfirmingUserId, "first") ? "1～15日分（取り消し済み）" : "1～15日分"}
                </option>
                <option value="second" disabled={!unconfirmingUserId || !hasConfirmedShiftsInBlock(unconfirmingUserId, "second")}>
                  {unconfirmingUserId && !hasConfirmedShiftsInBlock(unconfirmingUserId, "second") ? "16日～月末（取り消し済み）" : "16日～月末"}
                </option>
              </select>
            </label>
            <p style={{ fontSize: "0.95rem", marginBottom: "1rem", color: "var(--text-main)" }}>
              確定を取り消しますか？
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!!confirmingUserId}
                onClick={() => setUnconfirmingUserId(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: "var(--primary)", color: "white", border: "none" }}
                disabled={!!confirmingUserId || !(unconfirmingUserId && hasConfirmedShiftsInBlock(unconfirmingUserId, unconfirmBlock))}
                onClick={handleUnconfirm}
              >
                {confirmingUserId === unconfirmingUserId ? "処理中..." : "取り消す"}
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
                {month + 1}月{editingCell.day}日　{displayStaffList.find((s) => s.id === editingCell.userId)?.name ?? editingCell.userId}
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
                    const editRow = displayStaffList.find((s) => s.id === editingCell.userId);
                    const existingShift = editRow
                      ? findShiftForGridCell(editRow, dateStr, shifts, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
                      : undefined;
                    const firestoreUserId = existingShift?.userId ?? editingCell.userId;
                    const editedAfterConfirmed = existingShift?.status === "confirmed";
                    await saveShift(
                      {
                        userId: firestoreUserId,
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
                    const editRow2 = displayStaffList.find((s) => s.id === editingCell.userId);
                    const existingShiftOff = editRow2
                      ? findShiftForGridCell(editRow2, dateStr, shifts, staffIdSet, orphanNamesResolved, staffIdToName, staffList)
                      : undefined;
                    const firestoreUserIdOff = existingShiftOff?.userId ?? editingCell.userId;
                    const editedAfterConfirmed = existingShiftOff?.status === "confirmed";
                    await saveShift(
                      {
                        userId: firestoreUserIdOff,
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
