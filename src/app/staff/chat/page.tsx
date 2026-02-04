"use client";

import { useState, useEffect } from "react";
import ChatWindow from "@/components/ChatWindow";
import { getAdminIds, getUserProfile } from "@/services/userService";
import { useAuth } from "@/context/AuthContext";

export default function StaffChatPage() {
    const { user } = useAuth();
    const [adminIds, setAdminIds] = useState<string[]>([]);
    const [adminName, setAdminName] = useState<string>("管理者");
    const [adminPhotoURL, setAdminPhotoURL] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            if (process.env.NODE_ENV === 'development') {
                console.log('[staff/chat] isMobile:', mobile, 'width:', window.innerWidth);
            }
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // 認証済みユーザーが確定してから管理者一覧を取得（auth.currentUser が null だと getAdminIds が空を返す）
    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        const isPermissionDenied = (err: unknown) => {
            const code = (err as { code?: string })?.code ?? "";
            const msg = String((err as { message?: string })?.message ?? err);
            return (
                code === "permission-denied" ||
                code === "missing-or-insufficient-permissions" ||
                msg.toLowerCase().includes("insufficient permissions")
            );
        };

        getAdminIds().then((ids) => {
            setAdminIds(ids);
            const first = ids[0];
            if (first) {
                getUserProfile(first).then((admin) => {
                    if (admin) {
                        setAdminName(admin.name || "管理者");
                        setAdminPhotoURL(admin.photoURL ?? null);
                    }
                    setLoading(false);
                    setError(null);
                }).catch((err) => {
                    if (!isPermissionDenied(err)) {
                        console.error("Failed to get admin profile:", err);
                        setError("管理者情報の取得に失敗しました");
                    }
                    setLoading(false);
                });
            } else {
                setError("管理者が見つかりませんでした。管理者が登録されているか確認してください。");
                setLoading(false);
            }
        }).catch((err) => {
            if (!isPermissionDenied(err)) {
                console.error("Failed to get admin IDs:", err);
                setError("管理者の取得に失敗しました");
            } else {
                setError("管理者の取得に失敗しました（権限エラー）");
            }
            setLoading(false);
        });
    }, [user]);

    useEffect(() => {
        // 横スクロールを完全に防止する
        const preventHorizontalScroll = () => {
            if (window.scrollX !== 0) {
                window.scrollTo(0, window.scrollY);
            }
            document.documentElement.scrollLeft = 0;
            document.body.scrollLeft = 0;
            
            // すべての要素のscrollLeftも0に
            const allElements = document.querySelectorAll('*');
            allElements.forEach((el) => {
                if (el instanceof HTMLElement && el.scrollLeft !== 0) {
                    el.scrollLeft = 0;
                }
            });
        };
        
        // 即座に実行
        preventHorizontalScroll();
        
        // 定期的にチェック
        const interval = setInterval(preventHorizontalScroll, 50);
        
        window.addEventListener('scroll', preventHorizontalScroll, { passive: true });
        window.addEventListener('resize', preventHorizontalScroll);
        window.addEventListener('wheel', (e) => {
            if (e.deltaX !== 0) {
                e.preventDefault();
            }
        }, { passive: false });
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('scroll', preventHorizontalScroll);
            window.removeEventListener('resize', preventHorizontalScroll);
        };
    }, []);

    if (!user) {
        return (
            <div style={{ 
                width: '100%', 
                height: '100vh', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: 'var(--surface)',
                padding: '1rem',
            }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    ログインしてください
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{ 
                width: '100%', 
                height: '100vh', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: 'var(--surface)',
            }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    読み込み中...
                </div>
            </div>
        );
    }

    if (error || adminIds.length === 0) {
        return (
            <div style={{ 
                width: '100%', 
                height: '100vh', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: 'var(--surface)',
                padding: '1rem',
            }}>
                <div style={{ 
                    textAlign: 'center', 
                    color: 'var(--text-main)',
                    maxWidth: '400px',
                }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem', fontWeight: 600 }}>
                        {error || "管理者が見つかりませんでした"}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        管理者が登録されているか確認してください。
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div 
            id="staff-chat-container"
            style={{ 
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 0, 
                margin: 0, 
                boxSizing: 'border-box', 
                overflow: 'hidden',
                backgroundColor: 'var(--surface)',
                zIndex: 0,
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: isMobile ? '100%' : 1200,
                    margin: '0 auto',
                    padding: isMobile ? 0 : '0 1rem',
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    boxSizing: 'border-box',
                }}
            >
            {adminIds.length > 0 && (
                <ChatWindow
                    partnerId={adminIds[0]}
                    partnerIds={adminIds}
                    partnerName={adminName}
                    partnerPhotoURL={adminPhotoURL}
                    subscribeAllForMe
                    showBackButton
                    forceFullWidth
                />
            )}
            </div>
        </div>
    );
}
