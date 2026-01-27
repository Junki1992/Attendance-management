"use client";

import { useState, useEffect } from "react";
import ChatWindow from "@/components/ChatWindow";
import { getAllStaff, StaffItem } from "@/services/userService";
import { useAuth } from "@/context/AuthContext";

export default function AdminChatPage() {
    const { user } = useAuth();
    const [staffList, setStaffList] = useState<StaffItem[]>([]);
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

    useEffect(() => {
        // 一般アカウント（スタッフ）で/admin/chatに来た場合、getAllStaff()は
        // 「role==staff」のユーザーを読もうとして permission-denied になる。
        // 管理者のときだけスタッフ一覧を取得する。
        if (user?.role !== "admin") return;
        getAllStaff().then(setStaffList);
    }, [user?.role]);

    const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

    return (
        <div style={{ display: 'flex', gap: '1rem', height: 'calc(100vh - 100px)' }}>
            {/* Sidebar: Staff List */}
            <div style={{ 
                width: '250px', 
                backgroundColor: 'var(--surface)', 
                border: '1px solid var(--border)', 
                borderRadius: '0.5rem',
                display: 'flex', 
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', fontWeight: 600, backgroundColor: 'var(--surface-hover)' }}>
                    スタッフ一覧
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {staffList.map(staff => (
                        <div 
                            key={staff.id}
                            onClick={() => setSelectedStaffId(staff.id)}
                            style={{
                                padding: '1rem',
                                borderBottom: '1px solid var(--border)',
                                cursor: 'pointer',
                                backgroundColor: selectedStaffId === staff.id ? '#EEF2FF' : 'transparent',
                                color: selectedStaffId === staff.id ? 'var(--primary)' : 'inherit',
                                fontWeight: selectedStaffId === staff.id ? 500 : 400,
                            }}
                        >
                            {staff.name}
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Chat Window */}
            <div style={{ flex: 1 }}>
                {selectedStaff ? (
                    <ChatWindow 
                        partnerId={selectedStaff.id} 
                        partnerName={selectedStaff.name} 
                        className="h-full"
                    />
                ) : (
                    <div style={{ 
                        height: '100%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem'
                    }}>
                        左のリストからスタッフを選択してください
                    </div>
                )}
            </div>
        </div>
    );
}
