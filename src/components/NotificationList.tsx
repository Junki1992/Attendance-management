"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Notification, subscribeNotifications, markAsRead } from "@/services/notificationService";

export default function NotificationList({ onClose }: { onClose: () => void }) {
    const { user } = useAuth();
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    
    useEffect(() => {
        if (!user) return;
        
        if (process.env.NODE_ENV === "development") {
            console.log("[NotificationList] Subscribing to notifications for user:", user.uid);
        }
        
        const unsubscribe = subscribeNotifications(user.uid, (data) => {
            if (process.env.NODE_ENV === "development") {
                console.log("[NotificationList] Received notifications:", data.length);
            }
            setNotifications(data);
        });
        
        return () => unsubscribe();
    }, [user]);
    
    const handleRead = async (n: Notification) => {
        if (!n.read && n.id) {
            await markAsRead(n.id);
        }
        
        // 通知タイプに応じて適切なページに遷移
        if (!user) return;
        
        onClose(); // 通知一覧を閉じる
        
        if (n.type === 'shift_confirmed') {
            // シフト確定通知 → 確定シフトページ
            if (user.role === 'staff') {
                router.push('/staff/confirmed-shifts');
            } else if (user.role === 'admin') {
                router.push('/admin/shifts');
            }
        } else if (n.type === 'remind_submit') {
            // シフト提出催促通知 → シフト提出ページ
            if (user.role === 'staff') {
                router.push('/staff/shifts');
            }
        } else if (n.type === 'message') {
            // メッセージ通知 → チャットページ
            if (user.role === 'staff') {
                router.push('/staff/chat');
            } else if (user.role === 'admin') {
                router.push('/admin/chat');
            }
        } else if (n.type === 'shift_submitted') {
            // シフト提出通知 → 管理者はシフト表ページへ
            if (user.role === 'admin') {
                router.push('/admin/shifts');
            }
        } else if (n.type === 'shift_rejected') {
            // シフト却下通知 → スタッフはシフト提出ページで修正・再提出
            if (user.role === 'staff') {
                router.push('/staff/shifts');
            }
        } else if (n.type === 'shift_unconfirmed') {
            // 確定取り消し通知 → スタッフはシフト提出ページで再編集
            if (user.role === 'staff') {
                router.push('/staff/shifts');
            }
        } else if (n.type === 'shift_change_request') {
            // 変更申請通知 → 管理者は変更申請ページへ
            if (user.role === 'admin') {
                router.push('/admin/shift-change-requests');
            }
        } else if (n.type === 'shift_change_approved' || n.type === 'shift_change_rejected') {
            // 変更申請の承認/却下結果 → スタッフは確定シフトページへ
            if (user.role === 'staff') {
                router.push('/staff/confirmed-shifts');
            }
        } else if (n.type === 'hourly_wage_changed') {
            // 時給変更通知 → スタッフは確定シフトページへ（給与表示あり）
            if (user.role === 'staff') {
                router.push('/staff/confirmed-shifts');
            }
        } else if (n.type === 'deadline_changed') {
            // 締切変更通知 → スタッフはダッシュボードへ（締切表示あり）
            if (user.role === 'staff') {
                router.push('/staff');
            }
        } else if (n.type === 'chatwork_id_required') {
            if (user.role === 'staff') {
                router.push('/staff/settings');
            }
        }
    };

    return (
        <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: '300px',
            maxHeight: '400px',
            overflowY: 'auto',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            borderRadius: '0.5rem',
            padding: '0.5rem',
            zIndex: 50
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>通知</h3>
                <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {notifications.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        通知はありません
                    </div>
                ) : (
                    notifications.map(n => (
                        <div 
                            key={n.id}
                            onClick={() => handleRead(n)}
                            style={{
                                padding: '0.75rem',
                                borderBottom: '1px solid var(--border)',
                                cursor: 'pointer',
                                backgroundColor: n.read ? 'transparent' : 'var(--surface-hover)',
                                transition: 'background-color 0.2s',
                                fontSize: '0.85rem'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                <span style={{ 
                                    fontWeight: 600, 
                                    color: n.read ? 'var(--text-muted)' : 'var(--primary)',
                                    fontSize: '0.75rem' 
                                }}>
                                    {n.type === 'shift_confirmed' ? 'シフト確定' : n.type === 'shift_rejected' ? 'シフト却下' : n.type === 'shift_unconfirmed' ? '確定取り消し' : n.type === 'shift_submitted' ? 'シフト提出' : n.type === 'message' ? 'メッセージ' : n.type === 'shift_change_request' ? '変更申請' : n.type === 'shift_change_approved' ? '変更承認' : n.type === 'shift_change_rejected' ? '変更却下' : n.type === 'hourly_wage_changed' ? '時給変更' : n.type === 'deadline_changed' ? '締切変更' : n.type === 'chatwork_id_required' ? 'Chatwork ID未設定' : n.type === 'remind_submit' ? '提出催促' : 'お知らせ'}
                                </span>
                                {!n.read && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary)' }}></span>}
                            </div>
                            <div style={{ color: n.read ? 'var(--text-muted)' : 'var(--text-main)', lineHeight: '1.4' }}>
                                {n.message}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.25rem', textAlign: 'right' }}>
                                {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString() : ''}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
