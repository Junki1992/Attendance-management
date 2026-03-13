"use client";

import { useState, useEffect, useRef } from "react";
import { getSettings, saveSettings, type AppSettings } from "@/services/settingsService";
import { getChatworkConfig, getChatworkConfigRaw, saveChatworkConfig, sendNextDayAttendanceToChatwork, type NotificationDestination } from "@/services/chatworkService";
import { getAllUsers, subscribeAllUsers, updateUserRole, updateUserHourlyWage, updateUserWages, UserProfile } from "@/services/userService";
import { deleteAllUserData } from "@/services/userDeletionService";
import { getWageChangeLog, recordWageChange, WageChangeLogEntry } from "@/services/wageChangeLogService";
import { createNotification } from "@/services/notificationService";
import { subscribePresence } from "@/services/presenceService";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_HOURLY_WAGE } from "@/lib/app-config";
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
  const [chatworkDestinations, setChatworkDestinations] = useState<NotificationDestination[]>([]);
  const [chatworkNotifyTime, setChatworkNotifyTime] = useState("21:00");
  const [chatworkEditing, setChatworkEditing] = useState(false);
  const [chatworkSaving, setChatworkSaving] = useState(false);
  const [chatworkSending, setChatworkSending] = useState(false);
  const [chatworkNotifyModalOpen, setChatworkNotifyModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ uid: string; name: string; role: "admin" | "staff" } | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [editingHourlyWage, setEditingHourlyWage] = useState<number>(DEFAULT_HOURLY_WAGE);
  const [editingHourlyWageRemote, setEditingHourlyWageRemote] = useState<number | "">("");
  const [savingWage, setSavingWage] = useState(false);
  const [hourlyWageLocked, setHourlyWageLocked] = useState(true);
  const [wageChangeLog, setWageChangeLog] = useState<WageChangeLogEntry[]>([]);
  const [chatworkRaw, setChatworkRaw] = useState<Record<string, unknown> | null>(null);
  const [firstBlockDeadlineDay, setFirstBlockDeadlineDay] = useState(25);
  const [firstBlockDeadlineTime, setFirstBlockDeadlineTime] = useState("23:59");
  const [secondBlockDeadlineDay, setSecondBlockDeadlineDay] = useState(10);
  const [secondBlockDeadlineTime, setSecondBlockDeadlineTime] = useState("23:59");
  const [deadlineOverrides, setDeadlineOverrides] = useState<AppSettings["deadlineOverrides"]>({});
  const [deadlineSaving, setDeadlineSaving] = useState(false);
  const [onlineStaffIds, setOnlineStaffIds] = useState<Record<string, boolean>>({});
  const overrideYearMonthOptions = (() => {
    const now = new Date();
    const options: { value: string; label: string }[] = [];
    for (let i = -1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const value = `${y}-${String(m).padStart(2, "0")}`;
      options.push({ value, label: `${y}年${m}月` });
    }
    return options;
  })();
  const [newOverrideYearMonth, setNewOverrideYearMonth] = useState(() => overrideYearMonthOptions[0]?.value ?? "");
  const [newOverrideBlock, setNewOverrideBlock] = useState<"first" | "second">("first");
  const [newOverrideDatetime, setNewOverrideDatetime] = useState("");

  useEffect(() => {
    getSettings()
      .then((s) => {
        setFirstBlockDeadlineDay(s.firstBlockDeadlineDay ?? 25);
        setFirstBlockDeadlineTime(s.firstBlockDeadlineTime ?? "23:59");
        setSecondBlockDeadlineDay(s.secondBlockDeadlineDay ?? 10);
        setSecondBlockDeadlineTime(s.secondBlockDeadlineTime ?? "23:59");
        setDeadlineOverrides(s.deadlineOverrides ?? {});
      })
      .finally(() => setLoading(false))
      .catch(() => setLoading(false));
    getChatworkConfig().then((c) => {
      if (c) {
        const hour = c.notifyHour ?? 21;
        const minute = c.notifyMinute ?? 0;
        setChatworkToken(c.apiToken);
        setChatworkDestinations(c.notificationDestinations?.length ? [...c.notificationDestinations] : []);
        setChatworkNotifyTime(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
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

  useEffect(() => {
    if (currentUser?.role !== "admin" || users.length === 0) return;
    const staffIds = users.filter((u) => u.role === "staff").map((u) => u.uid).filter(Boolean);
    return subscribePresence(staffIds, setOnlineStaffIds);
  }, [currentUser?.role, users]);

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
    try {
      await deleteAllUserData(uid);
      setDeleteConfirmTarget(null);
      setSelectedUser(null);
      alert("削除しました");
    } catch (err) {
      console.error(err);
      setSelectedUser(null);
      const msg = err instanceof Error ? err.message : String(err);
      alert(`削除に失敗しました\n${msg}`);
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
      setEditingHourlyWage(selectedUser.hourlyWage ?? DEFAULT_HOURLY_WAGE);
      const remote = selectedUser.hourlyWageRemote;
      setEditingHourlyWageRemote(remote === undefined || remote === null ? "" : remote);
      setHourlyWageLocked(true);
    }
  }, [selectedUser?.uid, selectedUser?.hourlyWage, selectedUser?.hourlyWageRemote]);

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
    const remoteVal = editingHourlyWageRemote === "" || editingHourlyWageRemote === undefined ? undefined : Math.max(0, Math.floor(Number(editingHourlyWageRemote)) || 0);
    setSavingWage(true);
    try {
      await updateUserWages(selectedUser.uid, {
        hourlyWage: wage,
        hourlyWageRemote: editingHourlyWageRemote === "" ? null : remoteVal,
      });
      if (wage !== (selectedUser.hourlyWage ?? DEFAULT_HOURLY_WAGE)) {
        const previousWage = selectedUser.hourlyWage ?? DEFAULT_HOURLY_WAGE;
        try {
          await recordWageChange(selectedUser.uid, previousWage, wage, currentUser.uid, currentUser.name ?? "管理者");
        } catch (e) {
          console.warn("[handleSaveHourlyWage] 時給変更ログの記録に失敗:", e);
        }
        await createNotification(
          selectedUser.uid,
          "hourly_wage_changed",
          `時給が¥${wage.toLocaleString()}に変更されました。確認してください。`
        );
      }
      setEditingHourlyWage(wage);
      setEditingHourlyWageRemote(remoteVal ?? "");
      setHourlyWageLocked(true);
      setSelectedUser((prev) => (prev ? { ...prev, hourlyWage: wage, hourlyWageRemote: remoteVal } : null));
      const log = await getWageChangeLog(selectedUser.uid);
      setWageChangeLog(log);
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
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Chatwork 通知</h2>
        {chatworkEditing || (!chatworkToken.trim() && chatworkDestinations.length === 0) ? (
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
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>通知先（複数可）</label>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                ルーム（グループ）または個人アカウントを追加。翌日出勤通知がそれぞれに送られます
              </p>
              {chatworkDestinations.map((dest, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <select
                    value={dest.type}
                    onChange={(e) => {
                      const next = [...chatworkDestinations];
                      next[i] = { ...next[i], type: e.target.value as "room" | "personal" };
                      setChatworkDestinations(next);
                    }}
                    style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "0.875rem", minWidth: "100px" }}
                  >
                    <option value="room">ルーム</option>
                    <option value="personal">個人</option>
                  </select>
                  <input
                    type="text"
                    value={dest.id}
                    onChange={(e) => {
                      const next = [...chatworkDestinations];
                      next[i] = { ...next[i], id: e.target.value };
                      setChatworkDestinations(next);
                    }}
                    placeholder={dest.type === "room" ? "ルーム ID" : "アカウント ID"}
                    style={{ flex: 1, padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.5rem", color: "var(--text-muted)" }}
                    onClick={() => setChatworkDestinations(chatworkDestinations.filter((_, j) => j !== i))}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: "0.875rem" }}
                onClick={() => setChatworkDestinations([...chatworkDestinations, { type: "room", id: "" }])}
              >
                + 通知先を追加
              </button>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>自動通知時刻（日本時間）</label>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                GitHub Actions が5分ごとに実行。設定時刻から30分以内に実行されれば送信（遅延対策）。5分単位で指定
              </p>
              <input
                type="time"
                value={chatworkNotifyTime}
                onChange={(e) => setChatworkNotifyTime(e.target.value || "21:00")}
                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "1rem" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={chatworkSaving || !chatworkToken.trim() || !chatworkDestinations.some((d) => d.id.trim())}
                onClick={async () => {
                  setChatworkSaving(true);
                  try {
                    const [h, m] = chatworkNotifyTime.split(":").map((x) => parseInt(x, 10) || 0);
                    await saveChatworkConfig({
                      apiToken: chatworkToken.trim(),
                      notificationDestinations: chatworkDestinations.filter((d) => d.id.trim()),
                      notifyHour: Math.min(23, Math.max(0, h)),
                      notifyMinute: Math.min(59, Math.max(0, m)),
                    });
                    setChatworkEditing(false);
                    setChatworkDestinations(chatworkDestinations.filter((d) => d.id.trim()));
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
              {chatworkToken.trim() && chatworkDestinations.some((d) => d.id.trim()) && (
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
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>通知先: </span>
              {chatworkDestinations.length === 0 ? (
                <span>—</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
                  {chatworkDestinations.map((d, i) => (
                    <li key={i}>{d.type === "room" ? "ルーム" : "個人"} ID: {d.id}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>自動通知時刻: </span>
              <span>{chatworkNotifyTime}（日本時間）</span>
            </div>
            {process.env.NODE_ENV !== "production" && chatworkRaw != null && (
              <div style={{ fontSize: "0.75rem", padding: "0.5rem", backgroundColor: "var(--surface-hover)", borderRadius: "var(--radius-md)", fontFamily: "monospace" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted)" }}>Firestore 生データ（chatwork-notify.js が参照する settings/chatwork）</div>
                <div>notificationDestinations: {JSON.stringify(chatworkRaw.notificationDestinations)}</div>
                <div>notifyHour: {JSON.stringify(chatworkRaw.notifyHour)} notifyMinute: {JSON.stringify(chatworkRaw.notifyMinute)}</div>
                <div style={{ marginTop: "0.25rem", color: "var(--text-muted)" }}>
                  → GitHub Actions は日本時間 {String(Number(chatworkRaw.notifyHour) >= 0 && Number(chatworkRaw.notifyHour) <= 23 ? Number(chatworkRaw.notifyHour) : 21).toString().padStart(2, "0")}:{String(Number(chatworkRaw.notifyMinute) >= 0 && Number(chatworkRaw.notifyMinute) <= 59 ? Number(chatworkRaw.notifyMinute) : 0).toString().padStart(2, "0")} に通知送信
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

      <div className="card" style={{ maxWidth: "560px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>シフト提出締切</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
          通常は「毎月この日・この時刻まで」で締切が決まります。土日祝で締切日をずらしたい月だけ、下の「月別の例外」で日時を指定できます。
        </p>

        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>通常の締切</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            例: 25日 23:59 → 毎月25日の23:59までに提出
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                1～15日分 → 前月のいつまで？
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={firstBlockDeadlineDay}
                  onChange={(e) => setFirstBlockDeadlineDay(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  style={{ width: "3.5rem", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                />
                <span style={{ fontSize: "0.875rem" }}>日</span>
                <input
                  type="time"
                  value={firstBlockDeadlineTime}
                  onChange={(e) => setFirstBlockDeadlineTime(e.target.value || "23:59")}
                  style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                16日～月末 → 当月のいつまで？
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={secondBlockDeadlineDay}
                  onChange={(e) => setSecondBlockDeadlineDay(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  style={{ width: "3.5rem", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                />
                <span style={{ fontSize: "0.875rem" }}>日</span>
                <input
                  type="time"
                  value={secondBlockDeadlineTime}
                  onChange={(e) => setSecondBlockDeadlineTime(e.target.value || "23:59")}
                  style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>月別の例外（土日祝でずらすとき）</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            「○年○月の、1～15日分（または16日～月末）の締切を、この日時にする」を追加します。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Object.entries(deadlineOverrides ?? {}).map(([key, value]) => {
              const m = key.match(/^(\d{4})-(\d{2})_(first|second)$/);
              const label = m
                ? `${parseInt(m[1], 10)}年${parseInt(m[2], 10)}月 ${m[3] === "first" ? "1～15日分" : "16日～月末"}`
                : key;
              return (
                <div key={key} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.5rem", backgroundColor: "var(--surface-hover)", borderRadius: "var(--radius-md)" }}>
                  <span style={{ fontSize: "0.875rem", minWidth: "140px" }}>{label}</span>
                  <input
                    type="datetime-local"
                    value={value.slice(0, 16)}
                    onChange={(e) => {
                      const v = e.target.value ? `${e.target.value}:00` : value;
                      setDeadlineOverrides((prev) => ({ ...prev, [key]: v }));
                    }}
                    style={{ flex: "1 1 180px", minWidth: 0, padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.5rem", color: "var(--destructive)" }}
                    onClick={() => setDeadlineOverrides((prev) => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    })}
                  >
                    削除
                  </button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={newOverrideYearMonth}
                onChange={(e) => setNewOverrideYearMonth(e.target.value)}
                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "0.875rem", minWidth: "100px" }}
              >
                {overrideYearMonthOptions.map((ym) => (
                  <option key={ym.value} value={ym.value}>{ym.label}</option>
                ))}
              </select>
              <select
                value={newOverrideBlock}
                onChange={(e) => setNewOverrideBlock(e.target.value as "first" | "second")}
                style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "0.875rem", minWidth: "110px" }}
              >
                <option value="first">1～15日分</option>
                <option value="second">16日～月末</option>
              </select>
              <input
                type="datetime-local"
                value={newOverrideDatetime}
                onChange={(e) => setNewOverrideDatetime(e.target.value)}
                style={{ flex: "1 1 180px", minWidth: 0, padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxSizing: "border-box" }}
              />
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: "0.875rem" }}
                onClick={() => {
                  if (!newOverrideDatetime) {
                    alert("締切日時を選択してください");
                    return;
                  }
                  const key = `${newOverrideYearMonth}_${newOverrideBlock}`;
                  setDeadlineOverrides((prev) => ({ ...prev, [key]: `${newOverrideDatetime}:00` }));
                  setNewOverrideDatetime("");
                }}
              >
                例外を追加
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={deadlineSaving}
            onClick={async () => {
              setDeadlineSaving(true);
              try {
                await saveSettings({
                  firstBlockDeadlineDay,
                  firstBlockDeadlineTime,
                  secondBlockDeadlineDay,
                  secondBlockDeadlineTime,
                  deadlineOverrides: deadlineOverrides ?? {},
                });
                alert("締切設定を保存しました");
              } catch (e) {
                console.error(e);
                alert("保存に失敗しました");
              } finally {
                setDeadlineSaving(false);
              }
            }}
          >
            {deadlineSaving ? "保存中..." : "締切設定を保存"}
          </button>
        </div>
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
              シフト・通知・チャット・時給履歴など、DB 上の全関連データが削除されます。
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
            {[...users]
              .sort((a, b) => {
                if (a.name === "総務") return -1;
                if (b.name === "総務") return 1;
                return 0;
              })
              .map((user) => (
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
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <Avatar photoURL={user.photoURL} name={user.name} size="md" />
                    {user.role === "staff" && onlineStaffIds[user.uid] && (
                      <span
                        title="オンライン"
                        style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: "#22c55e",
                          border: "2px solid var(--surface)",
                        }}
                        aria-label="オンライン"
                      />
                    )}
                  </div>
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
                  {user.name !== "総務" && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginLeft: 4 }}
                      onClick={() => setSelectedUser(user)}
                      aria-label="ユーザー詳細を表示"
                    >
                      詳細
                    </button>
                  )}
                  {user.uid === currentUser?.uid && user.name !== "総務" && (
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
                  <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>出社:</span>
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
                    ¥{(selectedUser!.hourlyWage ?? DEFAULT_HOURLY_WAGE).toLocaleString()}
                  </span>
                  <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>在宅:</span>
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
                  >
                    {selectedUser!.hourlyWageRemote != null ? `¥${selectedUser!.hourlyWageRemote.toLocaleString()}` : "未設定（出社と同じ）"}
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
                    <span style={{ fontSize: "0.875rem", width: "3rem" }}>出社</span>
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
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.875rem", width: "3rem" }}>在宅</span>
                    <input
                      id="admin-hourly-wage-remote"
                      type="number"
                      min={0}
                      value={editingHourlyWageRemote === "" ? "" : editingHourlyWageRemote}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditingHourlyWageRemote(v === "" ? "" : Math.max(0, Math.floor(Number(v)) || 0));
                      }}
                      placeholder="未設定なら出社と同じ"
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        width: "120px",
                        fontSize: "1rem",
                      }}
                    />
                    <span style={{ color: "var(--text-muted)" }}>円</span>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>（空欄＝出社と同じ）</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
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
                        setEditingHourlyWage(selectedUser!.hourlyWage ?? DEFAULT_HOURLY_WAGE);
                        setEditingHourlyWageRemote(selectedUser!.hourlyWageRemote ?? "");
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
                出社と在宅で時給を分けられます。在宅を未設定にすると出社時給と同じになります。編集する場合は錠前をクリックして解除してください。
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
