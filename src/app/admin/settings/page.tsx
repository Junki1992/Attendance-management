"use client";

import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/services/settingsService";
import { getAllUsers, updateUserRole, updateUserHourlyWage, UserProfile } from "@/services/userService";
import { createNotification } from "@/services/notificationService";
import { useAuth } from "@/context/AuthContext";
import ProfileImageUpload from "@/components/ProfileImageUpload";
import Avatar from "@/components/Avatar";

export default function AdminSettingsPage() {
  const { user: currentUser, refreshUserProfile } = useAuth();
  const [deadlineDay, setDeadlineDay] = useState(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [editingHourlyWage, setEditingHourlyWage] = useState<number>(1000);
  const [savingWage, setSavingWage] = useState(false);
  const [hourlyWageLocked, setHourlyWageLocked] = useState(true);

  useEffect(() => {
    getSettings().then((s) => {
      setDeadlineDay(s.shiftSubmitDeadlineDay);
      setLoading(false);
    }).catch(() => setLoading(false));
    
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const list = await getAllUsers();
      setUsers(list);
    } catch (err) {
      console.error(err);
      alert("ユーザー一覧の取得に失敗しました");
    } finally {
      setUsersLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Math.max(1, Math.min(28, Math.floor(Number(deadlineDay))));
    setDeadlineDay(v);
    setSaving(true);
    setSaved(false);
    try {
      await saveSettings({ shiftSubmitDeadlineDay: v });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (uid: string, newRole: "admin" | "staff") => {
    if (!confirm(`このユーザーを${newRole === "admin" ? "管理者" : "アルバイト"}に変更しますか？`)) {
      return;
    }
    setUpdatingUserId(uid);
    try {
      await updateUserRole(uid, newRole);
      await loadUsers();
      alert("変更しました");
    } catch (err) {
      console.error(err);
      alert("変更に失敗しました");
    } finally {
      setUpdatingUserId(null);
    }
  };

  // 詳細モーダルで選択中のユーザーが変わったら時給の編集値とロックを同期
  useEffect(() => {
    if (selectedUser) {
      setEditingHourlyWage(selectedUser.hourlyWage ?? 1000);
      setHourlyWageLocked(true);
    }
  }, [selectedUser?.uid, selectedUser?.hourlyWage]);

  const handleSaveHourlyWage = async () => {
    if (!selectedUser) return;
    const wage = Math.max(0, Math.floor(Number(editingHourlyWage)) || 0);
    setSavingWage(true);
    try {
      await updateUserHourlyWage(selectedUser.uid, wage);
      setEditingHourlyWage(wage);
      setHourlyWageLocked(true);
      await createNotification(
        selectedUser.uid,
        "hourly_wage_changed",
        `時給が¥${wage.toLocaleString()}に変更されました。確認してください。`
      );
      await loadUsers();
      const updated = (await getAllUsers()).find((u) => u.uid === selectedUser.uid) ?? null;
      if (updated) setSelectedUser(updated);
      alert("時給を保存しました");
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました");
    } finally {
      setSavingWage(false);
    }
  };

  if (loading) {
    return <div className="card">読み込み中...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {currentUser && (
        <div className="card" style={{ maxWidth: "400px" }}>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>自分のプロフィール</h2>
          <ProfileImageUpload
            uid={currentUser.uid}
            name={currentUser.name}
            photoURL={currentUser.photoURL}
            onSuccess={refreshUserProfile}
          />
        </div>
      )}
      <div className="card" style={{ maxWidth: "400px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>設定</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="deadline" style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              シフト提出締切日
            </label>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              各月の「何日」までにアルバイトがシフトを提出できるか。1〜28で指定。締切を過ぎるとアルバイトは編集できません。
            </p>
            <input
              id="deadline"
              type="number"
              min={1}
              max={28}
              value={deadlineDay}
              onChange={(e) => setDeadlineDay(Number(e.target.value) || 25)}
              style={{
                padding: "0.5rem",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                width: "80px",
                fontSize: "1rem",
              }}
            />
            <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>日</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "保存中..." : "保存する"}
            </button>
            {saved && <span style={{ color: "var(--secondary)", fontSize: "0.875rem" }}>保存しました</span>}
          </div>
        </form>
      </div>

      <div className="card" style={{ maxWidth: "600px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>ユーザー管理</h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          アルバイトを管理者に昇格させたり、管理者をアルバイトに降格させることができます。
        </p>

        {usersLoading ? (
          <div>読み込み中...</div>
        ) : users.length === 0 ? (
          <div style={{ color: "var(--text-muted)" }}>ユーザーが見つかりません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {users.map((user) => (
              <div
                key={user.uid}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: user.uid === currentUser?.uid ? "var(--bg-secondary)" : undefined,
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0, flex: 1 }}>
                  <Avatar photoURL={user.photoURL} name={user.name} size="md" />
                  <div style={{ minWidth: 0, overflow: "hidden" }}>
                    <div title={user.name} style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
                    <div title={user.email} style={{ fontSize: "0.875rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <span
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      backgroundColor: user.role === "admin" ? "var(--primary)" : "var(--bg-secondary)",
                      color: user.role === "admin" ? "white" : "var(--text)",
                      flexShrink: 0,
                    }}
                  >
                    {user.role === "admin" ? "管理者" : "アルバイト"}
                  </span>
                  {user.uid !== currentUser?.uid && (
                    <button
                      className="btn btn-outline"
                      style={{ fontSize: "0.875rem", padding: "0.25rem 0.5rem", flexShrink: 0 }}
                      onClick={() => handleRoleChange(user.uid, user.role === "admin" ? "staff" : "admin")}
                      disabled={updatingUserId === user.uid}
                    >
                      {updatingUserId === user.uid
                        ? "変更中..."
                        : user.role === "admin"
                        ? "アルバイトに降格"
                        : "管理者に昇格"}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginLeft: 4 }}
                    onClick={() => setSelectedUser(user)}
                    aria-label="ユーザー詳細を表示"
                  >
                    詳細
                  </button>
                  {user.uid === currentUser?.uid && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flexShrink: 0 }}>（自分）</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    {selectedUser && (
      <div
        role="dialog"
        aria-label="ユーザー詳細"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
          padding: "1rem",
        }}
        onClick={() => setSelectedUser(null)}
      >
        <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, padding: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>ユーザー詳細</h3>
            <button onClick={() => setSelectedUser(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18 }}>
              ×
            </button>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
            <Avatar photoURL={selectedUser!.photoURL} name={selectedUser!.name} size="md" />
            <div>
              <div style={{ fontWeight: 600 }}>{selectedUser!.name}</div>
              <div style={{ color: "var(--text-muted)" }}>{selectedUser!.email}</div>
            </div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>役割:</strong>{" "}
            <span style={{ padding: "0.25rem 0.5rem", borderRadius: 6, background: selectedUser!.role === "admin" ? "var(--primary)" : "var(--bg-secondary)", color: selectedUser!.role === "admin" ? "#fff" : "inherit" }}>
              {selectedUser!.role === "admin" ? "管理者" : "アルバイト"}
            </span>
          </div>
          {selectedUser!.role === "staff" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}>
                時給（円）
              </label>
              {hourlyWageLocked ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      padding: "0.5rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-secondary)",
                      fontSize: "1rem",
                      minWidth: "100px",
                      cursor: "not-allowed",
                      userSelect: "none",
                    }}
                    title="編集できません（錠前をクリックで解除）"
                  >
                    ¥{(selectedUser!.hourlyWage ?? 1000).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setHourlyWageLocked(false)}
                    title="ロック解除"
                    aria-label="ロック解除"
                    style={{ padding: "0.5rem 0.6rem", lineHeight: 1 }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <input
                      id="admin-hourly-wage"
                      type="number"
                      min={0}
                      value={editingHourlyWage}
                      onChange={(e) => setEditingHourlyWage(Math.max(0, Math.floor(Number(e.target.value)) || 0))}
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        width: "120px",
                        fontSize: "1rem",
                      }}
                    />
                    <span style={{ color: "var(--text-muted)" }}>円</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveHourlyWage}
                      disabled={savingWage}
                    >
                      {savingWage ? "保存中..." : "時給を保存"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setHourlyWageLocked(true);
                        setEditingHourlyWage(selectedUser!.hourlyWage ?? 1000);
                      }}
                      disabled={savingWage}
                      title="ロックして編集不可に戻す"
                      aria-label="ロック"
                      style={{ padding: "0.5rem 0.6rem", lineHeight: 1 }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                給与集計やアルバイトの概算給与に反映されます。編集する場合は錠前アイコンをクリックして解除してください。
              </p>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            {selectedUser!.uid !== currentUser?.uid && (
              <button
                className="btn btn-outline"
                onClick={async () => {
                  try {
                    setUpdatingUserId(selectedUser!.uid);
                    await handleRoleChange(selectedUser!.uid, selectedUser!.role === "admin" ? "staff" : "admin");
                    const updated = (await getAllUsers()).find((u) => u.uid === selectedUser!.uid) ?? null;
                    setSelectedUser(updated);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setUpdatingUserId(null);
                  }
                }}
                disabled={updatingUserId === selectedUser!.uid}
              >
                {updatingUserId === selectedUser!.uid ? "変更中..." : selectedUser!.role === "admin" ? "アルバイトに降格" : "管理者に昇格"}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setSelectedUser(null)}>閉じる</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
