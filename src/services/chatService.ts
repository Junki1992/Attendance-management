
import { db, auth } from "@/lib/firebase/firebase";
import { collection, addDoc, query, where, orderBy, getDocs, onSnapshot, Timestamp } from "firebase/firestore";
import { createNotification } from "@/services/notificationService";

export interface ChatMessage {
    id?: string;
    text: string;
    senderId: string;
    senderName?: string;
    receiverId: string;
    read: boolean;
    createdAt: any; // Timestamp
}

export const sendMessage = async (text: string, senderId: string, receiverId: string, senderName?: string) => {
    try {
        await addDoc(collection(db, "messages"), {
            text,
            senderId,
            receiverId,
            senderName: senderName || "Unknown",
            read: false,
            createdAt: Timestamp.now(),
        });
    } catch (error) {
        console.error("Error sending message:", error);
        throw error;
    }
};

/** createdAt のミリ秒または秒を返す（ソート用） */
function toMillis(obj: ChatMessage["createdAt"]): number {
    if (!obj) return 0;
    if (typeof (obj as { toMillis?: () => number }).toMillis === "function") {
        return (obj as { toMillis: () => number }).toMillis();
    }
    const s = (obj as { seconds?: number })?.seconds;
    return typeof s === "number" ? s * 1000 : 0;
}

export const subscribeMessages = (
    currentUserId: string,
    partnerId: string,
    callback: (messages: ChatMessage[]) => void
) => {
    // loginMock や未ログイン時は request.auth が null のため Firestore が permission-denied になる。
    // Firebase Auth が有効でないときは購読せず空で返す（コンソールエラーを出さない）。
    if (!auth.currentUser) {
        callback([]);
        return () => {};
    }

    let part1: ChatMessage[] = [];
    let part2: ChatMessage[] = [];

    const notify = () => {
        const combined = [...part1, ...part2].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        callback(combined);
    };

    const onError = (error: unknown) => {
        const code = (error as { code?: string })?.code ?? "";
        const message = String((error as { message?: string })?.message ?? error);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            message.toLowerCase().includes("insufficient permissions");
        if (isPermissionDenied) {
            callback([]);
            return;
        }
        console.error("Chat subscription error:", { code, message, currentUserId, partnerId });
    };

    const q1 = query(
        collection(db, "messages"),
        where("senderId", "==", currentUserId),
        where("receiverId", "==", partnerId),
        orderBy("createdAt", "asc")
    );
    const q2 = query(
        collection(db, "messages"),
        where("receiverId", "==", currentUserId),
        where("senderId", "==", partnerId),
        orderBy("createdAt", "asc")
    );

    const unsub1 = onSnapshot(q1, (snap) => {
        part1 = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, onError);

    const unsub2 = onSnapshot(q2, (snap) => {
        part2 = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, onError);

    return () => {
        unsub1();
        unsub2();
    };
};

export const sendMessageWithRoom = async (text: string, senderId: string, receiverId: string, senderName?: string) => {
     try {
        const roomId = [senderId, receiverId].sort().join("_");
        await addDoc(collection(db, "messages"), {
            text,
            senderId,
            receiverId,
            senderName: senderName || "Unknown",
            read: false,
            roomId,
            createdAt: Timestamp.now(),
        });
        
        // メッセージ通知を作成（受信者に通知）
        try {
            await createNotification(
                receiverId,
                "message",
                `${senderName || "Unknown"}さんからメッセージが届きました`,
                senderId,
                senderName,
                roomId
            );
        } catch (notifError) {
            // 通知作成失敗はログに記録するが、メッセージ送信は成功とする
            console.error("[chatService] Failed to create notification:", notifError);
        }
    } catch (error) {
        console.error("Error sending message:", error);
        throw error;
    }
};

// For Admin: Get list of users who have chatted? 
// That might be complex. For now Admin can just see list of all staff (STAFF_LIST from page.tsx) and click one to chat.
