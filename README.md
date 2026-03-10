# 勤怠管理システム（Attendance Management）

アルバイト・パート向けのシフト管理アプリケーション。Next.js と Firebase で構築し、提出・確定・給与集計・チャット・通知まで一貫して管理できます。

## 主な機能

### スタッフ向け

- **シフト提出** - カレンダー UI で直感的に入力（15日区切り締切）
- **確定シフトの確認** - 確定済みシフトと概算給与の表示
- **チャット** - 管理者との連絡

### 管理者向け

- **シフト管理** - 提出一覧の確認、確定・修正、前半/後半の範囲指定
- **確定取り消し** - 確定済みシフトの取り消し（バイト側で再編集可能に）
- **未提出者への催促** - アプリ内通知（GitHub Actions で 25日・10日 09:00 に自動送信）
- **36協定アラート** - 週40時間超過・1日8時間超過の表示
- **チャット管理** - Chatwork 翌日出勤通知（ルーム/個人の複数通知先に対応）
- **給与集計** - 月別の勤務時間・時給・給与の一覧

## 技術スタック

| 項目 | 技術 |
|------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS / Global CSS |
| Database | Firebase Firestore |
| Auth | Firebase Authentication（メール+パスワード） |
| Hosting | Firebase Hosting（静的エクスポート） |

## クイックスタート

```bash
# 1. 依存関係のインストール
npm install

# 2. 環境変数の設定
cp .env.example .env.local
# .env.local を編集し、Firebase の設定値を入力

# 3. Firebase の初期設定（Authentication 有効化、Firestore デプロイ）
firebase login
firebase use your-project-id
firebase deploy --only firestore

# 4. 開発サーバー起動
npm run dev
```

詳細な手順は [docs/SETUP.md](docs/SETUP.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/SETUP.md](docs/SETUP.md) | 環境構築手順・トラブルシューティング |
| [docs/FIREBASE.md](docs/FIREBASE.md) | Firebase 設定・デプロイ・GitHub Actions |

## シフト提出ルール

- **1～15日分**: 前月の指定日・時刻までに提出（デフォルト: 前月25日 23:59）
- **16日～月末分**: 当月の指定日・時刻まで（デフォルト: 当月10日 23:59）
- 締切を過ぎた日はスタッフは編集不可
- 管理者は設定ページで締切日時を変更可能（月別上書き対応）

## デプロイ

```bash
# ビルド + Firebase Hosting へデプロイ
npm run deploy
```

Firestore のルール・インデックスも更新する場合：

```bash
firebase deploy --only firestore,hosting
```

Vercel でもデプロイ可能（静的エクスポート対応）。

## 自動通知（GitHub Actions）

| ワークフロー | 実行タイミング | 内容 |
|-------------|----------------|------|
| シフト提出催促 | 毎日 09:00 JST（25日・10日に該当する場合） | 未提出者へアプリ内通知 |
| Chatwork 翌日出勤通知 | 設定時刻（デフォルト 21:00 JST） | 翌日出勤者を Chatwork へ通知 |

いずれも `GOOGLE_APPLICATION_CREDENTIALS_JSON`（Firebase サービスアカウントの JSON）を GitHub Secrets に登録してください。Blaze プランは不要です。

## スクリプト

| コマンド | 説明 |
|----------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run deploy` | ビルド + Firebase Hosting デプロイ |
| `npm run chatwork-notify` | Chatwork 翌日出勤通知（手動実行） |

## プロジェクト構成

```
├── src/
│   ├── app/          # Next.js App Router ページ
│   ├── components/   # 共通コンポーネント
│   ├── context/     # React Context（認証など）
│   ├── lib/          # Firebase 初期化
│   └── services/     # ビジネスロジック（シフト・通知・チャット等）
├── docs/             # ドキュメント
├── scripts/          # ユーティリティ（Chatwork 通知・催促等）
├── firestore.rules   # Firestore セキュリティルール
├── firestore.indexes.json
└── firebase.json
```

## ライセンス

Private
