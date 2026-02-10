/**
 * シフト提出催促（GitHub Actions で毎日 09:00 JST に実行）
 * 25日: 来月1～15日分の未提出者に通知、10日: 当月16日～月末分の未提出者に通知
 *
 * 実行: node scripts/remind-shift-submit.js
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON (Firebase サービスアカウントの JSON 文字列)
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
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS を設定してください");
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  const db = admin.firestore();

  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();

  let startStr, endStr, message, blockLabel;
  if (today === 25) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    startStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`;
    endStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-15`;
    message = "来月1～15日分のシフト提出は本日が締切です。お早めに提出してください。";
    blockLabel = "next_month_1_15";
  } else if (today === 10) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    startStr = `${year}-${String(month + 1).padStart(2, "0")}-16`;
    endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    message = "当月16日～月末分のシフト提出は本日が締切です。お早めに提出してください。";
    blockLabel = "this_month_16_end";
  } else {
    console.log("[remind-shift-submit] not deadline day, skip", { today });
    process.exit(0);
  }

  const usersSnap = await db.collection("users").where("role", "==", "staff").get();
  const staff = usersSnap.docs.map((d) => ({ id: d.id, name: (d.data() && d.data().name) ? d.data().name : d.id }));
  if (staff.length === 0) {
    console.log("[remind-shift-submit] no staff found");
    process.exit(0);
  }

  const shiftsSnap = await db
    .collection("shifts")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  const submitted = new Set();
  shiftsSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data) return;
    if (data.status === "submitted" || data.status === "confirmed") {
      if (data.userId) submitted.add(data.userId);
    }
  });

  let createdCount = 0;
  const promises = [];
  staff.forEach((s) => {
    if (!submitted.has(s.id)) {
      promises.push(
        db
          .collection("notifications")
          .add({
            userId: s.id,
            type: "remind_submit",
            message,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .then(() => {
            createdCount += 1;
          })
          .catch((e) => console.error("[remind-shift-submit] notif add failed", s.id, e))
      );
    }
  });

  await Promise.all(promises);
  console.log("[remind-shift-submit] finished", { blockLabel, startStr, endStr, createdCount });
}

main().catch((err) => {
  console.error("[remind-shift-submit] error", err);
  process.exit(1);
});
