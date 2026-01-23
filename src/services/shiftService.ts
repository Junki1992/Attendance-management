
import { db } from "@/lib/firebase/firebase";
import { collection, doc, getDocs, setDoc, deleteDoc, query, where, Timestamp } from "firebase/firestore";

export interface Shift {
    id?: string;
    userId: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    status: 'draft' | 'submitted' | 'confirmed';
    hourlyWage?: number; // Optional snapshot of wage at time of shift
}

export const saveShift = async (shift: Shift) => {
    // ID strategy: userId_date to ensure one shift per day per user
    const docId = `${shift.userId}_${shift.date}`;
    const shiftRef = doc(db, "shifts", docId);

    const data = {
        ...shift,
        updatedAt: Timestamp.now(),
    };

    // If it's a new entry, add createdAt (effectively handling upsert logic partially, 
    // though strict create vs update separation requires reading first or using merge)
    // For simplicity, we just set merge: true to update fields or create if missing.
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

export const confirmShifts = async (year: number, month: number) => {
    // 1. Get all shifts for the month
    const shifts = await getAllShifts(year, month);
    const affectedUserIds = new Set<string>();

    // 2. Update each shift in parallel
    // (Ideally use WriteBatch for atomicity, but simple loops for now)
    const promises = shifts.map(async (shift) => {
        if (shift.status === 'confirmed') return; // Skip if already confirmed

        const docId = `${shift.userId}_${shift.date}`;
        const shiftRef = doc(db, "shifts", docId);

        affectedUserIds.add(shift.userId);
        return setDoc(shiftRef, { status: 'confirmed' }, { merge: true });
    });

    await Promise.all(promises);
    return Array.from(affectedUserIds);
};
