import React, { useState } from "react";

export default function HelpButton({ scope }: { scope: "staff" | "admin" | "general" }) {
  const [open, setOpen] = useState(false);
  const title = scope === "staff" ? "アルバイト向けヘルプ" : scope === "admin" ? "管理者向けヘルプ" : "マニュアル";
  const intro =
    scope === "staff"
      ? "シフト提出・確定シフト・チャットの使い方を確認できます。詳しい手順は「マニュアル」ページをご覧ください。"
      : scope === "admin"
      ? "シフト管理、変更申請の承認、チャット、設定の操作手順を確認できます。詳しい手順は「マニュアル」ページをご覧ください。"
      : "画面操作マニュアルへ移動します。";

  return (
    <>
    <button
        onClick={() => setOpen(true)}
        aria-label="ヘルプ"
        title="ヘルプ"
        style={{
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          padding: "0.25rem 0.5rem",
          fontWeight: 600,
        }}
      >
        ヘルプ
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 120,
            padding: "1rem",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 760, width: "100%", padding: "1rem", borderRadius: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0 }}>{title}</h3>
              <button onClick={() => setOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18 }}>
                ×
              </button>
            </div>
            <p style={{ marginTop: 0 }}>{intro}</p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <a href={scope === "staff" ? "/manual/staff" : scope === "admin" ? "/manual/admin" : "/manual"} style={{ textDecoration: "none", padding: "0.5rem 0.75rem", background: "#eef2ff", borderRadius: 6 }}>
                マニュアルを開く
              </a>
              <a href="/manual" style={{ textDecoration: "none", padding: "0.5rem 0.75rem", background: "#f3f4f6", borderRadius: 6 }}>
                共通の操作を確認
              </a>
            </div>
            <div style={{ marginTop: "1rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
              <strong>すぐやる操作例</strong>
              <ul>
                <li>メッセージ送信: チャット画面で入力して「送信」。</li>
                <li>シフト提出（アルバイト）: シフト提出ページで日付を選んで「提出内容を保存」。</li>
                <li>シフト確定（管理者）: シフト表で「確定して通知」をクリック。</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

