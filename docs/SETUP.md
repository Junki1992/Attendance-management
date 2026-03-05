# 環境構築手順

このドキュメントでは、勤怠管理システムをローカル環境でセットアップする手順を説明します。

## 前提条件

- **Node.js**: v20 以上（推奨: LTS）
- **npm**: v9 以上
- **Firebase アカウント**: [Firebase Console](https://console.firebase.google.com/) でプロジェクト作成可能

## 1. リポジトリのクローン

```bash
git clone <repository-url>
cd killingtime3
```

## 2. 依存関係のインストール

```bash
npm install
```

## 3. 環境変数の設定

### 3.1 テンプレートのコピー

```bash
cp .env.example .env.local
```

### 3.2 Firebase の設定

`.env.local` を編集し、Firebase の設定値を入力します。値は Firebase コンソールの「プロジェクトの設定」→「全般」→「マイアプリ」で取得できます。

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Web API キー |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `{プロジェクトID}.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | プロジェクト ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `{プロジェクトID}.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 送信者 ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | アプリ ID |

> **注意**: `auth/api-key-not-valid` エラーが出る場合は、API キーが誤っているか別プロジェクトのものです。`.env.local` を変更したら **`npm run dev` を一度止めて再起動**してください。

### 3.3 オプションの環境変数

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_FIRST_ADMIN_EMAIL` | 最初の管理者として登録するメールアドレス |
| `NEXT_PUBLIC_ADMIN_UID` | チャット機能用：管理者の UID（スタッフが管理者にメッセージを送るために必要） |
| `NEXT_PUBLIC_ENABLE_MOCK_LOGIN` | 開発用：`1` でパスワードなしログインを有効化（**本番では設定しない**） |

## 4. Firebase の初期設定

Firebase の設定と Firestore のデプロイは [docs/FIREBASE.md](./FIREBASE.md) を参照してください。

最低限必要な手順：

1. Firebase コンソールで **Authentication** → メール/パスワード を有効化
2. **Firestore** を有効化
3. `firebase deploy --only firestore` でルールとインデックスをデプロイ

## 5. 開発サーバーの起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) でアプリケーションにアクセスできます。

## 6. 最初の管理者アカウントの作成

1. `.env.local` に `NEXT_PUBLIC_FIRST_ADMIN_EMAIL=admin@example.com` を設定
2. 開発サーバーを再起動
3. `/signup` ページで、指定したメールアドレスとパスワードで新規登録
4. 自動的に管理者として作成され、管理者画面にリダイレクトされます

## トラブルシューティング

### 登録に失敗しました（permission-denied）

- Firebase Authentication にはユーザーが作成されているが、Firestore のプロフィール作成に失敗

**対処法**:
1. Firebase コンソール → Authentication → ユーザー から該当ユーザーを削除
2. Firestore ルールを確認（`firestore.rules` の内容をコンソールに反映）
3. 再度新規登録を試す

### API キーが無効です

- Firebase コンソールの Web API キーと `.env.local` の `NEXT_PUBLIC_FIREBASE_API_KEY` が一致しているか確認
- 別プロジェクトのキーを貼り付けていないか確認

### Auth の設定が見つかりません

- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` が `{プロジェクトID}.firebaseapp.com` になっているか確認（`firebasestorage.app` ではない）
- Authentication で「メール/パスワード」が有効か確認
