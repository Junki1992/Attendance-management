
import { db, auth } from "@/lib/firebase/firebase";
import { collection, addDoc, query, where, orderBy, getDocs, onSnapshot, Timestamp, doc, setDoc, serverTimestamp } from "firebase/firestore";

const MAX_IN_QUERY = 30; // Firestore "in" の上限
import { createNotification } from "@/services/notificationService";

// Simple global counter to help debug active realtime listeners
let activeListenerCount = 0;
export const getActiveListenerCount = () => activeListenerCount;

// --- Caches for realtime subscriptions to avoid creating duplicate listeners ---
const messagesListenerCache = new Map<string, {
    callbacks: Set<(msgs: ChatMessage[]) => void>,
    unsub?: () => void
}>();

const roomMetaListenerCache = new Map<string, {
    callbacks: Set<(meta: Record<string, any>) => void>,
    unsub?: () => void
}>();

// schedule/debounce lastRead writes: coalesce writes within this delay (ms)
const LAST_READ_DEBOUNCE_MS = 5000;
const lastReadTimers = new Map<string, NodeJS.Timeout>();
const lastReadPending = new Map<string, number>(); // roomId -> timestamp (ms)

export const scheduleRoomLastRead = (roomId: string, uid: string) => {
    if (!roomId || !uid) return;
    const key = `${roomId}:${uid}`;
    lastReadPending.set(key, Date.now());
    if (lastReadTimers.has(key)) {
        // timer already scheduled; do nothing (coalesce)
        return;
    }
    const t = setTimeout(async () => {
        try {
            await setRoomLastRead(roomId, uid);
        } catch (err) {
            console.error("[chatService] scheduleRoomLastRead failed:", err);
        } finally {
            lastReadTimers.delete(key);
            lastReadPending.delete(key);
        }
    }, LAST_READ_DEBOUNCE_MS);
    lastReadTimers.set(key, t);
};

export interface ChatMessage {
    id?: string;
    text: string;
    senderId: string;
    senderName?: string;
    receiverId: string;
    read: boolean;
    createdAt: any; // Timestamp
    // optional file metadata
    fileURL?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
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

/** Firestore onSnapshot の error から code/message を確実に取り出す（FirebaseError 以外の形でも） */
function normalizeSnapshotError(error: unknown): { code: string; message: string; raw: unknown } {
    const e = error as Record<string, unknown>;
    const code =
        (typeof e?.code === "string" ? e.code : "") ||
        (typeof (e?.errorInfo as { code?: string })?.code === "string" ? (e.errorInfo as { code: string }).code : "");
    let message =
        (typeof e?.message === "string" ? e.message : "") ||
        (typeof (e?.errorInfo as { message?: string })?.message === "string" ? (e.errorInfo as { message: string }).message : "");
    if (!message) {
        try {
            message = JSON.stringify(error);
        } catch {
            message = String(error);
        }
    }
    return { code, message, raw: error };
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

    const makeErrorHandler = (which: "q1" | "q2") => (error: unknown) => {
        const { code, message, raw } = normalizeSnapshotError(error);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            message.toLowerCase().includes("insufficient permissions");
        if (isPermissionDenied) {
            if (which === "q1") part1 = [];
            else part2 = [];
            notify();
            return;
        }
        if (code === "failed-precondition" || message.toLowerCase().includes("index")) {
            console.warn("[chatService] Chat subscription: index required", { which, currentUserId, partnerId, code, message });
            return;
        }
        console.error("[chatService] Chat subscription error:", { which, code, message, currentUserId, partnerId, raw });
    };
    const roomErrorHandler = (error: unknown) => {
        const { code, message, raw } = normalizeSnapshotError(error);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            message.toLowerCase().includes("insufficient permissions");
        if (isPermissionDenied) {
            part1 = [];
            part2 = [];
            notify();
            return;
        }
        if (code === "failed-precondition" || message.toLowerCase().includes("index")) {
            console.warn("[chatService] Chat subscription (room): index required", { currentUserId, partnerId, code, message });
            return;
        }
        console.error("[chatService] Chat subscription error (room):", { code, message, currentUserId, partnerId, raw });
    };

    // Use caching to avoid creating duplicate realtime listeners for same room
    const key = `${currentUserId}_${partnerId}`;
    let entry = messagesListenerCache.get(key);
    if (!entry) {
        entry = { callbacks: new Set() };
        // create a single underlying listener on roomId to reduce listener count
        const roomId = [currentUserId, partnerId].sort().join("_");
        const qRoom = query(
            collection(db, "messages"),
            where("roomId", "==", roomId),
            orderBy("createdAt", "asc")
        );
        const unsubRoom = onSnapshot(qRoom, (snap) => {
            // put all messages into part1 and clear part2, reuse existing notify()
            part1 = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
            part2 = [];
            notify();
        }, roomErrorHandler);
        entry.unsub = () => {
            try { unsubRoom(); } catch {}
            activeListenerCount = Math.max(0, activeListenerCount - 1);
            if (process.env.NODE_ENV === "development") {
                console.info("[chatService] underlying unsub for room", key, "activeListeners:", activeListenerCount);
            }
        };
        messagesListenerCache.set(key, entry);
        activeListenerCount += 1;
        if (process.env.NODE_ENV === "development") {
            console.info("[chatService] created underlying listener for room", key, "activeListeners:", activeListenerCount);
        }
    }
    // register callback
    entry.callbacks.add(callback);
    if (process.env.NODE_ENV === "development") {
        console.info("[chatService] registered callback for room", key, "callbacks:", entry.callbacks.size);
    }
    // immediately invoke callback with current parts if any
    notify();

    // return unsubscribe that removes this callback and cleans up underlying listeners when none remain
    return () => {
        const e = messagesListenerCache.get(key);
        if (e) {
            e.callbacks.delete(callback);
            if (process.env.NODE_ENV === "development") {
                console.info("[chatService] deregistered callback for room", key, "callbacks:", e.callbacks.size);
            }
            if (e.callbacks.size === 0) {
                // cleanup
                if (e.unsub) e.unsub();
                messagesListenerCache.delete(key);
            }
        }
    };
};

/**
 * 複数の相手（例: 全管理者）とのやり取りを1本のストリームで購読する。
 * スタッフチャットで「どの管理者からでも」届いたメッセージを表示するために使用。
 */
export const subscribeMessagesFromPartners = (
    currentUserId: string,
    partnerIds: string[],
    callback: (messages: ChatMessage[]) => void
) => {
    if (!auth.currentUser) {
        callback([]);
        return () => {};
    }
    const ids = partnerIds.slice(0, MAX_IN_QUERY);
    if (ids.length === 0) {
        callback([]);
        return () => {};
    }

    let part1: ChatMessage[] = [];
    let part2: ChatMessage[] = [];

    const notify = () => {
        const combined = [...part1, ...part2].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        callback(combined);
    };

    const makeErrorHandler = (which: "q1" | "q2") => (error: unknown) => {
        const { code, message, raw } = normalizeSnapshotError(error);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            message.toLowerCase().includes("insufficient permissions");
        if (isPermissionDenied) {
            if (which === "q1") part1 = [];
            else part2 = [];
            notify();
            return;
        }
        if (code === "failed-precondition" || message.toLowerCase().includes("index")) {
            console.warn("[chatService] Chat subscription (partners): index required", { which, currentUserId, partnerIds: ids, code, message });
            return;
        }
        console.error("[chatService] Chat subscription error (partners):", { which, code, message, currentUserId, partnerIds: ids, raw });
    };

    const q1 = query(
        collection(db, "messages"),
        where("senderId", "==", currentUserId),
        where("receiverId", "in", ids),
        orderBy("createdAt", "asc")
    );
    const q2 = query(
        collection(db, "messages"),
        where("receiverId", "==", currentUserId),
        where("senderId", "in", ids),
        orderBy("createdAt", "asc")
    );

    const unsub1 = onSnapshot(q1, (snap) => {
        part1 = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, makeErrorHandler("q1"));

    const unsub2 = onSnapshot(q2, (snap) => {
        part2 = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, makeErrorHandler("q2"));
    // count listeners
    activeListenerCount += 2;
    if (process.env.NODE_ENV === "development") {
        console.info("[chatService] subscribed 2 listeners for partners", ids, "activeListeners:", activeListenerCount);
    }

    const wrapped = () => {
        try { unsub1(); } catch {}
        try { unsub2(); } catch {}
        activeListenerCount = Math.max(0, activeListenerCount - 2);
        if (process.env.NODE_ENV === "development") {
            console.info("[chatService] unsubscribed 2 listeners for partners", ids, "activeListeners:", activeListenerCount);
        }
    };
    return wrapped;
};

/**
 * 現在ユーザーが送受信に関わる全メッセージを購読する（相手を固定しない）。
 * 「管理者UIDのズレ」等で partnerId が不正でも、自分が送った/受け取ったメッセージは必ず表示される。
 */
export const subscribeMyMessages = (
    currentUserId: string,
    callback: (messages: ChatMessage[]) => void
) => {
    if (!auth.currentUser) {
        callback([]);
        return () => {};
    }

    let sent: ChatMessage[] = [];
    let received: ChatMessage[] = [];

    const notify = () => {
        const combined = [...sent, ...received].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        callback(combined);
    };

    const makeErrorHandler = (which: "sent" | "received") => (error: unknown) => {
        const { code, message, raw } = normalizeSnapshotError(error);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            message.toLowerCase().includes("insufficient permissions");
        if (isPermissionDenied) {
            if (which === "sent") sent = [];
            else received = [];
            notify();
            return;
        }
        if (code === "failed-precondition" || message.toLowerCase().includes("index")) {
            console.warn("[chatService] Chat subscription (myMessages): index required", { which, currentUserId, code, message });
            return;
        }
        console.error("[chatService] Chat subscription error (myMessages):", { which, code, message, currentUserId, raw });
    };

    const qSent = query(
        collection(db, "messages"),
        where("senderId", "==", currentUserId),
        orderBy("createdAt", "asc")
    );
    const qReceived = query(
        collection(db, "messages"),
        where("receiverId", "==", currentUserId),
        orderBy("createdAt", "asc")
    );

    const unsub1 = onSnapshot(qSent, (snap) => {
        sent = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, makeErrorHandler("sent"));

    const unsub2 = onSnapshot(qReceived, (snap) => {
        received = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        notify();
    }, makeErrorHandler("received"));
    activeListenerCount += 2;
    if (process.env.NODE_ENV === "development") {
        console.info("[chatService] subscribed 2 listeners for myMessages", currentUserId, "activeListeners:", activeListenerCount);
    }

    const wrapped = () => {
        try { unsub1(); } catch {}
        try { unsub2(); } catch {}
        activeListenerCount = Math.max(0, activeListenerCount - 2);
        if (process.env.NODE_ENV === "development") {
            console.info("[chatService] unsubscribed 2 listeners for myMessages", currentUserId, "activeListeners:", activeListenerCount);
        }
    };
    return wrapped;
};

export const sendMessageWithRoom = async (
    text: string,
    senderId: string,
    receiverId: string,
    senderName?: string,
    file?: { url: string; name?: string; type?: string; size?: number }
) => {
    if (!receiverId || typeof receiverId !== "string" || !receiverId.trim()) {
        throw new Error("送信先が指定されていません");
    }
    const roomId = [senderId, receiverId].sort().join("_");
    const payload: Record<string, unknown> = {
        text,
        senderId,
        receiverId,
        senderName: senderName || "Unknown",
        read: false,
        roomId,
        createdAt: Timestamp.now(),
    };
    if (file && file.url) {
        payload.fileURL = file.url;
        if (file.name) payload.fileName = file.name;
        if (file.type) payload.fileType = file.type;
        if (typeof file.size === "number") payload.fileSize = file.size;
    }
    await addDoc(collection(db, "messages"), payload);

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
        console.error("[chatService] createNotification failed:", notifError);
        throw new Error("メッセージは送信されましたが、相手への通知に失敗しました。Firestore の notifications ルールを確認してください。");
    }
};

export const setRoomLastRead = async (roomId: string, uid: string) => {
    if (!roomId || !uid) return;
    const ref = doc(db, "chatRooms", roomId);
    // Use setDoc with merge to create the doc if missing and set nested field
    await setDoc(ref, { lastReadBy: { [uid]: serverTimestamp() } }, { merge: true });
};

export const subscribeRoomMeta = (roomId: string, callback: (lastReadBy: Record<string, any>) => void) => {
    if (!roomId) {
        callback({});
        return () => {};
    }
    const ref = doc(db, "chatRooms", roomId);
    const unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) {
            callback({});
            return;
        }
        const data = snap.data() as Record<string, any>;
        callback(data.lastReadBy || {});
    }, (err) => {
        console.error("[chatService] subscribeRoomMeta error:", err);
        callback({});
    });
    activeListenerCount += 1;
    if (process.env.NODE_ENV === "development") {
        console.info("[chatService] subscribed 1 listener for roomMeta", roomId, "activeListeners:", activeListenerCount);
    }
    const wrapped = () => {
        try { unsub(); } catch {}
        activeListenerCount = Math.max(0, activeListenerCount - 1);
        if (process.env.NODE_ENV === "development") {
            console.info("[chatService] unsubscribed 1 listener for roomMeta", roomId, "activeListeners:", activeListenerCount);
        }
    };
    return wrapped;
};
// For Admin: Get list of users who have chatted? 
// That might be complex. For now Admin can just see list of all staff (STAFF_LIST from page.tsx) and click one to chat.
