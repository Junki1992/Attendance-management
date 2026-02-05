/**
 * 翌日出勤を Chatwork に送信（GitHub Actions 等で毎日 21:00 に実行）
 * 実行: node scripts/chatwork-notify.js
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON (Firebase サービスアカウントの JSON 文字列)
 *          CHATWORK_API_TOKEN, CHATWORK_ROOM_ID（未設定時は Firestore settings/chatwork から取得）
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

async function main() {
  let cred;
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credJson) {
    cred = JSON.parse(credJson);
  } else if (credPath && fs.existsSync(path.resolve(credPath))) {
    cred = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
  } else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS（ファイルパス）を設定してください");
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  const db = admin.firestore();

  const cfgSnap = await db.doc("settings/chatwork").get();
  if (!cfgSnap.exists) {
    console.error("Chatwork 設定が Firestore にありません。管理画面で設定してください。");
    process.exit(1);
  }
  const cfgData = cfgSnap.data();
  let token = process.env.CHATWORK_API_TOKEN || cfgData?.apiToken?.trim();
  let roomId = process.env.CHATWORK_ROOM_ID || cfgData?.roomId?.trim();
  if (!token || !roomId) {
    console.error("Chatwork API トークンとルーム ID を設定してください");
    process.exit(1);
  }

  const forceSend = process.env.CHATWORK_NOTIFY_FORCE === "1";
  if (!forceSend) {
    const notifyHour = (typeof cfgData?.notifyHour === "number" && cfgData.notifyHour >= 0 && cfgData.notifyHour <= 23)
      ? cfgData.notifyHour
      : 21;
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    if (jstHour !== notifyHour) {
      console.log("Skip: current JST hour", jstHour, "!= configured", notifyHour);
      process.exit(0);
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const shiftsSnap = await db.collection("shifts").where("date", "==", dateStr).where("status", "==", "confirmed").get();
  const entries = [];
  for (const d of shiftsSnap.docs) {
    const data = d.data();
    const start = (data.startTime || "").trim();
    const end = (data.endTime || "").trim();
    if (!start || !end || (start === "00:00" && end === "00:00")) continue;
    const userSnap = await db.doc(`users/${data.userId}`).get();
    const name = userSnap.exists ? (userSnap.data()?.name || data.userId) : data.userId;
    entries.push({ name, start, end });
  }

  const dateLabel = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
  const lines = entries.length > 0 ? entries.map((e) => `${e.name} ${e.start}-${e.end}`) : ["（出勤なし）"];
  const body = `[toall]\n【翌日出勤】${dateLabel}\n${lines.join("\n")}`;

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "X-ChatworkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body }).toString(),
  });

  if (!res.ok) {
    console.error("Chatwork API error:", res.status, await res.text());
    process.exit(1);
  }
  console.log("Sent:", dateStr, entries.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
