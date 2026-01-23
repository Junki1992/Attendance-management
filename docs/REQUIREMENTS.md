# 要件・実装計画

## 一覧：やりたいこと vs 現状

| # | 要件 | 現状 | やること |
|---|------|------|----------|
| 1 | シフト提出締切前に未提出者へ**自動通知** ＆ 管理者に**未提出者リスト**表示 | 通知 `remind_submit` 型あり。自動送信・未提出者一覧はなし | 締切設定、cron/Cloud Functions、未提出者取得API、管理者UI |
| 2 | シフト**確定**→アルバイトへ**自動通知**＋**未読/既読**表示 | **実装済み**。確定時通知・`read`。管理者シフト表に「確定通知の既読状況」一覧（スタッフ名｜既読/未読｜日時） | — |
| 3 | **36協定アラート**：1日8h / 週40h 超過でアラート | **実装済み**。8h/40h の色分け・⚠️。**最上部に常設枠**で 8h超過日・週40h超過者をリスト表示 | — |
| 4 | シフト**確定後**の**変更申請**→管理者承認→シフト表へ自動反映 | なし | 変更申請スキーマ、申請/承認フロー、承認時にシフト更新 |
| 5 | 締切後は**修正不可** or 締切**後の修正は赤字**等で表示 | **実装済み**。スタッフは締切後編集不可。管理者はセルクリックで編集可能。`shifts.editedAfterDeadline` を付け、締切後編集セルは**赤字**表示 | — |
| 6 | **前日夜**に翌日出勤メンバーの**出退勤時刻**を運用者チャットへ**自動通知** | なし | 日次ジョブ（Cloud Functions等）、運用者=admin向けチャット or 専用チャンネル、メッセージ送信 |
| 7 | 確定シフトを**SS（スプレッドシート）用にコピペ**できる | 管理者に「CSVコピー」ボタンのみ、実装なし | CSV生成＋`navigator.clipboard` でコピー |
| 8 | 管理者⇔アルバイトの**個人チャット** | `ChatWindow`＋staff/admin チャットページあり。Firestore `messages`＋`roomId` | スタッフを `users` から取得にし、必要なら既読等拡張 |
| 9 | メニュー：**「シフト提出する」「確定シフトを見る」「チャット」** など分かりやすいUI | Home/Shifts/Chat の英語リンクあり | 日本語ラベル＋アイコン、サイドメニュー or カード型に整理 |
| 10 | **月単位の勤務時間合計→給与計算** | スタッフ「シフト提出」画面で概算給与あり。時給は `users.hourlyWage` | 管理者側の「月別・スタッフ別」集計と給与表示、確定シフトベースにする |

---

## 1. シフト提出締切前の未提出者：自動通知 & 未提出者リスト

### 1.1 必要なもの

- **締切日の設定**
  - Firestore: `settings` コレクション（または `config`）に `shiftSubmitDeadline`（例: 毎月25日 or 当年月＋日）を保存。
  - 管理者画面で締切日を変更できるようにする。

- **未提出者の定義**
  - 対象月に `shifts` に 1 件も `status: submitted | confirmed` が無いスタッフ = 未提出。
  - スタッフ一覧は `users` の `role: 'staff'` で取得。

- **自動通知（締切前）**
  - 例: 締切 2 日前や 1 日前に未提出者へ `createNotification(uid, 'remind_submit', '〇月のシフト提出が締め切られます。〇月〇日までに提出してください。')` を実行。
  - **実装場所**: Vercel Cron または **Firebase Cloud Functions (scheduled)** が現実的。`getAllStaff()` → 対象月の提出有無チェック → 未提出者に通知。

- **管理者：未提出者リスト**
  - 新規: `GET /api/admin/unsubmitted?year=2026&month=1` 相当の API（または service の `getUnsubmittedStaff(year, month)`）。
  - 管理者のシフトページ or 専用「未提出者」セクションに一覧表示。未提出者への「催促」ボタンで `remind_submit` を 1 件送る。

### 1.2 Firestore

- `settings/config` : `{ shiftSubmitDeadlineDay: 25 }` など。
- `notifications` : 既存の `type: 'remind_submit'` を利用。

---

## 2. シフト確定→アルバイトへ自動通知＋未読/既読

### 2.1 現状

- 管理者が「確定して通知」で `confirmShifts` → 対象者へ `createNotification(uid, 'shift_confirmed', ...)` 送信済み。
- `notifications` に `read: boolean` あり。`markAsRead` あり。スタッフの `NotificationList` で未読・既読の見た目はできている。

### 2.2 追加でやること

- **管理者側**: 「通知一覧」で、どのスタッフが「未読/既読」か分かるようにする。
  - `notifications` を `userId` や `type: 'shift_confirmed'` で検索し、`read` を一覧表示。
  - 例: シフト確定後に「〇月確定通知の既読状況」パネル。スタッフ名｜既読/未読｜日時。

---

## 3. 36協定アラート（1日8h / 週40h）

### 3.1 現状

- `admin/shifts` で
  - 1日 8h 超過: セル背景を赤系、`title="1日8時間超過"`。
  - 週 40h 超過: スタッフ行に ⚠️、合計を赤文字。
- ロジック: `isDailyOver(hours>8)`, `isWeeklyOver(uid)`（月を週跨ぎで 40h かは要検討。現状は「月の合計 40h 超過」に近い）。

### 3.2 追加でやること

- **週40h** を「 Calendar Week（月〜日）ごと」で計算するか決める。月単位なら現状のままで可。
- **アラートを目立たせる**:
  - 管理者ダッシュボード or シフト表の上に「36協定アラート」枠を常設。
  - 該当者・該当日をリストで表示。例: 「佐藤一郎: 1/15 が 9h」「鈴木: 週合計 42h」。
- 必要なら `notifications` に `type: 'overtime_alert'` を追加し、管理者向けに「要確認」として出す。

---

## 4. シフト確定後の変更申請→承認→シフト表へ反映

### 4.1 スキーマ

- **`shiftChangeRequests`**（例）:
  - `id`, `userId`, `date` (YYYY-MM-DD), `requestedStartTime`, `requestedEndTime`（または OFF）
  - `reason`: 自由文
  - `status`: `'pending' | 'approved' | 'rejected'`
  - `processedBy`, `processedAt`
  - `shiftDocId`: 元の `shifts` の doc ID（`userId_date`）

### 4.2 フロー

1. **スタッフ**: 確定シフト一覧の「変更申請」→ 日付・希望時刻（or OFF）・理由を入力して送信。
2. **管理者**: 「変更申請一覧」で `pending` を表示。承認/却下。承認時は `shifts` を更新（上書き）し、`status` を `approved`、`processedAt` を記録。
3. シフト表は `shifts` を参照しているので、`shifts` を更新すればそのまま反映される。

### 4.3 サービス

- `createShiftChangeRequest`, `getPendingShiftChangeRequests`, `approveShiftChangeRequest`, `rejectShiftChangeRequest`
- スタッフ用: `getMyShiftChangeRequests`。確定シフト一覧は `getUserShifts` の `status: 'confirmed'` のみ、または「確定済み」フィルタ。

### 4.4 UI

- スタッフ: 「確定シフトを見る」に「変更申請」ボタン／モーダル。
- 管理者: シフト管理 or 専用「変更申請」タブで一覧＋承認/却下。

---

## 5. 締切後は修正不可 or 締切後の修正は赤字表示

### 5.1 ルール

- **締切日**は `settings` の `shiftSubmitDeadline` を使用（1 と共通）。
- **スタッフの「シフト提出」**:
  - 提出対象月の締切日を過ぎていたら、カレンダーの編集・保存を不可（グレーアウト＋「締切のため編集できません」）。
- **管理者のシフト編集**:
  - 締切「前」にスタッフが入れたデータ = 黒（通常）。
  - 締切「後」に管理者が手動で編集したセル = **赤字**（または `editedAfterDeadline: true` のようなフラグを `shifts` に持つ）。

### 5.2 スキーマ

- `shifts` に `editedAfterDeadline?: boolean` を追加。管理者が締切後に編集したときだけ `true` を付与。
- 管理者シフト表のセルで `editedAfterDeadline === true` のとき、文字色を赤に。

### 5.3 判定

- 締切日: 例 `new Date(year, month, deadlineDay)` の 24:00 まで。
- 編集が「締切後」かは、**その編集を保存した時刻**が締切後なら `editedAfterDeadline: true` にする。

---

## 6. 前日夜に翌日出勤メンバー・出退勤時刻を運用者チャットへ自動通知

### 6.1 運用者 = 管理者

- 「運用者のチャット」= 管理者向けの「一括メッセージ」 or 管理者同士のルーム。
- いったんは **管理者（admin）のチャット** に、**システムがメッセージを投稿**する形でよい。
  - 例: `messages` に `senderId: 'system'` や `senderId: 'bot'`、`receiverId: admin uid`、`text: '【翌日出勤】1/24\n佐藤 09:00-18:00\n鈴木 10:00-19:00'` を `addDoc`。

### 6.2 実装

- **Cloud Functions (scheduled)**: 毎日 21:00 などに実行。
  - 翌日の `date` で `shifts` を検索（`status: 'confirmed'` に絞る）。
  - 出勤（`startTime !== '00:00'` かつ `endTime !== '00:00'`）のスタッフと時刻を集計。
  - `users` から名前を取得し、テキストを組み立て。
  - `messages` に 1 件追加。`receiverId` を代表管理者 or 運用者用 ID。`roomId` は「system-to-admin」など固定で、管理チャット画面で subscribe する。

### 6.3 代替

- 管理者向け「お知らせ」専用コレクション `dailyAttendanceDigest` を作り、そこに 1 日 1 件追加。管理者画面で「翌日出勤」パネルとして表示する方法もある。チャットに流すなら `messages` でよい。

---

## 7. 確定シフトを SS へコピペできる

### 7.1 現状

- 管理者シフト画面に「CSVコピー」ボタンのみ。処理なし。

### 7.2 実装

- 確定シフト（`status: 'confirmed'`）のみで、`getAllShifts` 相当で取得。
- スタッフ名は `users` から解決。
- CSV 形式例（1行目ヘッダ）:
  - `スタッフ,1,2,...,31` または `日付,スタッフ,出勤,退勤` など、SS で貼りやすい形にする。
- `navigator.clipboard.writeText(csvString)` でコピー。`await` のため `async` にして、クリックで「コピーしました」と表示。

### 7.3 注意

- 月の日数・スタッフ一覧は、表示中の表と揃える（`users` の staff 一覧と、その月の `getAllShifts`）。

---

## 8. 管理者⇔アルバイトの個人チャット

### 8.1 現状

- `ChatWindow`、`sendMessageWithRoom`、`subscribeMessages`（`roomId`）あり。
- スタッフ: 固定 `ADMIN_ID` とチャット。管理者: `STAFF_LIST` から選んでチャット。

### 8.2 やること

- **スタッフ一覧の動的化**: `STAFF_LIST` をやめ、`users` の `role: 'staff'` から取得。`getAllStaff()` のような service。
- 管理者・スタッフどちらも、`partnerId` に `users` の `uid` を使う。これで個人チャットとして成立。
- 既読などは、必要なら `messages` に `readBy: string[]` を追加。今回は既存の `read` で足りる想定。

---

## 9. メニュー：「シフト提出する」「確定シフトを見る」「チャット」など分かりやすい UI

### 9.1 スタッフ

- **シフト提出する**: `/staff/shifts`（提出用カレンダー）
- **確定シフトを見る**: 新規 `/staff/confirmed-shifts`。`getUserShifts` の `status: 'confirmed'` のみ表示。一覧 or カレンダー。
- **チャット**: `/staff/chat`

- ナビを日本語化: 「Home」→「ホーム」 or 廃止し、カード型ダッシュボードのみ。「Shifts」→「シフト提出」と「確定シフト」に分離。「Chat」→「チャット」。

### 9.2 管理者

- **シフト提出状況 / シフト表**: `/admin/shifts`（未提出者リスト＋シフト表＋確定ボタン）
- **確定シフト**: 同じ `/admin/shifts` で確定済みを表示、または「表示切替」で「提出中/確定済み」を選ぶ。
- **変更申請**: `/admin/shift-change-requests` または `/admin/shifts` 内タブ。
- **チャット**: `/admin/chat`
- **通知の既読状況**: `/admin/notifications` またはシフト画面内パネル。
- **36協定アラート**: ダッシュボード or シフト表の上部パネル。

- ナビを日本語化し、`layout` のリンクを上記に合わせる。

### 9.3 共通

- 必要なら `globals.css` に `.btn`, `.container`, `.card` を追加（未定義のまま class を使っているため）。

---

## 10. 月単位の勤務時間合計→給与計算

### 10.1 スタッフ（現状）

- シフト提出画面で、その月の「入力中」シフトから `calculateSalary()` で概算。`hourlyWage` は `getUserProfile`。

### 10.2 管理者でやりたいこと

- **確定シフトベース**の、月・スタッフ別の「勤務時間合計」と「給与」。
- データ: `getAllShifts(year, month)` の `status: 'confirmed'` に絞る。`users` で `hourlyWage` を取得。
- 表示: 管理者の「給与・勤務集計」画面 or シフト表の横に「合計時間」「給与」列。

### 10.3 計算

- 既存ロジックと合わせる: 6h 超で 1h 休憩控除。`(end - start) - break` を合計。`totalHours * hourlyWage` で給与（端数は切り捨て等、ルールを統一）。

### 10.4 サービス

- `getMonthlyWorkSummary(year, month)`: `{ userId, totalHours, wage, salary }[]` を返す。
- スタッフの「確定シフトを見る」にも、その月の `totalHours` と `salary` を表示するとよい。

---

## インフラ・設定の前提

- **Firestore**
  - コレクション: `users`, `shifts`, `messages`, `notifications`, `settings`（または `config`）, `shiftChangeRequests`（新規）
  - インデックス: `notifications`（`userId`, `createdAt`）、`messages`（`roomId`, `createdAt`）など、既存のクエリに合わせる。

- **Cloud Functions（推奨）**
  - 締切前の未提出者への催促（スケジュール）
  - 前日夜の翌日出勤 digest（スケジュール）
  - 36協定の「管理者向け通知」も、確定時に走らせるなら Functions で可。

- **Vercel Cron**
  - Cloud Functions が使えない場合、`/api/cron/remind-unsubmitted`、`/api/cron/daily-attendance` を Vercel Cron で叩く。 Firestore は Admin SDK で。認証は CRON_SECRET など。

- **締切・運用者**
  - 締切日: `settings.shiftSubmitDeadlineDay`（1〜28）。月末の場合は「当月最終日」など別フィールドで表現。
  - 運用者（翌日出勤通知の宛先）: `settings.operatorAdminUid` などで 1 名指定してよい。

---

## 実装の優先度（案）

1. **高**: 締切設定・未提出者リスト（1）、確定通知の既読一覧（2）、CSVコピー（7）、メニュー改善（9）
2. **高**: 36協定アラートの強化（3）、締切後の編集制限・赤字（5）、月別給与集計（10）
3. **中**: 変更申請→承認→反映（4）、スタッフ「確定シフトを見る」（9 の一部）
4. **中**: チャットのスタッフ一覧を `users` に（8）
5. **要スケジューラ**: 締切前の自動催促（1）、前日夜の翌日出勤通知（6）

---

## 補足：スタッフ一覧の共通化

- `admin/shifts`、`admin/chat` の `STAFF_LIST` を廃止し、`getAllStaff(): Promise<{id, name}[]>` を `userService` に追加。`users` の `role === 'staff'` を取得。未登録のスタッフがいる場合は、`users` の登録を先に行う運用にする。
