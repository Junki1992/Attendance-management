"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
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
    photoURL?: string;
    /** Chatwork アカウントID（数字）。通知のメンション用。Googleログイン時は未設定になり、設定画面で登録可能 */
    chatworkAccountId?: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    /** メール+パスワードでログイン（Firebase Auth） */
    login: (email: string, password: string) => Promise<void>;
    /** 新規登録。Firestore users/{uid} を作成してから完了。role=staff 固定 */
    register: (email: string, password: string, name: string, chatworkAccountId?: string) => Promise<void>;
    /** 開発・検証用：パスワードなしでロールを選んで入る */
    loginMock: (role: UserRole) => Promise<void>;
    logout: () => Promise<void>;
    /** プロフィールを再取得して user を更新（画像変更後に呼ぶ） */
    refreshUserProfile: () => Promise<void>;
    /** Googleでログイン（初回は Firestore にプロフィール自動作成） */
    loginWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    login: async () => {},
    register: async () => {},
    loginMock: async () => {},
    logout: async () => {},
    refreshUserProfile: async () => {},
    loginWithGoogle: async () => {},
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
                    // Google 初回ログイン: プロフィールが無ければ自動作成
                    if (!profile && firebaseUser.providerData?.some((p) => p?.providerId === "google.com")) {
                        const firstAdminEmail = process.env.NEXT_PUBLIC_FIRST_ADMIN_EMAIL?.trim().toLowerCase();
                        const email = firebaseUser.email?.trim().toLowerCase() ?? "";
                        const isFirstAdmin = !!firstAdminEmail && email === firstAdminEmail;
                        const role: "admin" | "staff" = isFirstAdmin ? "admin" : "staff";
                        try {
                            await createUser({
                                uid: firebaseUser.uid,
                                email: firebaseUser.email ?? "",
                                name: firebaseUser.displayName ?? firebaseUser.email ?? "User",
                                role,
                                hourlyWage: 1000,
                                photoURL: firebaseUser.photoURL ?? undefined,
                            });
                            profile = await getUserProfileDeduped(firebaseUser.uid);
                            devInfo("[Auth] onAuthStateChanged: created profile for Google user", { uid: firebaseUser.uid, role });
                        } catch (err) {
                            devError("[Auth] onAuthStateChanged: createUser for Google failed", err);
                        }
                    }
                    if (profile && (profile.role === "admin" || profile.role === "staff")) {
                        const u: User = {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email || profile.email || "",
                            name: profile.name,
                            role: profile.role,
                            photoURL: profile.photoURL,
                            chatworkAccountId: profile.chatworkAccountId,
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
                const err = e as { message?: string; code?: string; stack?: string };
                const msg = err?.message ?? "";
                const code = err?.code ?? "";
                // エラーオブジェクトは列挙不可プロパティを持つことがあるため、明示的に取り出してログ
                devError("[Auth] onAuthStateChanged error (getUserProfile等):", {
                    code,
                    message: msg,
                    name: e instanceof Error ? e.name : undefined,
                    stack: e instanceof Error ? e.stack : undefined,
                });
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
            let profile: UserProfileOrNull = null;
            try {
                profile = await getUserProfileDeduped(firebaseUser.uid);
            } catch (err: unknown) {
                const code = (err as { code?: string })?.code ?? "";
                const message = (err as { message?: string })?.message ?? "";
                devError("[Auth] login: getUserProfile failed", { code, message, uid: firebaseUser.uid });
                // Firestore権限エラーの場合
                if (code === "permission-denied" || code === "missing-or-insufficient-permissions") {
                    try {
                        await signOut(auth);
                    } catch {
                        // ignore
                    }
                    const firestoreError = new Error("firestore-permission-denied");
                    (firestoreError as { code?: string }).code = code;
                    throw firestoreError;
                }
                // その他のエラーは再スロー
                throw err;
            }
            devInfo("[Auth] login: getUserProfile", { ms: Math.round(nowMs() - tProfile0), uid: firebaseUser.uid, found: !!profile });
            if (profile && (profile.role === "admin" || profile.role === "staff")) {
                const u: User = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || profile.email || "",
                    name: profile.name,
                    role: profile.role,
                    photoURL: profile.photoURL,
                    chatworkAccountId: profile.chatworkAccountId,
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
            const profileError = new Error("user-profile-not-found");
            (profileError as { code?: string }).code = "user-profile-not-found";
            throw profileError;
        } catch (err: unknown) {
            // Firebase Auth のエラーはそのまま再スロー
            const code = (err as { code?: string })?.code ?? "";
            if (code.startsWith("auth/")) {
                throw err;
            }
            // Firestore のエラーやプロフィールが見つからないエラーも再スロー
            throw err;
        } finally {
            setLoading(false);
            devInfo("[Auth] login: done", { totalMs: Math.round(nowMs() - t0) });
        }
    };

    const loginWithGoogle = async () => {
        setLoading(true);
        localStorage.removeItem("mock_user");
        const t0 = nowMs();
        devInfo("[Auth] loginWithGoogle: start");
        try {
            const provider = new GoogleAuthProvider();
            const { user: firebaseUser } = await signInWithPopup(auth, provider);
            devInfo("[Auth] loginWithGoogle: signInWithPopup", { uid: firebaseUser.uid, totalMs: Math.round(nowMs() - t0) });
            // onAuthStateChanged でプロフィール取得 or 自動作成 → setUser される
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code ?? "";
            devError("[Auth] loginWithGoogle failed", { code, err });
            throw err;
        } finally {
            setLoading(false);
            devInfo("[Auth] loginWithGoogle: done", { totalMs: Math.round(nowMs() - t0) });
        }
    };

    const register = async (email: string, password: string, name: string, chatworkAccountId?: string) => {
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
            
            // 環境変数で指定された最初の管理者のメールアドレスと一致する場合のみ管理者として作成
            const firstAdminEmail = process.env.NEXT_PUBLIC_FIRST_ADMIN_EMAIL?.trim().toLowerCase();
            const isFirstAdmin = firstAdminEmail && email.trim().toLowerCase() === firstAdminEmail;
            const role: "admin" | "staff" = isFirstAdmin ? "admin" : "staff";
            
            const tDb0 = nowMs();
            try {
                await createUser({
                    uid: firebaseUser.uid,
                    email: email.trim(),
                    name: name.trim(),
                    role,
                    hourlyWage: 1000,
                    chatworkAccountId: chatworkAccountId?.trim() || undefined,
                });
                devInfo("[Auth] register: createUser(users/{uid})", { ms: Math.round(nowMs() - tDb0), uid: firebaseUser.uid, role });
            } catch (err: unknown) {
                const code = (err as { code?: string })?.code ?? "";
                const message = (err as { message?: string })?.message ?? "";
                devError("[Auth] register: createUser failed", { code, message, uid: firebaseUser.uid, role });
                // Firestore権限エラーの場合、Firebase Authenticationのユーザーは作成済みなので削除する必要がある
                if (code === "permission-denied" || code === "missing-or-insufficient-permissions") {
                    try {
                        await signOut(auth);
                        devWarn("[Auth] register: signed out due to Firestore permission error");
                    } catch {
                        // ignore
                    }
                }
                throw err;
            }
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

    const refreshUserProfile = async () => {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser || userRef.current?.uid !== firebaseUser.uid) return;
        try {
            const profile = await getUserProfile(firebaseUser.uid);
            if (profile && (profile.role === "admin" || profile.role === "staff")) {
                const u: User = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || profile.email || "",
                    name: profile.name,
                    role: profile.role,
                    photoURL: profile.photoURL,
                    chatworkAccountId: profile.chatworkAccountId,
                };
                userRef.current = u;
                setUser(u);
            }
        } catch {
            // ignore
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, loginMock, logout, refreshUserProfile, loginWithGoogle }}>
            {children}
        </AuthContext.Provider>
    );
};
