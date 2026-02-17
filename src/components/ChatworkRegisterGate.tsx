"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { updateMyProfileNameAndChatwork } from "@/services/userService";

/**
 * Googleログインで Chatwork ID が未設定のユーザーに表示する登録フォーム。
 * 登録するまで先に進めない。
 */
export default function ChatworkRegisterGate() {
  const { user, refreshUserProfile } = useAuth();
  const [chatworkAccountId, setChatworkAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const idStr = String(chatworkAccountId ?? "").trim();
    if (!idStr) {
      setError("Chatwork アカウントIDを入力してください");
      return;
    }
    if (!/^\d+$/.test(idStr)) {
      setError("Chatwork アカウントIDは数字のみです（プロフィール→アカウントで確認）");
      return;
    }
    setSaving(true);
    try {
      await updateMyProfileNameAndChatwork(user.uid, { chatworkAccountId: idStr });
      await refreshUserProfile();
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        boxSizing: "border-box",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="card" style={{ maxWidth: "400px", width: "100%" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
          Chatwork アカウントIDの登録
        </h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
          Googleでログインしました。通知でメンションを受け取るため、Chatwork アカウントIDを登録してください。登録しないと利用を続けられません。
        </p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label
              htmlFor="gate-chatwork"
              style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}
            >
              Chatwork アカウントID（数字）
            </label>
            <input
              id="gate-chatwork"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={chatworkAccountId}
              onChange={(e) => setChatworkAccountId(e.target.value.replace(/\D/g, ""))}
              placeholder="例: 123456789"
              style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
              disabled={saving}
            />
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Chatwork の「設定」→「プロフィール」→「アカウント」で確認できます。
            </p>
          </div>
          {error && (
            <p style={{ fontSize: "0.875rem", color: "var(--destructive)", margin: 0 }}>{error}</p>
          )}
          <button type="submit" className="btn" disabled={saving || !chatworkAccountId.trim()}>
            {saving ? "登録中..." : "登録して続ける"}
          </button>
        </form>
      </div>
    </div>
  );
}
