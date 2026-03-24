/**
 * shifts / shiftArchives の date を Firestore 上で YYYY-MM-DD 文字列に統一する。
 *
 * 問題: date が Timestamp のまま、または "2026-2-5" のような非ゼロ埋めだと、
 * where("date", ">=", "2026-02-01") の範囲クエリにヒットせず、シフト表に出ない。
 *
 * 確認のみ:
 *   npm run normalize-shift-dates -- --dry-run
 *
 * 書き込み:
 *   npm run normalize-shift-dates -- --execute
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const BATCH = 400;

function normalizeDate(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (typeof raw.toDate === "function") {
    const d = raw.toDate();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function needsUpdate(data) {
  const n = normalizeDate(data.date);
  if (!n) return null;
  const cur = data.date;
  if (typeof cur === "string" && cur === n) return null;
  if (cur && typeof cur.toDate === "function") return n;
  if (typeof cur === "string" && cur !== n) return n;
  return null;
}

async function paginateCollection(db, name, onDoc) {
  let last = null;
  const page = 500;
  let total = 0;
  for (;;) {
    let q = db.collection(name).orderBy(FieldPath.documentId()).limit(page);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      await onDoc(d);
      total++;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < page) break;
  }
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  if (!dryRun && !execute) {
    console.error("付与: --dry-run または --execute");
    process.exit(1);
  }

  let cred;
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credJson) cred = JSON.parse(credJson);
  else if (credPath && fs.existsSync(path.resolve(credPath))) {
    cred = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
  } else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS を設定してください");
    process.exit(1);
  }

  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
  const db = admin.firestore();

  const updates = [];
  const bad = [];

  async function collect(ref, data) {
    const n = needsUpdate(data);
    if (n) updates.push({ ref, n, id: ref.id });
    if (data.date != null && !normalizeDate(data.date)) bad.push(ref.path);
  }

  console.log("shifts をスキャン…");
  const nShift = await paginateCollection(db, "shifts", async (d) => collect(d.ref, d.data()));
  console.log(`  ドキュメント数: ${nShift}`);

  console.log("shiftArchives をスキャン…");
  const nArch = await paginateCollection(db, "shiftArchives", async (d) => collect(d.ref, d.data()));
  console.log(`  ドキュメント数: ${nArch}`);

  console.log(`date 要修正: ${updates.length} 件`);
  if (bad.length) console.log(`date 解釈不能（手動確認）: ${bad.length} 件（先頭5件）\n  ${bad.slice(0, 5).join("\n  ")}`);

  if (dryRun) {
    console.log("--dry-run のため未更新。本番は --execute");
    return;
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + BATCH);
    for (const u of chunk) {
      batch.update(u.ref, { date: u.n });
    }
    await batch.commit();
    done += chunk.length;
    console.log(`  更新 ${done} / ${updates.length}`);
  }
  console.log("完了。シフト表を再読み込みしてください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
