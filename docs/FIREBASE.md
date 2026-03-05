# Firebase 設定手順

勤怠管理システムで使用する Firebase の設定手順を説明します。

## 使用する Firebase サービス

| サービス | 用途 |
|----------|------|
| **Authentication** | メール/パスワード認証 |
| **Firestore** | シフト・ユーザー・通知・チャット等のデータ保存 |
| **Hosting** | 静的サイトのホスティング |

> Cloud Functions は使用していません。シフト催促・Chatwork 通知は GitHub Actions で実行するため、Blaze プランは不要です。

## 1. Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力して作成

## 2. Authentication の設定

1. 左メニュー → **Authentication** → **ログイン方法**
2. **メール/パスワード** を有効化

## 3. Firestore の設定

### 3.1 データベースの作成

1. 左メニュー → **Firestore Database**
2. 「データベースを作成」をクリック
3. 本番モードまたはテストモードで作成（ルールは後でデプロイ）

### 3.2 ルールとインデックスのデプロイ

Firebase CLI を使用して、プロジェクトに含まれる `firestore.rules` と `firestore.indexes.json` を一括デプロイします。

```bash
# Firebase CLI のインストール（未導入の場合）
npm install -g firebase-tools

# ログイン
firebase login

# プロジェクトの指定（.env.local の NEXT_PUBLIC_FIREBASE_PROJECT_ID と一致させる）
firebase use your-project-id

# Firestore のルールとインデックスをデプロイ
firebase deploy --only firestore
```

インデックスの作成には数分かかることがあります。Firebase コンソールの Firestore → インデックス で進捗を確認できます。

### 3.3 ルールの内容（概要）

- **users**: 新規登録時は `role: "staff"` または `role: "admin"` を許可。更新時は `role` の変更を禁止（管理者昇格の不正防止）
- **shifts**: 認証済みユーザーが読み書き可能
- **messages**: 送信者・受信者のみ読み取り可能
- **notifications**: 自分の通知のみ読み取り可能

### 3.4 手動でルールを設定する場合

CLI を使わない場合：

1. Firebase コンソール → Firestore Database → **ルール** タブ
2. プロジェクトルートの `firestore.rules` の内容をコピー
3. コンソールのエディタに貼り付けて「公開」

## 4. Hosting の設定

### 4.1 firebase.json の確認

プロジェクトルートの `firebase.json` で Hosting の設定を確認します。

- `public`: `out`（Next.js の静的エクスポート先）
- `site`: Firebase プロジェクトの Hosting サイト ID

### 4.2 デプロイ

```bash
# ビルド + デプロイ（推奨）
npm run deploy

# または個別に
npm run build
firebase deploy --only hosting
```

## 5. 本番環境の環境変数

Firebase Hosting は静的サイトのホスティングのみです。環境変数はビルド時に埋め込まれるため、**ビルド前に** `.env.local` または CI/CD の環境変数で設定してください。

Vercel 等でデプロイする場合は、プラットフォームの環境変数設定で `NEXT_PUBLIC_FIREBASE_*` を設定します。

## 6. GitHub Actions 用のサービスアカウント

シフト催促・Chatwork 通知の自動実行には、Firebase Admin SDK 用のサービスアカウントが必要です。

### 6.1 秘密鍵の取得

1. Firebase コンソール → プロジェクトの設定（歯車アイコン）
2. **サービスアカウント** タブ
3. 「新しい秘密鍵の生成」をクリック → JSON をダウンロード

### 6.2 GitHub Secrets への登録

1. GitHub リポジトリ → Settings → Secrets and variables → Actions
2. `GOOGLE_APPLICATION_CREDENTIALS_JSON` を追加
3. ダウンロードした JSON ファイルの内容をそのまま貼り付け

### 6.3 Chatwork エラー通知（オプション）

Chatwork 通知が失敗したときにメンションするアカウント ID を設定する場合：

- `CHATWORK_ERROR_NOTIFY_ACCOUNT_ID`: Chatwork のアカウント ID

## 7. Chatwork 通知の設定

管理画面の「設定」→「Chatwork 通知」で以下を設定します。

- **API トークン**: Chatwork の API トークン
- **通知先一覧**: ルーム ID または個人アカウント ID（複数追加可能）
- **自動通知時刻**: デフォルト 21:00 JST

個人宛ては翌日出勤者が 1 人以上いるときのみ送信されます。手動実行は GitHub Actions の「Chatwork 翌日出勤通知」→ Run workflow から可能です。

## 8. プロジェクト ID の変更

既存の Firebase プロジェクトから別プロジェクトに移行する場合：

1. `.env.local` の `NEXT_PUBLIC_FIREBASE_*` を新しいプロジェクトの値に更新
2. `firebase use new-project-id` でプロジェクトを切り替え
3. `firebase deploy --only firestore` でルール・インデックスをデプロイ
4. `npm run deploy` で Hosting をデプロイ
