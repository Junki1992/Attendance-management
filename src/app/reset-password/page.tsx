"use client";

import { auth } from "@/lib/firebase/firebase";
import { APP_NAME } from "@/lib/app-config";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/** Firebase Auth のエラーコードを日本語に */
function authErrorToMessage(code: string): string {
  const m: Record<string, string> = {
    "auth/expired-action-code": "リンクの有効期限が切れています。パスワードリセットを再度お試しください。",
    "auth/invalid-action-code": "リンクが無効です。すでに使用済みか、正しくありません。",
    "auth/user-disabled": "このアカウントは無効です",
    "auth/user-not-found": "アカウントが見つかりません",
    "auth/weak-password": "パスワードは 6 文字以上にしてください",
   };
  return m[code] ?? "パスワードの再設定に失敗しました。再度お試しください。";
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode");
  const mode = searchParams.get("mode");

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [validating, setValidating] = useState(true);
  const [invalidCode, setInvalidCode] = useState(false);

  useEffect(() => {
    if (!oobCode || mode !== "resetPassword") {
      setValidating(false);
      setInvalidCode(true);
      return;
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => {
        setEmail(email);
        setValidating(false);
      })
      .catch(() => {
        setValidating(false);
        setInvalidCode(true);
      });
  }, [oobCode, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!oobCode || password.length < 6) {
      setError("パスワードは 6 文字以上で入力してください");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
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
          <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "var(--primary)" }}>{APP_NAME} - パスワードの再設定</h1>
          <p style={{ marginBottom: "1rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>Firebase が未設定です。</p>
          <Link href="/login" className="btn btn-outline" style={{ display: "inline-block" }}>ログインに戻る</Link>
        </div>
      </div>
    );
  }

  if (validating) {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <p>確認中...</p>
        </div>
      </div>
    );
  }

  if (invalidCode) {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "var(--primary)" }}>リンクが無効です</h1>
          <p style={{ marginBottom: "1.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            リンクの有効期限が切れているか、すでに使用済みです。パスワードリセットを再度お試しください。
          </p>
          <Link href="/forgot-password" className="btn btn-primary" style={{ display: "inline-block" }}>パスワードリセットを再申請</Link>
          <p style={{ marginTop: "1rem" }}>
            <Link href="/login" style={{ color: "var(--primary)", textDecoration: "underline", fontSize: "0.875rem" }}>ログインに戻る</Link>
          </p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "var(--primary)" }}>パスワードを変更しました</h1>
          <p style={{ marginBottom: "1.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            新しいパスワードでログインできます。
          </p>
          <Link href="/login" className="btn btn-primary" style={{ display: "inline-block" }}>ログインする</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
        <h1 style={{ marginBottom: "0.5rem", fontSize: "1.25rem", color: "var(--primary)", textAlign: "center" }}>
          {APP_NAME} - パスワードの再設定
        </h1>
        <p style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
          メールアドレス: {email}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label htmlFor="password" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
              新しいパスワード
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6文字以上"
                minLength={6}
                style={{
                  width: "100%",
                  padding: "0.5rem 2.5rem 0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                style={{
                  position: "absolute",
                  right: "0.5rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0.25rem",
                  color: "var(--text-muted)",
                }}
              >
                <i className={`fa-solid fa-${showPassword ? "eye-slash" : "eye"}`} style={{ fontSize: "1rem" }} />
              </button>
            </div>
          </div>
          {error && <p style={{ color: "var(--destructive)", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "保存中..." : "保存"}
          </button>
        </form>

        <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
          <Link href="/login" style={{ color: "var(--primary)", textDecoration: "underline" }}>ログインに戻る</Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}><p>読み込み中...</p></div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
