"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserShifts, Shift } from "@/services/shiftService";
import { getUserProfile } from "@/services/userService";

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

  const lastDay = getDaysInMonth(year, month);
  const daysArray = Array.from({ length: lastDay }, (_, i) => i + 1);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [profile, data] = await Promise.all([
          getUserProfile(user.uid),
          getUserShifts(user.uid, year, month),
        ]);
        if (profile?.hourlyWage) setHourlyWage(profile.hourlyWage);
        setShifts(data.filter((s) => s.status === "confirmed"));
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

  let totalHours = 0;
  let salary = 0;
  shifts.forEach((s) => {
    totalHours += calcHours(s);
  });
  salary = Math.floor(totalHours * hourlyWage);

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

  if (!user) return null;

  return (
    <div className="card">
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
        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
          勤務合計: <strong>{totalHours.toFixed(1)}h</strong>
          {" / "}
          概算給与: <strong style={{ color: "var(--primary)" }}>¥{salary.toLocaleString()}</strong>（時給
          ¥{hourlyWage}）
        </div>
      </div>

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
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: "1px",
            backgroundColor: "var(--border)",
            border: "1px solid var(--border)",
          }}
        >
          {dayOfWeek.map((d) => (
            <div
              key={d}
              style={{
                backgroundColor: "var(--surface-hover)",
                padding: "0.5rem",
                textAlign: "center",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              {d}
            </div>
          ))}
          {daysArray.map((day) => {
            const date = new Date(year, month, day);
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const s = shiftByDay[day];
            const label = !s
              ? ""
              : s.startTime === "00:00" && s.endTime === "00:00"
                ? "OFF"
                : `${s.startTime} - ${s.endTime}`;

            return (
              <div
                key={day}
                style={{
                  backgroundColor: "var(--surface)",
                  minHeight: "80px",
                  padding: "0.5rem",
                  color: isWeekend ? "var(--destructive)" : "inherit",
                }}
              >
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: "0.9rem",
                    marginBottom: "0.25rem",
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
                      padding: "0.1rem",
                      borderRadius: "4px",
                      fontSize: "0.7rem",
                      textAlign: "center",
                      fontWeight: 500,
                    }}
                  >
                    {label === "OFF" ? "OFF" : label}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
