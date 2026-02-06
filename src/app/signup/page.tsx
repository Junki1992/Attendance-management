"use client";

import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/** 登録用：Firebase Auth / Firestore のエラーを日本語に。未対応コードはそのまま表示して原因を特定しやすくする */
function getSignupErrorMessage(err: unknown): string {
    const code = (err as { code?: string })?.code ?? "";
    const msg = (err as { message?: string })?.message ?? "";
    const m: Record<string, string> = {
        "auth/email-already-in-use": "このメールアドレスは既に登録されています。Firestore の権限エラーで登録に失敗した場合、Firebase コンソール → Authentication → ユーザー タブから該当ユーザーを削除してから再度登録してください。",
        "auth/weak-password": "パスワードは6文字以上にしてください",
        "auth/invalid-email": "メールアドレスの形式が正しくありません",
        "auth/operation-not-allowed": "この認証方法は有効になっていません",
        "auth/too-many-requests": "試行が多すぎます。しばらく待ってから再度お試しください",
        "auth/network-request-failed": "ネットワークエラーです。接続を確認してください",
        "auth/api-key-not-valid": "API キーが無効です。.env.local の NEXT_PUBLIC_FIREBASE_API_KEY を、Firebase コンソール「プロジェクトの設定」→「全般」の Web API キーと照らし、正しく貼り付けてから開発サーバーを再起動してください。",
        "auth/configuration-not-found": "Auth の設定が見つかりません。NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を「プロジェクトID.firebaseapp.com」にしてください（firebasestorage.app ではない）。認証で「メール/パスワード」が有効かも確認し、修正後に開発サーバーを再起動してください。",
        // Firestore（createUser の setDoc で発生しうる）
        "permission-denied": "Firestore の権限エラーです。以下の手順を実行してください：1) Firebase コンソール → Authentication → ユーザー タブから、登録に失敗したメールアドレスのユーザーを削除、2) Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリック、3) 再度新規登録を試してください。管理者として登録する場合は、`NEXT_PUBLIC_FIRST_ADMIN_EMAIL` で指定したメールアドレスで登録してください。",
        "missing-or-insufficient-permissions": "Firestore の権限エラーです。Firebase コンソール → Firestore Database → ルール タブで、プロジェクトルートの `firestore.rules` ファイルの内容をコピーして貼り付け「公開」をクリックしてください。登録に失敗した場合は、Firebase コンソール → Authentication → ユーザー タブから該当ユーザーを削除してから再度登録してください。",
        "unavailable": "Firestore に接続できません。ネットワークを確認してください。",
        "failed-precondition": "Firestore の操作が許可されていません。ルールを確認してください。",
    };
    const known = m[code];
    if (known) return known;
    if (code.includes("api-key-not-valid") || code.includes("api-key-not-valid.")) {
        return "API キーが無効です。.env.local の NEXT_PUBLIC_FIREBASE_API_KEY を、Firebase コンソール「プロジェクトの設定」→「全般」の Web API キーと照らし、正しく貼り付けてから開発サーバーを再起動してください。";
    }
    if (code.includes("configuration-not-found")) {
        return "Auth の設定が見つかりません。NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を「プロジェクトID.firebaseapp.com」にしてください（firebasestorage.app ではない）。認証で「メール/パスワード」が有効かも確認し、修正後に開発サーバーを再起動してください。";
    }
    // 未対応コードは表示して原因を特定しやすく
    if (code) return `登録に失敗しました（${code}）`;
    if (typeof msg === "string" && msg.length > 0 && msg.length < 120) return `登録に失敗しました（${msg})`;
    return "登録に失敗しました";
}

export default function SignupPage() {
    const { user, register, loading } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [name, setName] = useState("");
    const [chatworkAccountId, setChatworkAccountId] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < 768);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    useEffect(() => {
        if (user) {
            if (user.role === "admin") router.push("/admin");
            else router.push("/staff");
        }
    }, [user, router]);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError("");
        if (!email.trim()) {
            setSubmitError("メールアドレスを入力してください");
            return;
        }
        if (!name.trim()) {
            setSubmitError("名前を入力してください");
            return;
        }
        if (!chatworkAccountId.trim()) {
            setSubmitError("Chatwork アカウントIDを入力してください");
            return;
        }
        if (!/^\d+$/.test(chatworkAccountId.trim())) {
            setSubmitError("Chatwork アカウントIDは数字のみです（プロフィール→アカウントで確認）");
            return;
        }
        if (password.length < 6) {
            setSubmitError("パスワードは6文字以上にしてください");
            return;
        }
        if (password !== passwordConfirm) {
            setSubmitError("パスワードとパスワード（確認）が一致しません");
            return;
        }
        setSubmitting(true);
        try {
            await register(email.trim(), password, name.trim(), chatworkAccountId.trim());
            // リダイレクトは useEffect（user の変化）に任せる。user がセットされるまで
            // submitting は true のまま「登録中...」を表示し二重送信を防ぐ
        } catch (err: unknown) {
            if (process.env.NODE_ENV === "development") {
                console.error("[signup] register error:", err);
            }
            setSubmitError(getSignupErrorMessage(err));
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

    // Firebase 未設定時
    if (!FIREBASE_PROJECT_ID) {
        return (
            <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
                <div className="card" style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
                    <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem", color: "var(--primary)" }}>新規登録</h1>
                    <p style={{ marginBottom: "1.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                        Firebase を設定してください。.env.local に NEXT_PUBLIC_FIREBASE_* を設定すると、新規登録が利用できます。
                    </p>
                    <Link href="/login" className="btn btn-primary" style={{ width: "100%" }}>
                        ログインへ戻る
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
            <div className="card" style={{ width: "100%", maxWidth: "400px" }}>
                <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", color: "var(--primary)", textAlign: "center" }}>
                    新規登録
                </h1>

                <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                        <label htmlFor="name" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
                            名前
                        </label>
                        <input
                            id="name"
                            type="text"
                            autoComplete="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="山田 太郎"
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
                        <label htmlFor="chatworkAccountId" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
                            Chatwork アカウントID（数字）
                        </label>
                        <input
                            id="chatworkAccountId"
                            type="text"
                            autoComplete="off"
                            value={chatworkAccountId}
                            onChange={(e) => setChatworkAccountId(e.target.value)}
                            placeholder="例: 12345678"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            style={{
                                width: "100%",
                                padding: "0.5rem 0.75rem",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border)",
                                fontSize: "1rem",
                                boxSizing: "border-box",
                            }}
                        />
                        <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            数字のアカウントID（マイチャットでメッセージを引用すると aid= の後に表示）。通知時に To: メンションで届きます。
                        </p>
                    </div>
                    <div>
                        <label htmlFor="password" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
                            パスワード（6文字以上）
                        </label>
                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
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
                    <div>
                        <label htmlFor="passwordConfirm" style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem", color: "var(--text-main)" }}>
                            パスワード（確認）
                        </label>
                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                            <input
                                id="passwordConfirm"
                                type={showPasswordConfirm ? "text" : "password"}
                                autoComplete="new-password"
                                value={passwordConfirm}
                                onChange={(e) => setPasswordConfirm(e.target.value)}
                                placeholder="••••••••"
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
                                onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                                aria-label={showPasswordConfirm ? "パスワードを隠す" : "パスワードを表示"}
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
                                <i className={`fa-solid fa-${showPasswordConfirm ? "eye-slash" : "eye"}`} style={{ fontSize: "1rem" }} />
                            </button>
                        </div>
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
                        {submitting ? "登録中..." : "登録する"}
                    </button>
                </form>

                <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>
                    <Link href="/login" style={{ color: "var(--primary)", textDecoration: "underline" }}>
                        すでにアカウントをお持ちの方はログイン
                    </Link>
                </p>
            </div>
        </div>
    );
}
