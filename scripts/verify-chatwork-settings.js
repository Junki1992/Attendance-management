/**
 * Chatwork 設定の確認スクリプト
 * Firestore に保存されている実際の値を表示します
 *
 * 実行（推奨・ファイルから読み込み）:
 *   1. Firebase コンソールでサービスアカウントの JSON をダウンロード
 *   2. プロジェクト直下に serviceAccountKey.json として保存
 *   3. GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/verify-chatwork-settings.js
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { resolveChatworkNotifySchedule } = require("./resolveChatworkNotifySchedule");
const { resolveNotifyPlan, normalizeYmd } = require("./chatworkNotifyLogic");

async function main() {
  let cred;
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const resolvedPath = credPath ? path.resolve(process.cwd(), credPath) : null;
  if (credPath && fs.existsSync(resolvedPath)) {
    cred = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } else if (credPath && !fs.existsSync(resolvedPath)) {
    console.error("ファイルが見つかりません:", resolvedPath);
    process.exit(1);
  } else if (credJson) {
    try {
      cred = JSON.parse(credJson);
    } catch (e) {
      console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON の JSON 解析に失敗しました。");
      process.exit(1);
    }
  } else {
    console.error("認証情報を設定してください:");
    console.error("  GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/verify-chatwork-settings.js");
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  const db = admin.firestore();

  const cfgSnap = await db.doc("settings/chatwork").get();
  if (!cfgSnap.exists) {
    console.log("❌ Chatwork 設定が Firestore に存在しません");
    process.exit(1);
  }

  const data = cfgSnap.data();
  const { notifyHour, notifyMinute, rawHour, rawMin } = resolveChatworkNotifySchedule(data);
  const schedule = { notifyHour, notifyMinute };
  const plan = resolveNotifyPlan(data, schedule);

  console.log("=== Chatwork 設定（Firestore settings/chatwork）===");
  console.log("apiToken:    ", data?.apiToken ? "***設定済み***" : "(未設定)");
  console.log("roomId:      ", data?.roomId || "(未設定)");
  console.log(
    "notifyHour:  ",
    rawHour,
    "notifyMinute:",
    rawMin,
    `→ ${String(notifyHour).padStart(2, "0")}:${String(notifyMinute).padStart(2, "0")}（日本時間）`
  );
  console.log("lastNotificationDate:", normalizeYmd(data?.lastNotificationDate) || "(未送信)");
  console.log("lastNotificationJstDay:", normalizeYmd(data?.lastNotificationJstDay) || "(未記録)");
  console.log("");
  console.log("=== 通知判定（chatwork-notify.js と同じロジック）===");
  console.log("現在の日本時間: ", plan.jstHour + ":" + String(plan.jstMinute).padStart(2, "0"));
  if (plan.skipReason === "before_notify_time") {
    console.log("いま送信可能: ❌ いいえ（定時前。当日分は既に通知済みなら待機）");
  } else if (plan.skipReason === "already_sent") {
    console.log("いま送信可能: ❌ いいえ（", plan.dateStr, "は送信済み）");
  } else if (plan.isCatchUp) {
    console.log("いま送信可能: ✅ はい（取りこぼしキャッチアップ →", plan.dateStr, "）");
  } else {
    console.log("いま送信可能: ✅ はい（翌日分 →", plan.dateStr, "）");
  }
  if (plan.minutesPastNotify >= 45 && plan.skipReason !== "already_sent" && !plan.isCatchUp) {
    console.log("⚠️  設定時刻から", plan.minutesPastNotify, "分経過（45分超で管理者へ遅延アラート）");
  }
  console.log("");
  console.log("GitHub Actions は約5分ごと＋JST夕方帯の追加起動。遅延45分超で Chatwork に警告。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
