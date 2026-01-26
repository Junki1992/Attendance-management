"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  confirmShifts,
  saveShift,
  subscribeAllShifts,
  getUnsubmittedStaff,
  getMonthlyWorkSummary,
  Shift,
} from "@/services/shiftService";
import { getAllStaff, StaffItem } from "@/services/userService";
import { createNotification, getShiftConfirmedNotifications, Notification } from "@/services/notificationService";

function calcHours(s: Shift): number | "OFF" {
  if (s.startTime === "00:00" && s.endTime === "00:00") return "OFF";
  const [sH, sM] = s.startTime.split(":").map(Number);
  const [eH, eM] = s.endTime.split(":").map(Number);
  let h = eH + eM / 60 - (sH + sM / 60);
  if (h > 6) h -= 1;
  return h > 0 ? Math.round(h * 10) / 10 : 0;
}

export default function AdminShiftGrid() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftData, setShiftData] = useState<{ [key: string]: number }>({});
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [unsubmitted, setUnsubmitted] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [csvCopied, setCsvCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedNotifs, setConfirmedNotifs] = useState<Notification[]>([]);
  const [workSummary, setWorkSummary] = useState<{ userId: string; name: string; totalHours: number; hourlyWage: number; salary: number }[]>([]);
  const [editingCell, setEditingCell] = useState<{ userId: string; day: number } | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  const lastDay = new Date(year, month + 1, 0).getDate();
  const DAYS = Array.from({ length: lastDay }, (_, i) => i + 1);

  useEffect(() => {
    getAllStaff().then(setStaffList);
  }, []);

  useEffect(() => {
    getUnsubmittedStaff(year, month).then(setUnsubmitted);
  }, [year, month]);

  useEffect(() => {
    getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
  }, [year, month]);

  useEffect(() => {
    getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => setWorkSummary([]));
  }, [year, month]);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAllShifts(year, month, (s) => {
      setShifts(s);
      const map: { [key: string]: number } = {};
      s.forEach((sh) => {
        const h = calcHours(sh);
        if (h === "OFF") return;
        const day = parseInt(sh.date.split("-")[2], 10);
        map[`${sh.userId}-${day}`] = h as number;
      });
      setShiftData(map);
      setError(null);
      setLoading(false);
    });
    return () => unsub();
  }, [year, month]);

  const getShift = useCallback(
    (uid: string, day: number) => shiftData[`${uid}-${day}`] || 0,
    [shiftData]
  );

  const changeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 11) {
      m = 0;
      y += 1;
    } else if (m < 0) {
      m = 11;
      y -= 1;
    }
    setMonth(m);
    setYear(y);
  };

  const handleConfirm = async () => {
    if (!confirm(`${year}年${month + 1}月のシフトを確定し、スタッフへ通知を送りますか？`))
      return;
    setConfirming(true);
    try {
      const affectedUserIds = await confirmShifts(year, month);
      if (process.env.NODE_ENV === "development") {
        console.log("[admin/shifts] handleConfirm: affectedUserIds", affectedUserIds);
      }
      if (affectedUserIds.length === 0) {
        alert("確定するシフトがありませんでした。");
        return;
      }
      await Promise.all(
        affectedUserIds.map((uid) =>
          createNotification(
            uid,
            "shift_confirmed",
            `${month + 1}月のシフトが確定しました。確認してください。`
          )
        )
      );
      getShiftConfirmedNotifications(30).then(setConfirmedNotifs).catch(() => {});
      getMonthlyWorkSummary(year, month).then(setWorkSummary).catch(() => {});
      alert(`${affectedUserIds.length}名のスタッフに通知を送りました！`);
    } catch (e) {
      console.error("[admin/shifts] handleConfirm: error", e);
      alert("確定処理に失敗しました");
    } finally {
      setConfirming(false);
    }
  };

  const handleRemind = async () => {
    if (unsubmitted.length === 0) return;
    setReminding(true);
    try {
      await Promise.all(
        unsubmitted.map((u) =>
          createNotification(
            u.id,
            "remind_submit",
            `${month + 1}月のシフト提出がまだです。お早めに提出してください。`
          )
        )
      );
      alert(`${unsubmitted.length}名に催促通知を送りました`);
    } catch (e) {
      console.error(e);
      alert("催促に失敗しました");
    } finally {
      setReminding(false);
    }
  };

  const buildCsv = (): string => {
    const confirmed = shifts.filter((s) => s.status === "confirmed");
    const nameMap = Object.fromEntries(staffList.map((s) => [s.id, s.name]));
    const header = ["スタッフ", ...DAYS.map((d) => String(d)), "合計"].join(",");
    const rows = staffList.map((staff) => {
      let total = 0;
      const cells = DAYS.map((d) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const s = confirmed.find(
          (x) => x.userId === staff.id && x.date === dateStr
        );
        if (!s) return "";
        const h = calcHours(s);
        if (h === "OFF") return "OFF";
        total += h as number;
        return String(h);
      });
      return [nameMap[staff.id] || staff.id, ...cells, String(total)].join(
        ","
      );
    });
    return [header, ...rows].join("\n");
  };

  const handleCopyCsv = async () => {
    try {
      const csv = buildCsv();
      await navigator.clipboard.writeText(csv);
      setCsvCopied(true);
      setTimeout(() => setCsvCopied(false), 2000);
    } catch (e) {
      console.error(e);
      alert("コピーに失敗しました");
    }
  };

  const isDailyOver = (hours: number) => hours > 8;
  const isWeeklyOver = (uid: string) => {
    let t = 0;
    DAYS.forEach((d) => (t += getShift(uid, d)));
    return t > 40;
  };

  const alert36 = useMemo(() => {
    const daily: { name: string; day: number; hours: number }[] = [];
    const weekly: { name: string; total: number }[] = [];
    staffList.forEach((s) => {
      let total = 0;
      DAYS.forEach((d) => {
        const h = getShift(s.id, d);
        total += h;
        if (h > 8) daily.push({ name: s.name, day: d, hours: h });
      });
      if (total > 40) weekly.push({ name: s.name, total });
    });
    return { daily, weekly };
  }, [staffList, DAYS, getShift]);

  return (
    <div>
      {/* 36協定アラート（最上部に常設） */}
      <div
        className="card"
        style={{
          marginBottom: "1rem",
          borderColor: alert36.daily.length > 0 || alert36.weekly.length > 0 ? "#F59E0B" : "var(--border)",
          backgroundColor: alert36.daily.length > 0 || alert36.weekly.length > 0 ? "#FFFBEB" : "var(--surface)",
        }}
      >
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>36協定アラート</span>
          {(alert36.daily.length > 0 || alert36.weekly.length > 0) && <span style={{ color: "var(--destructive)" }}>⚠️ 要確認</span>}
        </h3>
        {alert36.daily.length === 0 && alert36.weekly.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: 0 }}>1日8時間超・週40時間超の該当者はありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.875rem" }}>
            {alert36.daily.length > 0 && (
              <div>
                <strong>1日8時間超過:</strong>{" "}
                {alert36.daily.map((x) => `${x.name} ${month + 1}/${x.day} (${x.hours}h)`).join("、")}
              </div>
            )}
            {alert36.weekly.length > 0 && (
              <div>
                <strong>週40時間超過（月合計）:</strong>{" "}
                {alert36.weekly.map((x) => `${x.name} ${x.total}h`).join("、")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 未提出者リスト */}
      {unsubmitted.length > 0 && (
        <div
          className="card"
          style={{ marginBottom: "1rem", backgroundColor: "#FEF3C7" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <strong>未提出者（{unsubmitted.length}名）</strong>
              <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>
                {unsubmitted.map((u) => u.name).join("、")}
              </span>
            </div>
            <button
              className="btn btn-outline"
              onClick={handleRemind}
              disabled={reminding}
            >
              {reminding ? "送信中..." : "催促通知を送る"}
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className="btn btn-outline"
              onClick={() => changeMonth(-1)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              ‹
            </button>
            <h2 style={{ fontSize: "1.5rem", margin: 0 }}>
              {year}年 {month + 1}月 シフト表
            </h2>
            <button
              className="btn btn-outline"
              onClick={() => changeMonth(1)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              ›
            </button>
          </div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <button
              className="btn btn-outline"
              onClick={handleCopyCsv}
              disabled={loading}
            >
              {csvCopied ? "コピーしました" : "CSVコピー"}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={loading || confirming}
            >
              {confirming ? "処理中..." : "確定して通知"}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#FEE2E2",
              color: "#B91C1C",
              marginBottom: "1rem",
              borderRadius: "0.5rem",
            }}
          >
            エラー: {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            読み込み中...
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              backgroundColor: "var(--surface)",
              fontSize: "0.8rem",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    minWidth: "100px",
                    position: "sticky",
                    left: 0,
                    backgroundColor: "var(--surface)",
                    zIndex: 1,
                  }}
                >
                  スタッフ
                </th>
                {DAYS.map((d) => (
                  <th
                    key={d}
                    style={{
                      padding: "0.25rem",
                      border: "1px solid var(--border)",
                      minWidth: "30px",
                      textAlign: "center",
                    }}
                  >
                    {d}
                  </th>
                ))}
                <th
                  style={{
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    minWidth: "60px",
                  }}
                >
                  合計
                </th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((user) => {
                const totalHours = DAYS.reduce(
                  (acc, d) => acc + getShift(user.id, d),
                  0
                );
                const weeklyWarning = totalHours > 40;

                return (
                  <tr key={user.id}>
                    <td
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        fontWeight: 500,
                        position: "sticky",
                        left: 0,
                        backgroundColor: "var(--surface)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      {user.name}
                      {weeklyWarning && (
                        <span
                          title="週40時間超過"
                          style={{ fontSize: "1rem" }}
                        >
                          ⚠️
                        </span>
                      )}
                    </td>
                    {DAYS.map((d) => {
                      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const shift = shifts.find((s) => s.userId === user.id && s.date === dateStr);
                      const h = shift ? calcHours(shift) : 0;
                      const numHours = h === "OFF" ? 0 : (h as number);
                      const isOver = isDailyOver(numHours);
                      const hasData = !!shift;
                      const isEditedLate = !!shift?.editedAfterDeadline;
                      const cellTitle = isOver ? "1日8時間超過" : isEditedLate ? "締切後に管理者が編集" : hasData ? "クリックで編集" : "";
                      return (
                        <td
                          key={d}
                          onClick={hasData ? () => setEditingCell({ userId: user.id, day: d }) : undefined}
                          style={{
                            border: "1px solid var(--border)",
                            textAlign: "center",
                            backgroundColor: isOver
                              ? "#FEE2E2"
                              : numHours > 0
                                ? "#EEF2FF"
                                : "transparent",
                            color: isOver || isEditedLate ? "#B91C1C" : "inherit",
                            cursor: hasData ? "pointer" : "default",
                          }}
                          title={cellTitle}
                        >
                          {h === "OFF" ? "OFF" : numHours > 0 ? numHours : ""}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        fontWeight: 600,
                        color: weeklyWarning
                          ? "var(--destructive)"
                          : "inherit",
                        textAlign: "center",
                      }}
                    >
                      {totalHours}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 確定通知の既読状況 */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>確定通知の既読状況（直近）</h3>
        {confirmedNotifs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>確定通知はまだありません</p>
        ) : (
          <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>スタッフ</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center" }}>既読</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>通知日時</th>
              </tr>
            </thead>
            <tbody>
              {confirmedNotifs.map((n) => (
                <tr key={n.id}>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>
                    {staffList.find((s) => s.id === n.userId)?.name || n.userId}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center" }}>
                    <span style={{ color: n.read ? "var(--secondary)" : "var(--destructive)", fontWeight: 500 }}>
                      {n.read ? "既読" : "未読"}
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString("ja-JP") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 月別給与集計（確定シフトベース） */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>{year}年{month + 1}月 給与集計</h3>
        {workSummary.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>確定シフトがないため、集計はありません</p>
        ) : (
          <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>スタッフ</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>勤務時間</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>時給</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>給与</th>
              </tr>
            </thead>
            <tbody>
              {workSummary.map((r) => (
                <tr key={r.userId}>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>{r.name}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>{r.totalHours}h</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right" }}>¥{r.hourlyWage.toLocaleString()}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "right", fontWeight: 500 }}>¥{r.salary.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* セル編集モーダル（管理者・締切後編集は赤字で表示） */}
      {editingCell && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => !savingCell && setEditingCell(null)}
        >
          <div
            className="card"
            style={{ minWidth: "280px", maxWidth: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>
              {month + 1}月{editingCell.day}日　{staffList.find((s) => s.id === editingCell.userId)?.name ?? editingCell.userId}
            </h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>希望の勤務に変更（締切後は赤字で記録）</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                { label: "09:00-18:00", start: "09:00", end: "18:00" },
                { label: "10:00-19:00", start: "10:00", end: "19:00" },
                { label: "OFF", start: "00:00", end: "00:00" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  className="btn btn-outline"
                  disabled={savingCell}
                  onClick={async () => {
                    setSavingCell(true);
                    try {
                      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(editingCell.day).padStart(2, "0")}`;
                      await saveShift(
                        {
                          userId: editingCell.userId,
                          date: dateStr,
                          startTime: opt.start,
                          endTime: opt.end,
                          status: "confirmed",
                        },
                        { byAdmin: true }
                      );
                      setEditingCell(null);
                    } catch (e) {
                      console.error(e);
                      alert("更新に失敗しました");
                    } finally {
                      setSavingCell(false);
                    }
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              className="btn btn-outline"
              style={{ marginTop: "1rem", width: "100%" }}
              onClick={() => setEditingCell(null)}
              disabled={savingCell}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
