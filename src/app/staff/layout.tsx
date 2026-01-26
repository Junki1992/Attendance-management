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
    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

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
                padding: '0.75rem 1rem',
                position: 'sticky',
                top: 0,
                zIndex: 100
            }}>
                {/* モバイル用ヘッダー */}
                {isMobile && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center'
                }}>
                    <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>スタッフ用</h1>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
                                        minWidth: '16px',
                                        height: '16px',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '0 4px',
                                        fontWeight: 600
                                    }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </button>
                            {showNotifications && <NotificationList onClose={() => setShowNotifications(false)} />}
                        </div>
                        <button
                            onClick={() => setShowMobileMenu(!showMobileMenu)}
                            style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: '1.5rem',
                                padding: '0.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {showMobileMenu ? '✕' : '☰'}
                        </button>
                    </div>
                </div>
                )}

                {/* デスクトップ用ヘッダー */}
                {!isMobile && (
                <div className="container" style={{ 
                    display: 'flex',
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                }}>
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>スタッフ用</h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.9rem' }}>{user.name}</span>
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
                                        minWidth: '16px',
                                        height: '16px',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '0 4px',
                                        fontWeight: 600
                                    }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </button>
                            {showNotifications && <NotificationList onClose={() => setShowNotifications(false)} />}
                        </div>
                        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Link href="/staff" style={{ textDecoration: 'none', color: 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>ホーム</Link>
                            <Link href="/staff/shifts" style={{ textDecoration: 'none', color: 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>シフト提出</Link>
                            <Link href="/staff/confirmed-shifts" style={{ textDecoration: 'none', color: 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>確定シフト</Link>
                            <Link href="/staff/chat" style={{ textDecoration: 'none', color: 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>チャット</Link>
                            <button 
                                onClick={handleLogout}
                                style={{ 
                                    background: 'transparent', 
                                    border: '1px solid var(--border)', 
                                    color: 'var(--text-main)', 
                                    padding: '0.25rem 0.75rem', 
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                ログアウト
                            </button>
                        </nav>
                    </div>
                </div>
                )}

                {/* モバイルメニュー */}
                {isMobile && showMobileMenu && (
                    <div style={{
                        marginTop: '0.75rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                            {user.name}
                        </div>
                        <Link 
                            href="/staff" 
                            onClick={() => setShowMobileMenu(false)}
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.5rem',
                                borderRadius: '4px',
                                backgroundColor: pathname === '/staff' ? 'var(--surface-hover)' : 'transparent'
                            }}
                        >
                            ホーム
                        </Link>
                        <Link 
                            href="/staff/shifts" 
                            onClick={() => setShowMobileMenu(false)}
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.5rem',
                                borderRadius: '4px',
                                backgroundColor: pathname === '/staff/shifts' ? 'var(--surface-hover)' : 'transparent'
                            }}
                        >
                            シフト提出
                        </Link>
                        <Link 
                            href="/staff/confirmed-shifts" 
                            onClick={() => setShowMobileMenu(false)}
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.5rem',
                                borderRadius: '4px',
                                backgroundColor: pathname === '/staff/confirmed-shifts' ? 'var(--surface-hover)' : 'transparent'
                            }}
                        >
                            確定シフト
                        </Link>
                        <Link 
                            href="/staff/chat" 
                            onClick={() => setShowMobileMenu(false)}
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.5rem',
                                borderRadius: '4px',
                                backgroundColor: pathname === '/staff/chat' ? 'var(--surface-hover)' : 'transparent'
                            }}
                        >
                            チャット
                        </Link>
                        <button 
                            onClick={() => {
                                setShowMobileMenu(false);
                                handleLogout();
                            }}
                            style={{ 
                                background: 'transparent', 
                                border: '1px solid var(--border)', 
                                color: 'var(--text-main)', 
                                padding: '0.5rem', 
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                textAlign: 'left',
                                marginTop: '0.5rem'
                            }}
                        >
                            ログアウト
                        </button>
                    </div>
                )}
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
