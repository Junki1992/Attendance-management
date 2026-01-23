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
- **Auth**: Firebase Authentication（メール+パスワード）。未設定時は開発用モック（ボタン 1 クリック）でログイン可能

## セットアップ手順

1. リポジトリをクローン
2. 依存関係のインストール
   ```bash
   npm install
   ```
3. 環境変数の設定
   `.env.local` を作成し、次の Firebase 用変数を記述します（値は Firebase コンソールの「プロジェクトの設定」→「全般」→「マイアプリ」で取得）：
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=あなたのプロジェクト.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=あなたのプロジェクトID
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=あなたのプロジェクト.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```
   **API キー**は「Web API キー」をそのままコピーしてください。`auth/api-key-not-valid` が出る場合は、キーが誤っているか別プロジェクトのものです。`.env.local` を変更したら **`npm run dev` を一度止めて再起動**してください。

4. **Firebase コンソールの設定**（メール登録・ログインを使う場合）
   - **Authentication** → ログイン方法 → **メール/パスワード** を有効にする。
   - **Firestore** → ルール：`users` に**新規登録で create できるルール**が必要です。例：
     ```
     match /users/{userId} {
       allow create: if request.auth != null && request.auth.uid == userId;
       allow read, update, delete: if request.auth != null && request.auth.uid == userId;
     }
     ```
     これがないと「登録に失敗しました」や `permission-denied` になります。

5. 開発サーバーの起動
   ```bash
   npm run dev
   ```
   [http://localhost:3000](http://localhost:3000) で確認できます。  
   登録で「登録に失敗しました（○○）」と出る場合は、表示されたコード（例: `permission-denied`）を手がかりに、Firebase の設定と Firestore ルールを確認してください。

## デプロイ

Vercel へのデプロイを推奨しています。
