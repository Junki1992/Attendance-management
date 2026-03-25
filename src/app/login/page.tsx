"use client";

import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase/firebase";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
// 本番環境では false。開発環境でのみ有効化する場合は .env.local に NEXT_PUBLIC_ENABLE_MOCK_LOGIN=1 を設定
const ENABLE_MOCK_LOGIN = process.env.NEXT_PUBLIC_ENABLE_MOCK_LOGIN === "1";

/** Firebase Auth のエラーコードを日本語に */
function authErrorToMessage(code: string): string {
    const m: Record<string, string> = {
        "auth/invalid-email": "メールアドレスの形式が正しくありません",
        "auth/user-disabled": "このアカウントは無効です",
        "auth/user-not-found": "アカウントが見つかりません",
        "auth/wrong-password": "パスワードが違います",
        "auth/invalid-credential": "メールアドレスまたはパスワードが正しくありません",
        "auth/too-many-requests": "試行が多すぎます。しばらく待ってから再度お試しください",
        "auth/network-request-failed": "ネットワークエラーです。接続を確認してください",
        "auth/popup-closed-by-user": "ログインがキャンセルされました",
        "auth/cancelled-popup-request": "ログインがキャンセルされました",
        "auth/account-exists-with-different-credential": "このメールアドレスは別のログイン方法で登録されています。メール・パスワードでログインするか、その方法をお試しください",
        "auth/api-key-not-valid": "API キーが無効です。.env.local の NEXT_PUBLIC_FIREBASE_API_KEY を、Firebase コンソール「プロジェクトの設定」→「全般」の Web API キーと一致させ、修正後に開発サーバーを再起動してください。",
        "auth/configuration-not-found": "Auth の設定が見つかりません。NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を「プロジェクトID.firebaseapp.com」にしてください（firebasestorage.app ではない）。認証で「メール/パスワード」が有効かも確認し、修正後に開発サーバーを再起動してください。",
        // Firestore のエラー
        "permission-denied": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        "missing-or-insufficient-permissions": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        "firestore-permission-denied": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        // プロフィールが見つからない
        "user-profile-not-found": "プロフィールが見つかりません。再登録するか管理者に連絡してください。",
        "employment-blocked": "このアカウントは停職または退職のためログインできません。管理者に連絡してください。",
    };
    const known = m[code];
    if (known) return known;
    if (code.includes("api-key-not-valid") || code.includes("api-key-not-valid.")) {
        return "API キーが無効です。.env.local の NEXT_PUBLIC_FIREBASE_API_KEY を、Firebase コンソール「プロジェクトの設定」→「全般」の Web API キーと一致させ、修正後に開発サーバーを再起動してください。";
    }
    if (code.includes("configuration-not-found")) {
        return "Auth の設定が見つかりません。NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を「プロジェクトID.firebaseapp.com」にしてください（firebasestorage.app ではない）。認証で「メール/パスワード」が有効かも確認し、修正後に開発サーバーを再起動してください。";
    }
    if (code.includes("permission-denied") || code.includes("missing-or-insufficient-permissions")) {
        return "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。";
    }
    return "ログインに失敗しました";
}

export default function LoginPage() {
    const { user, login, loginMock, loginWithGoogle, loading } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [devOpen, setDevOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [sessionCleared, setSessionCleared] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < 768);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    // ログイン画面に来た時点でセッションを破棄。credentials なしで管理画面へ行くのを防ぐ
    useEffect(() => {
        signOut(auth).then(() => setSessionCleared(true));
    }, []);

    // セッション破棄後にログイン成功した場合のみリダイレクト（既存セッションでの自動遷移を防ぐ）
    useEffect(() => {
        if (sessionCleared && user) {
            if (user.role === "admin") router.push("/admin");
            else router.push("/staff");
        }
    }, [sessionCleared, user, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError("");
        if (!email.trim()) {
            setSubmitError("メールアドレスを入力してください");
            return;
        }
        if (!password) {
            setSubmitError("パスワードを入力してください");
            return;
        }
        setSubmitting(true);
        try {
            await login(email.trim(), password);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code ?? "";
            setSubmitError(authErrorToMessage(code));
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogleLogin = async () => {
        setSubmitError("");
        setSubmitting(true);
        try {
            await loginWithGoogle();
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code ?? "";
            setSubmitError(authErrorToMessage(code));
        } finally {
            setSubmitting(false);
        }
    };

    const handleMockLogin = async (role: "admin" | "staff") => {
        setSubmitError("");
        setSubmitting(true);
        try {
            await loginMock(role);
        } catch (e) {
            setSubmitError("モックログインに失敗しました");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
                <p>Loading...</p>
            </div>
        );
    }

    // Firebase 未設定時：モックのみ
    if (!FIREBASE_PROJECT_ID) {
        return (
            <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
                <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
                    <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem", color: "var(--primary)" }}>ログイン</h1>
                    <p style={{ marginBottom: "1.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                        開発用モックログイン
                        <br />
                        <small>.env.local に NEXT_PUBLIC_FIREBASE_* を設定すると、メール+パスワードでログインできます</small>
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <button onClick={() => handleMockLogin("admin")} className="btn btn-primary" style={{ width: "100%" }}>
                            管理者としてログイン
                        </button>
                        <button onClick={() => handleMockLogin("staff")} className="btn btn-outline" style={{ width: "100%" }}>
                            アルバイトとしてログイン
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // メール+パスワードをメインに表示
    return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
                <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", color: "var(--primary)", textAlign: "center" }}>
                    ログイン
                </h1>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
                    <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={submitting}
                        style={{
                            width: "100%",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.5rem",
                            padding: "0.6rem 1rem",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--border)",
                            background: "#fff",
                            fontSize: "0.95rem",
                            cursor: submitting ? "not-allowed" : "pointer",
                            color: "var(--text-main)",
                            boxSizing: "border-box",
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Googleでログイン
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>または</span>
                        <span style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
                    </div>
                </div>

                <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                    <div>
                        <label htmlFor="password" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
                            パスワード
                        </label>
                        <input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
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
                    {submitError && (
                        <p style={{ color: "var(--destructive)", fontSize: "0.875rem", margin: 0 }}>{submitError}</p>
                    )}
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{
                            width: isMobile ? "85%" : "100%",
                            alignSelf: isMobile ? "center" : undefined,
                            padding: isMobile ? "0.85rem 1.25rem" : undefined,
                        }}
                        disabled={submitting}
                    >
                        {submitting ? "ログイン中..." : "ログイン"}
                    </button>
                </form>

                <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
                    <Link href="/forgot-password" style={{ color: "var(--primary)", textDecoration: "underline" }}>
                        パスワードを忘れた方
                    </Link>
                    {" · "}
                    <Link href="/signup" style={{ color: "var(--primary)", textDecoration: "underline" }}>
                        新規登録はこちら
                    </Link>
                </p>

                {ENABLE_MOCK_LOGIN && (
                    <details
                        style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}
                        open={devOpen}
                        onToggle={(e) => setDevOpen((e.target as HTMLDetailsElement).open)}
                    >
                        <summary style={{ fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer" }}>
                            開発・検証用：パスワードなしでログイン
                        </summary>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{ width: "100%", fontSize: "0.875rem" }}
                                onClick={() => handleMockLogin("admin")}
                                disabled={submitting}
                            >
                                管理者（モック）
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{ width: "100%", fontSize: "0.875rem" }}
                                onClick={() => handleMockLogin("staff")}
                                disabled={submitting}
                            >
                                アルバイト（モック）
                            </button>
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
}
