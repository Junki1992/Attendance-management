/**
 * シフト提出催促（GitHub Actions で毎日 09:00 JST に実行）
 * 設定（settings/app）の firstBlockDeadlineDay / secondBlockDeadlineDay および deadlineOverrides に従い、
 * 締切日当日に未提出者へ通知を送信する。
 *
 * 実行: node scripts/remind-shift-submit.js
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON (Firebase サービスアカウントの JSON 文字列)
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  firstBlockDeadlineDay: 25,
  secondBlockDeadlineDay: 10,
};

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
  const settingsSnap = await db.collection("settings").doc("app").get();
  const settings = settingsSnap.exists ? { ...DEFAULTS, ...settingsSnap.data() } : DEFAULTS;
  const firstDay = settings.firstBlockDeadlineDay ?? 25;
  const secondDay = settings.secondBlockDeadlineDay ?? 10;
  const overrides = settings.deadlineOverrides || {};

  const tasks = [];

  if (today === firstDay) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    tasks.push({
      startStr: `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`,
      endStr: `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-15`,
      message: "来月1～15日分のシフト提出は本日が締切です。お早めに提出してください。",
      blockLabel: "next_month_1_15",
    });
  }
  if (today === secondDay) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    tasks.push({
      startStr: `${year}-${String(month + 1).padStart(2, "0")}-16`,
      endStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      message: "当月16日～月末分のシフト提出は本日が締切です。お早めに提出してください。",
      blockLabel: "this_month_16_end",
    });
  }

  Object.entries(overrides).forEach(([key, value]) => {
    if (!value) return;
    const deadlineDate = new Date(value);
    if (Number.isNaN(deadlineDate.getTime())) return;
    const dYear = deadlineDate.getFullYear();
    const dMonth = deadlineDate.getMonth();
    const dDate = deadlineDate.getDate();
    if (dYear !== year || dMonth !== month || dDate !== today) return;

    const match = key.match(/^(\d{4})-(\d{2})_(first|second)$/);
    if (!match) return;
    const [, y, m, block] = match;
    const monthNum = parseInt(m, 10);
    const yearNum = parseInt(y, 10);
    if (block === "first") {
      tasks.push({
        startStr: `${yearNum}-${m}-01`,
        endStr: `${yearNum}-${m}-15`,
        message: `${yearNum}年${monthNum}月1～15日分のシフト提出は本日が締切です。お早めに提出してください。`,
        blockLabel: `${key}_override`,
      });
    } else {
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      tasks.push({
        startStr: `${yearNum}-${m}-16`,
        endStr: `${yearNum}-${m}-${String(lastDay).padStart(2, "0")}`,
        message: `${yearNum}年${monthNum}月16日～月末分のシフト提出は本日が締切です。お早めに提出してください。`,
        blockLabel: `${key}_override`,
      });
    }
  });

  if (tasks.length === 0) {
    console.log("[remind-shift-submit] not deadline day, skip", { today });
    process.exit(0);
  }

  const usersSnap = await db.collection("users").where("role", "==", "staff").get();
  const staff = usersSnap.docs.map((d) => ({ id: d.id, name: (d.data() && d.data().name) ? d.data().name : d.id }));
  if (staff.length === 0) {
    console.log("[remind-shift-submit] no staff found");
    process.exit(0);
  }

  let totalCreated = 0;
  for (const { startStr, endStr, message, blockLabel } of tasks) {
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

    const promises = [];
    let createdCount = 0;
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
    totalCreated += createdCount;
    console.log("[remind-shift-submit] block done", { blockLabel, startStr, endStr, createdCount });
  }
  console.log("[remind-shift-submit] finished", { totalCreated });
}

main().catch((err) => {
  console.error("[remind-shift-submit] error", err);
  process.exit(1);
});
