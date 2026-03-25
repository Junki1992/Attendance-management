"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getPendingShiftChangeRequests,
  approveShiftChangeRequest,
  rejectShiftChangeRequest,
  ShiftChangeRequest,
} from "@/services/shiftChangeRequestService";
import { getAllStaff, getInactiveStaffForAdmin } from "@/services/userService";

export default function AdminShiftChangeRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ShiftChangeRequest[]>([]);
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = () => {
    Promise.all([getPendingShiftChangeRequests(), getAllStaff(), getInactiveStaffForAdmin()])
      .then(([reqs, activeStaff, inactiveStaff]) => {
        setRequests(reqs);
        setStaffList([...activeStaff, ...inactiveStaff]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const getName = (uid: string) => staffList.find((s) => s.id === uid)?.name ?? uid;

  const formatHope = (r: ShiftChangeRequest) => {
    if (r.requestedStartTime === "00:00" && r.requestedEndTime === "00:00") return "OFF";
    return `${r.requestedStartTime} - ${r.requestedEndTime}${r.isRemote ? " 在宅" : ""}`;
  };

  const formatDate = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${y}年${parseInt(m, 10)}月${day}日`;
  };

  const handleApprove = async (id: string) => {
    if (!user) return;
    setProcessing(id);
    try {
      await approveShiftChangeRequest(id, user.uid);
      load();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "承認に失敗しました");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!user) return;
    setProcessing(id);
    try {
      await rejectShiftChangeRequest(id, user.uid);
      load();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "却下に失敗しました");
    } finally {
      setProcessing(null);
    }
  };

  if (!user) return null;

  return (
    <div>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>変更申請</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        確定後のシフト変更を申請されたものはここで承認または却下できます。承認するとシフト表に自動で反映されます。
      </p>

      {loading ? (
        <div className="card">読み込み中...</div>
      ) : requests.length === 0 ? (
        <div className="card" style={{ color: "var(--text-muted)" }}>
          保留中の申請はありません
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>アルバイト</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>日付</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>希望</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "left" }}>理由</th>
                <th style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center", minWidth: "180px" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>{getName(r.userId)}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>{formatDate(r.date)}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)" }}>{formatHope(r)}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", maxWidth: "200px" }}>{r.reason}</td>
                  <td style={{ padding: "0.5rem", border: "1px solid var(--border)", textAlign: "center" }}>
                    <button
                      className="btn btn-primary"
                      style={{ marginRight: "0.5rem", padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      onClick={() => handleApprove(r.id!)}
                      disabled={processing !== null}
                    >
                      {processing === r.id ? "処理中..." : "承認"}
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                      onClick={() => handleReject(r.id!)}
                      disabled={processing !== null}
                    >
                      却下
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
