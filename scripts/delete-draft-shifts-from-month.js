/**
 * 指定した「日付」の下限以降の shifts のうち、status が draft のみを削除する。
 * どの暦月が消えるかは --dry-run で必ず「暦月別件数」を確認してから --execute すること。
 *
 *   npm run delete-draft-shifts-from-month -- --dry-run --from-year 2026 --from-month 4
 *   npm run delete-draft-shifts-from-month -- --execute --from-year 2026 --from-month 4
 *
 * 例: --from-year 2026 --from-month 4 → ドキュメントの日付が 2026-04-01 以降の draft のみ。
 *     2026年3月以前の日付の下書きは対象外（消えない）。
 *
 * 終了を指定（その月末まで）:
 *   ... --to-year 2026 --to-month 12
 *
 * 特定ユーザーのみ:
 *   ... --uid <FirebaseUID>
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");

const SHIFTS = "shifts";
const BATCH_DELETE = 400;

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(y, mo, d) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function lastDayOfMonth(y, mo) {
  return new Date(y, mo, 0).getDate();
}

/** 4月31日など、暦上存在しない日付 */
function isValidCalendarYmd(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= lastDayOfMonth(y, mo);
}

function normalizeDateFromShift(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return ymd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }
  if (typeof raw.toDate === "function") {
    const d = raw.toDate();
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

function parseDateFromDocId(docId) {
  const m = String(docId).match(/_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return ymd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

function resolveShiftDate(docId, data) {
  return normalizeDateFromShift(data.date) || parseDateFromDocId(docId);
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

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const execute = argv.includes("--execute");
  const fy = argv.indexOf("--from-year");
  const fm = argv.indexOf("--from-month");
  const ty = argv.indexOf("--to-year");
  const tm = argv.indexOf("--to-month");
  const ui = argv.indexOf("--uid");

  if (!dryRun && !execute) {
    console.error("--dry-run または --execute を指定してください");
    process.exit(1);
  }
  if (fy === -1 || fm === -1) {
    console.error("--from-year と --from-month が必要です（例: --from-year 2026 --from-month 4）");
    process.exit(1);
  }
  const fromYear = parseInt(argv[fy + 1], 10);
  const fromMonth = parseInt(argv[fm + 1], 10);
  if (!Number.isFinite(fromYear) || !Number.isFinite(fromMonth) || fromMonth < 1 || fromMonth > 12) {
    console.error("from-year / from-month が不正です");
    process.exit(1);
  }

  let toYmdMax = null;
  if (ty !== -1 || tm !== -1) {
    if (ty === -1 || tm === -1) {
      console.error("--to-year と --to-month はセットで指定してください");
      process.exit(1);
    }
    const toYear = parseInt(argv[ty + 1], 10);
    const toMonth = parseInt(argv[tm + 1], 10);
    if (!Number.isFinite(toYear) || !Number.isFinite(toMonth) || toMonth < 1 || toMonth > 12) {
      console.error("to-year / to-month が不正です");
      process.exit(1);
    }
    const ld = lastDayOfMonth(toYear, toMonth);
    toYmdMax = ymd(toYear, toMonth, ld);
  }

  const fromYmdMin = ymd(fromYear, fromMonth, 1);
  if (!fromYmdMin) process.exit(1);

  const uidOnly = ui !== -1 && argv[ui + 1] ? String(argv[ui + 1]).trim() : null;

  return { dryRun, execute, fromYmdMin, toYmdMax, uidOnly };
}

function inRange(dateStr, fromMin, toMax) {
  if (!dateStr) return false;
  if (dateStr < fromMin) return false;
  if (toMax && dateStr > toMax) return false;
  return true;
}

/** YYYY-MM-DD → 暦月キー YYYY-MM（集計用） */
function calendarMonthKey(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return "（日付不明）";
  return `${m[1]}-${m[2]}`;
}

function printBreakdownByCalendarMonth(targets) {
  const map = new Map();
  for (const t of targets) {
    const k = calendarMonthKey(t.dateStr);
    map.set(k, (map.get(k) || 0) + 1);
  }
  const keys = [...map.keys()].sort();
  console.log("--- 削除対象 draft の暦月内訳（この一覧に出た月＝その月の日付を持つドキュメントだけ消える）---");
  for (const k of keys) {
    const [y, mo] = k.split("-");
    const label =
      y && mo && /^\d{4}$/.test(y) && /^\d{2}$/.test(mo)
        ? `${parseInt(y, 10)}年${parseInt(mo, 10)}月`
        : k;
    console.log(`  ${label}（${k}）: ${map.get(k)} 件`);
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = initAdmin();

  console.log("=== draft シフト削除 ===");
  console.log(
    `条件: 各ドキュメントの「日付」が ${args.fromYmdMin} 以上${args.toYmdMax ? ` かつ ${args.toYmdMax} 以下` : "（終了日の上限なし）"} かつ status===draft のみ削除。提出済み・確定は削除しません。`
  );
  console.log(`※ ${args.fromYmdMin} より前の日付の下書きは消えません。`);
  if (args.uidOnly) console.log(`対象ユーザーに限定: ${args.uidOnly}`);
  console.log("");

  const docs = await fetchAllShiftDocs(db);
  const targets = [];

  for (const d of docs) {
    const data = d.data() || {};
    const status = String(data.status ?? "").trim();
    if (status !== "draft") continue;

    const uid = String(data.userId ?? "").trim();
    if (args.uidOnly) {
      const idMatches = d.id.startsWith(`${args.uidOnly}_`);
      const fieldMatches = uid === args.uidOnly;
      if (!idMatches && !fieldMatches) continue;
    }

    const dateStr = resolveShiftDate(d.id, data);
    if (!inRange(dateStr, args.fromYmdMin, args.toYmdMax)) continue;

    targets.push({
      ref: d.ref,
      id: d.id,
      dateStr,
      uid: uid || "(本文なし)",
      invalidCalendar: !isValidCalendarYmd(dateStr),
    });
  }

  const badCal = targets.filter((t) => t.invalidCalendar);
  console.log(`スキャン: shifts ${docs.length} 件 → 削除対象 draft ${targets.length} 件\n`);
  if (badCal.length > 0) {
    console.log(`⚠ 暦上存在しない日付（不整合ドキュメント）: ${badCal.length} 件`);
    badCal.forEach((t) => console.log(`    ${t.id}`));
    console.log("");
  }

  if (targets.length === 0) {
    console.log("対象なし。終了します。");
    return;
  }

  printBreakdownByCalendarMonth(targets);

  console.log("--- ドキュメント一覧（先頭25件）---");
  targets.slice(0, 25).forEach((t) => console.log(`  ${t.id}  date=${t.dateStr}  userId=${t.uid}`));
  if (targets.length > 25) console.log(`  … 他 ${targets.length - 25} 件`);

  if (args.dryRun) {
    console.log(
      "\n--dry-run のため削除していません。上の「暦月内訳」が想定どおりなら、同じ引数に --execute を付けて再実行してください。"
    );
    return;
  }

  for (let i = 0; i < targets.length; i += BATCH_DELETE) {
    const batch = db.batch();
    const chunk = targets.slice(i, i + BATCH_DELETE);
    chunk.forEach((t) => batch.delete(t.ref));
    await batch.commit();
    console.log(`  … deleted ${Math.min(i + chunk.length, targets.length)} / ${targets.length}`);
  }

  console.log("\n完了。スタッフ画面を再読み込みすると下書き表示が消えます。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
