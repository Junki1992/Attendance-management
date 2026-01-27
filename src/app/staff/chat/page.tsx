"use client";

import { useState, useEffect } from "react";
import ChatWindow from "@/components/ChatWindow";
import { getAdminId, getUserProfile } from "@/services/userService";

export default function StaffChatPage() {
    const [adminId, setAdminId] = useState<string | null>(null);
    const [adminName, setAdminName] = useState<string>("管理者");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const isPermissionDenied = (err: unknown) => {
            const code = (err as { code?: string })?.code ?? "";
            const msg = String((err as { message?: string })?.message ?? err);
            return (
                code === "permission-denied" ||
                code === "missing-or-insufficient-permissions" ||
                msg.toLowerCase().includes("insufficient permissions")
            );
        };

        getAdminId().then((uid) => {
            if (uid) {
                setAdminId(uid);
                getUserProfile(uid).then((admin) => {
                    if (admin) {
                        setAdminName(admin.name || "管理者");
                    }
                    setLoading(false);
                }).catch((err) => {
                    if (!isPermissionDenied(err)) {
                        console.error("Failed to get admin profile:", err);
                    }
                    setLoading(false);
                });
            } else {
                setLoading(false);
            }
        }).catch((err) => {
            if (!isPermissionDenied(err)) {
                console.error("Failed to get admin ID:", err);
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
