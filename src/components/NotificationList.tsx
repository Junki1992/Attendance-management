"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Notification, subscribeNotifications, markAsRead } from "@/services/notificationService";

export default function NotificationList({ onClose }: { onClose: () => void }) {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    
    useEffect(() => {
        if (!user) return;
        
        const unsubscribe = subscribeNotifications(user.uid, (data) => {
            setNotifications(data);
        });
        
        return () => unsubscribe();
    }, [user]);
    
    const handleRead = async (n: Notification) => {
        if (!n.read && n.id) {
            await markAsRead(n.id);
        }
        // Optional: navigate to relevant page if needed
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
                                    {n.type === 'shift_confirmed' ? 'シフト確定' : 'お知らせ'}
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
