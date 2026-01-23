"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

// Mock User Types
type UserRole = "admin" | "staff";

interface User {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (role: UserRole) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    login: async () => { },
    logout: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Simulate checking local storage for persisted session
        const storedUser = localStorage.getItem("mock_user");
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
        setLoading(false);
    }, []);

    const login = async (role: UserRole) => {
        setLoading(true);
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 800));

        const mockUser: User = role === "admin"
            ? { uid: "admin-123", email: "admin@example.com", name: "管理者 太郎", role: "admin" }
            : { uid: "staff-456", email: "staff@example.com", name: "アルバイト 花子", role: "staff" };

        setUser(mockUser);
        localStorage.setItem("mock_user", JSON.stringify(mockUser));
        setLoading(false);
    };

    const logout = async () => {
        setLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 500));
        setUser(null);
        localStorage.removeItem("mock_user");
        setLoading(false);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
