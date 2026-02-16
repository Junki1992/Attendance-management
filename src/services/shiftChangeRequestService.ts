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
  writeBatch,
} from "firebase/firestore";
import { saveShift, getWageForWorkType } from "@/services/shiftService";
import { getUserProfile } from "@/services/userService";
import { createNotification } from "@/services/notificationService";

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
  /** 在宅勤務希望の場合 true */
  isRemote?: boolean;
}

export const createShiftChangeRequest = async (
  userId: string,
  date: string,
  requestedStartTime: string,
  requestedEndTime: string,
  reason: string,
  isRemote?: boolean
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
    ...(isRemote !== undefined && { isRemote }),
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

/** 指定ユーザーの全シフト変更申請を削除（ユーザー削除時に呼ぶ） */
export const deleteShiftChangeRequestsByUserId = async (userId: string): Promise<number> => {
  const q = query(collection(db, "shiftChangeRequests"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return 0;
  const BATCH_SIZE = 500;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d) => {
      batch.delete(d.ref);
      deleted++;
    });
    await batch.commit();
  }
  return deleted;
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

  const profile = await getUserProfile(data.userId as string);
  const isRemote = !!data.isRemote;
  const wage = getWageForWorkType(profile, isRemote ? "remote" : "office");

  await saveShift(
    {
      userId: data.userId,
      date: data.date,
      startTime: data.requestedStartTime,
      endTime: data.requestedEndTime,
      status: "confirmed",
      hourlyWage: wage,
      ...(data.isRemote !== undefined && { isRemote: data.isRemote }),
    },
    { byAdmin: true }
  );

  await updateDoc(ref, {
    status: "approved",
    processedBy,
    processedAt: Timestamp.now(),
  });

  const [, m, d] = (data.date as string).split("-");
  const dateLabel = `${parseInt(m, 10)}月${d}日`;
  await createNotification(
    data.userId as string,
    "shift_change_approved",
    `${dateLabel}のシフト変更が承認されました。`
  );
};

export const rejectShiftChangeRequest = async (
  requestId: string,
  processedBy: string
): Promise<void> => {
  const ref = doc(db, "shiftChangeRequests", requestId);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (!snap.exists() || !data || data.status !== "pending") {
    throw new Error("申請が見つからないか、すでに処理済みです。");
  }

  await updateDoc(ref, {
    status: "rejected",
    processedBy,
    processedAt: Timestamp.now(),
  });

  const [, m, d] = (data.date as string).split("-");
  const dateLabel = `${parseInt(m, 10)}月${d}日`;
  await createNotification(
    data.userId as string,
    "shift_change_rejected",
    `${dateLabel}のシフト変更は却下されました。`
  );
};
