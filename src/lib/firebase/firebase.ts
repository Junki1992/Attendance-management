import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Firestore: experimentalForceLongPolling で WebChannel の代わりに long-polling を使用。
// 「Failed to get document because the client is offline」が遅延・不安定な回線や
// 一部のプロキシ環境で出るのを軽減する。
let db: ReturnType<typeof getFirestore>;
if (typeof window !== "undefined") {
    try {
        db = initializeFirestore(app, { experimentalForceLongPolling: true });
    } catch {
        db = getFirestore(app);
    }
} else {
    db = getFirestore(app);
}

export { app, auth, db };
