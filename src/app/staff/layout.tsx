"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

export default function StaffLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && (!user || user.role !== 'staff')) {
            router.push('/login');
        }
    }, [user, loading, router]);

    if (loading || !user) return <div className="p-4 text-center">Loading...</div>;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{
                backgroundColor: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                padding: '1rem',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>Staff Portal</h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span>{user.name}</span>
                        <nav style={{ display: 'flex', gap: '1rem' }}>
                            <Link href="/staff" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>Home</Link>
                            <Link href="/staff/shifts" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>Shifts</Link>
                            <Link href="/staff/chat" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>Chat</Link>
                        </nav>
                    </div>
                </div>
            </header>
            <main className="container" style={{ flex: 1, padding: '2rem 1rem' }}>
                {children}
            </main>
        </div>
    );
}
