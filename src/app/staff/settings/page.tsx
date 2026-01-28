"use client";

import { useAuth } from "@/context/AuthContext";
import ProfileImageUpload from "@/components/ProfileImageUpload";

export default function StaffSettingsPage() {
  const { user, refreshUserProfile } = useAuth();

  if (!user) {
    return <div className="card">読み込み中...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div className="card" style={{ maxWidth: "400px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>プロフィール画像</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          チャットや画面に表示されるアイコン画像を設定できます。
        </p>
        <ProfileImageUpload
          uid={user.uid}
          name={user.name}
          photoURL={user.photoURL}
          onSuccess={refreshUserProfile}
        />
      </div>
    </div>
  );
}
