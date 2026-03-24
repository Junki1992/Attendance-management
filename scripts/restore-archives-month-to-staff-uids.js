/**
 * shiftArchives の指定月を、削除前の「旧UID」のままではなく
 * **いまのスタッフ一覧（role=staff）の UID** に載る形で shifts へ書き戻す。
 *
 * ユーザー削除で shifts から消えたが shiftArchives に残っている分を、
 * shiftArchiveUsers / 各ドキュメントの archivedUserName と現スタッフ名を照合して復旧する。
 *
 *   npm run restore-archives-to-staff -- --dry-run --year 2026 --month 2
 *   npm run restore-archives-to-staff -- --execute --year 2026 --month 2
 *
 * 旧UID直指定（名前で合わないとき）:
 *   export RESTORE_UID_MAP_JSON='{"旧FirebaseUID":"現スタッフUID",...}'
 *
 * 氏名→UID（是安遥など）:
 *   export RESTORE_NAME_MAP_JSON='{"是安遥":"現スタッフUID"}'
 *
 * GOOGLE_APPLICATION_CREDENTIALS_JSON または GOOGLE_APPLICATION_CREDENTIALS
 */

const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const { FieldPath } = require("firebase-admin/firestore");

const SHIFT_ARCHIVES = "shiftArchives";
const SHIFTS = "shifts";
const USERS = "users";
const SHIFT_ARCHIVE_USERS = "shiftArchiveUsers";
const BATCH_COMMIT = 400;

const ARCHIVE_ONLY_FIELDS = new Set(["archivedAt", "archivedFromShiftDocId", "archivedFromImport"]);

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

function normalizeYmd(y, mo, d) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function parseUserIdAndDateFromDocId(docId) {
  let m = String(docId).match(/^(.+)_(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const date = normalizeYmd(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
    if (date) return { userId: m[1], date };
  }
  m = String(docId).match(/^(.+)_(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const date = normalizeYmd(parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10));
    if (date) return { userId: m[1], date };
  }
  return null;
}

function normalizeDateForShift(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return normalizeYmd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }
  if (typeof raw.toDate === "function") {
    const d = raw.toDate();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return null;
}

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

function stripArchiveFields(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!ARCHIVE_ONLY_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function displayNameFromArchiveUserKey(key) {
  if (!String(key).startsWith("name_")) return null;
  const b64url = String(key).slice("name_".length);
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

function resolveStaffUidForEffectiveName(eff, staffList, manualNameMap) {
  const t = eff.trim();
  if (!t) return { uid: null, reason: "empty-name" };

  if (manualNameMap && typeof manualNameMap === "object") {
    if (manualNameMap[t]) return { uid: manualNameMap[t], reason: "manual-name" };
    const ne = normalizePersonNameForMatch(t);
    for (const [k, v] of Object.entries(manualNameMap)) {
      if (normalizePersonNameForMatch(k) === ne) return { uid: v, reason: "manual-name-norm" };
    }
  }

  const exact = staffList.filter((s) => namesMatch(t, s.name));
  if (exact.length === 1) return { uid: exact[0].id, reason: "exact" };
  if (exact.length > 1) return { uid: null, reason: "ambiguous-exact" };

  const relaxed = staffList.filter((s) => namesMatchRelaxed(t, s.name));
  if (relaxed.length === 1) return { uid: relaxed[0].id, reason: "relaxed" };
  if (relaxed.length > 1) return { uid: null, reason: "ambiguous-relaxed" };

  const sim = uniqueStaffIdBySimilarArchivedName(t, staffList);
  if (sim) return { uid: sim, reason: "similar" };

  return { uid: null, reason: "no-match" };
}

function effectiveArchiveName(oldUid, data, metaMap) {
  const raw = typeof data.archivedUserName === "string" ? data.archivedUserName.trim() : "";
  const fromDoc = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (fromDoc) return fromDoc;
  const fromMeta = (metaMap[oldUid] ?? "").trim();
  if (fromMeta) return fromMeta;
  return displayNameFromArchiveUserKey(oldUid)?.trim() ?? "";
}

function parseEnvJson(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
    return j;
  } catch {
    console.error(`${name} の JSON が壊れています`);
    process.exit(1);
  }
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

async function fetchStaff(db) {
  const snap = await db.collection(USERS).where("role", "==", "staff").get();
  const list = [];
  snap.forEach((d) => {
    const data = d.data();
    list.push({ id: d.id, name: data.name || "（名前なし）" });
  });
  return list;
}

async function fetchArchiveUserMetaMap(db, oldUids) {
  const map = {};
  const chunk = 30;
  for (let i = 0; i < oldUids.length; i += chunk) {
    const part = oldUids.slice(i, i + chunk);
    const snaps = await Promise.all(part.map((uid) => db.collection(SHIFT_ARCHIVE_USERS).doc(uid).get()));
    part.forEach((uid, j) => {
      const d = snaps[j];
      if (d.exists) {
        const n = String(d.data().archivedUserName ?? "").trim();
        if (n) map[uid] = n;
      }
    });
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  if (!dryRun && !execute) {
    console.error("使い方: --dry-run または --execute と --year --month が必要です");
    process.exit(1);
  }

  const yi = args.indexOf("--year");
  const mi = args.indexOf("--month");
  if (yi === -1 || mi === -1) {
    console.error("--year と --month は必須です（例: --year 2026 --month 2）");
    process.exit(1);
  }
  const year = parseInt(args[yi + 1], 10);
  const month = parseInt(args[mi + 1], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    console.error("年または月が不正です");
    process.exit(1);
  }

  const uidMapManual = parseEnvJson("RESTORE_UID_MAP_JSON") || {};
  const nameMapManual = parseEnvJson("RESTORE_NAME_MAP_JSON") || {};

  const db = initAdmin();
  console.log(`=== アーカイブ → 現スタッフUID で shifts 復旧: ${year}年${month}月 ===\n`);

  const [staffList, archiveDocs] = await Promise.all([fetchStaff(db), fetchAllArchiveDocs(db)]);

  const inMonth = archiveDocs.filter((d) => archiveDocInCalendarMonth(d.id, d.data(), year, month));
  const oldUids = [...new Set(inMonth.map((d) => parseUserIdAndDateFromDocId(d.id)?.userId).filter(Boolean))];
  const metaMap = await fetchArchiveUserMetaMap(db, oldUids);

  console.log(`スタッフ: ${staffList.length} 名`);
  staffList.forEach((s) => console.log(`  ${s.name}  ${s.id}`));
  console.log(`\n当月アーカイブ: ${inMonth.length} 件（全アーカイブ ${archiveDocs.length} 件中）\n`);

  const writes = [];
  const skipped = [];
  const collisions = [];

  for (const d of inMonth) {
    const parsed = parseUserIdAndDateFromDocId(d.id);
    if (!parsed) {
      skipped.push({ id: d.id, why: "docId-parse" });
      continue;
    }
    const oldUid = parsed.userId;
    const data = d.data() || {};
    const eff = effectiveArchiveName(oldUid, data, metaMap);

    let newUid = uidMapManual[oldUid] || null;
    let matchReason = newUid ? "manual-uid-map" : null;

    if (!newUid) {
      const r = resolveStaffUidForEffectiveName(eff, staffList, nameMapManual);
      newUid = r.uid;
      matchReason = r.reason;
    }

    if (!newUid) {
      skipped.push({ id: d.id, eff: eff || oldUid, why: matchReason || "no-target-uid" });
      continue;
    }

    const dateStr = normalizeDateForShift(data.date) || parsed.date;
    const targetId = `${newUid}_${dateStr}`;
    const base = stripArchiveFields(data);
    const payload = Object.fromEntries(
      Object.entries({ ...base, userId: newUid, date: dateStr }).filter(([, v]) => v !== undefined)
    );

    writes.push({ targetId, payload, archiveId: d.id, eff, newUid, oldUid });
  }

  const dedupByTarget = new Map();
  for (const w of writes) {
    if (!dedupByTarget.has(w.targetId)) dedupByTarget.set(w.targetId, w);
  }
  const writesUnique = [...dedupByTarget.values()];
  if (writesUnique.length < writes.length) {
    console.log(`（同一 targetId の重複 ${writes.length - writesUnique.length} 件を1件にまとめました）\n`);
  }

  const byStaff = new Map();
  for (const w of writesUnique) {
    byStaff.set(w.newUid, (byStaff.get(w.newUid) || 0) + 1);
  }

  console.log("--- 書き込み予定（現スタッフのドキュメントID）---");
  for (const [uid, n] of [...byStaff.entries()].sort((a, b) => b[1] - a[1])) {
    const nm = staffList.find((s) => s.id === uid)?.name || uid;
    console.log(`  ${nm}: ${n} 件`);
  }

  if (skipped.length) {
    const byWhy = {};
    for (const s of skipped) {
      const k = `${s.eff || ""}:${s.why}`;
      byWhy[k] = (byWhy[k] || 0) + 1;
    }
    console.log("\n--- スキップ（アーカイブにあっても照合できず）---");
    Object.entries(byWhy)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, c]) => console.log(`  ${c} 件  ${k}`));
  }

  const targetIds = [...new Set(writesUnique.map((w) => w.targetId))];
  const existsMap = new Map();
  const chunkSize = 40;
  for (let i = 0; i < targetIds.length; i += chunkSize) {
    const chunk = targetIds.slice(i, i + chunkSize);
    const snaps = await Promise.all(chunk.map((id) => db.collection(SHIFTS).doc(id).get()));
    chunk.forEach((id, j) => existsMap.set(id, snaps[j]));
  }

  const toCommit = [];
  for (const w of writesUnique) {
    const ex = existsMap.get(w.targetId);
    if (ex && ex.exists) {
      const u = String(ex.data().userId ?? "").trim();
      if (u === w.newUid) {
        toCommit.push({ ...w, action: "skip-exists" });
      } else {
        collisions.push({ targetId: w.targetId, want: w.newUid, have: u, archiveId: w.archiveId });
        toCommit.push({ ...w, action: "skip-collision" });
      }
    } else {
      toCommit.push({ ...w, action: "set" });
    }
  }

  const willSet = toCommit.filter((x) => x.action === "set");
  const willSkip = toCommit.filter((x) => x.action === "skip-exists").length;
  const willColl = toCommit.filter((x) => x.action === "skip-collision").length;

  console.log(`\n新規 set: ${willSet.length} / 既に同UIDで存在してスキップ: ${willSkip} / ID衝突でスキップ: ${willColl}`);

  if (collisions.length) {
    console.log("\n!!! 衝突（手動確認）!!!");
    collisions.slice(0, 15).forEach((c) => console.log(`  ${c.targetId} archive=${c.archiveId}`));
  }

  if (dryRun) {
    willSet.slice(0, 12).forEach((w) => {
      const nm = staffList.find((s) => s.id === w.newUid)?.name || w.newUid;
      console.log(`  [set] ${w.archiveId} => ${w.targetId} (${nm} / ${w.eff})`);
    });
    if (willSet.length > 12) console.log(`  … 他 ${willSet.length - 12} 件`);
    console.log("\n本番: RESTORE_UID_MAP_JSON / RESTORE_NAME_MAP_JSON が要なら設定のうえ");
    console.log("  npm run restore-archives-to-staff -- --execute --year " + year + " --month " + month);
    return;
  }

  for (let i = 0; i < willSet.length; i += BATCH_COMMIT) {
    const batch = db.batch();
    const chunk = willSet.slice(i, i + BATCH_COMMIT);
    for (const w of chunk) {
      batch.set(db.collection(SHIFTS).doc(w.targetId), w.payload);
    }
    await batch.commit();
    console.log(`  … wrote ${Math.min(i + chunk.length, willSet.length)} / ${willSet.length}`);
  }

  console.log("\n完了。npm run diagnose-shift-grid -- " + year + " " + month + " で確認してください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
