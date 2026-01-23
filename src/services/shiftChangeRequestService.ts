import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { saveShift } from "@/services/shiftService";

export interface ShiftChangeRequest {
  id?: string;
  userId: string;
  date: string; // YYYY-MM-DD
  requestedStartTime: string;
  requestedEndTime: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  processedBy?: string;
  processedAt?: unknown;
  createdAt?: unknown;
}

export const createShiftChangeRequest = async (
  userId: string,
  date: string,
  requestedStartTime: string,
  requestedEndTime: string,
  reason: string
): Promise<string> => {
  const mine = await getMyShiftChangeRequests(userId);
  if (mine.some((r) => r.date === date && r.status === "pending")) {
    throw new Error("この日付にはすでに変更申請が出ています。");
  }

  const ref = await addDoc(collection(db, "shiftChangeRequests"), {
    userId,
    date,
    requestedStartTime,
    requestedEndTime,
    reason,
    status: "pending",
    shiftDocId: `${userId}_${date}`,
    createdAt: Timestamp.now(),
  });
  return ref.id;
};

export const getPendingShiftChangeRequests = async (): Promise<ShiftChangeRequest[]> => {
  const q = query(
    collection(db, "shiftChangeRequests"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ShiftChangeRequest));
};

export const getMyShiftChangeRequests = async (userId: string): Promise<ShiftChangeRequest[]> => {
  const q = query(
    collection(db, "shiftChangeRequests"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ShiftChangeRequest));
};

export const approveShiftChangeRequest = async (
  requestId: string,
  processedBy: string
): Promise<void> => {
  const ref = doc(db, "shiftChangeRequests", requestId);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (!snap.exists() || !data || data.status !== "pending") {
    throw new Error("申請が見つからないか、すでに処理済みです。");
  }

  await saveShift(
    {
      userId: data.userId,
      date: data.date,
      startTime: data.requestedStartTime,
      endTime: data.requestedEndTime,
      status: "confirmed",
    },
    { byAdmin: true }
  );

  await updateDoc(ref, {
    status: "approved",
    processedBy,
    processedAt: Timestamp.now(),
  });
};

export const rejectShiftChangeRequest = async (
  requestId: string,
  processedBy: string
): Promise<void> => {
  const ref = doc(db, "shiftChangeRequests", requestId);
  await updateDoc(ref, {
    status: "rejected",
    processedBy,
    processedAt: Timestamp.now(),
  });
};
