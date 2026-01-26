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
   
   **最初の管理者アカウントを準備する場合**（推奨）：
   ```
   NEXT_PUBLIC_FIRST_ADMIN_EMAIL=admin@example.com
   ```
   この変数を設定すると、指定されたメールアドレスで新規登録した場合のみ、管理者として作成されます。
   
   **使い方**：
   1. 上記の環境変数を設定して開発サーバーを再起動
   2. `/signup` ページで、指定したメールアドレス（例: `admin@example.com`）とパスワードを入力して新規登録
   3. 自動的に管理者として作成され、管理者画面にリダイレクトされます
   
   **注意**：パスワードは新規登録ページで入力する必要があります（Firebase Authentication の仕様上、パスワードは必須です）。一度作成したら、その後のユーザーは通常通りスタッフとして登録されます。
   
   **チャット機能で管理者のUIDを設定する場合**（スタッフが管理者にメッセージを送信するために必要）：
   ```
   NEXT_PUBLIC_ADMIN_UID=管理者のUID
   ```
   この変数を設定すると、スタッフが管理者のUIDを取得してチャット機能を使用できます。管理者のUIDは、Firebase コンソール → Authentication → ユーザー タブで確認できます。設定しない場合、管理者のみが管理者のUIDを取得できます（スタッフはチャット機能を使用できません）。
   
   **開発環境でのみモックログインを有効化する場合**（本番では無効化されます）：
   ```
   NEXT_PUBLIC_ENABLE_MOCK_LOGIN=1
   ```
   この変数を設定すると、ログインページに「開発・検証用：パスワードなしでログイン」セクションが表示されます。**本番環境では設定しないでください**（セキュリティ上の理由）。

4. **Firebase コンソールの設定**（メール登録・ログインを使う場合）
   - **Authentication** → ログイン方法 → **メール/パスワード** を有効にする。
   - **Firestore** → ルール：
     1. Firebase コンソール → **Firestore Database** → **ルール** タブを開く
     2. プロジェクトルートの `firestore.rules` ファイルの内容をコピー
     3. コンソールのルールエディタに貼り付けて **「公開」** をクリック
     
     **重要**: `users` コレクションのルールで、**`role` フィールドの書き換えを禁止**しています。これにより、一般ユーザーが自分を管理者に昇格させることを防ぎます。
     
     - ✅ 新規登録時は `role: "staff"` または `role: "admin"` を許可（`NEXT_PUBLIC_FIRST_ADMIN_EMAIL` で指定されたメールアドレスのみ `admin` として作成可能）
     - ✅ 更新時は `role` フィールドの変更を禁止（`name`, `email`, `hourlyWage` のみ更新可）
     - ✅ 管理者は他のユーザーの `role` を変更可能（`/admin/settings` の「ユーザー管理」から）
     
     これがないと「登録に失敗しました」や `permission-denied` になります。
     
     **セキュリティ**: 
     - クライアント側のチェック（`/admin/layout.tsx`）に加えて、**Firestore ルールでデータベースレベルでも保護**しています
     - 開発者ツールで `user.role` を書き換えても、Firestore への書き込みが拒否されるため、管理者画面にはアクセスできません
     - `/admin/*` へのアクセスは `src/middleware.ts` でもチェック可能（Firebase Admin SDK を設定した場合）

   - **Firestore** → インデックス：
     1. Firebase コンソール → **Firestore Database** → **インデックス** タブを開く
     2. エラーメッセージに表示されたURLをクリックするか、以下のインデックスを手動で作成：
        - **`messages` コレクション**: `roomId` (昇順) + `createdAt` (昇順)
        - **`notifications` コレクション**: `userId` (昇順) + `createdAt` (降順)
     3. インデックスの作成には数分かかる場合があります
     
     これがないとチャット機能や通知機能で「The query requires an index」エラーが発生します。
     
     **手動でインデックスを作成する場合**：
     1. Firebase コンソール → **Firestore Database** → **インデックス** タブ
     2. 「インデックスを追加」をクリック
     3. コレクションID: `messages`、フィールド: `roomId` (昇順)、`createdAt` (昇順) を設定して作成
     4. 同様に、コレクションID: `notifications`、フィールド: `userId` (昇順)、`createdAt` (降順) を設定して作成

   - **Firestore** → インデックス：
     1. Firebase コンソール → **Firestore Database** → **インデックス** タブを開く
     2. エラーメッセージに表示されたURLをクリックするか、以下のインデックスを手動で作成：
        - **`messages` コレクション**: `roomId` (昇順) + `createdAt` (昇順)
        - **`notifications` コレクション**: `userId` (昇順) + `createdAt` (降順)
     3. インデックスの作成には数分かかる場合があります
     
     これがないとチャット機能や通知機能で「The query requires an index」エラーが発生します。
   ```bash
   npm run dev
   ```
   [http://localhost:3000](http://localhost:3000) で確認できます。  
   登録で「登録に失敗しました（○○）」と出る場合は、表示されたコード（例: `permission-denied`）を手がかりに、Firebase の設定と Firestore ルールを確認してください。
   
   **登録に失敗した場合の対処法**：
   - `permission-denied` エラーが出た場合、Firebase Authentication にはユーザーが作成されているが Firestore のプロフィールが作成されていない状態です
   - Firebase コンソール → **Authentication** → **ユーザー** タブから、登録に失敗したメールアドレスのユーザーを削除してください
   - その後、Firestore ルールを更新してから再度新規登録を試してください
   - `auth/email-already-in-use` エラーが出た場合も同様に、Firebase コンソールでユーザーを削除してから再度登録してください

## デプロイ

Vercel へのデプロイを推奨しています。

### 本番環境での注意事項

1. **モックログイン機能は無効化されます**
   - 本番環境では `NEXT_PUBLIC_ENABLE_MOCK_LOGIN` を設定しないでください
   - ログインページにモックログインボタンは表示されません

2. **最初の管理者を作成する手順**
   - **方法1（推奨）**：`.env.local` に `NEXT_PUBLIC_FIRST_ADMIN_EMAIL=admin@example.com` を設定 → `/signup` ページでそのメールアドレスとパスワードを入力して新規登録 → 自動的に管理者として作成されます
   - **方法2**：開発環境でモックユーザーでログイン → `/admin/settings` → 実際のユーザーを管理者に昇格
   - **方法3**：Firebase コンソールの Firestore で `users/{uid}.role` を `"admin"` に手動変更
   
   **注意**：パスワードは新規登録ページで入力する必要があります（Firebase Authentication の仕様上、パスワードは必須です）。

3. **環境変数の設定**
   - Vercel の「設定」→「環境変数」で `NEXT_PUBLIC_FIREBASE_*` を設定
   - **最初の管理者アカウントを作成する場合**：`NEXT_PUBLIC_FIRST_ADMIN_EMAIL=admin@example.com` を設定（一度作成したら削除可能）
   - `NEXT_PUBLIC_ENABLE_MOCK_LOGIN` は**設定しない**（本番では無効化）
