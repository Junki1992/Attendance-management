"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/firebase";
import { getUserProfile, createUser } from "@/services/userService";

export type UserRole = "admin" | "staff";

const JUST_REGISTERED_UID_KEY = "just_registered_uid";

function nowMs(): number {
    // performance.now の方が高精度。無ければ Date.now
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function devInfo(...args: unknown[]) {
    if (process.env.NODE_ENV === "development") console.info(...args);
}
function devWarn(...args: unknown[]) {
    if (process.env.NODE_ENV === "development") console.warn(...args);
}
function devError(...args: unknown[]) {
    if (process.env.NODE_ENV === "development") console.error(...args);
}

type UserProfileOrNull = Awaited<ReturnType<typeof getUserProfile>>;

function setJustRegisteredUid(uid: string) {
    try {
        sessionStorage.setItem(JUST_REGISTERED_UID_KEY, uid);
    } catch {
        // ignore
    }
}
function getJustRegisteredUid(): string | null {
    try {
        return sessionStorage.getItem(JUST_REGISTERED_UID_KEY);
    } catch {
        return null;
    }
}
function clearJustRegisteredUid() {
    try {
        sessionStorage.removeItem(JUST_REGISTERED_UID_KEY);
    } catch {
        // ignore
    }
}

export interface User {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    /** メール+パスワードでログイン（Firebase Auth） */
    login: (email: string, password: string) => Promise<void>;
    /** 新規登録。Firestore users/{uid} を作成してから完了。role=staff 固定 */
    register: (email: string, password: string, name: string) => Promise<void>;
    /** 開発・検証用：パスワードなしでロールを選んで入る */
    loginMock: (role: UserRole) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    login: async () => {},
    register: async () => {},
    loginMock: async () => {},
    logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const MOCK_USERS: Record<UserRole, User> = {
    admin: { uid: "admin-123", email: "admin@example.com", name: "管理者 太郎", role: "admin" },
    staff: { uid: "staff-456", email: "staff@example.com", name: "アルバイト 花子", role: "staff" },
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const userRef = useRef<User | null>(null);
    const profilePromiseRef = useRef<Map<string, Promise<UserProfileOrNull>>>(new Map());

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const getUserProfileDeduped = (uid: string): Promise<UserProfileOrNull> => {
        const existing = profilePromiseRef.current.get(uid);
        if (existing) return existing;
        const p = (async () => {
            try {
                return await getUserProfile(uid);
            } finally {
                profilePromiseRef.current.delete(uid);
            }
        })();
        profilePromiseRef.current.set(uid, p);
        return p;
    };

    useEffect(() => {
        if (typeof window === "undefined") return;

        // 1) Firebase Auth の状態を監視
        const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
            const t0 = nowMs();
            try {
                if (firebaseUser) {
                    // login() 側で profile を取得して user をセット済みなら、ここでは二重取得しない
                    if (userRef.current?.uid === firebaseUser.uid) {
                        devInfo("[Auth] onAuthStateChanged: skip (already set user)", { uid: firebaseUser.uid });
                        return;
                    }

                    const tProfile0 = nowMs();
                    let profile = await getUserProfileDeduped(firebaseUser.uid);
                    devInfo("[Auth] onAuthStateChanged: getUserProfile", {
                        uid: firebaseUser.uid,
                        ms: Math.round(nowMs() - tProfile0),
                        found: !!profile,
                    });
                    // 登録直後は setDoc が完了前で profile が null になり得る。
                    // ただし通常ログインまで遅くしないため「サインアップ直後（同タブ）」だけ短くリトライする。
                    if (!profile && getJustRegisteredUid() === firebaseUser.uid) {
                        const tRetry0 = nowMs();
                        for (let i = 0; i < 10 && !profile; i++) {
                            await new Promise((r) => setTimeout(r, 200));
                            const tTry = nowMs();
                            profile = await getUserProfileDeduped(firebaseUser.uid);
                            devInfo("[Auth] onAuthStateChanged: retry getUserProfile", {
                                uid: firebaseUser.uid,
                                try: i + 1,
                                ms: Math.round(nowMs() - tTry),
                                found: !!profile,
                            });
                        }
                        devInfo("[Auth] onAuthStateChanged: retry window done", {
                            uid: firebaseUser.uid,
                            ms: Math.round(nowMs() - tRetry0),
                            found: !!profile,
                        });
                        clearJustRegisteredUid();
                    }
                    if (profile && (profile.role === "admin" || profile.role === "staff")) {
                        const u: User = {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email || profile.email || "",
                            name: profile.name,
                            role: profile.role,
                        };
                        userRef.current = u;
                        setUser(u);
                        devInfo("[Auth] onAuthStateChanged: setUser", {
                            uid: firebaseUser.uid,
                            role: profile.role,
                            totalMs: Math.round(nowMs() - t0),
                        });
                        return;
                    }
                    // プロフィールが無い/ロールが不正なら追い出す
                    try {
                        await signOut(auth);
                    } catch {
                        // ignore
                    }
                    userRef.current = null;
                    setUser(null);
                    devWarn("[Auth] onAuthStateChanged: signOut (missing/invalid profile)", {
                        uid: firebaseUser.uid,
                        totalMs: Math.round(nowMs() - t0),
                    });
                    return;
                }

                // 2) Firebase 未ログイン時：モックの永続化を確認
                const stored = localStorage.getItem("mock_user");
                if (stored) {
                    try {
                        const u = JSON.parse(stored) as User;
                        if (u?.uid && (u.role === "admin" || u.role === "staff")) {
                            setUser(u);
                        } else {
                            localStorage.removeItem("mock_user");
                            setUser(null);
                        }
                    } catch {
                        localStorage.removeItem("mock_user");
                        setUser(null);
                    }
                } else {
                    userRef.current = null;
                    setUser(null);
                }
            } catch (e) {
                // Firestore permission-denied などでここに来ると、loading が落ちず無限 Loading になり得るため必ず回復させる
                devError("[Auth] onAuthStateChanged error:", e);
                try {
                    await signOut(auth);
                } catch {
                    // ignore
                }
                userRef.current = null;
                setUser(null);
            } finally {
                setLoading(false);
                devInfo("[Auth] onAuthStateChanged: done", { totalMs: Math.round(nowMs() - t0), hasFirebaseUser: !!firebaseUser });
            }
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        setLoading(true);
        localStorage.removeItem("mock_user");
        const t0 = nowMs();
        devInfo("[Auth] login: start", { email: email.trim() });
        try {
            const tAuth0 = nowMs();
            const { user: firebaseUser } = await signInWithEmailAndPassword(auth, email.trim(), password);
            devInfo("[Auth] login: signInWithEmailAndPassword", { ms: Math.round(nowMs() - tAuth0), uid: firebaseUser.uid });

            const tProfile0 = nowMs();
            const profile = await getUserProfileDeduped(firebaseUser.uid);
            devInfo("[Auth] login: getUserProfile", { ms: Math.round(nowMs() - tProfile0), uid: firebaseUser.uid, found: !!profile });
            if (profile && (profile.role === "admin" || profile.role === "staff")) {
                const u: User = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || profile.email || "",
                    name: profile.name,
                    role: profile.role,
                };
                userRef.current = u;
                setUser(u);
                devInfo("[Auth] login: setUser", { uid: u.uid, role: u.role, totalMs: Math.round(nowMs() - t0) });
                return;
            }
            // プロフィールが無い/ロールが不正なら追い出す（=このアプリに入れない）
            try {
                await signOut(auth);
            } catch {
                // ignore
            }
            userRef.current = null;
            setUser(null);
            throw new Error("user-profile-not-found");
        } finally {
            setLoading(false);
            devInfo("[Auth] login: done", { totalMs: Math.round(nowMs() - t0) });
        }
    };

    const register = async (email: string, password: string, name: string) => {
        setLoading(true);
        localStorage.removeItem("mock_user");
        const t0 = nowMs();
        devInfo("[Auth] register: start", { email: email.trim() });
        try {
            const tAuth0 = nowMs();
            const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email.trim(), password);
            devInfo("[Auth] register: createUserWithEmailAndPassword", { ms: Math.round(nowMs() - tAuth0), uid: firebaseUser.uid });
            // onAuthStateChanged で profile 未作成を短くリトライするための印
            setJustRegisteredUid(firebaseUser.uid);
            const tDb0 = nowMs();
            await createUser({
                uid: firebaseUser.uid,
                email: email.trim(),
                name: name.trim(),
                role: "staff",
                hourlyWage: 1000,
            });
            devInfo("[Auth] register: createUser(users/{uid})", { ms: Math.round(nowMs() - tDb0), uid: firebaseUser.uid });
        } finally {
            setLoading(false);
            devInfo("[Auth] register: done", { totalMs: Math.round(nowMs() - t0) });
        }
    };

    const loginMock = async (role: UserRole) => {
        setLoading(true);
        try {
            try {
                await signOut(auth);
            } catch {
                // 未ログイン時はエラーにならない想定
            }
            const u = MOCK_USERS[role];
            setUser(u);
            localStorage.setItem("mock_user", JSON.stringify(u));
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        setLoading(true);
        try {
            await signOut(auth);
            localStorage.removeItem("mock_user");
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, loginMock, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
