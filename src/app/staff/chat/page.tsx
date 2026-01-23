"use client";

import ChatWindow from "@/components/ChatWindow";

export default function StaffChatPage() {
    // Hardcode Admin ID for now（総務 1 名想定）
    const ADMIN_ID = "admin-123";
    const ADMIN_NAME = "総務";

    return (
        <div style={{ width: '100%', maxWidth: '100%' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>総務への連絡</h2>
            <ChatWindow 
                partnerId={ADMIN_ID} 
                partnerName={ADMIN_NAME} 
            />
        </div>
    );
}
