import { db, auth } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, addDoc, updateDoc, doc, query, where, orderBy, limit, Timestamp, onSnapshot, writeBatch } from "firebase/firestore";

export interface Notification {
    id?: string;
    userId: string;
    type: 'shift_confirmed' | 'remind_submit' | 'message' | 'shift_change_request' | 'shift_change_approved' | 'shift_change_rejected' | 'hourly_wage_changed' | 'shift_submitted' | 'deadline_changed' | 'chatwork_id_required';
    message: string;
    read: boolean;
    createdAt: any; // Timestamp
    // メッセージ通知の場合に使用
    senderId?: string;
    senderName?: string;
    roomId?: string; // チャットルームID（メッセージ通知の場合）
}

export const createNotification = async (
    userId: string, 
    type: Notification['type'], 
    message: string,
    senderId?: string,
    senderName?: string,
    roomId?: string
) => {
    try {
        const data: any = {
            userId,
            type,
            message,
            read: false,
            createdAt: Timestamp.now(),
        };
        
        // メッセージ通知の場合、追加情報を保存
        if (type === "message") {
            if (senderId) data.senderId = senderId;
            if (senderName) data.senderName = senderName;
            if (roomId) data.roomId = roomId;
        }
        
        const docRef = await addDoc(collection(db, "notifications"), data);
        if (process.env.NODE_ENV === "development") {
            console.log("[notificationService] createNotification: success", { 
                id: docRef.id, 
                userId, 
                type, 
                message,
                senderId,
                roomId
            });
        }
        return docRef.id;
    } catch (error) {
        const code = (error as { code?: string })?.code ?? "";
        const message = (error as { message?: string })?.message ?? "";
        console.error("[notificationService] createNotification: failed", { 
            code, 
            message, 
            userId, 
            type 
        });
        throw error;
    }
};

/** Googleログイン等で Chatwork ID が未設定のスタッフに、1回だけ通知を作成する */
export const ensureChatworkIdReminderNotification = async (userId: string): Promise<void> => {
    try {
        const q = query(
            collection(db, "notifications"),
            where("userId", "==", userId),
            where("type", "==", "chatwork_id_required"),
            limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) return;
        await createNotification(
            userId,
            "chatwork_id_required",
            "Chatwork アカウントIDが未設定です。通知でメンションを受け取るには「設定」→「名前・Chatwork」でIDを登録してください。"
        );
    } catch (e) {
        console.warn("[notificationService] ensureChatworkIdReminderNotification failed", e);
    }
};

export const getUserNotifications = async (userId: string) => {
    // ... same as before
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc")
    );

    const querySnapshot = await getDocs(q);
    const notifications: Notification[] = [];
    querySnapshot.forEach((doc) => {
        notifications.push({ id: doc.id, ...doc.data() } as Notification);
    });
    return notifications;
};

export const subscribeNotifications = (userId: string, callback: (notifications: Notification[]) => void) => {
    // loginMock や未ログイン時は request.auth が null のため Firestore が permission-denied になる。
    if (!auth.currentUser) {
        callback([]);
        return () => {};
    }

    const q = query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc")
    );

    const normalizeError = (error: unknown): { code: string; message: string; raw: unknown } => {
        const anyErr = error as any;
        let code =
            (typeof anyErr?.code === "string" ? anyErr.code : "") ||
            (typeof anyErr?.errorInfo?.code === "string" ? anyErr.errorInfo.code : "") ||
            (typeof anyErr?.name === "string" && anyErr.name.toLowerCase().includes("permission") ? "permission-denied" : "");
        let message =
            (typeof anyErr?.message === "string" ? anyErr.message : "") ||
            (typeof anyErr?.errorInfo?.message === "string" ? anyErr.errorInfo.message : "");
        
        // message が空ならフォールバック
        if (!message) {
            try {
                message = JSON.stringify(error);
            } catch {
                message = String(error);
            }
        }
        
        // code が空なら message から推測
        if (!code && typeof message === "string") {
            if (message.toLowerCase().includes("permission")) code = "permission-denied";
            else if (message.toLowerCase().includes("index")) code = "failed-precondition";
        }
        
        return { code, message, raw: error };
    };

    return onSnapshot(q, (snapshot) => {
        const notifications: Notification[] = [];
        snapshot.forEach((doc) => {
            notifications.push({ id: doc.id, ...doc.data() } as Notification);
        });
        if (process.env.NODE_ENV === "development") {
            console.log("[notificationService] subscribeNotifications: update", { 
                userId, 
                count: notifications.length 
            });
        }
        callback(notifications);
    }, (error) => {
        const { code, message, raw } = normalizeError(error);

        // permission-denied の場合は空で返し、コンソールに FirebaseError を出さない
        if (
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            (typeof message === "string" && message.toLowerCase().includes("insufficient permissions"))
        ) {
            callback([]);
            return;
        }

        // 典型的な「インデックス不足」は noisy なので warn にする（本質的な原因特定の邪魔になる）
        if (code === "failed-precondition" || (typeof message === "string" && message.toLowerCase().includes("index"))) {
            console.warn("[notificationService] subscribeNotifications: index required", { userId, code, message });
            console.warn("[notificationService] ⚠️ Firestore index required: notifications (userId, createdAt)");
            return;
        }

        // raw の全プロパティを展開してログに出す（原因特定のため）
        const rawProps = raw && typeof raw === "object" ? Object.keys(raw).reduce((acc, k) => {
            acc[k] = (raw as Record<string, unknown>)[k];
            return acc;
        }, {} as Record<string, unknown>) : raw;
        console.error("[notificationService] subscribeNotifications: error", { userId, code, message, raw: rawProps });
    });
};

export const markAsRead = async (notificationId: string) => {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, {
        read: true
    });
};

/** 特定のチャットルームのメッセージ通知を既読にする */
export const markMessageNotificationsAsRead = async (userId: string, roomId: string) => {
    if (!auth.currentUser) return;
    try {
        const q = query(
            collection(db, "notifications"),
            where("userId", "==", userId),
            where("type", "==", "message"),
            where("roomId", "==", roomId),
            where("read", "==", false)
        );
        const snap = await getDocs(q);
        const promises = snap.docs.map((d) => markAsRead(d.id));
        await Promise.all(promises);
        if (process.env.NODE_ENV === "development") {
            console.log("[notificationService] markMessageNotificationsAsRead: marked", { 
                userId, 
                roomId, 
                count: snap.docs.length 
            });
        }
    } catch (error) {
        const code = (error as { code?: string })?.code ?? "";
        const msg = String((error as { message?: string })?.message ?? error);
        if (
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            msg.toLowerCase().includes("insufficient permissions")
        ) {
            return;
        }
        console.error("[notificationService] markMessageNotificationsAsRead: error", error);
    }
};

/** 指定ユーザーの全通知を削除（ユーザー削除時に呼ぶ） */
export const deleteNotificationsByUserId = async (userId: string): Promise<number> => {
    const q = query(collection(db, "notifications"), where("userId", "==", userId));
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

/** 管理者用: シフト確定通知の一覧（既読状況の確認）。Firestore に (type, createdAt) の複合インデックスが必要 */
export const getShiftConfirmedNotifications = async (limitCount = 50): Promise<Notification[]> => {
    const q = query(
        collection(db, "notifications"),
        where("type", "==", "shift_confirmed"),
        orderBy("createdAt", "desc"),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
};
