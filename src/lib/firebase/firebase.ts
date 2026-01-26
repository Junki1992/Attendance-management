import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore, enableNetwork, enableMultiTabIndexedDbPersistence } from "firebase/firestore";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (typeof window !== "undefined" && !firebaseConfig.projectId) {
    console.warn("[Firebase] NEXT_PUBLIC_FIREBASE_PROJECT_ID が未設定です。.env.local を確認してください。");
}

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Firestore:
// 以前は experimentalForceLongPolling を常に有効化していたが、環境によっては極端に遅くなることがある。
// デフォルトは WebChannel を使い、必要な場合だけ long-polling を有効化できるようにする。
let db: ReturnType<typeof getFirestore>;
let firestoreReady: Promise<void> = Promise.resolve();
if (typeof window !== "undefined") {
    const forceLongPolling = process.env.NEXT_PUBLIC_FIREBASE_FORCE_LONG_POLLING === "1";
    try {
        db = forceLongPolling
            ? initializeFirestore(app, { experimentalForceLongPolling: true })
            : getFirestore(app);
    } catch {
        db = getFirestore(app);
    }
    if (forceLongPolling) {
        console.warn("[Firebase] Firestore: experimentalForceLongPolling=ON（回線によっては遅くなる場合があります）");
    }
    // オフライン永続化（複数タブ対応）: 必ず他の Firestore 操作より先に呼ぶ。
    // 複数タブでも永続化が有効になり「client is offline」を軽減する。
    const _p = enableMultiTabIndexedDbPersistence(db).catch((e: { code?: string; message?: string }) => {
        if (e?.code !== "failed-precondition" && e?.code !== "unimplemented") {
            console.warn("[Firebase] オフライン永続化を有効にできません:", e?.message ?? e);
        }
    });
    firestoreReady = _p.then(() => {});
    // 接続を明示的に有効化（オフライン誤検知の緩和）
    enableNetwork(db).catch(() => {});
} else {
    db = getFirestore(app);
}

export { app, auth, db, firestoreReady };
