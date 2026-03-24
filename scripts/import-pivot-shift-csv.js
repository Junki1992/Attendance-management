/**
 * Googleスプレッドシートの「日付×氏名」マトリクスCSVから、指定スタッフ列のシフトを
 * Firestore `shifts` に書き込む（復旧用）。
 *
 * 手順:
 *   1. スプレッドシートで該当シートを表示 → ファイル → ダウンロード → カンマ区切り形式 (.csv)
 *   2. UTF-8 で保存（Excel なら「CSV UTF-8」推奨）
 *
 *   npm run import-pivot-shift-csv -- --dry-run --file ./202602.csv --year 2026 --month 2 --staff 文野
 *   npm run import-pivot-shift-csv -- --execute --file ./202602.csv --year 2026 --month 2 --staff 文野
 *
 * --staff … users の name に部分一致（role=staff）。1人に決まらなければ終了。
 * --column-index N … 0始まり列番号で列を直接指定（ヘッダー行の列。A=0 は日付列）
 *
 * セル例: 10-19（在宅/休憩1h） / 10-18（出社/休憩1h） / 10-19（在宅/休憩1h）→休み → 当日は OFF 扱い
 *        10-19（在宅/休憩1h）→10-12 → 10:00–12:00（→以降の時刻が優先）
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const USERS = "users";
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

function stripBom(s) {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

/** 最小限の RFC4180 風 CSV パース */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let i = 0;
  let inQ = false;
  const t = stripBom(String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  while (i < t.length) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function normalizePersonKey(name) {
  let s = String(name).normalize("NFKC").trim();
  s = s.replace(/\s+/g, "");
  s = s.replace(/（[^）]*）/g, "");
  s = s.replace(/\([^)]*\)/g, "");
  s = s.replace(/★/g, "");
  return s.toLowerCase();
}

function cleanHeaderTitle(h) {
  return String(h)
    .replace(/★/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

function padHour(n) {
  return String(Math.min(23, Math.max(0, n))).padStart(2, "0");
}
function padMin(n) {
  return String(Math.min(59, Math.max(0, n))).padStart(2, "0");
}

/** セル文字列 → { startTime, endTime, workType } | { off: true } | null */
function parseShiftCell(raw) {
  const cell = String(raw ?? "").trim();
  if (!cell) return null;
  if (/変更OK|⇒\s*3\//u.test(cell)) return null;

  if (/→\s*休み/u.test(cell)) {
    return { off: true };
  }
  if (/^\s*休み\s*$/u.test(cell)) {
    return { off: true };
  }

  let workType = "office";
  if (/当欠|欠勤/u.test(cell)) workType = "absence";
  else if (/在宅|リモート/u.test(cell)) workType = "remote";

  const arrowEnd = cell.match(/→\s*(\d{1,2})(?::(\d{2}))?[-–〜](\d{1,2})(?::(\d{2}))?/u);
  const firstRange = cell.match(/(\d{1,2})(?::(\d{2}))?[-–〜](\d{1,2})(?::(\d{2}))?/u);
  if (!firstRange) return null;

  let sh = parseInt(firstRange[1], 10);
  let sm = firstRange[2] ? parseInt(firstRange[2], 10) : 0;
  let eh = parseInt(firstRange[3], 10);
  let em = firstRange[4] ? parseInt(firstRange[4], 10) : 0;

  if (arrowEnd) {
    sh = parseInt(arrowEnd[1], 10);
    sm = arrowEnd[2] ? parseInt(arrowEnd[2], 10) : 0;
    eh = parseInt(arrowEnd[3], 10);
    em = arrowEnd[4] ? parseInt(arrowEnd[4], 10) : 0;
  }

  const startTime = `${padHour(sh)}:${padMin(sm)}`;
  const endTime = `${padHour(eh)}:${padMin(em)}`;
  return { startTime, endTime, workType };
}

/** 先頭列「2/2(月)」など → { month, day } */
function parseDateCell(s, year, expectMonth) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const d = parseInt(m[2], 10);
  if (expectMonth != null && mo !== expectMonth) {
    return { month: mo, day: d, year };
  }
  return { month: mo, day: d, year };
}

async function fetchStaff(db) {
  const snap = await db.collection(USERS).where("role", "==", "staff").get();
  const list = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({ id: d.id, name: data.name || "" });
  });
  return list;
}

function findStaffColumnIndex(headers, staffSubstr) {
  const key = normalizePersonKey(staffSubstr);
  for (let c = 1; c < headers.length; c++) {
    const title = cleanHeaderTitle(headers[c] || "");
    if (!title) continue;
    const nk = normalizePersonKey(title);
    if (nk.includes(key) || key.includes(nk)) return c;
    if (title.includes(staffSubstr)) return c;
  }
  return -1;
}

function resolveStaffUid(staffList, staffSubstr) {
  const key = normalizePersonKey(staffSubstr);
  const hits = staffList.filter((s) => normalizePersonKey(s.name).includes(key) || s.name.includes(staffSubstr));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    console.error(`スタッフが見つかりません（--staff "${staffSubstr}"）。登録名を確認してください。`);
    process.exit(1);
  }
  console.error("複数ヒット（--staff を具体名に）:");
  hits.forEach((h) => console.error(`  ${h.name}  ${h.id}`));
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  const fi = args.indexOf("--file");
  if (fi < 0 || !args[fi + 1]) {
    console.error("--file ./sheet.csv を指定してください");
    process.exit(1);
  }
  const filePath = args[fi + 1];
  if (!fs.existsSync(path.resolve(filePath))) {
    console.error("ファイルがありません:", filePath);
    process.exit(1);
  }

  const yi = args.indexOf("--year");
  const mi = args.indexOf("--month");
  const staffI = args.indexOf("--staff");
  const colI = args.indexOf("--column-index");
  if (yi < 0 || mi < 0) {
    console.error("--year 2026 --month 2 を指定してください");
    process.exit(1);
  }
  const year = parseInt(args[yi + 1], 10);
  const month = parseInt(args[mi + 1], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    console.error("年または月が不正です");
    process.exit(1);
  }

  if (!dryRun && !execute) {
    console.error("--dry-run または --execute");
    process.exit(1);
  }

  const csvText = fs.readFileSync(path.resolve(filePath), "utf8");
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    console.error("CSV の行が足りません");
    process.exit(1);
  }

  const headers = rows[0].map((c) => String(c).trim());
  let colIdx;
  if (colI >= 0 && args[colI + 1] != null) {
    colIdx = parseInt(args[colI + 1], 10);
    if (!Number.isFinite(colIdx) || colIdx < 1) {
      console.error("--column-index は 1 以上（A列=日付が0、氏名は1から）");
      process.exit(1);
    }
  } else {
    if (staffI < 0 || !args[staffI + 1]) {
      console.error("--staff 文野 のように氏名の一部を指定するか、--column-index を指定してください");
      process.exit(1);
    }
    const staffSubstr = args[staffI + 1];
    colIdx = findStaffColumnIndex(headers, staffSubstr);
    if (colIdx < 0) {
      console.error("ヘッダーから列が特定できません。1行目:", headers.slice(0, 12).join(" | "));
      process.exit(1);
    }
    console.log(`列特定: [${colIdx}] ${headers[colIdx]}`);
  }

  const db = dryRun ? null : initAdmin();
  const staffList = dryRun ? [] : await fetchStaff(db);
  let targetUid;
  let targetName = args[staffI + 1] ? String(args[staffI + 1]) : `(列 ${colIdx})`;
  if (!dryRun) {
    if (staffI >= 0 && args[staffI + 1]) {
      const u = resolveStaffUid(staffList, args[staffI + 1]);
      targetUid = u.id;
      targetName = u.name;
    } else {
      console.error("--execute 時は --staff で Firebase ユーザーを特定できる必要があります");
      process.exit(1);
    }
  }

  const writes = [];
  const skipped = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const dateCell = String(row[0] ?? "").trim();
    const parsed = parseDateCell(dateCell, year, month);
    if (!parsed) {
      skipped.push({ row: r + 1, why: "date-parse", cell: dateCell });
      continue;
    }
    if (parsed.month !== month) {
      skipped.push({ row: r + 1, why: "other-month", cell: dateCell });
      continue;
    }
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;

    const cell = String(row[colIdx] ?? "").trim();
    const parsedShift = parseShiftCell(cell);
    if (parsedShift == null) {
      continue;
    }

    if (parsedShift.off) {
      writes.push({ dateStr, off: true, note: "OFF", sourceCell: cell });
      continue;
    }

    const { startTime, endTime, workType } = parsedShift;
    writes.push({
      dateStr,
      off: false,
      startTime,
      endTime,
      workType,
      note: `${startTime}-${endTime}`,
      sourceCell: cell,
    });
  }

  console.log(`\n対象: ${targetName}${dryRun ? "（dry-run・Firestore は未接続）" : `  uid=${targetUid}`}`);
  console.log(`書き込み予定: ${writes.length} 日分（空セルはスキップ）`);
  writes.slice(0, 20).forEach((w) => console.log(`  ${w.dateStr}  ${w.note}  | ${w.sourceCell}`));
  if (writes.length > 20) console.log(`  … 他 ${writes.length - 20} 件`);
  if (skipped.length) console.log(`\n日付行スキップ: ${skipped.length}（先頭3件）`, skipped.slice(0, 3));

  if (dryRun) {
    console.log("\n問題なければ --execute と --staff を付けて再実行（--staff は Firestore の登録名に合わせる）");
    return;
  }

  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    const chunk = writes.slice(i, i + BATCH);
    for (const w of chunk) {
      const docId = `${targetUid}_${w.dateStr}`;
      let payload;
      if (w.off) {
        payload = {
          userId: targetUid,
          date: w.dateStr,
          startTime: "00:00",
          endTime: "00:00",
          status: "confirmed",
          workType: "office",
          isRemote: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          wasUnconfirmed: false,
        };
      } else {
        const isRemote = w.workType === "remote";
        payload = {
          userId: targetUid,
          date: w.dateStr,
          startTime: w.startTime,
          endTime: w.endTime,
          status: "confirmed",
          workType: w.workType,
          isRemote,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          wasUnconfirmed: false,
        };
      }
      batch.set(db.collection(SHIFTS).doc(docId), payload, { merge: true });
    }
    await batch.commit();
    console.log(`  … wrote ${Math.min(i + chunk.length, writes.length)} / ${writes.length}`);
  }
  console.log("\n完了。管理画面の 2026年2月 を再読み込みして確認してください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
