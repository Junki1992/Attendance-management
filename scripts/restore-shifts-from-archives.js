/**
 * shiftArchives の内容を shifts コレクションへ書き戻す（緊急復旧用）
 *
 * ユーザー削除時にコピーされた退職者シフトが shiftArchives に残っている場合、
 * 現役のシフト表（shifts）をここから復元できます。
 *
 * 事前確認（書き込みなし）:
 *   npm run restore-shifts-from-archives -- --dry-run
 *
 * 本番復元（実際に shifts へ書き込み）:
 *   npm run restore-shifts-from-archives -- --execute
 *
 * 特定の暦月だけ復元（例: 2026年2月のみ・緊急時に推奨）:
 *   npm run restore-shifts-from-archives -- --dry-run --year 2026 --month 2
 *   npm run restore-shifts-from-archives -- --execute --year 2026 --month 2
 *
 * 既存ドキュメントとフィールドをマージ（上書きを弱める）:
 *   ... --execute --merge
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 * （delete-user-shifts.js と同じサービスアカウント）
 */

const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const SHIFT_ARCHIVES = "shiftArchives";
const SHIFTS = "shifts";
const BATCH_COMMIT = 400;

/** archivedUserName は残す（復元後も管理表で name_* / 旧UID と現行スタッフ名の照合に必要） */
const ARCHIVE_ONLY_FIELDS = new Set([
  "archivedAt",
  "archivedFromShiftDocId",
  "archivedFromImport",
]);

function stripArchiveFields(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!ARCHIVE_ONLY_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

/** 月次クエリ（文字列範囲）に載るよう date を YYYY-MM-DD 文字列へ */
function normalizeDateForShift(raw) {
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
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function parseYearMonthArgs(args) {
  const yi = args.indexOf("--year");
  const mi = args.indexOf("--month");
  if (yi === -1 && mi === -1) return null;
  if (yi === -1 || mi === -1) {
    console.error("--year と --month はセットで指定してください（例: --year 2026 --month 2）");
    process.exit(1);
  }
  const y = parseInt(args[yi + 1], 10);
  const m = parseInt(args[mi + 1], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    console.error("--year / --month の値が不正です");
    process.exit(1);
  }
  return { year: y, month: m };
}

/** アーカイブ1件が指定暦月に含まれるか（date またはドキュメントID末尾の日付） */
function archiveDocInCalendarMonth(docId, data, year, month) {
  const nd = normalizeDateForShift(data.date);
  if (nd) {
    const [yy, mm] = nd.split("-").map((x) => parseInt(x, 10));
    return yy === year && mm === month;
  }
  const m = String(docId).match(/_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month;
}

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
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  const useMerge = args.includes("--merge");
  const ym = parseYearMonthArgs(args);

  if (!dryRun && !execute) {
    console.error("次のどちらかを付けてください:");
    console.error("  --dry-run   … 件数だけ確認（書き込みなし）");
    console.error("  --execute   … shifts へ実際に復元");
    process.exit(1);
  }

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

  console.log(`${SHIFT_ARCHIVES} を読み込み中…`);
  const docs = await fetchAllArchiveDocs(db);
  console.log(`アーカイブ件数: ${docs.length}`);

  if (docs.length === 0) {
    console.error("shiftArchives にドキュメントがありません。Firebase コンソールでコレクションを確認してください。");
    process.exit(2);
  }

  let skipped = 0;
  let filteredOut = 0;
  const toWrite = [];
  for (const d of docs) {
    const data = d.data();
    const uid = data.userId;
    const date = data.date;
    if (!uid || !date) {
      console.warn(`スキップ（userId/date なし）: ${d.id}`);
      skipped++;
      continue;
    }
    if (ym && !archiveDocInCalendarMonth(d.id, data, ym.year, ym.month)) {
      filteredOut++;
      continue;
    }
    const payload = stripArchiveFields(data);
    const nd = normalizeDateForShift(payload.date);
    if (nd) payload.date = nd;
    toWrite.push({ id: d.id, payload });
  }

  if (ym) {
    console.log(`月フィルタ: ${ym.year}年${ym.month}月のみ（対象外 ${filteredOut} 件）`);
  }
  console.log(`復元対象: ${toWrite.length} 件（スキップ ${skipped}）`);

  if (dryRun) {
    console.log("--dry-run のため書き込みは行いません。本番は --execute を付けて再実行してください。");
    return;
  }

  if (toWrite.length === 0) {
    console.error("復元対象が0件です。月フィルタを外すか、アーカイブに該当月データがあるか確認してください。");
    process.exit(3);
  }

  console.log(`--execute: shifts へ書き込み開始… (${useMerge ? "merge: true" : "merge: false（全フィールド上書き）"})`);
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_COMMIT) {
    const batch = db.batch();
    const chunk = toWrite.slice(i, i + BATCH_COMMIT);
    for (const { id, payload } of chunk) {
      batch.set(db.collection(SHIFTS).doc(id), payload, { merge: useMerge });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  … ${written} / ${toWrite.length}`);
  }

  console.log(`完了: shifts に ${written} 件を書き込みました。`);
  console.log("ブラウザでシフト表を再読み込みして表示を確認してください。");
  console.log("※ shiftArchives のデータは削除していません（必要ならコンソールから別途整理）。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
