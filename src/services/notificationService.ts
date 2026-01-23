
import { db } from "@/lib/firebase/firebase";
import { collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy, Timestamp } from "firebase/firestore";

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

export const markAsRead = async (notificationId: string) => {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, {
        read: true
    });
};
