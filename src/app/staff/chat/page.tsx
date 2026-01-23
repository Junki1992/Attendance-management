"use client";

import ChatWindow from "@/components/ChatWindow";

export default function StaffChatPage() {
    // Hardcode Admin ID for now (assuming single store manager model)
    const ADMIN_ID = "admin-123";
    const ADMIN_NAME = "店長";

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>店長への連絡</h2>
            <ChatWindow 
                partnerId={ADMIN_ID} 
                partnerName={ADMIN_NAME} 
            />
        </div>
    );
}
