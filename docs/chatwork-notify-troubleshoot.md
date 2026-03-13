# Chatwork 通知が届かないときの確認手順

## 1. 手動で「今すぐ送信」して届くか試す

1. GitHub → リポジトリ → **Actions** → 「Chatwork 翌日出勤通知」
2. 右の **Run workflow** → **Run workflow**
3. 数分後にその実行のログを開き、`Run node scripts/chatwork-notify.js` のログを確認
   - **「Sending for date:」→「Sent OK:」** が出ていれば送信は成功。届いていないなら **通知先ルームID・個人ID** が違うルームを指している可能性
   - **「Send error」「Chatwork API 4xx/5xx」** が出ていればトークンまたはルームIDの誤り
4. 手動実行で Chatwork に届いた → スケジュール実行が「時刻スキップ」か「already sent」で止まっている可能性（下記 2・3 を確認）
5. 手動実行でも届かない → Firestore の API トークン・通知先設定、または Chatwork 側の権限を確認

---

## 2. Firestore の「送信済み」をリセットする（一度だけ）

過去の不具合で **送っていないのに lastNotificationDate が入っている** と、スケジュール実行が「already sent」で送信しない。

1. Firebase Console → Firestore → **settings** コレクション → **chatwork** ドキュメント
2. フィールド **lastNotificationDate** を削除（または今日の翌日の日付でないことを確認）
3. 保存後、翌日の 18:00 前後の実行で送信が試みられる

---

## 3. 18:00 の実行ログで何が起きているか見る

1. Actions → 「Chatwork 翌日出勤通知」の実行一覧で、**18:00 頃（JST）** の実行を探す  
   （一覧は UTC なら 9:00 / 9:05、表示が JST なら 18:00 / 18:05）
2. その実行 → **notify** ジョブ → **Run node scripts/chatwork-notify.js** のログを開く
3. 次のどれが出ているかで原因を切り分け

| ログの内容 | 意味 | 対処 |
|------------|------|------|
| `Skip: JST 18:xx not in window 18:0 +30min` | 実行時刻が 18:00–18:29 の外（遅延など） | 次回の実行を待つか、手動実行で送る |
| `Skip: JST 9:0 not in window 18:0 +30min` | 朝 9:00 JST の実行なのでスキップ（正常） | 18:00 の実行ログを別途確認 |
| `Skip: already sent for 2025-xx-xx` | その日付は送信済み扱い | 上記 2 のとおり lastNotificationDate を削除 |
| `Sending for date:` のあと `Sent OK:` | 送信処理は成功 | 届いていないなら通知先（ルームID等）が違う |
| `Send error` / `Chatwork API 403` 等 | API エラー | トークン・ルームID・Chatwork 権限を確認 |

---

## 4. 通知時刻の設定を確認

- Firestore **settings/chatwork** の **notifyHour** が **18**（18:00 に送りたい場合）になっているか
- 別の値（例: 9）だと送信ウィンドウが 9:00–9:29 JST になり、18:00 の実行はすべてスキップされる
