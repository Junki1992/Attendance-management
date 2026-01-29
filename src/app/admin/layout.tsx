"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import NotificationList from "@/components/NotificationList";
import Avatar from "@/components/Avatar";
import { subscribeNotifications } from "@/services/notificationService";

export default function AdminLayout({
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

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

    useEffect(() => {
        if (!loading && (!user || user.role !== 'admin')) {
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

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    if (loading || !user) return <div className="p-4 text-center">Loading...</div>;

    const isWide = pathname === "/admin/chat";

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{
                backgroundColor: '#1e1b4b', /* Indigo 950 */
                color: 'white',
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
                    <h1 style={{ fontSize: '1rem', fontWeight: 600 }}>管理画面</h1>
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
                                    position: 'relative',
                                    color: '#e0e7ff'
                                }}
                            >
                                🔔
                                {unreadCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        backgroundColor: '#ef4444',
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
                            className={`hamburger-icon ${showMobileMenu ? 'open' : ''}`}
                            style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                padding: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#e0e7ff',
                                transition: 'transform 0.2s'
                            }}
                            aria-label="メニュー"
                        >
                            <span></span>
                            <span></span>
                            <span></span>
                        </button>
                    </div>
                </div>
                )}

                {/* デスクトップ用ヘッダー */}
                {!isMobile && (
                <div className="container container-wide" style={{ 
                    display: 'flex',
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                }}>
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>管理画面</h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Avatar photoURL={user.photoURL} name={user.name} size="sm" />
                            <span style={{ fontSize: '0.9rem' }}>{user.name}</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button 
                                onClick={() => setShowNotifications(!showNotifications)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    padding: '0.25rem',
                                    position: 'relative',
                                    color: '#e0e7ff'
                                }}
                            >
                                🔔
                                {unreadCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        backgroundColor: '#ef4444',
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
                            <Link href="/admin" style={{ textDecoration: 'none', color: '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>ホーム</Link>
                            <Link href="/admin/shifts" style={{ textDecoration: 'none', color: '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>シフト表</Link>
                            <Link href="/admin/shift-change-requests" style={{ textDecoration: 'none', color: '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>変更申請</Link>
                            <Link href="/admin/chat" style={{ textDecoration: 'none', color: '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>チャット</Link>
                            <Link href="/admin/settings" style={{ textDecoration: 'none', color: '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>設定</Link>
                            <button 
                                onClick={handleLogout}
                                style={{ 
                                    background: 'transparent', 
                                    border: '1px solid #e0e7ff', 
                                    color: '#e0e7ff', 
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
                    <div className="mobile-menu-enter" style={{
                        marginTop: '0.75rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(224, 231, 255, 0.2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        <div className="menu-item-enter" style={{ 
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            fontSize: '0.9rem', 
                            color: 'rgba(224, 231, 255, 0.7)', 
                            marginBottom: '0.25rem',
                            padding: '0.5rem 0.75rem',
                            fontWeight: 500
                        }}>
                            <Avatar photoURL={user.photoURL} name={user.name} size="sm" />
                            {user.name}
                        </div>
                        <Link 
                            href="/admin" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: pathname === '/admin' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: pathname === '/admin' ? 600 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (pathname !== '/admin') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (pathname !== '/admin') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            ホーム
                        </Link>
                        <Link 
                            href="/admin/shifts" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: pathname === '/admin/shifts' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: pathname === '/admin/shifts' ? 600 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (pathname !== '/admin/shifts') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (pathname !== '/admin/shifts') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            シフト表
                        </Link>
                        <Link 
                            href="/admin/shift-change-requests" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: pathname === '/admin/shift-change-requests' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: pathname === '/admin/shift-change-requests' ? 600 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (pathname !== '/admin/shift-change-requests') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (pathname !== '/admin/shift-change-requests') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            変更申請
                        </Link>
                        <Link 
                            href="/admin/chat" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: pathname === '/admin/chat' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: pathname === '/admin/chat' ? 600 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (pathname !== '/admin/chat') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (pathname !== '/admin/chat') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            チャット
                        </Link>
                        <Link 
                            href="/admin/settings" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: pathname === '/admin/settings' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: pathname === '/admin/settings' ? 600 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (pathname !== '/admin/settings') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (pathname !== '/admin/settings') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            設定
                        </Link>
                        <button 
                            onClick={() => {
                                setShowMobileMenu(false);
                                handleLogout();
                            }}
                            className="menu-item-enter"
                            style={{ 
                                background: 'transparent', 
                                border: '1px solid #e0e7ff', 
                                color: '#e0e7ff', 
                                padding: '0.75rem 1rem', 
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                textAlign: 'left',
                                marginTop: '0.5rem',
                                transition: 'all 0.2s ease',
                                fontWeight: 500
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                e.currentTarget.style.borderColor = '#a5b4fc';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = '#e0e7ff';
                            }}
                        >
                            ログアウト
                        </button>
                    </div>
                )}
            </header>
            <main
                className="container container-wide"
                style={{
                    flex: 1,
                    padding: '2rem 1rem',
                    margin: '0 auto',
                    width: '100%',
                }}
            >
                {children}
            </main>
        </div>
    );
}
