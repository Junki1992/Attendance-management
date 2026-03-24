/**
 * 手元の JSON バックアップから Firestore の `shifts` コレクションへ復元する。
 * （GCP の Firestore エクスポートの生データは別形式のため、このスクリプトでは扱わない。
 *  その場合は `gcloud firestore import gs://...` を検討。）
 *
 * ファイル形式（いずれか）:
 *   A) [ { "id": "UID_2026-02-01", "userId": "UID", "date": "2026-02-01", ... }, ... ]
 *   B) { "shifts": [ ... 同上 ... ] }
 *
 * 各要素はドキュメント ID をキー `id` で必須。ほかは Firestore にそのまま保存可能なプレーン JSON
 * （文字列・数値・真偽・null。ネストオブジェクト可。日付はアプリでは string の YYYY-MM-DD を推奨）
 *
 * 例:
 *   npm run restore-shifts-from-json -- --dry-run --file ./backups/shifts-202602.json
 *   npm run restore-shifts-from-json -- --execute --file ./backups/shifts-202602.json --year 2026 --month 2
 *
 *   --merge（デフォルト）… 既存とマージ
 *   --no-merge … ドキュメント全体を上書き
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SHIFTS = "shifts";
const BATCH = 400;

function initAdmin() {
  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let cred;
  if (credJson) cred = JSON.parse(credJson);
  else if (credPath && fs.existsSync(path.resolve(credPath)))
    cred = JSON.parse(fs.readFileSync(path.resolve(credPath), "utf8"));
  else {
    console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS が必要です");
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
  return admin.firestore();
}

function normalizeYmd(y, mo, d) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dateFromDocId(docId) {
  const m = String(docId).match(/_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return normalizeYmd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

function normalizeDateField(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return normalizeYmd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }
  return null;
}

function inCalendarMonth(docId, row, year, month) {
  const nd = normalizeDateField(row.date);
  if (nd) {
    const [yy, mm] = nd.split("-").map((x) => parseInt(x, 10));
    return yy === year && mm === month;
  }
  const fromId = dateFromDocId(docId);
  if (!fromId) return false;
  const [yy, mm] = fromId.split("-").map((x) => parseInt(x, 10));
  return yy === year && mm === month;
}

function loadDocuments(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const j = JSON.parse(raw);
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.shifts)) return j.shifts;
  console.error("JSON は配列か、{ shifts: [...] } 形式である必要があります");
  process.exit(1);
}

function parseYearMonth(args) {
  const yi = args.indexOf("--year");
  const mi = args.indexOf("--month");
  if (yi === -1 && mi === -1) return null;
  if (yi === -1 || mi === -1) {
    console.error("--year と --month はセットで指定してください");
    process.exit(1);
  }
  const y = parseInt(args[yi + 1], 10);
  const m = parseInt(args[mi + 1], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    console.error("年または月が不正です");
    process.exit(1);
  }
  return { year: y, month: m };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  const merge = !args.includes("--no-merge");
  const fi = args.indexOf("--file");
  if (fi === -1 || !args[fi + 1]) {
    console.error("--file ./path/to.json を指定してください");
    process.exit(1);
  }
  const filePath = args[fi + 1];
  if (!fs.existsSync(path.resolve(filePath))) {
    console.error("ファイルが見つかりません:", filePath);
    process.exit(1);
  }

  if (!dryRun && !execute) {
    console.error("--dry-run または --execute を付けてください");
    process.exit(1);
  }

  const ym = parseYearMonth(args);
  const rows = loadDocuments(filePath);
  const db = dryRun ? null : initAdmin();

  const toWrite = [];
  let skipped = 0;
  let filtered = 0;

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      skipped++;
      continue;
    }
    const { id: _drop, ...payload } = row;
    if (ym && !inCalendarMonth(id, row, ym.year, ym.month)) {
      filtered++;
      continue;
    }
    const nd = normalizeDateField(payload.date);
    if (nd) payload.date = nd;
    toWrite.push({ id, payload });
  }

  console.log(`ファイル: ${filePath}`);
  console.log(`読み込み: ${rows.length} 行 → 書き込み候補 ${toWrite.length}（スキップ id なし ${skipped}）`);
  if (ym) console.log(`月フィルタ: ${ym.year}-${String(ym.month).padStart(2, "0")} 以外 ${filtered} 件除外`);
  if (toWrite.length === 0) {
    console.error("書き込み候補がありません");
    process.exit(2);
  }

  if (dryRun) {
    toWrite.slice(0, 15).forEach((w) => console.log(`  [dry-run] ${w.id}`));
    if (toWrite.length > 15) console.log(`  … 他 ${toWrite.length - 15} 件`);
    console.log("\n本番: npm run restore-shifts-from-json -- --execute --file ...");
    return;
  }

  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = db.batch();
    const chunk = toWrite.slice(i, i + BATCH);
    for (const { id, payload } of chunk) {
      batch.set(db.collection(SHIFTS).doc(id), payload, { merge });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  … ${written} / ${toWrite.length}`);
  }
  console.log(`完了: shifts に ${written} 件（merge=${merge}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
