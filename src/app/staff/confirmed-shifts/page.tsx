"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserShifts, Shift } from "@/services/shiftService";
import { getUserProfile, getAdminIds } from "@/services/userService";
import {
  createShiftChangeRequest,
  getMyShiftChangeRequests,
  ShiftChangeRequest,
} from "@/services/shiftChangeRequestService";
import { createNotification } from "@/services/notificationService";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function calcHours(s: Shift): number {
  if (s.startTime === "00:00" && s.endTime === "00:00") return 0;
  const [sH, sM] = s.startTime.split(":").map(Number);
  const [eH, eM] = s.endTime.split(":").map(Number);
  let h = eH + eM / 60 - (sH + sM / 60);
  if (h > 6) h -= 1;
  return h > 0 ? h : 0;
}

export default function StaffConfirmedShiftsPage() {
  const { user } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [hourlyWage, setHourlyWage] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [myRequests, setMyRequests] = useState<ShiftChangeRequest[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState("");
  const [modalHopeStart, setModalHopeStart] = useState("09:00");
  const [modalHopeEnd, setModalHopeEnd] = useState("18:00");
  const [modalHopeIsOff, setModalHopeIsOff] = useState(false);
  const [modalHopeIsRemote, setModalHopeIsRemote] = useState(false);
  const [modalReason, setModalReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const [detailModalDay, setDetailModalDay] = useState<number | null>(null);
  /** 変更申請モード：true のときのみ日付をクリックしてモーダルを開ける */
  const [changeRequestMode, setChangeRequestMode] = useState(false);

  const lastDay = getDaysInMonth(year, month);
  const daysArray = Array.from({ length: lastDay }, (_, i) => i + 1);
  /** 当月の全日付（YYYY-MM-DD）。変更申請で任意の日を選択可能 */
  const allDatesInMonth = Array.from(
    { length: lastDay },
    (_, i) => `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
  );

  const loadRequests = () => {
    if (!user) return;
    getMyShiftChangeRequests(user.uid).then(setMyRequests).catch(() => {});
  };

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [profile, data, reqs] = await Promise.all([
          getUserProfile(user.uid),
          getUserShifts(user.uid, year, month),
          getMyShiftChangeRequests(user.uid),
        ]);
        if (profile?.hourlyWage) setHourlyWage(profile.hourlyWage);
        setShifts(data.filter((s) => s.status === "confirmed"));
        setMyRequests(reqs);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, year, month]);

  const shiftByDay: Record<number, Shift> = {};
  shifts.forEach((s) => {
    const d = parseInt(s.date.split("-")[2], 10);
    shiftByDay[d] = s;
  });

  /** 当月の変更申請中（pending）の日付 → 申請 */
  const pendingRequestByDay: Record<number, ShiftChangeRequest> = {};
  myRequests
    .filter((r) => r.status === "pending")
    .forEach((r) => {
      const [y, m, d] = r.date.split("-").map(Number);
      if (y === year && m === month + 1) {
        pendingRequestByDay[d] = r;
      }
    });

  let totalHours = 0;
  let salaryExact = 0;
  shifts.forEach((s) => {
    const h = calcHours(s);
    totalHours += h;
    const wage = s.hourlyWage ?? hourlyWage;
    salaryExact += h * wage;
  });
  const salary = Math.floor(salaryExact);

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

  const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"];

  const enterChangeRequestMode = () => {
    setChangeRequestMode(true);
  };

  const exitChangeRequestMode = () => {
    setChangeRequestMode(false);
    setDetailModalDay(null);
  };

  const handleSubmitRequest = async () => {
    if (!user || !modalDate.trim() || !modalReason.trim()) {
      setModalError("対象日と理由を入力してください。");
      return;
    }
    if (!modalHopeIsOff) {
      const startM = parseInt(modalHopeStart.slice(0, 2), 10) * 60 + parseInt(modalHopeStart.slice(3), 10);
      const endM = parseInt(modalHopeEnd.slice(0, 2), 10) * 60 + parseInt(modalHopeEnd.slice(3), 10);
      if (startM >= endM) {
        setModalError("終了時刻は開始時刻より後にしてください。");
        return;
      }
    }
    setSubmitting(true);
    setModalError("");
    try {
      const [start, end] = modalHopeIsOff ? ["00:00", "00:00"] : [modalHopeStart, modalHopeEnd];
      await createShiftChangeRequest(user.uid, modalDate, start, end, modalReason.trim(), modalHopeIsRemote);
      const adminIds = await getAdminIds();
      const message = `${user.name ?? "アルバイト"}さんからシフト変更申請が届きました`;
      await Promise.all(
        adminIds.map((uid) =>
          createNotification(uid, "shift_change_request", message).catch((err) => {
            console.error("[confirmed-shifts] 管理者への通知失敗:", err);
          })
        )
      );
      loadRequests();
      setShowModal(false);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const formatHope = (r: ShiftChangeRequest) => {
    if (r.requestedStartTime === "00:00" && r.requestedEndTime === "00:00") return "OFF";
    return `${r.requestedStartTime}-${r.requestedEndTime}${r.isRemote ? " 在宅" : ""}`;
  };
  const formatDate = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${parseInt(m, 10)}/${day}`;
  };

  if (!user) return null;

  return (
    <div className="card" style={{ overflow: "visible", maxWidth: "100%", minWidth: 0 }}>
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
          <h2 style={{ fontSize: "1.25rem", margin: 0 }}>
            {year}年 {month + 1}月 確定シフト
          </h2>
          <button
            className="btn btn-outline"
            onClick={() => changeMonth(1)}
            style={{ padding: "0.25rem 0.5rem" }}
          >
            ›
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            勤務合計: <strong>{totalHours.toFixed(1)}h</strong>
            {" / "}
            概算給与: <strong style={{ color: "var(--primary)" }}>¥{salary.toLocaleString()}</strong>（時給
            ¥{hourlyWage}）
          </div>
          {changeRequestMode ? (
            <button
              className="btn btn-outline"
              onClick={exitChangeRequestMode}
              title="選択モードを解除"
            >
              選択モード解除
            </button>
          ) : (
            <button
              className="btn btn-outline"
              onClick={enterChangeRequestMode}
              disabled={loading}
              title="日付をクリックして変更申請ができます"
            >
              変更申請
            </button>
          )}
        </div>
      </div>

      {myRequests.length > 0 && (
        <div style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
          <strong>変更申請の状況:</strong>{" "}
          {myRequests.slice(0, 5).map((r) => (
            <span key={r.id} style={{ marginRight: "0.5rem" }}>
              {formatDate(r.date)}→{formatHope(r)}{" "}
              <span style={{ color: r.status === "pending" ? "#F59E0B" : r.status === "approved" ? "var(--secondary)" : "var(--text-muted)" }}>
                {r.status === "pending" ? "申請中" : r.status === "approved" ? "承認" : "却下"}
              </span>
            </span>
          ))}
        </div>
      )}

      {detailModalDay != null && (
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
          onClick={() => { setDetailModalDay(null); }}
        >
          <div
            className="card"
            style={{ width: "90%", maxWidth: "360px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "1rem" }}>
              {month + 1}月{detailModalDay}日
              {dayOfWeek[new Date(year, month, detailModalDay - 1).getDay()]}のシフト
            </h3>
            {(() => {
              const s = shiftByDay[detailModalDay];
              const pendingReq = pendingRequestByDay[detailModalDay];
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(detailModalDay).padStart(2, "0")}`;

              const openChangeRequestForm = () => {
                setDetailModalDay(null);
                setModalDate(dateStr);
                if (s) {
                  const isOff = s.startTime === "00:00" && s.endTime === "00:00";
                  setModalHopeStart(s.startTime);
                  setModalHopeEnd(s.endTime);
                  setModalHopeIsOff(isOff);
                  setModalHopeIsRemote(s.isRemote ?? false);
                } else {
                  setModalHopeStart("09:00");
                  setModalHopeEnd("18:00");
                  setModalHopeIsOff(false);
                  setModalHopeIsRemote(false);
                }
                setModalReason("");
                setModalError("");
                setShowModal(true);
              };

              return (
                <>
                  {s ? (
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>確定シフト</div>
                      <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                        {s.startTime === "00:00" && s.endTime === "00:00" ? "OFF" : `${s.startTime} ～ ${s.endTime}`}
                      </div>
                      {!(s.startTime === "00:00" && s.endTime === "00:00") && (
                        <>
                          <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                            {s.isRemote ? "在宅勤務" : "出社"}
                          </div>
                          <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                            勤務時間: <strong>{calcHours(s).toFixed(1)}h</strong>
                          </div>
                          <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                            時給: <strong>¥{(s.hourlyWage ?? hourlyWage).toLocaleString()}</strong>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                      この日のシフトはありません
                    </p>
                  )}

                  {pendingReq && (
                    <div
                      style={{
                        marginBottom: "1rem",
                        padding: "0.75rem",
                        backgroundColor: "#FFFBEB",
                        border: "1px solid #F59E0B",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#F59E0B", marginBottom: "0.5rem" }}>
                        変更申請中
                      </div>
                      <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                        希望: {formatHope(pendingReq)}
                      </div>
                      <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                        理由: {pendingReq.reason}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                    {!pendingReq && (
                      <button className="btn btn-outline" onClick={openChangeRequestForm}>
                        変更申請
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={() => setDetailModalDay(null)}>
                      閉じる
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {showModal && (
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
          onClick={() => !submitting && setShowModal(false)}
        >
          <div
            className="card"
            style={{ width: "90%", maxWidth: "400px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "1rem" }}>変更申請</h3>
            {modalDate && (
              <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    対象: {modalDate.split("-").map((v, i) => (i === 0 ? `${v}年` : i === 1 ? `${parseInt(v, 10)}月` : `${parseInt(v, 10)}日`)).join("")}
              </div>
            )}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>希望する時刻</label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={modalHopeIsOff} onChange={(e) => setModalHopeIsOff(e.target.checked)} />
                OFF（休み希望）
              </label>
              {!modalHopeIsOff && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                    <input type="checkbox" checked={modalHopeIsRemote} onChange={(e) => setModalHopeIsRemote(e.target.checked)} />
                    在宅
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <input
                      type="time"
                      value={modalHopeStart}
                      onChange={(e) => setModalHopeStart(e.target.value)}
                      style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
                    />
                    <span style={{ fontSize: "0.875rem" }}>～</span>
                    <input
                      type="time"
                      value={modalHopeEnd}
                      onChange={(e) => setModalHopeEnd(e.target.value)}
                      style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}
                    />
                  </div>
                </>
              )}
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                理由 <span style={{ color: "var(--destructive)" }}>*必須</span>
              </label>
              <textarea
                value={modalReason}
                onChange={(e) => setModalReason(e.target.value)}
                rows={3}
                placeholder="例: 用事が入ったため"
                required
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", resize: "vertical" }}
              />
            </div>
            {modalError && <p style={{ color: "var(--destructive)", fontSize: "0.875rem", marginBottom: "0.5rem" }}>{modalError}</p>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setShowModal(false)} disabled={submitting}>
                キャンセル
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmitRequest}
                disabled={submitting || !modalDate.trim() || !modalReason.trim()}
              >
                {submitting ? "送信中..." : "送信"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center" }}>読み込み中...</div>
      ) : shifts.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          この月の確定シフトはまだありません
        </div>
      ) : (
        <div
          style={{
            overflowX: "auto",
            overflowY: "visible",
            marginLeft: "-0.25rem",
            marginRight: "-0.25rem",
            paddingLeft: "0.25rem",
            paddingRight: "0.25rem",
            WebkitOverflowScrolling: "touch",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: "1px",
              backgroundColor: "var(--border)",
              border: "1px solid var(--border)",
              minWidth: "280px",
            }}
          >
            {changeRequestMode && (
              <div style={{ gridColumn: "1 / -1", padding: "0.5rem", backgroundColor: "#EEF2FF", fontSize: "0.85rem", color: "var(--primary)" }}>
                日付をクリックして変更申請
              </div>
            )}
            {dayOfWeek.map((d) => (
              <div
                key={d}
                style={{
                  backgroundColor: "var(--surface-hover)",
                  padding: "0.4rem 0.25rem",
                  textAlign: "center",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  minWidth: 0,
                }}
              >
                {d}
              </div>
            ))}
            {daysArray.map((day) => {
              const date = new Date(year, month, day);
              const dow = date.getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isHoliday = isJapaneseHoliday(date);
              const isRed = isWeekend || isHoliday;
              const s = shiftByDay[day];
              const label = !s
                ? "OFF"
                : s.startTime === "00:00" && s.endTime === "00:00"
                  ? "OFF"
                  : `${s.startTime} - ${s.endTime}${s.isRemote ? " 在宅" : ""}`;

              const pendingReq = pendingRequestByDay[day];
              const isClickable = changeRequestMode || !!pendingReq;
              return (
                <div
                  key={day}
                  role={isClickable ? "button" : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onClick={() => isClickable && setDetailModalDay(day)}
                  onKeyDown={(e) => { if (isClickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDetailModalDay(day); } }}
                  title={pendingReq ? `${day}日の変更申請内容を表示` : isClickable ? `${day}日のシフト詳細・変更申請` : "変更申請を押すと日付をクリックできます"}
                  style={{
                    backgroundColor: "var(--surface)",
                    minHeight: "80px",
                    padding: "0.4rem 0.25rem",
                    minWidth: 0,
                    cursor: isClickable ? "pointer" : "not-allowed",
                  }}
                >
                  <div
                    style={{
                      fontWeight: isRed ? "bold" : 500,
                      fontSize: "0.85rem",
                      marginBottom: "0.25rem",
                      color: isRed ? "#DC2626" : "var(--text-main)",
                    }}
                  >
                    {day}
                  </div>
                  {label && (
                    <div
                      style={{
                        backgroundColor:
                          label === "OFF" ? "#F3F4F6" : "#EEF2FF",
                        color: label === "OFF" ? "#4B5563" : "#4F46E5",
                        padding: "0.15rem 0.2rem",
                        borderRadius: "4px",
                        fontSize: "0.65rem",
                        textAlign: "center",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label === "OFF" ? "OFF" : label}
                    </div>
                  )}
                  {pendingReq && (
                    <div
                      style={{
                        marginTop: "0.15rem",
                        fontSize: "0.7rem",
                        color: "#F59E0B",
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                      title={`変更申請中: ${formatHope(pendingReq)}`}
                    >
                      変更申請中
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
