# シフト管理システム (Attendance Management)

Next.js と Firebase を使用したアルバイト・パート向けシフト管理アプリケーションです。

## 機能一覧

- **スタッフ機能**
  - シフト提出（カレンダーUI・15日区切り締切）
  - 自分のシフト確認・確定シフトの概算給与
  - チャット機能（管理者との連絡）

- **管理者機能**
  - スタッフからのシフト提出一覧確認・シフトの確定・修正
  - 未提出者への催促（アプリ内通知＋GitHub Actions で 25日・10日 09:00 に自動送信）
  - 36協定（週40時間超過）アラート表示
  - チャット管理・Chatwork 翌日出勤通知（ルーム/個人の複数通知先に対応）

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
   
   **Chatwork 通知連携**（翌日出勤通知）: 管理画面の「設定」→「Chatwork 通知」で API トークンと**通知先一覧**（ルーム ID または個人アカウント ID を複数追加可能）を保存。自動通知時刻（デフォルト 21:00 JST）に GitHub Actions が全通知先へ送信。個人宛ては翌日出勤者がいるときのみ送信。手動は「翌日出勤を通知」ボタン。

4. **Firebase コンソールの設定**（メール登録・ログインを使う場合）
   - **Authentication** → ログイン方法 → **メール/パスワード** を有効にする。
   - **Firestore** → データベース・ルール・インデックスを一括で用意する（推奨）：
     1. Firebase コンソール → **Firestore Database** → まだなら **「データベースを作成」** をクリック（本番/テストどちらでも可）。
     2. ターミナルで以下を実行（プロジェクトID は `.env.local` の `NEXT_PUBLIC_FIREBASE_PROJECT_ID` の値に合わせる）：
        ```bash
        npm install -g firebase-tools
        firebase login
        firebase use あなたのプロジェクトID
        firebase deploy --only firestore
        ```
        `firebase deploy --only firestore` で **ルール**（`firestore.rules`）と **インデックス**（`firestore.indexes.json`）が一度にデプロイされます。インデックス作成には数分かかることがあります。
     3. ルールだけ先に反映したい場合: `firebase deploy --only firestore:rules`
     4. インデックスだけ先に反映したい場合: `firebase deploy --only firestore:indexes`
   - **Firestore** → ルール（CLI を使わない場合）：
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

   - **Firestore** → インデックス（CLI で `firebase deploy --only firestore` を実行した場合は不要）：
     手動で行う場合のみ、Firebase コンソール → **Firestore Database** → **インデックス** タブで、`firestore.indexes.json` に定義されている 7 本の複合インデックスを追加します（チャット・通知・シフト・変更申請で必要）。インデックスの作成には数分かかることがあります。
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

## シフト提出ルール

- シフトは **15日ごと** に提出。
- **1～15日分**: 前月25日までに提出。締切を過ぎた日はスタッフは編集不可。
- **16日～月末分**: 当月10日までに提出。締切を過ぎた日は編集不可。
- 催促は GitHub Actions で **25日・10日 09:00 JST** に未提出者へアプリ内通知を送信（Blaze プラン不要・同一リポジトリの Secrets `GOOGLE_APPLICATION_CREDENTIALS_JSON` を利用）。

## デプロイ

- **Firebase Hosting**: `npm run build` のあと `firebase deploy --only firestore,hosting` で Firestore ルール・インデックスと静的サイトをデプロイ。Cloud Functions は Blaze プランが必要なため、シフト催促は GitHub Actions で実行。
- **Vercel** でもデプロイ可能（静的エクスポート対応）。

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

4. **Chatwork 自動通知（GitHub Actions）**
   - 管理画面で Chatwork の API トークンと**通知先**（ルーム or 個人の ID）を1件以上追加して保存
   - Firebase コンソール → プロジェクトの設定 → サービスアカウント → 新しい秘密鍵の生成
   - GitHub リポジトリ → Settings → Secrets → `GOOGLE_APPLICATION_CREDENTIALS_JSON` を追加（秘密鍵の JSON をそのまま貼り付け）
   - 設定した「自動通知時刻」（デフォルト 21:00 JST）に毎日実行。手動実行は Actions タブから「Chatwork 翌日出勤通知」→ Run workflow
   - 個人宛ては翌日出勤者が1人以上いるときのみ送信

5. **シフト提出催促（GitHub Actions）**
   - 上記と同じ `GOOGLE_APPLICATION_CREDENTIALS_JSON` を使用
   - 25日 09:00 JST: 来月1～15日分の未提出者へアプリ内通知
   - 10日 09:00 JST: 当月16日～月末分の未提出者へアプリ内通知
   - 手動実行は Actions タブから「シフト提出催促」→ Run workflow
