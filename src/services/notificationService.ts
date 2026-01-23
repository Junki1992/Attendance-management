import { db } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, addDoc, updateDoc, doc, query, where, orderBy, limit, Timestamp, onSnapshot } from "firebase/firestore";

export interface Notification {
    id?: string;
    userId: string;
    type: 'shift_confirmed' | 'remind_submit';
    message: string;
    read: boolean;
    createdAt: any; // Timestamp
}

export const createNotification = async (userId: string, type: Notification['type'], message: string) => {
    try {
        await addDoc(collection(db, "notifications"), {
            userId,
            type,
            message,
            read: false,
            createdAt: Timestamp.now(),
        });
    } catch (error) {
        console.error("Error creating notification:", error);
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
        callback(notifications);
    }, (error) => {
        console.warn("Notification subscription error:", error);
    });
};

export const markAsRead = async (notificationId: string) => {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, {
        read: true
    });
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
