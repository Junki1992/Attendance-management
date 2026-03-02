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
  if (!token) {
    console.error("Chatwork API トークンを設定してください");
    process.exit(1);
  }
  let destinations = [];
  const rawDests = cfgData?.notificationDestinations;
  if (Array.isArray(rawDests) && rawDests.length > 0) {
    destinations = rawDests
      .filter((x) => x && (x.type === "room" || x.type === "personal") && x.id && String(x.id).trim())
      .map((x) => ({ type: x.type, id: String(x.id).trim() }));
  }
  if (destinations.length === 0) {
    const roomId = process.env.CHATWORK_ROOM_ID || cfgData?.roomId?.trim();
    const personalAccountId = process.env.CHATWORK_PERSONAL_ACCOUNT_ID || cfgData?.personalAccountId?.trim();
    if (roomId) destinations.push({ type: "room", id: roomId });
    if (personalAccountId) destinations.push({ type: "personal", id: personalAccountId });
  }
  if (destinations.length === 0) {
    console.error("通知先を1件以上設定してください（管理画面の「通知先」でルームまたは個人を追加）");
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

  console.log("[chatwork-notify] Sending for date:", dateStr, "destinations:", destinations.length);
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
  console.log("[chatwork-notify] Entries:", entries.length, "destinations:", destinations.length);

  let firstRoomIdForError = null;
  let lastError = null;
  for (const dest of destinations) {
    if (dest.type === "personal" && entries.length === 0) {
      continue;
    }
    let targetRoomId;
    if (dest.type === "personal") {
      try {
        // 自分を必ず members_admin_ids に含める（Chatwork API の要件）
        const meRes = await fetch("https://api.chatwork.com/v2/me", {
          headers: { "X-ChatworkToken": token },
        });
        if (!meRes.ok) throw new Error("自分のアカウント情報を取得できませんでした");
        const meJson = await meRes.json();
        const myAccountId = meJson?.account_id != null ? String(meJson.account_id) : null;
        if (!myAccountId) throw new Error("account_id を取得できませんでした");
        const bodyParams = new URLSearchParams();
        bodyParams.set("name", "翌日出勤通知");
        bodyParams.set("members_admin_ids", dest.id);
        bodyParams.set("members_member_ids", myAccountId);
        const createRes = await fetch("https://api.chatwork.com/v2/rooms", {
          method: "POST",
          headers: { "X-ChatworkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
          body: bodyParams.toString(),
        });
        if (!createRes.ok) {
          const t = await createRes.text();
          throw new Error(`ルーム作成失敗 ${createRes.status}: ${t}`);
        }
        const json = await createRes.json();
        if (typeof json?.room_id !== "number") throw new Error("ルーム作成の応答に room_id がありません");
        targetRoomId = String(json.room_id);
        if (!firstRoomIdForError) firstRoomIdForError = targetRoomId;
        console.log("[chatwork-notify] Created 1-on-1 room:", targetRoomId);
      } catch (e) {
        console.error("[chatwork-notify] Create room error for", dest.id, e);
        lastError = e?.message || String(e);
        continue;
      }
    } else {
      targetRoomId = dest.id;
      if (!firstRoomIdForError) firstRoomIdForError = targetRoomId;
    }
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${targetRoomId}/messages`, {
      method: "POST",
      headers: { "X-ChatworkToken": token, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ body }).toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      lastError = `Chatwork API ${res.status}: ${errText}`;
      console.error("[chatwork-notify] Send error to", targetRoomId, res.status, errText);
    }
  }
  if (lastError && firstRoomIdForError) {
    await sendErrorToChatwork(token, firstRoomIdForError, process.env.CHATWORK_ERROR_NOTIFY_ACCOUNT_ID, lastError);
  }
  if (lastError) process.exit(1);
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
          if (!roomId && Array.isArray(d?.notificationDestinations) && d.notificationDestinations.length > 0) {
            const first = d.notificationDestinations.find((x) => x?.type === "room" && x?.id);
            if (first) roomId = first.id;
          }
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
