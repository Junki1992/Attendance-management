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
    const [unreadMessageCount, setUnreadMessageCount] = useState(0);
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
            setUnreadMessageCount(notifs.filter(n => n.type === "message" && !n.read).length);
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

    const path = pathname.replace(/\/$/, "") || "/";
    const isWide = path === "/admin/chat";

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{
                backgroundColor: '#1e1b4b', /* Indigo 950 */
                color: 'white',
                padding: '0.75rem 1rem',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 100,
            }}>
                {/* モバイル用ヘッダー */}
                {isMobile && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    gap: '0.5rem',
                    minWidth: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        <h1 style={{ fontSize: '1rem', fontWeight: 600, whiteSpace: 'nowrap' }}>管理画面</h1>
                        <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.2)', fontWeight: 600, flexShrink: 0 }}>管理者</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0, minWidth: 0, padding: '0.25rem 0.5rem', borderRadius: '9999px', backgroundColor: 'rgba(255,255,255,0.15)' }} title="ログイン中">
                            <Avatar photoURL={user.photoURL} name={user.name} size="sm" />
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>{user.name}</span>
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
                    alignItems: 'center',
                    minWidth: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>管理画面</h1>
                        <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>管理者</span>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
                        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                            <Link href="/admin" style={{ textDecoration: 'none', color: path === '/admin' ? '#fff' : '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/admin' ? '2px solid #fff' : '2px solid transparent' }}>ホーム</Link>
                            <Link href="/admin/shifts" style={{ textDecoration: 'none', color: path === '/admin/shifts' ? '#fff' : '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/admin/shifts' ? '2px solid #fff' : '2px solid transparent' }}>シフト表</Link>
                            <Link href="/admin/shift-change-requests" style={{ textDecoration: 'none', color: path === '/admin/shift-change-requests' ? '#fff' : '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/admin/shift-change-requests' ? '2px solid #fff' : '2px solid transparent' }}>変更申請</Link>
                            <Link href="/admin/chat" style={{ textDecoration: 'none', color: path === '/admin/chat' ? '#fff' : '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/admin/chat' ? '2px solid #fff' : '2px solid transparent', position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                チャット
                                {unreadMessageCount > 0 && (
                                    <span style={{ backgroundColor: '#ef4444', color: 'white', fontSize: '0.6rem', minWidth: '16px', height: '16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', fontWeight: 600 }}>
                                        {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                                    </span>
                                )}
                            </Link>
                            <Link href="/admin/settings" style={{ textDecoration: 'none', color: path === '/admin/settings' ? '#fff' : '#e0e7ff', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/admin/settings' ? '2px solid #fff' : '2px solid transparent' }}>設定</Link>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', marginLeft: '0.5rem', borderRadius: '9999px', backgroundColor: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }} title="ログイン中">
                                <Avatar photoURL={user.photoURL} name={user.name} size="sm" />
                                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{user.name}</span>
                            </div>
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
                                    whiteSpace: 'nowrap',
                                    fontWeight: 600
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
                                backgroundColor: path === '/admin' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/admin') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/admin') {
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
                                backgroundColor: path === '/admin/shifts' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/admin/shifts') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/admin/shifts') {
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
                                backgroundColor: path === '/admin/shift-change-requests' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/admin/shift-change-requests') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/admin/shift-change-requests') {
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
                                backgroundColor: path === '/admin/chat' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/admin/chat') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/admin/chat') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            チャット
                            {unreadMessageCount > 0 && (
                                <span style={{ backgroundColor: '#ef4444', color: 'white', fontSize: '0.65rem', minWidth: '18px', height: '18px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', fontWeight: 600 }}>
                                    {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                                </span>
                            )}
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
                                backgroundColor: path === '/admin/settings' ? 'rgba(224, 231, 255, 0.15)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/admin/settings') {
                                    e.currentTarget.style.backgroundColor = 'rgba(224, 231, 255, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/admin/settings') {
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
                                fontWeight: 600
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
                    paddingTop: 'calc(3.5rem + 2rem)',
                }}
            >
                {children}
            </main>
        </div>
    );
}
