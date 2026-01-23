"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import NotificationList from "@/components/NotificationList";
import { subscribeNotifications } from "@/services/notificationService";

export default function StaffLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [showNotifications, setShowNotifications] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

    useEffect(() => {
        if (!loading && (!user || user.role !== 'staff')) {
            router.push('/login');
        }
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        const unsubscribe = subscribeNotifications(user.uid, (notifs) => {
            setUnreadCount(notifs.filter(n => !n.read).length);
        });
        return () => unsubscribe();
    }, [user]);

    if (loading || !user) return <div className="p-4 text-center">Loading...</div>;

    const isWide = pathname === "/staff/shifts" || pathname === "/staff/confirmed-shifts" || pathname === "/staff/chat";

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
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>スタッフ用</h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span>{user.name}</span>
                        <div style={{ position: 'relative' }}>
                            <button 
                                onClick={() => setShowNotifications(!showNotifications)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    padding: '0.25rem',
                                    position: 'relative'
                                }}
                            >
                                🔔
                                {unreadCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        backgroundColor: 'var(--destructive)',
                                        color: 'white',
                                        fontSize: '0.6rem',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        {unreadCount}
                                    </span>
                                )}
                            </button>
                            {showNotifications && <NotificationList onClose={() => setShowNotifications(false)} />}
                        </div>
                        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <Link href="/staff" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>ホーム</Link>
                            <Link href="/staff/shifts" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>シフト提出</Link>
                            <Link href="/staff/confirmed-shifts" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>確定シフト</Link>
                            <Link href="/staff/chat" style={{ textDecoration: 'none', color: 'var(--text-main)' }}>チャット</Link>
                            <button 
                                onClick={handleLogout}
                                style={{ 
                                    background: 'transparent', 
                                    border: '1px solid var(--border)', 
                                    color: 'var(--text-main)', 
                                    padding: '0.25rem 0.75rem', 
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >
                                ログアウト
                            </button>
                        </nav>
                    </div>
                </div>
            </header>
            <main
                className={isWide ? '' : 'container'}
                style={{
                    flex: 1,
                    padding: '2rem 1rem',
                    ...(isWide && { maxWidth: '1600px', margin: '0 auto', width: '100%' }),
                }}
            >
                {children}
            </main>
        </div>
    );
}
