# シフト管理システム (Attendance Management)

Next.js と Firebase を使用したアルバイト・パート向けシフト管理アプリケーションです。

## 機能一覧 (予定含む)

- **スタッフ機能**
  - シフト提出（カレンダーUI）
  - 自分のシフト確認
  - チャット機能（管理者との連絡）
  - 給与概算確認（実装予定）

- **管理者機能**
  - スタッフからのシフト提出一覧確認
  - シフトの確定・修正
  - 未提出者への通知（実装予定）
  - 36協定（週40時間超過）アラート表示
  - チャット管理

## 技術スタック

- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (一部 Module CSS / Global CSS)
- **Database**: Firebase Firestore
- **Auth**: Firebase Authentication (予定)

## セットアップ手順

1. リポジトリをクローン
2. 依存関係のインストール
   ```bash
   npm install
   ```
3. 環境変数の設定
   `.env.local` ファイルを作成し、Firebaseの設定情報を記述してください。
4. 開発サーバーの起動
   ```bash
   npm run dev
   ```
   [http://localhost:3000](http://localhost:3000) で確認できます。

## デプロイ

Vercel へのデプロイを推奨しています。
