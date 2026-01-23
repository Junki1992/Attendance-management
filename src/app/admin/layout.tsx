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
    const { user, loading, logout } = useAuth();
    const router = useRouter();

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

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
                        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <Link href="/admin" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Home</Link>
                            <Link href="/admin/shifts" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Shift Grid</Link>
                            <Link href="/admin/chat" style={{ textDecoration: 'none', color: '#e0e7ff' }}>Chat</Link>
                            <button 
                                onClick={handleLogout}
                                style={{ 
                                    background: 'transparent', 
                                    border: '1px solid #e0e7ff', 
                                    color: '#e0e7ff', 
                                    padding: '0.25rem 0.75rem', 
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >
                                Logout
                            </button>
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
