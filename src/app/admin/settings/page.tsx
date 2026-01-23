"use client";

import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/services/settingsService";

export default function AdminSettingsPage() {
  const [deadlineDay, setDeadlineDay] = useState(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setDeadlineDay(s.shiftSubmitDeadlineDay);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

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

  if (loading) {
    return <div className="card">読み込み中...</div>;
  }

  return (
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
  );
}
