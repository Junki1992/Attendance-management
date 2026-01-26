"use client";

import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/services/settingsService";
import { getAllUsers, updateUserRole, UserProfile } from "@/services/userService";
import { useAuth } from "@/context/AuthContext";

export default function AdminSettingsPage() {
  const { user: currentUser } = useAuth();
  const [deadlineDay, setDeadlineDay] = useState(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

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
    if (!confirm(`このユーザーを${newRole === "admin" ? "管理者" : "スタッフ"}に変更しますか？`)) {
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

  if (loading) {
    return <div className="card">読み込み中...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div className="card" style={{ maxWidth: "400px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>設定</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="deadline" style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              シフト提出締切日
            </label>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              各月の「何日」までにスタッフがシフトを提出できるか。1〜28で指定。締切を過ぎるとスタッフは編集できません。
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
          スタッフを管理者に昇格させたり、管理者をスタッフに降格させることができます。
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
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{user.name}</div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>{user.email}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      backgroundColor: user.role === "admin" ? "var(--primary)" : "var(--bg-secondary)",
                      color: user.role === "admin" ? "white" : "var(--text)",
                    }}
                  >
                    {user.role === "admin" ? "管理者" : "スタッフ"}
                  </span>
                  {user.uid !== currentUser?.uid && (
                    <button
                      className="btn btn-outline"
                      style={{ fontSize: "0.875rem", padding: "0.25rem 0.5rem" }}
                      onClick={() => handleRoleChange(user.uid, user.role === "admin" ? "staff" : "admin")}
                      disabled={updatingUserId === user.uid}
                    >
                      {updatingUserId === user.uid
                        ? "変更中..."
                        : user.role === "admin"
                        ? "スタッフに降格"
                        : "管理者に昇格"}
                    </button>
                  )}
                  {user.uid === currentUser?.uid && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>（自分）</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
