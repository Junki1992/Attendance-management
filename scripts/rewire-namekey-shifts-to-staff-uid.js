/**
 * shifts の userId / ドキュメントID が `name_*`（アーカイブ用キー）のまま残っているドキュメントを、
 * 現役スタッフの Firebase UID に付け替える（復旧用）。
 *
 * - ドキュメントIDは `${userId}_${YYYY-MM-DD}` 前提。新IDで作り直し、旧ドキュメントは削除する。
 * - 紐づけ: archivedUserName → 厳密一致 → 緩い一致（短い方が長い方に含まれる）→ 連続2文字類似で一意なら採用
 * - 自動で決まらない人は --map-file で明示指定
 *
 * 事前確認:
 *   npm run rewire-namekey-shifts -- --dry-run
 *   npm run rewire-namekey-shifts -- --dry-run --year 2026 --month 2
 * 本番:
 *   npm run rewire-namekey-shifts -- --execute
 *   npm run rewire-namekey-shifts -- --execute --year 2026 --month 2
 *
 * 手動マップ（JSON）例 map.json:
 *   {"是安遥":"FirebaseのUID","金澤優也":"別のUID"}
 *   npm run rewire-namekey-shifts -- --execute --map-file ./map.json
 *
 * ファイルなし（急ぎ）— 次のいずれか:
 *   export REWIRE_MAP_JSON='{"是安遥":"UID","金澤優也":"UID"}'
 *   npm run rewire-namekey-shifts -- --execute --year 2026 --month 2
 *
 *   npm run rewire-namekey-shifts -- --execute --year 2026 --month 2 --map-json '{"是安遥":"UID"}'
 * （--map-file / REWIRE_MAP_JSON / --map-json はマージされ、後勝ち）
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
const BATCH_OPS = 400; // delete+set で2倍を見越す

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

function resolveStaffUidForEffectiveName(eff, staffList, manualMap) {
  const t = eff.trim();
  if (!t) return { uid: null, reason: "empty-name" };

  if (manualMap && typeof manualMap === "object") {
    if (manualMap[t]) return { uid: manualMap[t], reason: "manual-exact" };
    const ne = normalizePersonNameForMatch(t);
    for (const [k, v] of Object.entries(manualMap)) {
      if (normalizePersonNameForMatch(k) === ne) return { uid: v, reason: "manual-normalized" };
    }
  }

  const exact = staffList.filter((s) => namesMatch(t, s.name));
  if (exact.length === 1) return { uid: exact[0].id, reason: "exact" };
  if (exact.length > 1) return { uid: null, reason: "ambiguous-exact" };

  const relaxed = staffList.filter((s) => namesMatchRelaxed(t, s.name));
  if (relaxed.length === 1) return { uid: relaxed[0].id, reason: "relaxed" };
  if (relaxed.length > 1) return { uid: null, reason: "ambiguous-relaxed" };

  const sim = uniqueStaffIdBySimilarArchivedName(t, staffList);
  if (sim) return { uid: sim, reason: "similar-2char-unique" };

  return { uid: null, reason: "no-match" };
}

function effectiveNameFromDoc(docIdKey, data, orphanMap) {
  const raw = typeof data.archivedUserName === "string" ? data.archivedUserName.trim() : "";
  const fromDoc = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (fromDoc) return fromDoc;
  const uidInBody = String(data.userId ?? "").trim();
  const key = docIdKey || uidInBody;
  const fromMeta = (orphanMap[key] ?? "").trim();
  if (fromMeta) return fromMeta;
  return displayNameFromArchiveUserKey(key)?.trim() ?? "";
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

function parseYearMonthArgs(args) {
  const yi = args.indexOf("--year");
  const mi = args.indexOf("--month");
  if (yi === -1 && mi === -1) return null;
  if (yi === -1 || mi === -1) {
    console.error("--year と --month はセットで指定してください");
    process.exit(1);
  }
  const y = parseInt(args[yi + 1], 10);
  const m = parseInt(args[mi + 1], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) process.exit(1);
  return { year: y, month: m };
}

function parseMapFileArg(args) {
  const i = args.indexOf("--map-file");
  if (i === -1) return null;
  const p = args[i + 1];
  if (!p) {
    console.error("--map-file の後に JSON ファイルパスを指定してください");
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) {
    console.error("map file が見つかりません:", abs);
    process.exit(1);
  }
  const j = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (typeof j !== "object" || j === null) {
    console.error("map file はオブジェクト JSON である必要があります");
    process.exit(1);
  }
  return j;
}

function parseMapJsonArg(args) {
  const i = args.indexOf("--map-json");
  if (i === -1) return null;
  const raw = args[i + 1];
  if (!raw) {
    console.error('--map-json の直後に JSON オブジェクトを1つ書いてください（例: \'{"是安遥":"uid"}\'）');
    process.exit(1);
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    console.error("--map-json の JSON が壊れています:", e.message);
    process.exit(1);
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) {
    console.error("--map-json はオブジェクト JSON である必要があります");
    process.exit(1);
  }
  return j;
}

function parseMapFromEnv() {
  const raw = process.env.REWIRE_MAP_JSON?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (typeof j !== "object" || j === null || Array.isArray(j)) {
      console.error("REWIRE_MAP_JSON はオブジェクト JSON である必要があります");
      process.exit(1);
    }
    return j;
  } catch (e) {
    console.error("REWIRE_MAP_JSON の JSON が壊れています:", e.message);
    process.exit(1);
  }
}

/** --map-file → --map-json → REWIRE_MAP_JSON の順でマージ（後勝ち） */
function buildManualMap(args) {
  const fromFile = parseMapFileArg(args);
  const fromJson = parseMapJsonArg(args);
  const fromEnv = parseMapFromEnv();
  const merged = { ...fromFile, ...fromJson, ...fromEnv };
  return Object.keys(merged).length ? merged : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  if (!dryRun && !execute) {
    console.error("使い方: --dry-run または --execute を付けてください");
    process.exit(1);
  }
  const ym = parseYearMonthArgs(args);
  const manualMap = buildManualMap(args);

  const db = initAdmin();
  const [staffList, docs] = await Promise.all([fetchStaff(db), fetchAllShiftDocs(db)]);

  const nameKeyDocs = [];
  for (const d of docs) {
    const parsed = parseUserIdAndDateFromDocId(d.id);
    if (!parsed || !parsed.userId.startsWith("name_")) continue;
    if (ym && !inCalendarMonth(d.id, d.data(), ym.year, ym.month)) continue;
    nameKeyDocs.push({ snap: d, parsed });
  }

  const orphanUids = [...new Set(nameKeyDocs.map(({ parsed }) => parsed.userId))];
  let orphanMap = {};
  if (orphanUids.length) orphanMap = await fetchArchiveNames(db, orphanUids);

  console.log(`スタッフ: ${staffList.length} 名。name_* ドキュメント候補: ${nameKeyDocs.length} 件`);
  if (ym) console.log(`月フィルタ: ${ym.year}年${ym.month}月`);
  if (manualMap) console.log("手動マップ: 有効（--map-file / --map-json / REWIRE_MAP_JSON）");

  console.log("\n（--map-file 用）スタッフ UID 一覧:");
  staffList.forEach((s) => console.log(`  "${s.name}": "${s.id}",`));

  const plan = [];
  const skipReasons = {};

  for (const { snap, parsed } of nameKeyDocs) {
    const data = snap.data() || {};
    const eff = effectiveNameFromDoc(parsed.userId, data, orphanMap);
    const { uid, reason } = resolveStaffUidForEffectiveName(eff, staffList, manualMap);

    if (!uid) {
      skipReasons[`${eff || parsed.userId}:${reason}`] = (skipReasons[`${eff || parsed.userId}:${reason}`] || 0) + 1;
      continue;
    }

    const dateStr = normalizeDateForShift(data.date) || parsed.date;
    const newId = `${uid}_${dateStr}`;
    plan.push({ oldRef: snap.ref, oldId: snap.id, newId, targetUid: uid, eff, reason, data, dateStr });
  }

  console.log("\n--- 付け替え予定 ---");
  const byTarget = new Map();
  for (const p of plan) {
    byTarget.set(p.targetUid, (byTarget.get(p.targetUid) || 0) + 1);
  }
  for (const [uid, n] of byTarget) {
    const name = staffList.find((s) => s.id === uid)?.name || uid;
    console.log(`  → ${name}: ${n} 件`);
  }

  if (Object.keys(skipReasons).length) {
    console.log("\n--- スキップ（要 map-file またはスタッフ追加）---");
    for (const [k, c] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c} 件  ${k}`);
    }
  }

  const collisions = [];
  const toRun = [];

  const needExistence = plan.filter((p) => p.newId !== p.oldId);
  const existenceSnaps = [];
  const chunkSize = 40;
  for (let i = 0; i < needExistence.length; i += chunkSize) {
    const chunk = needExistence.slice(i, i + chunkSize);
    const snaps = await Promise.all(chunk.map((p) => db.collection(SHIFTS).doc(p.newId).get()));
    existenceSnaps.push(...snaps);
  }
  const existByNewId = new Map();
  needExistence.forEach((p, i) => existByNewId.set(p.newId, existenceSnaps[i]));

  for (const p of plan) {
    if (p.newId === p.oldId) {
      const bodyUid = String(p.data.userId ?? "").trim();
      if (bodyUid !== p.targetUid) {
        toRun.push({ type: "update-only", ref: p.oldRef, userId: p.targetUid, oldId: p.oldId });
      }
      continue;
    }

    const existing = existByNewId.get(p.newId);
    if (existing && existing.exists) {
      const ex = existing.data() || {};
      const exUid = String(ex.userId ?? "").trim();
      if (exUid === p.targetUid) {
        toRun.push({ type: "delete-dup", ref: p.oldRef, oldId: p.oldId, note: "既に正しいIDのドキュメントあり、重複のみ削除" });
      } else {
        collisions.push({ newId: p.newId, oldId: p.oldId, eff: p.eff, existingUid: exUid });
      }
      continue;
    }

    const raw = { ...p.data, userId: p.targetUid, date: p.dateStr };
    const payload = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    toRun.push({
      type: "move",
      oldRef: p.oldRef,
      newRef: db.collection(SHIFTS).doc(p.newId),
      payload,
      oldId: p.oldId,
      newId: p.newId,
    });
  }

  if (collisions.length) {
    console.log("\n!!! 新ドキュメントIDが既に別ユーザーで使用中（手動で解消してください）!!!");
    collisions.slice(0, 20).forEach((c) => {
      console.log(`  want ${c.newId} for "${c.eff}" but exists uid=${c.existingUid.slice(0, 12)}…`);
    });
  }

  console.log(`\n実行オペレーション: ${toRun.length}（move/update/delete-dup）`);
  if (dryRun) {
    toRun.slice(0, 15).forEach((op) => {
      if (op.type === "move") console.log(`  [move] ${op.oldId} => ${op.newId}`);
      if (op.type === "update-only") console.log(`  [update userId] ${op.oldId}`);
      if (op.type === "delete-dup") console.log(`  [delete dup] ${op.oldId}`);
    });
    if (toRun.length > 15) console.log(`  … 他 ${toRun.length - 15} 件`);
    console.log("\n本番: npm run rewire-namekey-shifts -- --execute [--year Y --month M] [--map-file ./x.json]");
    return;
  }

  for (let i = 0; i < toRun.length; i += Math.floor(BATCH_OPS / 2)) {
    const batch = db.batch();
    const chunk = toRun.slice(i, i + Math.floor(BATCH_OPS / 2));
    for (const op of chunk) {
      if (op.type === "update-only") {
        batch.update(op.ref, { userId: op.userId });
      } else if (op.type === "delete-dup") {
        batch.delete(op.ref);
      } else if (op.type === "move") {
        batch.set(op.newRef, op.payload);
        batch.delete(op.oldRef);
      }
    }
    if (chunk.length) await batch.commit();
    console.log(`  … committed ${Math.min(i + chunk.length, toRun.length)} / ${toRun.length}`);
  }

  console.log("\n完了。npm run diagnose-shift-grid -- <年> <月> で件数を確認してください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
