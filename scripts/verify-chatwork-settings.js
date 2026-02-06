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
  const raw = data?.notifyHour;
  const notifyHour =
    typeof raw === "number" && raw >= 0 && raw <= 23
      ? Math.floor(raw)
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Math.min(23, Math.max(0, parseInt(raw, 10)))
        : 21;

  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;

  console.log("=== Chatwork 設定（Firestore settings/chatwork）===");
  console.log("apiToken:    ", data?.apiToken ? "***設定済み***" : "(未設定)");
  console.log("roomId:      ", data?.roomId || "(未設定)");
  console.log("notifyHour:  ", raw, `→ 解釈結果: ${notifyHour}時（日本時間）`);
  console.log("");
  console.log("=== 通知判定（chatwork-notify.js と同じロジック）===");
  console.log("現在の日本時間: ", jstHour, "時");
  console.log("設定された時刻: ", notifyHour, "時");
  console.log("この時刻に通知送信: ", jstHour === notifyHour ? "✅ はい" : "❌ いいえ（スキップ）");
  console.log("");
  console.log("GitHub Actions は毎時 0 分（UTC）に実行され、");
  console.log(`日本時間 ${String(notifyHour).padStart(2, "0")}:00 のときのみ通知を送信します。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
