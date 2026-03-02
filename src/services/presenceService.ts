/**
 * オンライン状態（presence）の管理
 * スタッフがアプリを開いている間、lastActiveAt をハートビートで更新。
 * 管理者チャットのアルバイト一覧で「オンライン」表示に利用。
 */
import { db } from "@/lib/firebase/firebase";
import {
    doc,
    setDoc,
    onSnapshot,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";

/** オンラインとみなす閾値（秒）。lastActiveAt がこの秒数以内ならオンライン */
export const ONLINE_THRESHOLD_SEC = 90;

/** 自分の presence を更新（スタッフがログイン中に定期的に呼ぶ） */
export async function updatePresence(userId: string): Promise<void> {
    const ref = doc(db, "presence", userId);
    await setDoc(ref, { lastActiveAt: serverTimestamp() }, { merge: true });
}

/** 複数ユーザーの presence を購読。オンライン状態の Map を返す */
export function subscribePresence(
    userIds: string[],
    onUpdate: (onlineMap: Record<string, boolean>) => void
): () => void {
    if (userIds.length === 0) {
        onUpdate({});
        return () => {};
    }
    const unsubs: (() => void)[] = [];
    const onlineMap: Record<string, boolean> = {};
    const now = () => Date.now() / 1000;

    userIds.forEach((uid) => {
        const ref = doc(db, "presence", uid);
        const unsub = onSnapshot(
            ref,
            (snap) => {
                const data = snap.data();
                const lastActive = data?.lastActiveAt as Timestamp | undefined;
                const lastSec = lastActive?.toMillis
                    ? lastActive.toMillis() / 1000
                    : 0;
                onlineMap[uid] = now() - lastSec < ONLINE_THRESHOLD_SEC;
                onUpdate({ ...onlineMap });
            },
            () => {
                onlineMap[uid] = false;
                onUpdate({ ...onlineMap });
            }
        );
        unsubs.push(unsub);
    });

    return () => unsubs.forEach((u) => u());
}
