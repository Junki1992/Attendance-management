import React from "react";
import { APP_NAME } from "@/lib/app-config";

export const metadata = {
  title: `マニュアル - ${APP_NAME}`,
};

export default function ManualPage() {
  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto", lineHeight: 1.6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>ユーザーマニュアル（エンドユーザー向け）</h1>
        <a href="/" style={{ padding: "0.5rem 0.75rem", background: "#e6f4ea", borderRadius: 6, textDecoration: "none", color: "var(--text-main)", fontWeight: 600 }}>
          アプリに戻る
        </a>
      </div>
      <p>対象: 本アプリを操作するエンドユーザー（アルバイト／管理者）</p>

      <div style={{ margin: "1rem 0", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <a href="/manual/staff" style={{ padding: "0.5rem 0.75rem", background: "#EEF2FF", borderRadius: 6, textDecoration: "none", color: "var(--primary)", fontWeight: 600 }}>アルバイト向けマニュアル</a>
        <a href="/manual/admin" style={{ padding: "0.5rem 0.75rem", background: "#FEF3C7", borderRadius: 6, textDecoration: "none", color: "var(--text-main)", fontWeight: 600 }}>管理者向けマニュアル</a>
      </div>

      <h2>概要</h2>
      <p>勤怠管理アプリの基本的な使い方をまとめたマニュアルです。ここではログイン、プロフィール、チャット、通知など日常的に使う操作を説明します。</p>

      <h2>ログイン</h2>
      <p>アプリを利用するにはログインが必要です。ログインしたアカウントでできる操作が変わります。</p>

      <h2>プロフィール</h2>
      <p>プロフィール画面で表示名やプロフィール写真を設定・編集できます。プロフィール写真はご自身のアカウントのみ変更できます。</p>

      <h2>チャットの使い方（基本）</h2>
      <ol>
        <li>チャット画面を開くと、相手とのメッセージ履歴が表示されます。</li>
        <li>テキストを入力して「送信」ボタンを押すとメッセージが送信されます（空白のみは不可）。</li>
        <li>ファイル添付: クリップボタンで選択。サポート形式は画像（jpg/png 等）と PDF のみ。画像はプレビュー、PDF はダウンロードリンクで表示されます。</li>
        <li>既読: 相手がメッセージを確認すると「既読」と表示されます（反映に遅延が生じることがあります）。</li>
      </ol>

      <h2>複数相手のチャット（アルバイト向け）</h2>
      <p>アルバイト向けビューでは管理者グループなど複数の相手からのメッセージをまとめて確認できます。操作は通常のチャットと同じです。</p>

      <h2>通知</h2>
      <p>新しいメッセージが届くとアプリ内通知が表示されます。通知一覧から該当メッセージへ移動してください。</p>

      <h2>モバイルでの使い方</h2>
      <p>画面幅が狭い場合、入力欄が下部に固定表示され操作しやすくなっています。表示に問題があればページを再読み込みしてください。</p>

      <h2>よくあるトラブルと対処法</h2>
      <ul>
        <li>ファイルが送れない: 対応形式（画像/PDF）以外は送れません。ファイルを変換するか圧縮してください。</li>
        <li>メッセージが表示されない: ネットワーク接続を確認し、必要なら再読み込みや再ログインを試してください。</li>
        <li>既読表示が遅い: 数秒〜数十秒の遅延が発生することがあります。少し待ってから確認してください。</li>
      </ul>

      <h2>サポートへの連絡</h2>
      <p>アプリ内の管理者連絡先、または職場のシステム管理者へお問い合わせください。スクリーンショットを添えると対応が早くなります。</p>
    </main>
  );
}

