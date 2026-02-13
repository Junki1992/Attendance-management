"use client";

import { useAuth } from "@/context/AuthContext";
import ProfileImageUpload from "@/components/ProfileImageUpload";
import { updateMyProfileNameAndChatwork } from "@/services/userService";
import { useState, useEffect } from "react";

export default function StaffSettingsPage() {
  const { user, refreshUserProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [chatworkAccountId, setChatworkAccountId] = useState(user?.chatworkAccountId ?? "");

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setChatworkAccountId(user.chatworkAccountId ?? "");
    }
  }, [user]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState(false);

  if (!user) {
    return <div className="card">読み込み中...</div>;
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess(false);
    if (!name.trim()) {
      setProfileError("名前を入力してください");
      return;
    }
    if (chatworkAccountId.trim() && !/^\d+$/.test(chatworkAccountId.trim())) {
      setProfileError("Chatwork アカウントIDは数字のみです（プロフィール→アカウントで確認）");
      return;
    }
    setProfileSaving(true);
    try {
      await updateMyProfileNameAndChatwork(user.uid, {
        name: name.trim(),
        chatworkAccountId: chatworkAccountId.trim() || undefined,
      });
      await refreshUserProfile();
      setProfileSuccess(true);
    } catch (err) {
      setProfileError("保存に失敗しました");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div className="card" style={{ maxWidth: "400px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>名前・Chatwork</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          Googleでログインした方もここで名前やChatworkアカウントIDを登録・変更できます。Chatwork IDを設定すると通知でメンションされます。
        </p>
        <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label htmlFor="staff-name" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
              名前
            </label>
            <input
              id="staff-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="表示名"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label htmlFor="staff-chatwork" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
              Chatwork アカウントID（数字）
            </label>
            <input
              id="staff-chatwork"
              type="text"
              inputMode="numeric"
              value={chatworkAccountId}
              onChange={(e) => setChatworkAccountId(e.target.value.replace(/\D/g, ""))}
              placeholder="未設定の場合は空欄でOK"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          {profileError && <p style={{ color: "var(--destructive)", fontSize: "0.875rem", margin: 0 }}>{profileError}</p>}
          {profileSuccess && <p style={{ color: "var(--primary)", fontSize: "0.875rem", margin: 0 }}>保存しました</p>}
          <button type="submit" className="btn btn-primary" disabled={profileSaving} style={{ alignSelf: "flex-start" }}>
            {profileSaving ? "保存中..." : "保存"}
          </button>
        </form>
      </div>

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
