import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import {
    collection,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    Timestamp,
    onSnapshot,
    writeBatch,
    getDocsFromServer,
    documentId,
    type QuerySnapshot,
} from "firebase/firestore";
import { getAllStaff, StaffItem, getUserProfile } from "@/services/userService";
import { DEFAULT_HOURLY_WAGE } from "@/lib/app-config";
import { isPastSubmitDeadlineForDateAsync } from "@/services/settingsService";
import {
    canonicalUserIdForShiftDoc,
    resolveShiftDateString,
    shiftDocumentInCalendarMonth,
    shiftModelInCalendarMonth,
} from "@/lib/shiftDateNormalize";
import {
    getAllArchivedShiftsForMonth,
    getArchivedShiftsForUserMonth,
    getArchivedUserNamesForIds,
} from "@/services/shiftArchiveService";
import { displayNameFromArchiveUserKey } from "@/lib/archiveUserKey";
import { shiftBelongsToStaffRow } from "@/lib/adminShiftRowMatch";

/** Firestore `in` は最大 30 要素 */
const SHIFT_DOC_ID_IN_CHUNK = 30;

/** 当月カレンダーの各日に対応する shifts のドキュメントID（アプリ標準: `${userId}_YYYY-MM-DD`） */
function shiftDocumentIdsForUserMonth(userId: string, year: number, month0: number): string[] {
    const lastDay = new Date(year, month0 + 1, 0).getDate();
    const ids: string[] = [];
    for (let d = 1; d <= lastDay; d++) {
        const ds = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        ids.push(`${userId}_${ds}`);
    }
    return ids;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function shiftsFromUserIdFieldQuery(snapshot: QuerySnapshot, year: number, month0: number): Shift[] {
    const shifts: Shift[] = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (!shiftDocumentInCalendarMonth(data.date, docSnap.id, String(data.userId ?? ""), year, month0)) return;
        shifts.push(shiftFromFirestoreDoc(docSnap.id, data));
    });
    return shifts;
}

/** documentId() in で取ったドキュメントは当月スロット固定のため月判定をスキップ（本文 userId 欠損でも表示する） */
function shiftsFromDocIdInQuery(snapshot: QuerySnapshot): Shift[] {
    const shifts: Shift[] = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        shifts.push(shiftFromFirestoreDoc(docSnap.id, data));
    });
    return shifts;
}

async function fetchLiveShiftsByDocumentIdsForMonth(
    userId: string,
    year: number,
    month0: number,
    fetchDocs: typeof getDocs
): Promise<Shift[]> {
    const parts = chunkArray(shiftDocumentIdsForUserMonth(userId, year, month0), SHIFT_DOC_ID_IN_CHUNK);
    if (parts.length === 0) return [];
    const snaps = await Promise.all(
        parts.map((ids) => fetchDocs(query(collection(db, "shifts"), where(documentId(), "in", ids))))
    );
    const out: Shift[] = [];
    for (const s of snaps) out.push(...shiftsFromDocIdInQuery(s));
    return out;
}

/** shifts に無く shiftArchives にだけ残っている分も月次表示に含める（同一 userId+日は live を優先） */
function mergeLiveAndArchivedShifts(live: Shift[], archived: Shift[]): Shift[] {
    const map = new Map<string, Shift>();
    const withNormDate = (s: Shift): Shift => {
        const id = s.id ?? "";
        const uid = canonicalUserIdForShiftDoc(id, s.userId);
        const d = resolveShiftDateString(s.date, id, uid);
        return { ...s, userId: uid, date: d || s.date };
    };
    for (const s of archived) {
        const n = withNormDate(s);
        map.set(`${n.userId}_${n.date}`, n);
    }
    for (const s of live) {
        const n = withNormDate(s);
        map.set(`${n.userId}_${n.date}`, n);
    }
    return Array.from(map.values()).sort((a, b) => a.userId.localeCompare(b.userId) || a.date.localeCompare(b.date));
}

async function safeArchivedForMonth(year: number, month: number): Promise<Shift[]> {
    try {
        return await getAllArchivedShiftsForMonth(year, month);
    } catch (e) {
        console.warn("[shiftService] getAllArchivedShiftsForMonth failed:", e);
        return [];
    }
}

async function safeArchivedForUserMonth(userId: string, year: number, month: number): Promise<Shift[]> {
    try {
        return await getArchivedShiftsForUserMonth(userId, year, month);
    } catch (e) {
        console.warn("[shiftService] getArchivedShiftsForUserMonth failed:", e);
        return [];
    }
}

/** Firestore の date（欠損・型ゆれ含む）を YYYY-MM-DD に揃えて Shift 化。ドキュメント ID を正として userId も復元 */
function shiftFromFirestoreDoc(id: string, raw: Record<string, unknown>): Shift {
    const canonicalUid = canonicalUserIdForShiftDoc(id, String(raw.userId ?? ""));
    const dateStr = resolveShiftDateString(raw.date, id, canonicalUid);
    const archivedUserName =
        typeof raw.archivedUserName === "string" ? raw.archivedUserName.trim() : undefined;
    return {
        id,
        ...raw,
        userId: canonicalUid,
        date: dateStr,
        ...(archivedUserName ? { archivedUserName } : {}),
    } as Shift;
}

/** 勤務形態（出社・在宅・当欠）。給与計算で参照する想定 */
export type ShiftWorkType = "office" | "remote" | "absence";

export interface Shift {
    id?: string;
    userId: string;
    /** 退職アーカイブ時の氏名（旧UIDのシフトを現行スタッフ行に表示する照合に使用） */
    archivedUserName?: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    status: 'draft' | 'submitted' | 'confirmed';
    hourlyWage?: number; // Optional snapshot of wage at time of shift
    /** 締切後に管理者が編集した場合 true */
    editedAfterDeadline?: boolean;
    /** 確定済みのシフトを管理者が編集した場合 true（再通知が必要） */
    editedAfterConfirmed?: boolean;
    /** 確定を取り消された場合 true（バイト画面で「取り消し済み」表示） */
    wasUnconfirmed?: boolean;
    /** 在宅勤務の場合 true（後方互換。workType があれば workType を優先） */
    isRemote?: boolean;
    /** 勤務形態: 出社 / 在宅 / 当欠。未設定時は isRemote から判定 */
    workType?: ShiftWorkType;
}

/** シフトの勤務形態を取得（workType 未設定時は isRemote から判定） */
export function getShiftWorkType(shift: Shift): ShiftWorkType {
    if (shift.workType) return shift.workType;
    return shift.isRemote ? "remote" : "office";
}

/** 勤務形態の表示ラベル */
export function getShiftWorkTypeLabel(shift: Shift): string {
    return getWorkTypeLabel(getShiftWorkType(shift));
}

/** 勤務形態の表示ラベル（workType のみから） */
export function getWorkTypeLabel(w: ShiftWorkType): string {
    return w === "absence" ? "当欠" : w === "remote" ? "在宅" : "出社";
}

/** プロフィールと勤務形態から時給を返す（集計・フォールバック用） */
export function getWageForWorkType(
    profile: { hourlyWage?: number; hourlyWageRemote?: number } | null,
    workType: ShiftWorkType
): number {
    const base = profile?.hourlyWage ?? DEFAULT_HOURLY_WAGE;
    if (workType === "remote") return profile?.hourlyWageRemote ?? base;
    return base;
}

export type SaveShiftOptions = { byAdmin?: boolean };

/** スタッフがシフトを保存（updateDoc で wasUnconfirmed を絶対に上書きしない） */
export const saveShiftByStaff = async (shift: Shift): Promise<string> => {
    const docId = `${shift.userId}_${shift.date}`;
    const shiftRef = doc(db, "shifts", docId);
    const workType = shift.workType ?? (shift.isRemote ? "remote" : "office");
    const updateData = {
        startTime: shift.startTime,
        endTime: shift.endTime,
        status: shift.status,
        workType,
        isRemote: workType === "remote",
        updatedAt: Timestamp.now(),
    };
    try {
        await updateDoc(shiftRef, updateData);
    } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "not-found") {
            await setDoc(shiftRef, { userId: shift.userId, date: shift.date, ...updateData }, { merge: true });
        } else {
            throw e;
        }
    }
    return docId;
};

export const saveShift = async (shift: Shift, options?: SaveShiftOptions): Promise<string> => {
    const docId = `${shift.userId}_${shift.date}`;
    const shiftRef = doc(db, "shifts", docId);

    let editedAfterDeadline: boolean | undefined;
    let hourlyWage = shift.hourlyWage;
    if (options?.byAdmin && shift.status === "confirmed" && hourlyWage == null) {
        const profile = await getUserProfile(shift.userId);
        const workType = shift.workType ?? (shift.isRemote ? "remote" : "office");
        hourlyWage = getWageForWorkType(profile, workType);
    }
    if (options?.byAdmin) {
        editedAfterDeadline = await isPastSubmitDeadlineForDateAsync(shift.date);
    }

    const { hourlyWage: _skip, wasUnconfirmed: _wu, ...shiftRest } = shift;
    const workType = shift.workType ?? (shift.isRemote ? "remote" : "office");
    const data = {
        ...shiftRest,
        workType,
        isRemote: workType === "remote",
        ...(hourlyWage != null && { hourlyWage }),
        updatedAt: Timestamp.now(),
        ...(editedAfterDeadline !== undefined && { editedAfterDeadline }),
        // スタッフ保存時は wasUnconfirmed を触らない（確定取り消しの「取り消し済み」表示を維持）
        ...(options?.byAdmin && { wasUnconfirmed: false }),
    };

    try {
        await setDoc(shiftRef, data, { merge: true });
        return docId;
    } catch (error) {
        console.error("Error saving shift:", error);
        throw error;
    }
};

export const getUserShifts = async (userId: string, year: number, month: number) => {
    const q = query(collection(db, "shifts"), where("userId", "==", userId));
    const [querySnapshot, byDocId, archived] = await Promise.all([
        getDocs(q),
        fetchLiveShiftsByDocumentIdsForMonth(userId, year, month, getDocs),
        safeArchivedForUserMonth(userId, year, month),
    ]);
    const fromField = shiftsFromUserIdFieldQuery(querySnapshot, year, month);
    const map = new Map<string, Shift>();
    for (const s of fromField) map.set(s.id!, s);
    for (const s of byDocId) map.set(s.id!, s);
    return mergeLiveAndArchivedShifts([...map.values()], archived);
};

/** 指定ユーザーのシフトをサーバーから取得（キャッシュを無視して最新を取得。更新ボタン用） */
export const getUserShiftsFromServer = async (userId: string, year: number, month: number): Promise<Shift[]> => {
    const q = query(collection(db, "shifts"), where("userId", "==", userId));
    const [querySnapshot, byDocId, archived] = await Promise.all([
        getDocsFromServer(q),
        fetchLiveShiftsByDocumentIdsForMonth(userId, year, month, getDocsFromServer),
        safeArchivedForUserMonth(userId, year, month),
    ]);
    const fromField = shiftsFromUserIdFieldQuery(querySnapshot, year, month);
    const map = new Map<string, Shift>();
    for (const s of fromField) map.set(s.id!, s);
    for (const s of byDocId) map.set(s.id!, s);
    return mergeLiveAndArchivedShifts([...map.values()], archived);
};

/**
 * 指定ユーザーのシフトをリアルタイム購読。
 * `where("userId")` だけだと本文 userId 欠損・誤りのドキュメントが取りこぼれるため、
 * 当月の `documentId in (uid_yyyy-mm-dd, …)` も併用してマージする。
 */
export const subscribeUserShifts = (
    userId: string,
    year: number,
    month: number,
    callback: (shifts: Shift[]) => void
) => {
    const archivedPromise = safeArchivedForUserMonth(userId, year, month);
    const idChunks = chunkArray(shiftDocumentIdsForUserMonth(userId, year, month), SHIFT_DOC_ID_IN_CHUNK);

    let fromField: Shift[] = [];
    const fromDocChunks: Shift[][] = idChunks.map(() => []);

    const emit = async () => {
        const map = new Map<string, Shift>();
        for (const s of fromField) map.set(s.id!, s);
        for (const s of fromDocChunks.flat()) map.set(s.id!, s);
        const archived = await archivedPromise;
        callback(mergeLiveAndArchivedShifts([...map.values()], archived));
    };

    const unsubs: Array<() => void> = [];
    const qField = query(collection(db, "shifts"), where("userId", "==", userId));
    unsubs.push(
        onSnapshot(
            qField,
            (snapshot) => {
                if (snapshot.metadata.fromCache && snapshot.empty) return;
                fromField = shiftsFromUserIdFieldQuery(snapshot, year, month);
                void emit();
            },
            (error) => {
                console.warn("[subscribeUserShifts] userId query error:", { userId, year, month: month + 1, error });
            }
        )
    );

    idChunks.forEach((ids, idx) => {
        const qd = query(collection(db, "shifts"), where(documentId(), "in", ids));
        unsubs.push(
            onSnapshot(
                qd,
                (snapshot) => {
                    fromDocChunks[idx] = shiftsFromDocIdInQuery(snapshot);
                    void emit();
                },
                (error) => {
                    console.warn("[subscribeUserShifts] documentId query error:", {
                        userId,
                        year,
                        month: month + 1,
                        chunk: idx,
                        error,
                    });
                }
            )
        );
    });

    return () => {
        unsubs.forEach((u) => u());
    };
};

export const getAllShifts = async (year: number, month: number) => {
    const [snapshot, archived] = await Promise.all([getDocs(collection(db, "shifts")), safeArchivedForMonth(year, month)]);
    const shifts: Shift[] = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (!shiftDocumentInCalendarMonth(data.date, docSnap.id, String(data.userId ?? ""), year, month)) return;
        shifts.push(shiftFromFirestoreDoc(docSnap.id, data));
    });
    return mergeLiveAndArchivedShifts(shifts, archived);
};

/** 当月シフトをサーバーから取得（キャッシュを使わない。確定状態を正しく表示するために管理画面の初回表示で使用） */
export const getAllShiftsFromServer = async (year: number, month: number): Promise<Shift[]> => {
    const [snapshot, archived] = await Promise.all([
        getDocsFromServer(collection(db, "shifts")),
        safeArchivedForMonth(year, month),
    ]);
    const shifts: Shift[] = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (!shiftDocumentInCalendarMonth(data.date, docSnap.id, String(data.userId ?? ""), year, month)) return;
        shifts.push(shiftFromFirestoreDoc(docSnap.id, data));
    });
    return mergeLiveAndArchivedShifts(shifts, archived);
};

/** callback の第2引数: fromCache が true のときはキャッシュ由来（管理画面ではサーバー反映後に上書きしないために参照する） */
export const subscribeAllShifts = (
    year: number,
    month: number,
    callback: (shifts: Shift[], meta?: { fromCache: boolean }) => void
) => {
    const archivedPromise = safeArchivedForMonth(year, month);
    const col = collection(db, "shifts");

    return onSnapshot(col, async (snapshot) => {
        const live: Shift[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            if (!shiftDocumentInCalendarMonth(data.date, docSnap.id, String(data.userId ?? ""), year, month)) return;
            live.push(shiftFromFirestoreDoc(docSnap.id, data));
        });
        if (snapshot.metadata.fromCache && snapshot.empty) return;
        const archived = await archivedPromise;
        callback(mergeLiveAndArchivedShifts(live, archived), { fromCache: snapshot.metadata.fromCache });
    }, (error) => {
        console.warn("Shift subscription error:", error);
    });
};

export const deleteShift = async (userId: string, date: string) => {
    const docId = `${userId}_${date}`;
    const shiftRef = doc(db, "shifts", docId);
    try {
        await deleteDoc(shiftRef);
    } catch (error) {
        console.error("Error deleting shift:", error);
        throw error;
    }
};

/** 指定ユーザーの全シフトを削除（ユーザー削除時に呼ぶ。在籍していない＝シフトも不要） */
export const deleteShiftsByUserId = async (userId: string): Promise<number> => {
    const q = query(collection(db, "shifts"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return 0;
    const BATCH_SIZE = 500;
    let deleted = 0;
    for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);
        chunk.forEach((d) => {
            batch.delete(d.ref);
            deleted++;
        });
        await batch.commit();
    }
    return deleted;
};

/** 確定範囲: 全月 / 1～15日分 / 16日～月末 */
export type ConfirmBlock = "all" | "first" | "second";

function isShiftInBlock(dateStr: string, block: ConfirmBlock): boolean {
    const day = parseInt(dateStr.split("-")[2]!, 10);
    if (block === "first") return day <= 15;
    if (block === "second") return day >= 16;
    return true;
}

export const confirmShifts = async (year: number, month: number, block: ConfirmBlock = "all") => {
    // 1. Get all shifts for the month（提出済み・下書きをすべて確定扱いに）
    const shifts = await getAllShifts(year, month);
    const filtered = block === "all" ? shifts : shifts.filter((s) => isShiftInBlock(s.date, block));
    const toConfirm = filtered.filter((s) => s.status !== "confirmed");
    const affectedUserIds = new Set<string>(toConfirm.map((s) => s.userId));

    // 2. 確定時に時給スナップショットを保存（出社/在宅で時給が違う場合は勤務形態に応じてセット）
    const uidToProfile = new Map<string, Awaited<ReturnType<typeof getUserProfile>>>();
    for (const uid of affectedUserIds) {
        uidToProfile.set(uid, await getUserProfile(uid));
    }

    const promises = toConfirm.map((shift) => {
        const docId = `${shift.userId}_${shift.date}`;
        const shiftRef = doc(db, "shifts", docId);
        const profile = uidToProfile.get(shift.userId) ?? null;
        const wage = getWageForWorkType(profile, getShiftWorkType(shift));
        return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage, wasUnconfirmed: false }, { merge: true });
    });

    await Promise.all(promises);
    return Array.from(affectedUserIds);
};

/** 指定ユーザーのその月のシフトのみ確定する（個別確定通知用） */
export const confirmShiftsForUser = async (userId: string, year: number, month: number, block: ConfirmBlock = "all"): Promise<boolean> => {
    const shifts = await getAllShifts(year, month);
    const userShifts = shifts.filter((s) => s.userId === userId);
    const filtered = block === "all" ? userShifts : userShifts.filter((s) => isShiftInBlock(s.date, block));
    if (filtered.length === 0) return false;

    const profile = await getUserProfile(userId);

    const toUpdate = filtered.filter((s) => s.status !== "confirmed");
    await Promise.all(
        toUpdate.map((shift) => {
            const docId = `${shift.userId}_${shift.date}`;
            const shiftRef = doc(db, "shifts", docId);
            const wage = getWageForWorkType(profile, getShiftWorkType(shift));
            return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage, wasUnconfirmed: false }, { merge: true });
        })
    );
    // 確定通知を送ったので editedAfterConfirmed をクリア（再通知不要に）
    await Promise.all(
        filtered.map((shift) => {
            const docId = `${shift.userId}_${shift.date}`;
            const shiftRef = doc(db, "shifts", docId);
            return setDoc(shiftRef, { editedAfterConfirmed: false }, { merge: true });
        })
    );
    return true;
};

/** 指定ユーザーのその月の確定済みシフトを取り消す（submitted に戻す）。バイト側で再編集可能になる。確定済みが1件もなければ false */
export const unconfirmShiftsForUser = async (
  userId: string,
  year: number,
  month: number,
  block: ConfirmBlock = "all"
): Promise<boolean> => {
  const shifts = await getAllShifts(year, month);
  const userShifts = shifts.filter((s) => s.userId === userId && s.status === "confirmed");
  const filtered = block === "all" ? userShifts : userShifts.filter((s) => isShiftInBlock(s.date, block));
  if (filtered.length === 0) return false;

  await Promise.all(
    filtered.map((shift) => {
      const docId = `${shift.userId}_${shift.date}`;
      const shiftRef = doc(db, "shifts", docId);
      return updateDoc(shiftRef, { status: "submitted", editedAfterConfirmed: false, wasUnconfirmed: true });
    })
  );
  return true;
};

/** 指定ユーザーのその月の提出済みシフトを却下する（draft に戻す）。提出済みが1件もなければ false */
export const rejectShiftsForUser = async (userId: string, year: number, month: number): Promise<boolean> => {
    const shifts = await getAllShifts(year, month);
    const userShifts = shifts.filter((s) => s.userId === userId && s.status === "submitted");
    if (userShifts.length === 0) return false;

    const batch = writeBatch(db);
    for (const shift of userShifts) {
        const docId = `${shift.userId}_${shift.date}`;
        const shiftRef = doc(db, "shifts", docId);
        batch.update(shiftRef, { status: "draft" });
    }
    await batch.commit();
    return true;
};

function calcHoursForShift(s: Shift): number {
    if (getShiftWorkType(s) === "absence") return 0;
    if (s.startTime === "00:00" && s.endTime === "00:00") return 0;
    const [sH, sM] = s.startTime.split(":").map(Number);
    const [eH, eM] = s.endTime.split(":").map(Number);
    let h = eH + eM / 60 - (sH + sM / 60);
    if (h > 6) h -= 1;
    return h > 0 ? h : 0;
}

export interface MonthlyWorkSummaryRow {
    userId: string;
    name: string;
    totalHours: number;
    hourlyWage: number;
    salary: number;
}

/** 確定シフトベースの月別・アルバイト別 勤務時間と給与（シフトごとの時給スナップショットで計算） */
export const getMonthlyWorkSummary = async (year: number, month: number): Promise<MonthlyWorkSummaryRow[]> => {
    const [shifts, staffList] = await Promise.all([getAllShifts(year, month), getAllStaff()]);
    const nameByStaffId = new Map(staffList.map((s) => [s.id, s.name] as const));
    const confirmed = shifts.filter((s) => s.status === "confirmed");
    const uids = [...new Set(confirmed.map((s) => s.userId))];

    const rows: MonthlyWorkSummaryRow[] = [];
    for (const uid of uids) {
        const profile = await getUserProfile(uid);
        const fallbackWage = profile?.hourlyWage ?? DEFAULT_HOURLY_WAGE;
        const userShifts = confirmed.filter((s) => s.userId === uid);

        let totalHours = 0;
        let salaryExact = 0;
        for (const s of userShifts) {
            const hours = calcHoursForShift(s);
            const wage = s.hourlyWage ?? getWageForWorkType(profile, getShiftWorkType(s));
            totalHours += hours;
            salaryExact += hours * wage;
        }

        totalHours = Math.round(totalHours * 10) / 10;
        const salary = Math.floor(salaryExact);
        const displayWage = totalHours > 0 ? Math.round(salary / totalHours) : fallbackWage;

        const fromList = nameByStaffId.get(uid);
        const profName = profile?.name?.trim();
        const fromArchiveKey = displayNameFromArchiveUserKey(uid)?.trim();
        rows.push({
            userId: uid,
            name: fromList || profName || fromArchiveKey || uid,
            totalHours,
            hourlyWage: displayWage,
            salary,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
};

/** 対象月に submitted/confirmed のシフトが1件もないアルバイトを返す（管理表・名前紐づけと同じ基準） */
export const getUnsubmittedStaff = async (
    year: number,
    month: number
): Promise<StaffItem[]> => {
    const [staffList, shifts] = await Promise.all([
        getAllStaff(),
        getAllShifts(year, month),
    ]);
    const staffIdSet = new Set(staffList.map((s) => s.id));

    const orphanUids = [...new Set(shifts.map((s) => s.userId).filter((uid) => !staffIdSet.has(uid)))];
    let orphanUidToArchivedName: Record<string, string> = {};
    if (orphanUids.length > 0) {
        orphanUidToArchivedName = await getArchivedUserNamesForIds(orphanUids);
    }
    shifts.forEach((s) => {
        if (staffIdSet.has(s.userId)) return;
        const an = typeof s.archivedUserName === "string" ? s.archivedUserName.trim() : "";
        if (an) orphanUidToArchivedName[s.userId] = orphanUidToArchivedName[s.userId] || an;
    });

    const staffIdToName = Object.fromEntries(staffList.map((x) => [x.id, x.name] as const));

    return staffList.filter((staff) => {
        const has = shifts.some(
            (s) =>
                (s.status === "submitted" || s.status === "confirmed") &&
                shiftModelInCalendarMonth(s, year, month) &&
                shiftBelongsToStaffRow(s, staff.id, staff.name, staffIdSet, orphanUidToArchivedName, staffIdToName, staffList)
        );
        return !has;
    });
};
