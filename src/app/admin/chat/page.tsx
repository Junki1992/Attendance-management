"use client";

import { useState, useEffect, useMemo } from "react";
import ChatWindow from "@/components/ChatWindow";
import Avatar from "@/components/Avatar";
import { getAllStaff, StaffItem } from "@/services/userService";
import { useAuth } from "@/context/AuthContext";
import { subscribeNotifications } from "@/services/notificationService";
import { subscribePresence } from "@/services/presenceService";

const MOBILE_BREAKPOINT = 768;

export default function AdminChatPage() {
    const { user } = useAuth();
    const [staffList, setStaffList] = useState<StaffItem[]>([]);
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [notifications, setNotifications] = useState<{ type: string; read: boolean; senderId?: string }[]>([]);
    const [onlineStaffIds, setOnlineStaffIds] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (user?.role !== "admin") return;
        getAllStaff().then(setStaffList);
    }, [user?.role]);

    useEffect(() => {
        if (user?.role !== "admin" || staffList.length === 0) return;
        const staffIds = staffList.map((s) => s.id).filter(Boolean);
        return subscribePresence(staffIds, setOnlineStaffIds);
    }, [user?.role, staffList]);

    useEffect(() => {
        if (!user?.uid) return;
        const unsub = subscribeNotifications(user.uid, (list) => {
            setNotifications(list.map((n) => ({ type: n.type, read: n.read ?? false, senderId: n.senderId })));
        });
        return () => unsub();
    }, [user?.uid]);

    /** アルバイトIDごとの未読メッセージ通知件数 */
    const unreadCountByStaffId = useMemo(() => {
        const count: Record<string, number> = {};
        notifications.forEach((n) => {
            if (n.type === "message" && !n.read && n.senderId) {
                count[n.senderId] = (count[n.senderId] ?? 0) + 1;
            }
        });
        return count;
    }, [notifications]);

    useEffect(() => {
        const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

    const staffListPanel = (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                height: isMobile ? "100%" : undefined,
                minHeight: isMobile ? "calc(100vh - 120px)" : 0,
                ...(isMobile ? { flex: 1, minWidth: 0 } : { width: "250px" }),
            }}
        >
            <div
                style={{
                    padding: "1rem",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    backgroundColor: "var(--surface-hover)",
                    flexShrink: 0,
                }}
            >
                アルバイト一覧
            </div>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {staffList.map((staff) => (
                    <div
                        key={staff.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedStaffId(staff.id)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedStaffId(staff.id);
                            }
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.75rem",
                            padding: "1rem 1.25rem",
                            borderBottom: "1px solid var(--border)",
                            cursor: "pointer",
                            backgroundColor: selectedStaffId === staff.id ? "#EEF2FF" : "transparent",
                            color: selectedStaffId === staff.id ? "var(--primary)" : "inherit",
                            fontWeight: selectedStaffId === staff.id ? 600 : 400,
                            transition: "background-color 0.15s ease",
                        }}
                    >
                        <div style={{ position: "relative", flexShrink: 0 }}>
                            <Avatar photoURL={staff.photoURL} name={staff.name} size="sm" />
                            {onlineStaffIds[staff.id] && (
                                <span
                                    title="オンライン"
                                    style={{
                                        position: "absolute",
                                        bottom: 0,
                                        right: 0,
                                        width: "10px",
                                        height: "10px",
                                        borderRadius: "50%",
                                        backgroundColor: "#22c55e",
                                        border: "2px solid var(--surface)",
                                    }}
                                    aria-label="オンライン"
                                />
                            )}
                        </div>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {staff.name}
                        </span>
                        {(unreadCountByStaffId[staff.id] ?? 0) > 0 && (
                            <span
                                title={`未読 ${unreadCountByStaffId[staff.id]}件`}
                                style={{
                                    minWidth: "20px",
                                    height: "20px",
                                    padding: "0 6px",
                                    borderRadius: "10px",
                                    backgroundColor: "var(--destructive, #ef4444)",
                                    color: "#fff",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                                aria-label={`未読 ${unreadCountByStaffId[staff.id]}件`}
                            >
                                {unreadCountByStaffId[staff.id]! > 99 ? "99+" : unreadCountByStaffId[staff.id]}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );

    const placeholderPanel = (
        <div
            style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1.5rem",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
            }}
        >
            <p
                style={{
                    margin: 0,
                    color: "var(--text-muted)",
                    fontSize: isMobile ? "0.95rem" : "1rem",
                    lineHeight: 1.6,
                    textAlign: "center",
                    maxWidth: "320px",
                    whiteSpace: isMobile ? "pre-line" : "normal",
                    writingMode: "horizontal-tb",
                }}
            >
                {isMobile
                    ? "アルバイトをタップして\nチャットを開始してください"
                    : "左のリストからアルバイトを選択してください"}
            </p>
        </div>
    );

    const chatPanel = selectedStaff ? (
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {isMobile && (
                <button
                    type="button"
                    onClick={() => setSelectedStaffId(null)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.5rem",
                        padding: "0.5rem 0",
                        border: "none",
                        background: "none",
                        color: "var(--primary)",
                        fontSize: "0.9rem",
                        cursor: "pointer",
                        fontWeight: 500,
                    }}
                    aria-label="アルバイト一覧に戻る"
                >
                    <span style={{ fontSize: "1.2rem" }}>←</span>
                    アルバイト一覧
                </button>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
                    <ChatWindow
                    partnerId={selectedStaff.id}
                    partnerName={selectedStaff.name}
                    partnerPhotoURL={selectedStaff.photoURL}
                    className="h-full"
                />
            </div>
        </div>
    ) : (
        placeholderPanel
    );

    if (isMobile) {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    height: "calc(100vh - 100px)",
                    minHeight: 0,
                    padding: "0 0.5rem",
                }}
            >
                {selectedStaff ? (
                    chatPanel
                ) : (
                    staffListPanel
                )}
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                gap: "1rem",
                height: "calc(100vh - 100px)",
                minHeight: 0,
            }}
        >
            {staffListPanel}
            {chatPanel}
        </div>
    );
}
