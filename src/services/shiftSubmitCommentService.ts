import { db } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, query, where, Timestamp } from "firebase/firestore";
import { getUserProfile } from "@/services/userService";

const COLLECTION = "shiftSubmitComments";

/** シフト提出時に保存するコメント（1ユーザー・1月につき1件、再提出で上書き） */
export async function saveShiftSubmitComment(
  userId: string,
  year: number,
  month: number,
  comment: string
): Promise<void> {
  const docId = `${userId}_${year}_${month}`;
  await setDoc(doc(db, COLLECTION, docId), {
    userId,
    year,
    month,
    comment: comment.trim(),
    submittedAt: Timestamp.now(),
  });
}

/** 指定年月の提出コメント一覧（管理者用）。名前を解決して返す */
export interface ShiftSubmitCommentItem {
  userId: string;
  name: string;
  comment: string;
  submittedAt: unknown;
}

export async function getShiftSubmitComments(
  year: number,
  month: number
): Promise<ShiftSubmitCommentItem[]> {
  const q = query(
    collection(db, COLLECTION),
    where("year", "==", year),
    where("month", "==", month)
  );
  const snap = await getDocs(q);
  const items: ShiftSubmitCommentItem[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const userId = data.userId as string;
    const profile = await getUserProfile(userId);
    items.push({
      userId,
      name: profile?.name ?? userId,
      comment: (data.comment as string) ?? "",
      submittedAt: data.submittedAt,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
