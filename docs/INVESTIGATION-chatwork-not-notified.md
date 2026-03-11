# 調査: Action は成功しているのに Chatwork に通知されない

## 前提の整理

「Action」が何を指すかで原因が変わります。

1. **GitHub Actions の「Chatwork 翌日出勤通知」ワークフロー**  
   → 5分ごとの cron で `scripts/chatwork-notify.js` を実行。成功（exit 0）なのに Chatwork に届かない。
2. **管理画面の「翌日出勤をChatworkに送る」ボタン**  
   → 送信成功と表示されたのに Chatwork に届かない。
3. **管理者のシフト確定（「確定通知を送る」）**  
   → 確定は成功したが、Chatwork には何も送られていない。

---

## 1. シフト確定時に Chatwork は呼ばれていない（仕様）

**該当する場合:** 管理者が「確定通知を送る」を実行し、アプリ上は「確定通知を送りました」と表示されたが、Chatwork にメッセージが来ない。

**原因:**  
シフト確定時の処理では **Chatwork API は一切呼んでいません**。

- **やっていること**
  - `confirmShiftsForUser()` で Firestore の `shifts` を確定に更新
  - `createNotification(userId, "shift_confirmed", message)` で **Firestore の `notifications` にアプリ内通知を1件追加**
- **やっていないこと**
  - Chatwork への送信

Chatwork が関わるのは次の2種類だけです。

- **翌日出勤通知**  
  - 管理画面の「翌日出勤をChatworkに送る」  
  - または GitHub Actions の `chatwork-notify.js`（設定時刻に実行）
- **提出催促**  
  - `scripts/remind-shift-submit.js`（未提出者を Chatwork に通知）

**結論:**  
「確定通知を送った」＝アプリ内通知まで。Chatwork に出す仕様にはなっていないため、**実装不足が原因**です。

---

## 2. GitHub Actions は成功しているが Chatwork に届かない（chatwork-notify.js）

**該当する場合:** ワークフロー「Chatwork 翌日出勤通知」が緑で成功しているが、Chatwork に翌日出勤メッセージが来ない。

`scripts/chatwork-notify.js` は、**送信しない場合でも `process.exit(0)` で終了**する箇所が2つあります。  
そのため「Action は成功」だが「1通も送っていない」という状態が起こり得ます。

### 2.1 時刻ウィンドウ外でスキップ（最も有力）

- **ロジック:**  
  Firestore の `settings/chatwork` の `notifyHour` / `notifyMinute`（日本時間）から「その時刻〜+30分」の間だけ送信する。  
  それ以外の実行では送信せず `exit(0)`。
- **コード:**  
  `scripts/chatwork-notify.js` の 79–106 行付近。
- **具体例:**
  - 設定が 21:00 の場合、送信されるのは JST 21:00〜21:29 の実行だけ。
  - cron は 5 分ごと（UTC）なので、JST 21:00 は UTC 12:00。  
    つまり **12:00, 12:05, 12:10, 12:15, 12:20, 12:25（UTC）** の 6 回がウィンドウ内。
- **確認方法:**
  - Actions のログに  
    `[chatwork-notify] Skip: JST XX:XX not in window 21:0 +30min`  
    が出ていれば「時刻ウィンドウ外でスキップ」が原因。
- **対処:**
  - 実行したい時刻がウィンドウに含まれるように、Firestore の `notifyHour` / `notifyMinute` を調整する。
  - または手動実行時に `CHATWORK_NOTIFY_FORCE=1` を付ける（workflow_dispatch では既に付与済み）と時刻チェックをスキップして送信する。

### 2.2 同一日付で「既に送信済み」と判断してスキップ

- **ロジック:**  
  Firestore の `settings/chatwork` に `lastNotificationDate` があり、それが「翌日」の日付と同じなら「今日はもう送った」として送信せず `exit(0)`。
- **コード:**  
  `scripts/chatwork-notify.js` の 107–112 行付近。
- **具体例:**
  - その日に一度でも送信に成功すると、`lastNotificationDate` が更新される。
  - その後、同じ日付で再度実行されると「Skip: already sent for YYYY-MM-DD」で終了。
- **確認方法:**
  - ログに  
    `[chatwork-notify] Skip: already sent for 2025-02-11`  
    のような行があればこのスキップ。
- **対処:**
  - 想定どおりの動き。同じ日に二度送りたくない場合は問題なし。  
    意図せず「既に送信済み」になっている場合は、Firestore の `settings/chatwork.lastNotificationDate` を確認・必要なら削除または日付変更。

### 2.3 その他（送信先・API エラー）

- **通知先が空:**  
  `notificationDestinations` が空で、かつ後方互換の `roomId` / `personalAccountId` も無い場合は、  
  「通知先を1件以上設定してください」で **exit(1)** になるため、Action は失敗します。  
  「Action が成功」なら、ここでは止まっていない想定。
- **Chatwork API エラー:**  
  送信リクエストが 4xx/5xx などだと `lastError` がセットされ、最後に **exit(1)** するため、これも Action 失敗になります。  
  成功しているなら、少なくとも「送信を試みた全ての宛先」で API は 2xx だったか、あるいは上記のスキップで送信自体していないかのどちらかです。
- **送信先の取り違え:**  
  スクリプトは Firestore の `notificationDestinations`（または従来の roomId）のルームに送ります。  
  届いていない場合は、設定されているルーム ID が「見ているルーム」と一致しているか確認が必要です。

---

## 3. 管理画面の「翌日出勤をChatworkに送る」が成功表示なのに届かない

- **実装:**  
  `src/app/admin/settings/page.tsx` から `sendNextDayAttendanceToChatwork()`（`src/services/chatworkService.ts`）を呼んでいる。
- **注意点:**  
  `chatworkService.ts` の `sendNextDayAttendanceToChatwork` は、**Firestore の `lastNotificationDate` を更新しません**。  
  更新するのは `scripts/chatwork-notify.js` だけです。
- **考えられる原因:**
  - 返り値が `{ ok: true }` でも、複数宛先のうち一部だけ失敗している場合がある（ループ内で lastError を上書きするが、最後の宛先が成功なら `lastError` が残らない実装）。
  - 実際に送っているルーム／個人が、ユーザーが確認している Chatwork のルームと違う（通知先設定の取り違え）。
- **確認:**  
  ブラウザの開発者ツールでネットワークタブを見るか、`sendNextDayAttendanceToChatwork` の戻り値と、管理画面の「送信しました」の条件を確認するとよい。

---

## まとめ（原因の切り分け）

| 状況 | 想定される原因 |
|------|----------------|
| シフト確定したが Chatwork に何も来ない | **仕様:** 確定時は Chatwork を呼んでいない。アプリ内通知のみ。 |
| GitHub Action は成功するが Chatwork に届かない | **時刻スキップ:** 実行時刻が「notifyHour:notifyMinute の 30 分ウィンドウ」外で `exit(0)`。または **同一日付で「既に送信済み」スキップ**。 |
| 管理画面の「送る」は成功表示だが届かない | 送信先ルームの取り違え、または複数宛先の一部だけ送れていない可能性。 |

**推奨確認手順（GitHub Actions の場合）**

1. Actions の「Chatwork 翌日出勤通知」の直近の実行ログを開く。
2. `[chatwork-notify] Skip:` の有無を確認する。  
   - あれば「時刻ウィンドウ外」または「already sent」が原因。
3. `[chatwork-notify] Sending for date:` まで出ているか確認する。  
   - 出ていれば送信処理まで進んでいる。そのうえで届いていなければ、宛先ルーム ID や Chatwork 側の設定を確認する。

---

## 4. 「昨日は送られなかった」原因（chatwork-notify.js の実装）

**事実（修正前のコード）:**  
リポジトリの `scripts/chatwork-notify.js` には、次の処理が**実装されていた**。

```javascript
for (const dest of destinations) {
  if (dest.type === "personal" && entries.length === 0) {
    continue;  // ← 個人宛かつ翌日出勤0件のときは送らない
  }
  // ... 送信処理
}
// ループ後、送信有無に関係なく必ず実行されていた:
await db.doc("settings/chatwork").set({ lastNotificationDate: dateStr }, { merge: true });
```

つまり「翌日出勤0件でも個人宛に（出勤なし）を送る」は**仕様・意図**であって、**実装はそうなっていなかった**。  
通知先が**「個人」のみ**で、その日に翌日出勤が0件だった場合:

1. 18:00 頃の実行で送信ウィンドウに入り、`Sending for date:` まで進む。
2. `entries.length === 0` なので body は「【翌日出勤】○/○\n（出勤なし）」になる。
3. 宛先がすべて `personal` のため、上記 `continue` で**全宛先がスキップ**され、**1通も送信されない**。
4. それにもかかわらず **`lastNotificationDate` が更新される**（送信していないのに「送信済み」になる）。
5. 同じ日の 18:05, 18:10… の実行は「already sent for ○○○○-○○-○○」でスキップ。
6. 翌日以降も、その dateStr に対する送信は「済」のままなので、**昨日・一昨日も「（出勤なし）」は送られていない**。

**結論（出勤者0件の場合）:**  
「個人にも出勤なしを送る」は仕様だったが、**コードでは personal + entries.length === 0 のとき送らない実装**になっており、かつ**送っていないのに lastNotificationDate を更新していた**ため、届いていなかった。  
修正後は「個人にも出勤なしを送る」ようにし、**実際に1通以上送れたときだけ** lastNotificationDate を更新するように変更済み。

---

### 出勤者がいたのに送られなかった場合の原因候補

翌日出勤者が**いた**（entries.length > 0）のに届いていない場合は、上記の「personal + 0件スキップ」は当てはまらない。考えられる原因:

1. **時刻ウィンドウ外（スケジュール遅延）**  
   GitHub Actions のスケジュール実行は負荷で遅れることがある。  
   設定 18:00 なら送信されるのは JST 18:00〜18:29 のみ。  
   18:00 に走るはずの実行が 18:30 以降にずれ込むと「not in window」でスキップされ、1通も送られない。  
   → 該当日の 9:00〜9:25 UTC（18:00〜18:25 JST）の実行ログで「Skip: JST … not in window」が出ていないか確認。

2. **「already sent」でスキップ**  
   Firestore の `lastNotificationDate` が、その日の「翌日」の日付と既に一致していた。  
   （手動で「翌日出勤を送る」を押した、別の run が先に送った、または誤って同じ日付が入っていたなど。）  
   → 該当 run のログに「Skip: already sent for YYYY-MM-DD」が出ていないか確認。

3. **通知時刻の設定ミス**  
   Firestore の `notifyHour` / `notifyMinute` が想定と違う（例: 18 ではなく 9 が入っている）。  
   その場合、送信ウィンドウは 9:00〜9:29 JST になり、18:00 の実行はすべてウィンドウ外でスキップされる。  
   → 管理画面の Chatwork 設定、または Firestore `settings/chatwork` の値を確認。

4. **送信先の取り違え**  
   実際には送信されていたが、別ルームや別アカウントに届いている。  
   → `notificationDestinations` の room ID / 個人 ID が、確認している Chatwork のルーム・アカウントと一致しているか確認。

**確定するには:** 届かなかった日の、18:00 前後（JST）に実行された run のログを見る。  
「Skip: JST … not in window」「Skip: already sent for」のどちらか、または「Sending for date:」「Sent OK:」まで出ているかで原因を切り分けられる。
