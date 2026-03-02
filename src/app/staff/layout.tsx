"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import NotificationList from "@/components/NotificationList";
import Avatar from "@/components/Avatar";
import ProfileImageUpload from "@/components/ProfileImageUpload";
import { subscribeNotifications, ensureChatworkIdReminderNotification } from "@/services/notificationService";
import { updatePresence } from "@/services/presenceService";

export default function StaffLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, loading, logout, refreshUserProfile } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [showNotifications, setShowNotifications] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
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

    useEffect(() => {
        if (user?.role === "staff" && String(user?.chatworkAccountId ?? "").trim() === "") {
            ensureChatworkIdReminderNotification(user.uid).catch(() => {});
        }
    }, [user?.uid, user?.role, user?.chatworkAccountId]);

    useEffect(() => {
        if (!user || user.role !== "staff") return;
        updatePresence(user.uid).catch(() => {});
        const interval = setInterval(() => updatePresence(user.uid).catch(() => {}), 30000);
        return () => clearInterval(interval);
    }, [user?.uid, user?.role]);

    useEffect(() => {
        if (pathname.replace(/\/$/, "") === '/staff/chat') {
            // グローバルCSSクラスを適用して確実にスクロールを無効化
            document.documentElement.classList.add('chat-fullscreen');
            
            // 横スクロールを強制的に防ぐ
            const preventHorizontalScroll = () => {
                if (window.scrollX !== 0) {
                    window.scrollTo(0, window.scrollY);
                }
                document.documentElement.scrollLeft = 0;
                document.body.scrollLeft = 0;
            };
            
            // 定期的にチェック
            const interval = setInterval(preventHorizontalScroll, 100);
            
            // イベントリスナーも追加
            window.addEventListener('scroll', preventHorizontalScroll, { passive: true });
            window.addEventListener('resize', preventHorizontalScroll);
            
            return () => {
                document.documentElement.classList.remove('chat-fullscreen');
                clearInterval(interval);
                window.removeEventListener('scroll', preventHorizontalScroll);
                window.removeEventListener('resize', preventHorizontalScroll);
            };
        }
    }, [pathname]);

    if (loading || !user) return <div className="p-4 text-center">Loading...</div>;

    const path = pathname.replace(/\/$/, "") || "/";
    const isWide = path === "/staff/shifts" || path === "/staff/confirmed-shifts" || path === "/staff/chat";

    const isChatPage = path === '/staff/chat';
    const isChatMobile = isChatPage && isMobile;

    return (
        <div style={{ 
            minHeight: '100vh',
            height: isChatPage ? '100vh' : undefined,
            display: 'flex', 
            flexDirection: 'column',
            overflowX: 'hidden',
            overflowY: isChatPage ? 'hidden' : undefined,
            width: '100%',
            maxWidth: '100vw',
            margin: 0,
            padding: 0,
            boxSizing: 'border-box',
        }}>
            <header style={{
                backgroundColor: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                padding: isMobile ? '0.75rem max(1rem, env(safe-area-inset-left)) 0.75rem max(1rem, env(safe-area-inset-right))' : '0.75rem 1rem',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 100,
                width: '100%',
                boxSizing: 'border-box',
            }}>
                {/* モバイル用ヘッダー */}
                {isMobile && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>勤怠入力</h1>
                        <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: 'var(--primary)', color: 'white', fontWeight: 600 }}>アルバイト</span>
                    </div>
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
                            className={`hamburger-icon ${showMobileMenu ? 'open' : ''}`}
                            style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                padding: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-main)',
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
                <div className={`container ${isWide ? 'container-wide' : ''}`} style={{ 
                    display: 'flex',
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    minWidth: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>勤怠入力</h1>
                        <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: 'var(--primary)', color: 'white', fontWeight: 600 }}>アルバイト</span>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setShowProfileMenu(true)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowProfileMenu(true); } }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.25rem 0' }}
                        >
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
                        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                            <Link href="/staff" style={{ textDecoration: 'none', color: path === '/staff' ? 'var(--primary)' : 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/staff' ? '2px solid var(--primary)' : '2px solid transparent' }}>ホーム</Link>
                            <Link href="/staff/shifts" style={{ textDecoration: 'none', color: path === '/staff/shifts' ? 'var(--primary)' : 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/staff/shifts' ? '2px solid var(--primary)' : '2px solid transparent' }}>シフト提出</Link>
                            <Link href="/staff/confirmed-shifts" style={{ textDecoration: 'none', color: path === '/staff/confirmed-shifts' ? 'var(--primary)' : 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/staff/confirmed-shifts' ? '2px solid var(--primary)' : '2px solid transparent' }}>確定シフト</Link>
                            <Link href="/staff/chat" style={{ textDecoration: 'none', color: path === '/staff/chat' ? 'var(--primary)' : 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/staff/chat' ? '2px solid var(--primary)' : '2px solid transparent' }}>チャット</Link>
                            <Link href="/staff/settings" style={{ textDecoration: 'none', color: path === '/staff/settings' ? 'var(--primary)' : 'var(--text-main)', fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600, padding: '0.25rem 0', borderBottom: path === '/staff/settings' ? '2px solid var(--primary)' : '2px solid transparent' }}>設定</Link>
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
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => { setShowProfileMenu(true); setShowMobileMenu(false); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowProfileMenu(true); setShowMobileMenu(false); } }}
                            className="menu-item-enter"
                            style={{ 
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                fontSize: '0.9rem', 
                                color: 'var(--text-muted)', 
                                marginBottom: '0.25rem',
                                padding: '0.5rem 0.75rem',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            <Avatar photoURL={user.photoURL} name={user.name} size="sm" />
                            {user.name}
                        </div>
                        <Link 
                            href="/staff" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: path === '/staff' ? 'var(--surface-hover)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/staff') {
                                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/staff') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            ホーム
                        </Link>
                        <Link 
                            href="/staff/shifts" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: path === '/staff/shifts' ? 'var(--surface-hover)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/staff/shifts') {
                                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/staff/shifts') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            シフト提出
                        </Link>
                        <Link 
                            href="/staff/confirmed-shifts" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: path === '/staff/confirmed-shifts' ? 'var(--surface-hover)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/staff/confirmed-shifts') {
                                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/staff/confirmed-shifts') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            確定シフト
                        </Link>
                        <Link 
                            href="/staff/chat" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: path === '/staff/chat' ? 'var(--surface-hover)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/staff/chat') {
                                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (path !== '/staff/chat') {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            チャット
                        </Link>
                        <Link 
                            href="/staff/settings" 
                            onClick={() => setShowMobileMenu(false)}
                            className="menu-item-enter"
                            style={{ 
                                textDecoration: 'none', 
                                color: 'var(--text-main)', 
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                backgroundColor: path === '/staff/settings' ? 'var(--surface-hover)' : 'transparent',
                                transition: 'all 0.2s ease',
                                fontWeight: 600
                            }}
                            onMouseEnter={(e) => {
                                if (path !== '/staff/settings') {
                                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = path === '/staff/settings' ? 'var(--surface-hover)' : 'transparent';
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
                                border: '1px solid var(--border)', 
                                color: 'var(--text-main)', 
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
                                e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                                e.currentTarget.style.borderColor = 'var(--primary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = 'var(--border)';
                            }}
                        >
                            ログアウト
                        </button>
                    </div>
                )}
            </header>
            <main
                className={isChatPage ? '' : (isWide ? '' : 'container')}
                style={{
                    flex: isChatPage ? '1 1 0' : 1,
                    padding: isChatPage ? '0 1rem' : '2rem max(1rem, env(safe-area-inset-left)) 2rem max(1rem, env(safe-area-inset-right))',
                    paddingTop: isChatPage ? '3.5rem' : 'calc(3.5rem + 2rem)',
                    maxWidth: isWide ? '1600px' : undefined,
                    marginLeft: isWide ? 'auto' : undefined,
                    marginRight: isWide ? 'auto' : undefined,
                    width: '100%',
                    minWidth: 0,
                    height: isChatPage ? '100%' : undefined,
                    minHeight: isChatPage ? 0 : undefined,
                    display: isChatPage ? 'flex' : 'block',
                    flexDirection: isChatPage ? 'column' : undefined,
                    overflowX: 'hidden',
                    overflowY: isChatPage ? 'hidden' : undefined,
                    position: isChatPage ? 'relative' : undefined,
                    boxSizing: 'border-box',
                }}
            >
                {children}
            </main>

            {showProfileMenu && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(0,0,0,0.4)',
                            zIndex: 100,
                        }}
                        onClick={() => setShowProfileMenu(false)}
                        aria-hidden
                    />
                    <div
                        role="dialog"
                        aria-label="プロフィール画像"
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            zIndex: 101,
                            padding: '1.5rem',
                            minWidth: '280px',
                            maxWidth: '90%',
                            backgroundColor: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '0.75rem',
                            boxShadow: 'var(--shadow-lg)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '1rem' }}>プロフィール画像</span>
                            <button
                                type="button"
                                onClick={() => setShowProfileMenu(false)}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1, color: 'var(--text-muted)' }}
                                aria-label="閉じる"
                            >
                                ×
                            </button>
                        </div>
                        <ProfileImageUpload
                            uid={user.uid}
                            name={user.name}
                            photoURL={user.photoURL}
                            size="md"
                            onSuccess={() => { refreshUserProfile(); setShowProfileMenu(false); }}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
