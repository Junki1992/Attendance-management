"use client";

import { useAuth } from "@/context/AuthContext";
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
        "auth/api-key-not-valid": "API キーが無効です。.env.local の NEXT_PUBLIC_FIREBASE_API_KEY を、Firebase コンソール「プロジェクトの設定」→「全般」の Web API キーと一致させ、修正後に開発サーバーを再起動してください。",
        "auth/configuration-not-found": "Auth の設定が見つかりません。NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を「プロジェクトID.firebaseapp.com」にしてください（firebasestorage.app ではない）。認証で「メール/パスワード」が有効かも確認し、修正後に開発サーバーを再起動してください。",
        // Firestore のエラー
        "permission-denied": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        "missing-or-insufficient-permissions": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        "firestore-permission-denied": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。",
        // プロフィールが見つからない
        "user-profile-not-found": "ユーザープロフィールが見つかりません。Firestore の `users/{uid}` ドキュメントが存在しない可能性があります。以下のいずれかの方法で対処してください：1) Firebase コンソール → Authentication → ユーザー タブから該当ユーザーを削除してから新規登録をやり直す、2) Firebase コンソール → Firestore Database → データ タブで `users/{uid}` ドキュメントを手動で作成する（`email`, `name`, `role` フィールドに \"staff\" または \"admin\"、`hourlyWage` フィールドに `1000` を設定）。",
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
    const { user, login, loginMock, loading } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [devOpen, setDevOpen] = useState(false);

    useEffect(() => {
        if (user) {
            if (user.role === "admin") router.push("/admin");
            else router.push("/staff");
        }
    }, [user, router]);

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
                    <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem", color: "var(--primary)" }}>勤怠管理ツール</h1>
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
                    勤怠管理ツール
                </h1>

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
                    <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
                        {submitting ? "ログイン中..." : "ログイン"}
                    </button>
                </form>

                <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
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
