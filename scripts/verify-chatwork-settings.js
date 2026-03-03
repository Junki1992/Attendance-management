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

async function main() {
  let cred;
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  // ファイルパスを優先（シェルでの JSON エスケープを避けられる）
  const resolvedPath = credPath ? path.resolve(process.cwd(), credPath) : null;
  if (credPath && fs.existsSync(resolvedPath)) {
    cred = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } else if (credPath && !fs.existsSync(resolvedPath)) {
    console.error("ファイルが見つかりません:", resolvedPath);
    console.error("Firebase コンソール → プロジェクト設定 → サービスアカウント → 新しい秘密鍵の生成");
    console.error("で JSON をダウンロードし、上記パスに保存してください。");
    process.exit(1);
  } else if (credJson) {
    try {
      cred = JSON.parse(credJson);
    } catch (e) {
      console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON の JSON 解析に失敗しました。");
      console.error("ファイルで渡す方法: サービスアカウント JSON を serviceAccountKey.json に保存し、");
      console.error("  GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/verify-chatwork-settings.js");
      process.exit(1);
    }
  } else {
    console.error("認証情報を設定してください:");
    console.error("  方法1: GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/verify-chatwork-settings.js");
    console.error("  方法2: サービスアカウント JSON を serviceAccountKey.json に保存してから上記を実行");
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
  const rawHour = data?.notifyHour;
  const notifyHour =
    typeof rawHour === "number" && rawHour >= 0 && rawHour <= 23
      ? Math.floor(rawHour)
      : typeof rawHour === "string" && /^\d+$/.test(rawHour)
        ? Math.min(23, Math.max(0, parseInt(rawHour, 10)))
        : 21;
  const rawMin = data?.notifyMinute;
  const notifyMinute =
    typeof rawMin === "number" && rawMin >= 0 && rawMin <= 59
      ? Math.floor(rawMin)
      : typeof rawMin === "string" && /^\d+$/.test(rawMin)
        ? Math.min(59, Math.max(0, parseInt(rawMin, 10)))
        : 0;

  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstMinute = now.getUTCMinutes();

  console.log("=== Chatwork 設定（Firestore settings/chatwork）===");
  console.log("apiToken:    ", data?.apiToken ? "***設定済み***" : "(未設定)");
  console.log("roomId:      ", data?.roomId || "(未設定)");
  console.log("notifyHour:  ", rawHour, "notifyMinute:", rawMin, `→ ${String(notifyHour).padStart(2, "0")}:${String(notifyMinute).padStart(2, "0")}（日本時間）`);
  console.log("");
  console.log("=== 通知判定（chatwork-notify.js と同じロジック）===");
  console.log("現在の日本時間: ", jstHour + ":" + String(jstMinute).padStart(2, "0"));
  console.log("設定された時刻: ", notifyHour + ":" + String(notifyMinute).padStart(2, "0"));
  console.log("この時刻に通知送信: ", jstHour === notifyHour && jstMinute === notifyMinute ? "✅ はい" : "❌ いいえ（スキップ）");
  console.log("");
  console.log("GitHub Actions は毎分実行され、");
  console.log(`日本時間 ${String(notifyHour).padStart(2, "0")}:${String(notifyMinute).padStart(2, "0")} のときのみ通知を送信します。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
