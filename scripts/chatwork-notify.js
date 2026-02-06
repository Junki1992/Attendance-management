/**
 * 翌日出勤を Chatwork に送信（GitHub Actions 等で毎日 21:00 に実行）
 * 実行: node scripts/chatwork-notify.js
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON (Firebase サービスアカウントの JSON 文字列)
 *          CHATWORK_API_TOKEN, CHATWORK_ROOM_ID（未設定時は Firestore settings/chatwork から取得）
 *          CHATWORK_ERROR_NOTIFY_ACCOUNT_ID（エラー時のメンション先、GitHub Secrets で設定）
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

async function sendErrorToChatwork(token, roomId, accountId, errorMessage) {
  if (!accountId?.trim()) return;
  try {
    const body = `[To:${accountId.trim()}] 【エラー】翌日出勤通知に失敗しました\n${errorMessage}`;
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "X-ChatworkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ body }).toString(),
    });
    if (!res.ok) {
      console.error("Failed to send error notification:", res.status, await res.text());
    }
  } catch (e) {
    console.error("Failed to send error notification:", e);
  }
}

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
    const raw = cfgData?.notifyHour;
    const notifyHour =
      typeof raw === "number" && raw >= 0 && raw <= 23
        ? Math.floor(raw)
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? Math.min(23, Math.max(0, parseInt(raw, 10)))
          : 21;
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    if (jstHour !== notifyHour) {
      console.log("[chatwork-notify] Skip: JST", jstHour, "!= configured", notifyHour, "(UTC", now.getUTCHours() + ":00)");
      process.exit(0);
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  console.log("[chatwork-notify] Sending for date:", dateStr, "roomId:", roomId);
  const shiftsSnap = await db.collection("shifts").where("date", "==", dateStr).where("status", "==", "confirmed").get();
  const entries = [];
  for (const d of shiftsSnap.docs) {
    const data = d.data();
    const start = (data.startTime || "").trim();
    const end = (data.endTime || "").trim();
    if (!start || !end || (start === "00:00" && end === "00:00")) continue;
    const userSnap = await db.doc(`users/${data.userId}`).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const name = userData?.name || data.userId;
    const raw = userData?.chatworkAccountId;
    const chatworkAccountId = (raw != null ? String(raw).trim() : "") || undefined;
    entries.push({ name, start, end, chatworkAccountId });
  }

  const dateLabel = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
  const lines =
    entries.length > 0
      ? entries.map((e) => {
          const mention = e.chatworkAccountId ? `[To:${e.chatworkAccountId}] ` : "";
          return `${mention}${e.name} ${e.start}-${e.end}`;
        })
      : ["（出勤なし）"];
  const body = `【翌日出勤】${dateLabel}\n${lines.join("\n")}`;
  console.log("[chatwork-notify] Entries:", entries.length, "Body:", body);

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "X-ChatworkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[chatwork-notify] Chatwork API error:", res.status, errText);
    await sendErrorToChatwork(token, roomId, process.env.CHATWORK_ERROR_NOTIFY_ACCOUNT_ID, `Chatwork API エラー ${res.status}: ${errText}`);
    process.exit(1);
  }
  console.log("[chatwork-notify] Sent OK:", dateStr, "entries:", entries.length);
}

main().catch(async (e) => {
  console.error(e);
  try {
    let token = process.env.CHATWORK_API_TOKEN;
    let roomId = process.env.CHATWORK_ROOM_ID;
    if (!token || !roomId) {
      const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credJson || (credPath && fs.existsSync(path.resolve(credPath)))) {
        const cred = credJson ? JSON.parse(credJson) : JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
        const cfgSnap = await admin.firestore().doc("settings/chatwork").get();
        if (cfgSnap.exists) {
          const d = cfgSnap.data();
          token = token || d?.apiToken?.trim();
          roomId = roomId || d?.roomId?.trim();
        }
      }
    }
    if (token && roomId) {
      await sendErrorToChatwork(token, roomId, process.env.CHATWORK_ERROR_NOTIFY_ACCOUNT_ID, String(e?.message || e));
    }
  } catch (notifyErr) {
    console.error("Error notify failed:", notifyErr);
  }
  process.exit(1);
});
