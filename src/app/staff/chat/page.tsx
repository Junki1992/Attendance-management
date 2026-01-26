"use client";

import { useState, useEffect } from "react";
import ChatWindow from "@/components/ChatWindow";
import { getAdminId, getUserProfile } from "@/services/userService";

export default function StaffChatPage() {
    const [adminId, setAdminId] = useState<string | null>(null);
    const [adminName, setAdminName] = useState<string>("管理者");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // まず管理者のUIDを取得
        getAdminId().then((uid) => {
            if (uid) {
                setAdminId(uid);
                // 管理者のプロフィールを取得して名前を設定
                getUserProfile(uid).then((admin) => {
                    if (admin) {
                        setAdminName(admin.name || "管理者");
                    }
                    setLoading(false);
                }).catch((err) => {
                    console.error("Failed to get admin profile:", err);
                    setLoading(false);
                });
            } else {
                setLoading(false);
            }
        }).catch((err) => {
            console.error("Failed to get admin ID:", err);
            // エラーの詳細をログに出力
            if (process.env.NODE_ENV === "development") {
                console.error("Error details:", {
                    code: (err as { code?: string })?.code,
                    message: (err as { message?: string })?.message,
                });
            }
            setLoading(false);
        });
    }, []);

    if (loading) {
        return (
            <div style={{ width: '100%', maxWidth: '100%' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>管理者への連絡</h2>
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    読み込み中...
                </div>
            </div>
        );
    }

    if (!adminId) {
        return (
            <div style={{ width: '100%', maxWidth: '100%' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>管理者への連絡</h2>
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    管理者が見つかりませんでした
                </div>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', maxWidth: '100%' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>管理者への連絡</h2>
            <ChatWindow 
                partnerId={adminId} 
                partnerName={adminName} 
            />
        </div>
    );
}
