"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
    const { user, login, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (user) {
            if (user.role === 'admin') router.push('/admin');
            else router.push('/staff');
        }
    }, [user, router]);

    const handleLogin = async (role: "admin" | "staff") => {
        await login(role);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <p>Loading...</p>
            </div>
        );
    }

    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
                <h1 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', color: 'var(--primary)' }}>勤怠管理ツール</h1>
                <p style={{ marginBottom: '2rem', color: 'var(--text-muted)' }}>
                    開発用モックログイン
                    <br />
                    <small>※パスワード不要でログインできます</small>
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button
                        onClick={() => handleLogin('admin')}
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                    >
                        管理者としてログイン
                    </button>

                    <button
                        onClick={() => handleLogin('staff')}
                        className="btn btn-outline"
                        style={{ width: '100%' }}
                    >
                        スタッフとしてログイン
                    </button>
                </div>
            </div>
        </div>
    );
}
