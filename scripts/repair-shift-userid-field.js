/**
 * shifts コレクションの各ドキュメントについて、ドキュメントIDが `UID_YYYY-MM-DD` 形式なら
 * 本文の userId / date を ID に合わせて修正する（where("userId") の取りこぼし・表示ズレの根本修復）
 *
 * 事前確認:
 *   npm run repair-shift-userids -- --dry-run
 * 本番更新:
 *   npm run repair-shift-userids -- --execute
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const path = require("path");
const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");

const SHIFTS = "shifts";
const BATCH_SIZE = 400;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeYmd(y, mo, d) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function parseUserIdAndDateFromDocId(docId) {
  let m = docId.match(/^(.+)_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const date = normalizeYmd(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
    if (date) return { userId: m[1], date };
  }
  m = docId.match(/^(.+)_(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const date = normalizeYmd(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
    if (date) return { userId: m[1], date };
  }
  return null;
}

async function fetchAllShiftDocs(db) {
  const all = [];
  let last = null;
  const page = 500;
  for (;;) {
    let q = db.collection(SHIFTS).orderBy(FieldPath.documentId()).limit(page);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => all.push(d));
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < page) break;
  }
  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");

  if (!dryRun && !execute) {
    console.error("使い方: npm run repair-shift-userids -- --dry-run | --execute");
    process.exit(1);
  }

  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const pathCred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (json) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
  } else if (pathCred) {
    admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(pathCred))) });
  } else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS を設定してください");
    process.exit(1);
  }

  const db = admin.firestore();
  const docs = await fetchAllShiftDocs(db);
  let wouldFix = 0;
  let fixed = 0;

  const toWrite = [];
  for (const d of docs) {
    const parsed = parseUserIdAndDateFromDocId(d.id);
    if (!parsed) continue;
    const data = d.data() || {};
    const curUid = String(data.userId ?? "").trim();
    const curDate = typeof data.date === "string" ? data.date.trim() : "";
    const needUid = curUid !== parsed.userId;
    const needDate = curDate !== parsed.date;
    if (!needUid && !needDate) continue;
    wouldFix++;
    const upd = {};
    if (needUid) upd.userId = parsed.userId;
    if (needDate) upd.date = parsed.date;
    toWrite.push({ ref: d.ref, upd });
  }

  if (execute) {
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { ref, upd } of toWrite.slice(i, i + BATCH_SIZE)) {
        batch.update(ref, upd);
      }
      await batch.commit();
    }
    fixed = toWrite.length;
  }

  console.log(dryRun ? "[dry-run]" : "[execute]", `対象ドキュメント総数: ${docs.length}`);
  console.log(dryRun ? `修正が必要な件数（予定）: ${wouldFix}` : `更新した件数: ${fixed}`);
  if (dryRun && wouldFix > 0) {
    console.log("本番反映: npm run repair-shift-userids -- --execute");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
