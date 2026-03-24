/**
 * 管理シフト表と同じルールで「誰の行に何件載るか」を Firestore 上で検証する。
 *
 *   npm run diagnose-shift-grid -- 2026 2
 *
 * 環境変数: GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");

const SHIFTS = "shifts";
const USERS = "users";
const SHIFT_ARCHIVE_USERS = "shiftArchiveUsers";

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

function inCalendarMonth(docId, data, year, month) {
  const nd = normalizeDateForShift(data.date);
  if (nd) {
    const [yy, mm] = nd.split("-").map((x) => parseInt(x, 10));
    return yy === year && mm === month;
  }
  const m = String(docId).match(/_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month;
}

function displayNameFromArchiveUserKey(key) {
  if (!key.startsWith("name_")) return null;
  const b64url = key.slice("name_".length);
  if (!b64url) return null;
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function normalizePersonNameForMatch(name) {
  if (!name) return "";
  let s = String(name).normalize("NFKC").trim();
  s = s.replace(/\s+/g, "");
  s = s.replace(/（[^）]*）/g, "");
  s = s.replace(/\([^)]*\)/g, "");
  return s.toLowerCase();
}

function namesMatch(a, b) {
  const na = normalizePersonNameForMatch(a);
  const nb = normalizePersonNameForMatch(b);
  if (!na || !nb) return false;
  return na === nb;
}

function namesMatchRelaxed(a, b) {
  if (namesMatch(a, b)) return true;
  const na = normalizePersonNameForMatch(a);
  const nb = normalizePersonNameForMatch(b);
  if (!na || !nb) return false;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 2) return false;
  return longer.includes(shorter);
}

/** shiftDateNormalize と同じ（管理画面の adminShiftRowMatch と一致させる） */
function parseUserIdAndDateFromShiftDocId(docId) {
  const m1 = String(docId).match(/^(.+)_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m1) {
    const y = parseInt(m1[2], 10);
    const mo = parseInt(m1[3], 10);
    const d = parseInt(m1[4], 10);
    if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { userId: m1[1], date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
    }
  }
  const m2 = String(docId).match(/^(.+)_(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    const y = parseInt(m2[2], 10);
    const mo = parseInt(m2[3], 10);
    const d = parseInt(m2[4], 10);
    if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { userId: m2[1], date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
    }
  }
  return null;
}

function canonicalUserIdForShiftDoc(docId, rawUserId) {
  const parsed = parseUserIdAndDateFromShiftDocId(docId);
  const u = String(rawUserId ?? "").trim();
  if (!parsed) return u;
  if (!u || !String(docId).startsWith(`${u}_`)) return parsed.userId;
  return u;
}

function shiftDocIdProvesCanonicalUserOwnership(shift) {
  const sid = shift.id ?? "";
  const canonical = canonicalUserIdForShiftDoc(sid, shift.userId);
  const parsedUid = parseUserIdAndDateFromShiftDocId(sid)?.userId;
  return Boolean(parsedUid && parsedUid === canonical);
}

const SIMILAR_NAME_MIN_COMMON = 2;

function maxConsecutiveCommonSubstringLen(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/** アーカイブ側の氏名が、一覧のどれか1人とだけ「連続2文字以上」よく似ているときそのスタッフID */
function uniqueStaffIdBySimilarArchivedName(eff, staffList) {
  const ne = normalizePersonNameForMatch(eff);
  if (ne.length < SIMILAR_NAME_MIN_COMMON) return null;
  let best = 0;
  const scores = staffList.map((s) => ({
    id: s.id,
    score: maxConsecutiveCommonSubstringLen(ne, normalizePersonNameForMatch(s.name)),
  }));
  for (const x of scores) if (x.score > best) best = x.score;
  if (best < SIMILAR_NAME_MIN_COMMON) return null;
  const winners = scores.filter((x) => x.score === best);
  if (winners.length !== 1) return null;
  return winners[0].id;
}

function archivedNameMatchesStaffRow(eff, staffRowUserId, staffRowName, allStaffRows) {
  const nm = staffRowName.trim();
  if (!nm || !eff.trim()) return false;
  if (namesMatch(eff, nm) || namesMatchRelaxed(eff, nm)) return true;
  const only = uniqueStaffIdBySimilarArchivedName(eff, allStaffRows);
  return only === staffRowUserId;
}

function effectiveName(shift, orphanMap) {
  const raw = typeof shift.archivedUserName === "string" ? shift.archivedUserName.trim() : "";
  const fromDoc = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (fromDoc) return fromDoc;
  const fromMeta = (orphanMap[shift.userId] ?? "").trim();
  if (fromMeta) return fromMeta;
  return displayNameFromArchiveUserKey(shift.userId)?.trim() ?? "";
}

function shiftBelongsToStaffRow(shift, staffId, staffName, staffIdSet, orphanMap, staffIdToName, staffList) {
  const eff = effectiveName(shift, orphanMap);
  const ownerNm = (staffIdToName[shift.userId] ?? "").trim();
  const nm = staffName.trim();

  if (shift.userId === staffId) {
    if (shiftDocIdProvesCanonicalUserOwnership(shift)) return true;
    if (!eff) return true;
    if (!staffIdSet.has(shift.userId)) return true;
    if (ownerNm && !namesMatch(eff, ownerNm) && !namesMatchRelaxed(eff, ownerNm)) return false;
    return true;
  }

  if (staffIdSet.has(shift.userId)) {
    if (!eff) return false;
    if (!archivedNameMatchesStaffRow(eff, staffId, staffName, staffList)) return false;
    if (ownerNm && (namesMatch(eff, ownerNm) || namesMatchRelaxed(eff, ownerNm))) return false;
    return true;
  }

  if (!nm) return false;
  return archivedNameMatchesStaffRow(eff, staffId, staffName, staffList);
}

function shiftCountsTowardUserIdRow(shift, staffIdSet, orphanMap, staffIdToName) {
  if (!staffIdSet.has(shift.userId)) return true;
  if (shiftDocIdProvesCanonicalUserOwnership(shift)) return true;
  const eff = effectiveName(shift, orphanMap);
  if (!eff) return true;
  const ownerNm = (staffIdToName[shift.userId] ?? "").trim();
  if (!ownerNm) return true;
  return namesMatch(eff, ownerNm) || namesMatchRelaxed(eff, ownerNm);
}

async function fetchAllShifts(db) {
  const all = [];
  let last = null;
  const page = 500;
  for (;;) {
    let q = db.collection(SHIFTS).orderBy(FieldPath.documentId()).limit(page);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => all.push({ id: d.id, ...d.data() }));
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < page) break;
  }
  return all;
}

async function fetchStaff(db) {
  const snap = await db.collection(USERS).where("role", "==", "staff").get();
  const list = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({ id: d.id, name: data.name || "（名前なし）" });
  });
  return list;
}

async function fetchArchiveNames(db, uids) {
  const out = {};
  for (const uid of uids) {
    try {
      const d = await db.collection(SHIFT_ARCHIVE_USERS).doc(uid).get();
      if (!d.exists) continue;
      const n = String(d.data().archivedUserName ?? "").trim();
      if (n) out[uid] = n;
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function main() {
  const y = parseInt(process.argv[2], 10);
  const m = parseInt(process.argv[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    console.error("使い方: npm run diagnose-shift-grid -- <年> <月>   例: npm run diagnose-shift-grid -- 2026 2");
    process.exit(1);
  }

  const db = initAdmin();
  console.log(`=== 診断: ${y}年${m}月（shifts のみ・管理画面と同じ照合ロジック）===\n`);

  const [staffList, allShifts] = await Promise.all([fetchStaff(db), fetchAllShifts(db)]);
  const staffIdSet = new Set(staffList.map((s) => s.id));
  const staffIdToName = Object.fromEntries(staffList.map((s) => [s.id, s.name]));

  const monthShifts = allShifts.filter((s) => inCalendarMonth(s.id, s, y, m));
  const nonDraft = monthShifts.filter((s) => s.status !== "draft");

  console.log(`スタッフ（role=staff）: ${staffList.length} 名`);
  staffList.slice(0, 30).forEach((s) => console.log(`  ${s.id.slice(0, 8)}… ${s.name}`));
  if (staffList.length > 30) console.log(`  … 他 ${staffList.length - 30} 名`);

  console.log(`\n当月 shifts 全件: ${monthShifts.length}（draft 除く表示対象: ${nonDraft.length}）`);

  const orphanUids = [...new Set(nonDraft.map((s) => s.userId).filter((uid) => !staffIdSet.has(uid)))];
  let orphanMap = {};
  if (orphanUids.length) orphanMap = await fetchArchiveNames(db, orphanUids);
  nonDraft.forEach((s) => {
    if (staffIdSet.has(s.userId)) return;
    const an = typeof s.archivedUserName === "string" ? s.archivedUserName.trim() : "";
    if (an) orphanMap[s.userId] = orphanMap[s.userId] || an;
  });

  console.log(`\n一覧外 userId（当月・非draft）: ${orphanUids.length} 種類`);
  orphanUids.slice(0, 15).forEach((uid) => {
    const cnt = nonDraft.filter((s) => s.userId === uid).length;
    const sample = nonDraft.find((s) => s.userId === uid);
    const eff = effectiveName(sample, orphanMap);
    console.log(`  ${uid.slice(0, 12)}… count=${cnt} eff="${eff}"`);
  });

  const byUid = new Map();
  nonDraft.forEach((s) => {
    byUid.set(s.userId, (byUid.get(s.userId) || 0) + 1);
  });
  console.log(`\n当月 userId 別件数（上位15）:`);
  [...byUid.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([uid, c]) => {
      const onList = staffIdSet.has(uid) ? "一覧内" : "一覧外";
      console.log(`  ${c}件  ${onList}  ${uid.slice(0, 14)}…`);
    });

  console.log(`\n--- スタッフ行ごとの「紐づく」シフト件数（画面の行に載る想定）---`);
  let totalAttributed = 0;
  for (const st of staffList) {
    let n = 0;
    for (const sh of nonDraft) {
      if (shiftBelongsToStaffRow(sh, st.id, st.name, staffIdSet, orphanMap, staffIdToName, staffList)) n++;
    }
    totalAttributed += n;
    if (n > 0 || staffList.length <= 20) console.log(`  ${st.name}: ${n} 件`);
  }
  if (staffList.length > 20) {
    console.log(`  （0件の行は省略。件数>0のみ上に表示）`);
  }

  const unmatched = nonDraft.filter((sh) => {
    return !staffList.some((st) =>
      shiftBelongsToStaffRow(sh, st.id, st.name, staffIdSet, orphanMap, staffIdToName, staffList)
    );
  });

  console.log(`\n--- どのスタッフ行にも載らないシフト: ${unmatched.length} 件 ---`);
  unmatched.slice(0, 25).forEach((sh) => {
    console.log(
      `  id=${sh.id} userId=${String(sh.userId).slice(0, 20)}… status=${sh.status} eff="${effectiveName(sh, orphanMap)}"`
    );
  });

  const uidRowOnly = nonDraft.filter((sh) => shiftCountsTowardUserIdRow(sh, staffIdSet, orphanMap, staffIdToName));
  console.log(`\n--- UIDキー行に載るシフト（一覧外行用）: ${uidRowOnly.length} 件 ---`);

  console.log(
    "\n※ スタッフ行が 0 件の人は、当月の shifts にその UID のドキュメントが無い（または draft のみ）可能性が高いです。"
  );
  console.log("  照合ロジックではデータを増やせません。バックアップ・別月アーカイブ・手入力で復旧してください。");
  console.log("\n=== 診断終了 ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
