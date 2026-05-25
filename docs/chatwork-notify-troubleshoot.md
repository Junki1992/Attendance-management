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
2. 次のフィールドを削除（または確認）
   - **lastNotificationDate**
   - **lastNotificationJstDay**（送信した JST の日付。未記録の古いデータは再送を許可する実装）
3. 保存後、次の定時実行または手動実行で送信が試みられる

---

## 3. 設定時刻付近の実行ログで何が起きているか見る

1. Actions → 「Chatwork 翌日出勤通知」の実行一覧で、**設定時刻の直後（JST）** の実行を探す
2. その実行 → **notify** ジョブ → **Run node scripts/chatwork-notify.js** のログを開く
3. 次のどれが出ているかで原因を切り分け

| ログの内容 | 意味 | 対処 |
|------------|------|------|
| `Skip: ... before notify time`（定時前） | 当日分は既に通知済みで夕方待ち（正常） | 設定時刻以降のログを確認 |
| `Catch-up:` | 前夜の取りこぼしを朝〜夕方前に回収 | 前夜の Actions 失敗を調査 |
| `Skip: already sent for` | そのシフト日付は送信済み | 上記 2 で lastNotification* を確認 |
| `Overdue:` / Chatwork の【エラー】遅延 | 設定+45分経過しても未送信 | Actions の遅延・停止・Secrets を確認 |
| `Sending for date:` のあと `Sent OK:` | 送信処理は成功 | 届いていないなら通知先 ID を確認 |
| `Send error` / `Chatwork API 403` 等 | API エラー | トークン・ルームID・Chatwork 権限を確認 |
| 実行自体が少ない・無い | GitHub スケジュール未実行 | リポジトリの更新・Actions 有効化を確認 |

---

## 4. 通知時刻の設定を確認

- Firestore **settings/chatwork** の **notifyHour** / **notifyMinute**（18:00 なら 18 と 0）
- 別の値（例: 9）だと、9:00〜23:59 JST にしか送られない

---

## 5. 2時間以上遅れる・届かないときのチェックリスト

| 確認項目 | 内容 |
|----------|------|
| Actions が動いているか | 設定時刻前後 2 時間で実行が複数あるか |
| `CHATWORK_ERROR_NOTIFY_ACCOUNT_ID` | 遅延45分超で管理者に Chatwork 警告が届くか |
| リポジトリの更新 | 60日以上無更新だとスケジュールが止まることがある |
| `lastNotificationJstDay` | 空のまま `lastNotificationDate` だけあると旧データ。2の手順でリセット可 |
