import { db } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, addDoc, query, orderBy, limit, Timestamp, writeBatch } from "firebase/firestore";

export interface WageChangeLogEntry {
  id: string;
  previousWage: number;
  newWage: number;
  changedAt: Date;
  changedByUid: string;
  changedByName: string;
}

/** 時給変更をログに記録（管理者が時給を変更したときに呼ぶ） */
export const recordWageChange = async (
  userId: string,
  previousWage: number,
  newWage: number,
  changedByUid: string,
  changedByName: string
): Promise<void> => {
  const col = collection(db, "users", userId, "wageHistory");
  await addDoc(col, {
    previousWage,
    newWage,
    changedAt: Timestamp.now(),
    changedByUid,
    changedByName,
  });
};

/** 指定ユーザーの時給変更履歴を全削除（ユーザー削除時に呼ぶ） */
export const deleteWageHistoryByUserId = async (userId: string): Promise<number> => {
  const col = collection(db, "users", userId, "wageHistory");
  const snap = await getDocs(col);
  if (snap.empty) return 0;
  const BATCH_SIZE = 500;
  let deleted = 0;
  const docs = snap.docs;
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

/** 指定ユーザーの時給変更ログを取得（新しい順、最大50件） */
export const getWageChangeLog = async (userId: string): Promise<WageChangeLogEntry[]> => {
  const col = collection(db, "users", userId, "wageHistory");
  const q = query(col, orderBy("changedAt", "desc"), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    const ts = data.changedAt;
    return {
      id: d.id,
      previousWage: data.previousWage ?? 0,
      newWage: data.newWage ?? 0,
      changedAt: ts?.toDate?.() ?? new Date(),
      changedByUid: data.changedByUid ?? "",
      changedByName: data.changedByName ?? "",
    };
  });
};
