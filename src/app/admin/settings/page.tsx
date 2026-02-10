"use client";

import { useState, useEffect, useRef } from "react";
import { getSettings } from "@/services/settingsService";
import { getChatworkConfig, getChatworkConfigRaw, saveChatworkConfig, sendNextDayAttendanceToChatwork } from "@/services/chatworkService";
import { getAllUsers, subscribeAllUsers, updateUserRole, updateUserHourlyWage, UserProfile } from "@/services/userService";
import { deleteAllUserData } from "@/services/userDeletionService";
import { getWageChangeLog, WageChangeLogEntry } from "@/services/wageChangeLogService";
import { createNotification } from "@/services/notificationService";
import { useAuth } from "@/context/AuthContext";
import ProfileImageUpload from "@/components/ProfileImageUpload";
import Avatar from "@/components/Avatar";

/** 管理者昇格・降格機能を無効にする（一旦無効） */
const ROLE_CHANGE_ENABLED = false;

export default function AdminSettingsPage() {
  const { user: currentUser, refreshUserProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [chatworkToken, setChatworkToken] = useState("");
  const [chatworkRoomId, setChatworkRoomId] = useState("");
  const [chatworkNotifyHour, setChatworkNotifyHour] = useState(21);
  const chatworkNotifyHourRef = useRef(21);
  const [chatworkEditing, setChatworkEditing] = useState(false);
  const [chatworkSaving, setChatworkSaving] = useState(false);
  const [chatworkSending, setChatworkSending] = useState(false);
  const [chatworkNotifyModalOpen, setChatworkNotifyModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ uid: string; name: string; role: "admin" | "staff" } | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [editingHourlyWage, setEditingHourlyWage] = useState<number>(1000);
  const [savingWage, setSavingWage] = useState(false);
  const [hourlyWageLocked, setHourlyWageLocked] = useState(true);
  const [wageChangeLog, setWageChangeLog] = useState<WageChangeLogEntry[]>([]);
  const [chatworkRaw, setChatworkRaw] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    getSettings().then(() => setLoading(false)).catch(() => setLoading(false));
    getChatworkConfig().then((c) => {
      if (c) {
        const hour = c.notifyHour ?? 21;
        setChatworkToken(c.apiToken);
        setChatworkRoomId(c.roomId);
        setChatworkNotifyHour(hour);
        chatworkNotifyHourRef.current = hour;
      }
    }).catch(() => {});
    if (process.env.NODE_ENV !== "production") {
      getChatworkConfigRaw().then(setChatworkRaw).catch(() => setChatworkRaw(null));
    }

    setUsersLoading(true);
    const timeout = setTimeout(() => setUsersLoading(false), 15000);
    const unsubscribe = subscribeAllUsers((list) => {
      setUsers(list);
      setUsersLoading(false);
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const openDeleteConfirm = (uid: string, name: string, role: "admin" | "staff") => {
    if (role === "admin") {
      const adminCount = users.filter((u) => u.role === "admin").length;
      if (adminCount <= 1) {
        alert("最後の管理者は削除できません");
        return;
      }
    }
    setDeleteConfirmTarget({ uid, name, role });
  };

  const executeDeleteUser = async () => {
    if (!deleteConfirmTarget) return;
    const { uid } = deleteConfirmTarget;
    setDeletingUserId(uid);
    setDeleteConfirmTarget(null);
    try {
      await deleteAllUserData(uid);
      setSelectedUser(null);
      alert("削除しました");
    } catch (err) {
      console.error(err);
      alert("削除に失敗しました");
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleRoleChange = async (uid: string, newRole: "admin" | "staff") => {
    if (!confirm(`このユーザーを${newRole === "admin" ? "管理者" : "アルバイト"}に変更しますか？`)) {
      return;
    }
    setUpdatingUserId(uid);
    try {
      await updateUserRole(uid, newRole);
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

  // スタッフ選択時に時給変更ログを取得
  useEffect(() => {
    if (selectedUser?.role === "staff") {
      getWageChangeLog(selectedUser.uid)
        .then(setWageChangeLog)
        .catch(() => setWageChangeLog([]));
    } else {
      setWageChangeLog([]);
    }
  }, [selectedUser?.uid, selectedUser?.role]);

  // 選択中のユーザーがDBから削除されたらモーダルを閉じる
  useEffect(() => {
    if (selectedUser && !users.some((u) => u.uid === selectedUser.uid)) {
      setSelectedUser(null);
    }
  }, [users, selectedUser]);

  const handleSaveHourlyWage = async () => {
    if (!selectedUser || !currentUser) return;
    const wage = Math.max(0, Math.floor(Number(editingHourlyWage)) || 0);
    setSavingWage(true);
    try {
      await updateUserHourlyWage(selectedUser.uid, wage, {
        changedByUid: currentUser.uid,
        changedByName: currentUser.name ?? "管理者",
      });
      setEditingHourlyWage(wage);
      setHourlyWageLocked(true);
      setSelectedUser((prev) => (prev ? { ...prev, hourlyWage: wage } : null));
      const log = await getWageChangeLog(selectedUser.uid);
      setWageChangeLog(log);
      await createNotification(
        selectedUser.uid,
        "hourly_wage_changed",
        `時給が¥${wage.toLocaleString()}に変更されました。確認してください。`
      );
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

        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            シフト提出ルール
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
            シフトは15日ごとに提出です。締切を過ぎた日はアルバイトは編集できません。
            <br />
            <strong>1～15日分</strong>: 前月25日までに提出
            <br />
            <strong>16日～月末分</strong>: 当月10日までに提出
          </p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: "400px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Chatwork 通知</h2>
        {chatworkEditing || (!chatworkToken.trim() && !chatworkRoomId.trim()) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>API トークン</label>
              <input
                type="password"
                value={chatworkToken}
                onChange={(e) => setChatworkToken(e.target.value)}
                placeholder="Chatwork の API トークン"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>ルーム ID</label>
              <input
                type="text"
                value={chatworkRoomId}
                onChange={(e) => setChatworkRoomId(e.target.value)}
                placeholder="421966365"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>自動通知時刻（日本時間）</label>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                GitHub Actions が毎時実行され、この時刻に通知を送信します
              </p>
              <select
                value={chatworkNotifyHour}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setChatworkNotifyHour(v);
                  chatworkNotifyHourRef.current = v;
                }}
                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1rem" }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={chatworkSaving || !chatworkToken.trim() || !chatworkRoomId.trim()}
                onClick={async () => {
                  setChatworkSaving(true);
                  try {
                    await saveChatworkConfig({ apiToken: chatworkToken.trim(), roomId: chatworkRoomId.trim(), notifyHour: chatworkNotifyHourRef.current });
                    setChatworkEditing(false);
                    if (process.env.NODE_ENV !== "production") {
                      getChatworkConfigRaw().then(setChatworkRaw).catch(() => {});
                    }
                    alert("保存しました");
                  } catch (e) {
                    console.error(e);
                    alert("保存に失敗しました");
                  } finally {
                    setChatworkSaving(false);
                  }
                }}
              >
                {chatworkSaving ? "保存中..." : "保存"}
              </button>
              {chatworkToken.trim() && chatworkRoomId.trim() && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setChatworkEditing(false)}
                  disabled={chatworkSaving}
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>API トークン: </span>
              <span>••••••••</span>
            </div>
            <div>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>ルーム ID: </span>
              <span>{chatworkRoomId}</span>
            </div>
            <div>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>自動通知時刻: </span>
              <span>{String(chatworkNotifyHour).padStart(2, "0")}:00（日本時間）</span>
            </div>
            {process.env.NODE_ENV !== "production" && chatworkRaw != null && (
              <div style={{ fontSize: "0.75rem", padding: "0.5rem", backgroundColor: "var(--surface-hover)", borderRadius: "var(--radius-md)", fontFamily: "monospace" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted)" }}>Firestore 生データ（chatwork-notify.js が参照する settings/chatwork）</div>
                <div>notifyHour: {JSON.stringify(chatworkRaw.notifyHour)} (型: {typeof chatworkRaw.notifyHour})</div>
                <div style={{ marginTop: "0.25rem", color: "var(--text-muted)" }}>
                  → GitHub Actions は日本時間 {String(Number(chatworkRaw.notifyHour) >= 0 && Number(chatworkRaw.notifyHour) <= 23 ? Number(chatworkRaw.notifyHour) : 21).toString().padStart(2, "0")}:00 に通知送信
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-outline" onClick={() => setChatworkEditing(true)}>
                編集
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={chatworkSending}
                onClick={() => setChatworkNotifyModalOpen(true)}
              >
                翌日出勤を通知
              </button>
            </div>
          </div>
        )}
      </div>

      {deleteConfirmTarget && (
        <div
          role="dialog"
          aria-label="ユーザー削除の確認"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
            padding: "1rem",
          }}
          onClick={() => !deletingUserId && setDeleteConfirmTarget(null)}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: "1.25rem" }}>
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.1rem", color: "var(--destructive)" }}>ユーザーを削除</h3>
            <p style={{ margin: "0 0 1rem 0", color: "var(--text-main)", fontSize: "0.95rem" }}>
              <strong>{deleteConfirmTarget.name}</strong> をユーザー一覧から削除しますか？
            </p>
            <p style={{ margin: "0 0 1rem 0", color: "var(--text-muted)", fontSize: "0.875rem", lineHeight: 1.5 }}>
              シフト・通知・チャット・時給履歴など、DB 上の全関連データが削除されます。<br />
              Firebase Authentication の削除は Firebase コンソールで別途行ってください。
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteConfirmTarget(null)}
                disabled={!!deletingUserId}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}
                onClick={executeDeleteUser}
                disabled={!!deletingUserId}
              >
                {deletingUserId ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {chatworkNotifyModalOpen && (
        <div
          role="dialog"
          aria-label="翌日出勤通知の確認"
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
          onClick={() => !chatworkSending && setChatworkNotifyModalOpen(false)}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, padding: "1.25rem" }}>
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.1rem" }}>翌日出勤を通知</h3>
            <p style={{ margin: "0 0 1rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Chatwork に翌日の出勤メンバーを通知します。よろしいですか？
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setChatworkNotifyModalOpen(false)}
                disabled={chatworkSending}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={chatworkSending}
                onClick={async () => {
                  setChatworkSending(true);
                  try {
                    const r = await sendNextDayAttendanceToChatwork();
                    setChatworkNotifyModalOpen(false);
                    if (r.ok) alert(`送信しました（${r.count}件）`);
                    else alert(r.error || "送信に失敗しました");
                  } catch (e) {
                    console.error(e);
                    alert("送信に失敗しました");
                  } finally {
                    setChatworkSending(false);
                  }
                }}
              >
                {chatworkSending ? "送信中..." : "送信する"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ maxWidth: "600px" }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0, marginBottom: "1rem" }}>ユーザー管理</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          {ROLE_CHANGE_ENABLED
            ? "アルバイトを管理者に昇格させたり、管理者をアルバイトに降格させることができます。"
            : "ユーザー一覧です。"}
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
                      fontWeight: user.role === "admin" ? 500 : 600,
                      backgroundColor: user.role === "admin" ? "var(--primary)" : "var(--bg-secondary)",
                      color: user.role === "admin" ? "white" : "var(--text)",
                      flexShrink: 0,
                    }}
                  >
                    {user.role === "admin" ? "管理者" : "アルバイト"}
                  </span>
                  {ROLE_CHANGE_ENABLED && user.uid !== currentUser?.uid && (
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
            <span style={{ padding: "0.25rem 0.5rem", borderRadius: 6, fontWeight: selectedUser!.role === "admin" ? 500 : 600, background: selectedUser!.role === "admin" ? "var(--primary)" : "var(--bg-secondary)", color: selectedUser!.role === "admin" ? "#fff" : "inherit" }}>
              {selectedUser!.role === "admin" ? "管理者" : "アルバイト"}
            </span>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>Chatwork アカウントID:</strong>{" "}
            <span style={{ color: "var(--text-muted)" }}>{selectedUser!.chatworkAccountId || "未設定"}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>（数字。通知の To: 用）</span>
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
              <div style={{ marginTop: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }}>
                  時給変更履歴
                </label>
                <div
                  style={{
                    maxHeight: "160px",
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.8rem",
                  }}
                >
                  {wageChangeLog.length === 0 ? (
                    <p style={{ padding: "0.75rem", margin: 0, color: "var(--text-muted)" }}>変更履歴はありません</p>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                          <th style={{ padding: "0.4rem 0.5rem", textAlign: "left" }}>日時</th>
                          <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>変更前</th>
                          <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>変更後</th>
                          <th style={{ padding: "0.4rem 0.5rem", textAlign: "left" }}>変更者</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wageChangeLog.map((entry) => (
                          <tr key={entry.id} style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: "0.4rem 0.5rem", color: "var(--text-muted)" }}>
                              {entry.changedAt.toLocaleString("ja-JP", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>¥{entry.previousWage.toLocaleString()}</td>
                            <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 500 }}>¥{entry.newWage.toLocaleString()}</td>
                            <td style={{ padding: "0.4rem 0.5rem", color: "var(--text-muted)" }}>{entry.changedByName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            {ROLE_CHANGE_ENABLED && selectedUser!.uid !== currentUser?.uid && (
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
            {selectedUser!.uid !== currentUser?.uid && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openDeleteConfirm(selectedUser!.uid, selectedUser!.name, selectedUser!.role);
                }}
                disabled={deletingUserId === selectedUser!.uid}
              >
                {deletingUserId === selectedUser!.uid ? "削除中..." : "ユーザーを削除"}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setSelectedUser(null)}>閉じる</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
