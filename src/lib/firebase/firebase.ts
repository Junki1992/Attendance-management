import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
    getFirestore,
    initializeFirestore,
    enableNetwork,
    persistentLocalCache,
    persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

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
// オフライン永続化（複数タブ対応）は FirestoreSettings.localCache で指定（非推奨の enableMultiTabIndexedDbPersistence の代替）。
// experimentalForceLongPolling は NEXT_PUBLIC_FIREBASE_FORCE_LONG_POLLING=1 のときのみ有効。
let db: ReturnType<typeof getFirestore>;
const firestoreReady: Promise<void> = Promise.resolve();
if (typeof window !== "undefined") {
    const forceLongPolling = process.env.NEXT_PUBLIC_FIREBASE_FORCE_LONG_POLLING === "1";
    // To avoid localStorage / WebStorage quota exhaustion in browsers (multi-tab shared client state),
    // do NOT enable persistent local cache / multi-tab manager here.
    // Use a plain getFirestore() instance in the browser to prevent excessive localStorage writes.
    db = getFirestore(app);
    if (forceLongPolling) {
        console.warn("[Firebase] Firestore: experimentalForceLongPolling=ON（回線によっては遅くなる場合があります）");
    }
    // Ensure network is enabled
    enableNetwork(db).catch(() => {});
} else {
    db = getFirestore(app);
}

const storage = getStorage(app);
export { app, auth, db, firestoreReady, storage };
