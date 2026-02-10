import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, deleteDoc, query, where, Timestamp, onSnapshot, writeBatch } from "firebase/firestore";
import { getAllStaff, StaffItem, getUserProfile } from "@/services/userService";
import { isPastSubmitDeadlineForDate } from "@/services/settingsService";

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
    /** 在宅勤務の場合 true */
    isRemote?: boolean;
}

export type SaveShiftOptions = { byAdmin?: boolean };

export const saveShift = async (shift: Shift, options?: SaveShiftOptions): Promise<string> => {
    const docId = `${shift.userId}_${shift.date}`;
    const shiftRef = doc(db, "shifts", docId);

    let editedAfterDeadline: boolean | undefined;
    let hourlyWage = shift.hourlyWage;
    if (options?.byAdmin && shift.status === "confirmed" && hourlyWage == null) {
        const existing = await getDoc(shiftRef);
        const existingWage = existing.exists() ? (existing.data()?.hourlyWage as number | undefined) : undefined;
        if (existingWage != null) {
            hourlyWage = existingWage;
        } else {
            const profile = await getUserProfile(shift.userId);
            hourlyWage = profile?.hourlyWage ?? 1000;
        }
    }
    if (options?.byAdmin) {
        editedAfterDeadline = isPastSubmitDeadlineForDate(shift.date);
    }

    const { hourlyWage: _skip, ...shiftRest } = shift;
    const data = {
        ...shiftRest,
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

export const confirmShifts = async (year: number, month: number) => {
    // 1. Get all shifts for the month（提出済み・下書きをすべて確定扱いに）
    const shifts = await getAllShifts(year, month);
    const toConfirm = shifts.filter((s) => s.status !== "confirmed");
    const affectedUserIds = new Set<string>(toConfirm.map((s) => s.userId));

    // 2. 確定時に時給スナップショットを保存（月途中の時給変更に備える）
    const uidToWage = new Map<string, number>();
    for (const uid of affectedUserIds) {
        const profile = await getUserProfile(uid);
        uidToWage.set(uid, profile?.hourlyWage ?? 1000);
    }

    const promises = toConfirm.map((shift) => {
        const docId = `${shift.userId}_${shift.date}`;
        const shiftRef = doc(db, "shifts", docId);
        const wage = uidToWage.get(shift.userId) ?? 1000;
        return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage }, { merge: true });
    });

    await Promise.all(promises);
    return Array.from(affectedUserIds);
};

/** 指定ユーザーのその月のシフトのみ確定する（個別確定通知用） */
export const confirmShiftsForUser = async (userId: string, year: number, month: number): Promise<boolean> => {
    const shifts = await getAllShifts(year, month);
    const userShifts = shifts.filter((s) => s.userId === userId);
    if (userShifts.length === 0) return false;

    const profile = await getUserProfile(userId);
    const wage = profile?.hourlyWage ?? 1000;

    const toUpdate = userShifts.filter((s) => s.status !== "confirmed");
    await Promise.all(
        toUpdate.map((shift) => {
            const docId = `${shift.userId}_${shift.date}`;
            const shiftRef = doc(db, "shifts", docId);
            return setDoc(shiftRef, { status: "confirmed", hourlyWage: wage }, { merge: true });
        })
    );
    // 確定通知を送ったので editedAfterConfirmed をクリア（再通知不要に）
    await Promise.all(
        userShifts.map((shift) => {
            const docId = `${shift.userId}_${shift.date}`;
            const shiftRef = doc(db, "shifts", docId);
            return setDoc(shiftRef, { editedAfterConfirmed: false }, { merge: true });
        })
    );
    return true;
};

function calcHoursForShift(s: Shift): number {
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
        const fallbackWage = profile?.hourlyWage ?? 1000;
        const userShifts = confirmed.filter((s) => s.userId === uid);

        let totalHours = 0;
        let salaryExact = 0;
        for (const s of userShifts) {
            const hours = calcHoursForShift(s);
            const wage = s.hourlyWage ?? fallbackWage;
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

/** 対象月に1件も submitted/confirmed のシフトがないアルバイトを返す */
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
