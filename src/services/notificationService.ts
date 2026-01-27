import { db, auth } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, addDoc, updateDoc, doc, query, where, orderBy, limit, Timestamp, onSnapshot } from "firebase/firestore";

export interface Notification {
    id?: string;
    userId: string;
    type: 'shift_confirmed' | 'remind_submit' | 'message';
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
        const code = (error as { code?: string })?.code ?? (error as { errorInfo?: { code?: string } })?.errorInfo?.code ?? "";
        const message = String((error as { message?: string })?.message ?? (error as { errorInfo?: { message?: string } })?.errorInfo?.message ?? error);

        // permission-denied の場合は空で返し、コンソールに FirebaseError を出さない
        if (
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            (typeof message === "string" && message.toLowerCase().includes("insufficient permissions"))
        ) {
            callback([]);
            return;
        }

        console.error("[notificationService] subscribeNotifications: error", { code, message, userId });

        if (code === "failed-precondition" || message?.includes("index")) {
            console.error("[notificationService] ⚠️ Firestore index required: notifications (userId, createdAt)");
        }
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
