"use client";

import { auth } from "@/lib/firebase/firebase";
import { APP_NAME } from "@/lib/app-config";
import { sendPasswordResetEmail, signOut } from "firebase/auth";
import Link from "next/link";
import { useEffect, useState } from "react";

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/** Firebase Auth のエラーコードを日本語に */
function authErrorToMessage(code: string): string {
  const m: Record<string, string> = {
    "auth/invalid-email": "メールアドレスの形式が正しくありません",
    "auth/user-not-found": "このメールアドレスは登録されていません",
    "auth/too-many-requests": "試行が多すぎます。しばらく待ってから再度お試しください",
    "auth/network-request-failed": "ネットワークエラーです。接続を確認してください",
  };
  return m[code] ?? "送信に失敗しました。しばらくしてから再度お試しください";
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // このページに来た時点でセッションを破棄。 credentials なしで管理画面へ行くのを防ぐ
  useEffect(() => {
    signOut(auth);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("メールアドレスを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://attendance-management-4bf79.web.app";
      await sendPasswordResetEmail(auth, email.trim(), {
        url: `${baseUrl}/reset-password`,
        handleCodeInApp: true,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      setError(authErrorToMessage(code));
    } finally {
      setSubmitting(false);
    }
  };

  if (!FIREBASE_PROJECT_ID) {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "var(--primary)" }}>{APP_NAME} パスワードを忘れた場合</h1>
          <p style={{ marginBottom: "1rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Firebase が未設定です。.env.local を確認してください。
          </p>
          <Link href="/login" className="btn btn-outline" style={{ display: "inline-block" }}>
            ログインに戻る
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "var(--primary)" }}>
            {APP_NAME}<br />メールを送信しました
          </h1>
          <p style={{ marginBottom: "1.5rem", color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            ご登録のメールアドレスにパスワード再設定のリンクを送信しました。
            <br />
            メールが届かない場合は、迷惑メールフォルダをご確認ください。
          </p>
          <Link href="/login" className="btn btn-primary" style={{ display: "inline-block" }}>
            ログインに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
        <h1 style={{ marginBottom: "0.5rem", fontSize: "1.25rem", color: "var(--primary)", textAlign: "center" }}>
          {APP_NAME}<br />パスワードを忘れた場合
        </h1>
        <p style={{ marginBottom: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
          登録したメールアドレスを入力すると、<br />パスワード再設定用のリンクをお送りします
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label htmlFor="email" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@company.com"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          {error && <p style={{ color: "var(--destructive)", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "送信中..." : "送信する"}
          </button>
        </form>

        <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
          <Link href="/login" style={{ color: "var(--primary)", textDecoration: "underline" }}>
            ログインに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
