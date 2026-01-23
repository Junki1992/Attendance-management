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

// Firestore: experimentalForceLongPolling で WebChannel の代わりに long-polling を使用。
// 「Failed to get document because the client is offline」が遅延・不安定な回線や
// 一部のプロキシ環境で出るのを軽減する。
let db: ReturnType<typeof getFirestore>;
let firestoreReady: Promise<void> = Promise.resolve();
if (typeof window !== "undefined") {
    try {
        db = initializeFirestore(app, { experimentalForceLongPolling: true });
    } catch {
        db = getFirestore(app);
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
