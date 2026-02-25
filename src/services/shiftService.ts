import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, deleteDoc, query, where, Timestamp, onSnapshot, writeBatch } from "firebase/firestore";
import { getAllStaff, StaffItem, getUserProfile } from "@/services/userService";
import { DEFAULT_HOURLY_WAGE } from "@/lib/app-config";
import { isPastSubmitDeadlineForDateAsync } from "@/services/settingsService";

/** 勤務形態（出社・在宅・当欠）。給与計算で参照する想定 */
export type ShiftWorkType = "office" | "remote" | "absence";

export interface Shift {
    id?: string;
    userId: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    status: 'draft' | 'submitted' | 'confirmed';
    hourlyWage?: number; // Optional snapshot of wage at time of shift
    /** 締切後に管理者が編集した場合 true */
    editedAfterDeadline?: boolean;
    /** 確定済みのシフトを管理者が編集した場合 true（再通知が必要） */
    editedAfterConfirmed?: boolean;
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

    const { hourlyWage: _skip, ...shiftRest } = shift;
    const workType = shift.workType ?? (shift.isRemote ? "remote" : "office");
    const data = {
        ...shiftRest,
        workType,
        isRemote: workType === "remote",
        ...(hourlyWage != null && { hourlyWage }),
        updatedAt: Timestamp.now(),
        ...(editedAfterDeadline !== undefined && { editedAfterDeadline }),
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
    // Month is 0-indexed in JS Date, but let's store standard YYYY-MM-DD strings.
    // Querying by string prefix is possible or just filtering client side if data is small.
    // For scalability, where('date', '>=', start) and where('date', '<=', end) is best.

    // Construct range
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    // End date logic: get last day of month
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

    const q = query(
        collection(db, "shifts"),
        where("userId", "==", userId),
        where("date", ">=", startStr),
        where("date", "<=", endStr)
    );

    const querySnapshot = await getDocs(q);
    const shifts: Shift[] = [];
    querySnapshot.forEach((doc) => {
        shifts.push({ id: doc.id, ...doc.data() } as Shift);
    });
    return shifts;
};

export const getAllShifts = async (year: number, month: number) => {
    // ... existing implementation
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

    const q = query(
        collection(db, "shifts"),
        where("date", ">=", startStr),
        where("date", "<=", endStr)
    );

    const querySnapshot = await getDocs(q);
    const shifts: Shift[] = [];
    querySnapshot.forEach((doc) => {
        shifts.push({ id: doc.id, ...doc.data() } as Shift);
    });
    return shifts;
};

export const subscribeAllShifts = (
    year: number, 
    month: number, 
    callback: (shifts: Shift[]) => void
) => {
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

    const q = query(
        collection(db, "shifts"),
        where("date", ">=", startStr),
        where("date", "<=", endStr)
    );

    return onSnapshot(q, (snapshot) => {
        const shifts: Shift[] = [];
        snapshot.forEach((doc) => {
            shifts.push({ id: doc.id, ...doc.data() } as Shift);
        });
        callback(shifts);
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
        return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage }, { merge: true });
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
            return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage }, { merge: true });
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
    const shifts = await getAllShifts(year, month);
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

        rows.push({
            userId: uid,
            name: profile?.name ?? uid,
            totalHours,
            hourlyWage: displayWage,
            salary,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
};

/** 対象月に submitted/confirmed のシフトが1件もないアルバイトを返す（提出ボタンを押していない＝未提出者） */
export const getUnsubmittedStaff = async (
    year: number,
    month: number
): Promise<StaffItem[]> => {
    const [staffList, shifts] = await Promise.all([
        getAllStaff(),
        getAllShifts(year, month),
    ]);
    const submitted = new Set<string>();
    shifts.forEach((s) => {
        if (s.status === "submitted" || s.status === "confirmed") {
            submitted.add(s.userId);
        }
    });
    return staffList.filter((s) => !submitted.has(s.id));
};
