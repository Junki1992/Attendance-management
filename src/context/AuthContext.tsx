"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/firebase";
import { getUserProfile, createUser } from "@/services/userService";

export type UserRole = "admin" | "staff";

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

    useEffect(() => {
        if (typeof window === "undefined") return;

        // 1) Firebase Auth の状態を監視
        const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                let profile = await getUserProfile(firebaseUser.uid);
                // 登録直後は setDoc が完了前で profile が null になり得る。1回だけリトライ
                if (!profile) {
                    await new Promise((r) => setTimeout(r, 2000));
                    profile = await getUserProfile(firebaseUser.uid);
                }
                if (profile && (profile.role === "admin" || profile.role === "staff")) {
                    setUser({
                        uid: firebaseUser.uid,
                        email: firebaseUser.email || profile.email || "",
                        name: profile.name,
                        role: profile.role,
                    });
                } else {
                    await signOut(auth);
                    setUser(null);
                }
                setLoading(false);
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
                    }
                } catch {
                    localStorage.removeItem("mock_user");
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        setLoading(true);
        localStorage.removeItem("mock_user");
        await signInWithEmailAndPassword(auth, email.trim(), password);
        setLoading(false);
    };

    const register = async (email: string, password: string, name: string) => {
        setLoading(true);
        localStorage.removeItem("mock_user");
        try {
            const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email.trim(), password);
            await createUser({
                uid: firebaseUser.uid,
                email: email.trim(),
                name: name.trim(),
                role: "staff",
                hourlyWage: 1000,
            });
        } finally {
            setLoading(false);
        }
    };

    const loginMock = async (role: UserRole) => {
        setLoading(true);
        try {
            await signOut(auth);
        } catch {
            // 未ログイン時はエラーにならない想定
        }
        const u = MOCK_USERS[role];
        setUser(u);
        localStorage.setItem("mock_user", JSON.stringify(u));
        setLoading(false);
    };

    const logout = async () => {
        setLoading(true);
        await signOut(auth);
        localStorage.removeItem("mock_user");
        setUser(null);
        setLoading(false);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, loginMock, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
