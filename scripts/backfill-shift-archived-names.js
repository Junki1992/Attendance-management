/**
 * shiftArchives の archivedUserName を、同一ドキュメントIDの shifts に merge する。
 * 過去に復元スクリプトで archivedUserName を落としてしまった場合の修復用。
 *
 *   npm run backfill-shift-archived-names -- --dry-run
 *   npm run backfill-shift-archived-names -- --execute
 */
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");

const SHIFT_ARCHIVES = "shiftArchives";
const SHIFTS = "shifts";
const BATCH = 400;

async function fetchAllArchiveDocs(db) {
  const all = [];
  let last = null;
  const page = 500;
  for (;;) {
    let q = db.collection(SHIFT_ARCHIVES).orderBy(FieldPath.documentId()).limit(page);
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
  const dry = args.includes("--dry-run");
  const exec = args.includes("--execute");
  if (!dry && !exec) {
    console.error("npm run backfill-shift-archived-names -- --dry-run | --execute");
    process.exit(1);
  }

  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let cred;
  if (credJson) cred = JSON.parse(credJson);
  else if (credPath && fs.existsSync(path.resolve(credPath)))
    cred = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
  else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS を設定してください");
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
  const db = admin.firestore();

  const docs = await fetchAllArchiveDocs(db);
  const pairs = [];
  for (const d of docs) {
    const n = String(d.data().archivedUserName ?? "").trim();
    if (!n) continue;
    pairs.push({ id: d.id, archivedUserName: n });
  }
  console.log(`アーカイブから氏名あり: ${pairs.length} 件`);
  if (dry) {
    console.log("--dry-run のため書き込みしません");
    return;
  }
  let w = 0;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = db.batch();
    const chunk = pairs.slice(i, i + BATCH);
    for (const { id, archivedUserName } of chunk) {
      batch.set(db.collection(SHIFTS).doc(id), { archivedUserName }, { merge: true });
    }
    await batch.commit();
    w += chunk.length;
    console.log(`  … ${w} / ${pairs.length}`);
  }
  console.log("完了: shifts に archivedUserName をマージしました。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
