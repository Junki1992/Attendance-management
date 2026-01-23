"use client";

import { useState, useEffect, useCallback } from "react";
import {
  confirmShifts,
  subscribeAllShifts,
  getUnsubmittedStaff,
  Shift,
} from "@/services/shiftService";
import { getAllStaff, StaffItem } from "@/services/userService";
import { createNotification } from "@/services/notificationService";

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

  const lastDay = new Date(year, month + 1, 0).getDate();
  const DAYS = Array.from({ length: lastDay }, (_, i) => i + 1);

  useEffect(() => {
    getAllStaff().then(setStaffList);
  }, []);

  useEffect(() => {
    getUnsubmittedStaff(year, month).then(setUnsubmitted);
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
      await Promise.all(
        affectedUserIds.map((uid) =>
          createNotification(
            uid,
            "shift_confirmed",
            `${month + 1}月のシフトが確定しました。確認してください。`
          )
        )
      );
      alert(`${affectedUserIds.length}名のスタッフに通知を送りました！`);
    } catch (e) {
      console.error(e);
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

  return (
    <div>
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
                      const hours = getShift(user.id, d);
                      const isOver = isDailyOver(hours);
                      return (
                        <td
                          key={d}
                          style={{
                            border: "1px solid var(--border)",
                            textAlign: "center",
                            backgroundColor: isOver
                              ? "#FEE2E2"
                              : hours > 0
                                ? "#EEF2FF"
                                : "transparent",
                            color: isOver ? "#EF4444" : "inherit",
                            cursor: "default",
                          }}
                          title={isOver ? "1日8時間超過" : ""}
                        >
                          {hours > 0 ? hours : ""}
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
    </div>
  );
}
