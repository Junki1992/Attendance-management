
import { db } from "@/lib/firebase/firebase";
import { collection, addDoc, query, where, orderBy, getDocs, onSnapshot, Timestamp } from "firebase/firestore";

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

export const subscribeMessages = (
    userId1: string, 
    userId2: string, 
    callback: (messages: ChatMessage[]) => void
) => {
    // Queries messages where (sender=u1 AND receiver=u2) OR (sender=u2 AND receiver=u1)
    // Firestore doesn't support logical OR in simple queries efficiently for this mixed structure without advanced indices or client-side merge.
    // simpler approach: Subscribe to ALL messages where (sender == userId1) OR (receiver == userId1) 
    // and then filter for the specific partner client-side.
    // OR: maintain a "chatRoomId" which is `min(u1, u2)_max(u1, u2)`
    
    // Using simple approach: query all involved with current user (for staff view that's mostly fine).
    // Actually, for direct chat, room ID strategy is best.
    const roomId = [userId1, userId2].sort().join("_");
    
    // However, that requires adding roomId to every message. Let's do that in sendMessage?
    // Changing strategy: Query logic client side for simplicity given low volume?
    // No, let's use the 'OR' query or just two listeners?
    // Firestore 'in' query works for one field.
    
    // Let's execute TWO queries? No, `onSnapshot` might be complicated.
    
    // Easier strategy for this scale:
    // Just save `roomId` or `participants` array. 
    // Let's modify sendMessage to include `roomId`.
    // But `sendMessage` above doesn't have it. I'll update `sendMessage` to include logic or `roomId`.
    
    // Wait, simple approach without changing schema too much:
    // Query: collection "messages", where "participants" array-contains "userId1"
    // Then filter by "userId2" in JS.
    
    // Let's just assume we pass `roomId` explicitly or derive it.
    // Let's use derived `roomId` = sort(u1, u2).join('_').
    // I will update sendMessage to include this field.
    
    return onSnapshot(
        query(
            collection(db, "messages"),
            where("roomId", "==", [userId1, userId2].sort().join("_")),
            orderBy("createdAt", "asc")
        ),
        (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
            callback(messages);
        },
        (error) => {
            console.error("Chat subscription error:", error);
        }
    );
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
    } catch (error) {
        console.error("Error sending message:", error);
        throw error;
    }
};

// For Admin: Get list of users who have chatted? 
// That might be complex. For now Admin can just see list of all staff (STAFF_LIST from page.tsx) and click one to chat.
