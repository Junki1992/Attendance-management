"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && (!user || user.role !== 'admin')) {
            router.push('/login');
        }
    }, [user, loading, router]);

    if (loading || !user) return <div className="p-4 text-center">Loading...</div>;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{
                backgroundColor: '#1e1b4b', /* Indigo 950 */
                color: 'white',
                padding: '1rem',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Shift Admin</h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span>{user.name}</span>
                        <nav style={{ display: 'flex', gap: '1rem' }}>
                            <Link href="/admin" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Home</Link>
                            <Link href="/admin/shifts" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Shift Grid</Link>
                            <Link href="/admin/chat" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Chat</Link>
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
