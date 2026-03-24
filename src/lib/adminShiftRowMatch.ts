/**
 * 管理シフト表: 退職・再登録などで userId が変わっても、
 * アーカイブ時の氏名と現行スタッフ名が一致すれば同一人物の行として表示する。
 */
import type { Shift } from "@/services/shiftService";
import { displayNameFromArchiveUserKey } from "@/lib/archiveUserKey";
import {
    canonicalUserIdForShiftDoc,
    parseUserIdAndDateFromShiftDocId,
    resolveShiftDateString,
    shiftModelInCalendarMonth,
} from "@/lib/shiftDateNormalize";

/** 標準 docId（`{uid}_{YYYY-MM-DD}`）なら本文の氏名より ID 上の所有者を優先（復元で archivedUserName だけ古い表記のとき表から消えるのを防ぐ） */
function shiftDocIdProvesCanonicalUserOwnership(s: Shift): boolean {
    const sid = s.id ?? "";
    const canonical = canonicalUserIdForShiftDoc(sid, s.userId);
    const parsedUid = parseUserIdAndDateFromShiftDocId(sid)?.userId;
    return Boolean(parsedUid && parsedUid === canonical);
}

/** 旧UID・name_* キー・archivedUserName から、スタッフ行との名前照合用の文字列を得る */
function effectiveNameForOrphanShift(s: Shift, orphanUidToArchivedName: Record<string, string>): string {
    const raw = typeof s.archivedUserName === "string" ? s.archivedUserName.trim() : "";
    const fromDoc = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (fromDoc) return fromDoc;
    const fromMeta = (orphanUidToArchivedName[s.userId] ?? "").trim();
    if (fromMeta) return fromMeta;
    return displayNameFromArchiveUserKey(s.userId)?.trim() ?? "";
}

function resolvedDateForShift(s: Shift): string {
    const id = s.id ?? "";
    const uid = canonicalUserIdForShiftDoc(id, s.userId);
    return resolveShiftDateString(s.date, id, uid);
}

/** 「山田 太郎」と「山田太郎」、全角半角の差を吸収して比較する */
export function normalizePersonNameForMatch(name: string): string {
    if (!name) return "";
    let s = name.normalize("NFKC").trim();
    s = s.replace(/\s+/g, "");
    s = s.replace(/（[^）]*）/g, "");
    s = s.replace(/\([^)]*\)/g, "");
    return s.toLowerCase();
}

function namesMatchForStaffRow(a: string, b: string): boolean {
    const na = normalizePersonNameForMatch(a);
    const nb = normalizePersonNameForMatch(b);
    if (!na || !nb) return false;
    return na === nb;
}

/** 厳密一致に加え、正規化後に短い方が長い方に含まれるなら同一人物とみなす（姓のみ・スペース差など） */
export function namesMatchRelaxedForStaffRow(a: string, b: string): boolean {
    if (namesMatchForStaffRow(a, b)) return true;
    const na = normalizePersonNameForMatch(a);
    const nb = normalizePersonNameForMatch(b);
    if (!na || !nb) return false;
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    if (shorter.length < 2) return false;
    return longer.includes(shorter);
}

/** 正規化後の文字列同士で、連続して一致する部分の最大長（「是安遥」と「屋安遥」→「安遥」で2） */
function maxConsecutiveCommonSubstringLen(a: string, b: string): number {
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

const SIMILAR_NAME_MIN_COMMON = 2;

/**
 * アーカイブ側の氏名が、一覧のどれか1人とだけ「連続2文字以上」よく似ているときそのスタッフID。
 * 同点が複数いれば null（取り違え防止）。
 */
export function uniqueStaffIdBySimilarArchivedName(
    eff: string,
    staffList: readonly { id: string; name: string }[]
): string | null {
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
    return winners[0]!.id;
}

function archivedNameMatchesStaffRow(
    eff: string,
    staffRowUserId: string,
    staffRowName: string,
    allStaffRows: readonly { id: string; name: string }[]
): boolean {
    const nm = staffRowName.trim();
    if (!nm || !eff.trim()) return false;
    if (namesMatchForStaffRow(eff, nm) || namesMatchRelaxedForStaffRow(eff, nm)) return true;
    const only = uniqueStaffIdBySimilarArchivedName(eff, allStaffRows);
    return only === staffRowUserId;
}

/**
 * 地図キー `${userId}-${day}` に載せるか。本文 userId が一覧スタッフだが archived 氏名が別人のときは
 * 誤った行に時間が出ないよう false（削除済みUID行は常に true）。
 */
export function shiftCountsTowardUserIdRow(
    s: Shift,
    staffIdSet: Set<string>,
    orphanUidToArchivedName: Record<string, string>,
    staffIdToName: Record<string, string>
): boolean {
    if (!staffIdSet.has(s.userId)) return true;
    if (shiftDocIdProvesCanonicalUserOwnership(s)) return true;
    const eff = effectiveNameForOrphanShift(s, orphanUidToArchivedName);
    if (!eff) return true;
    const ownerNm = (staffIdToName[s.userId] ?? "").trim();
    if (!ownerNm) return true;
    return namesMatchForStaffRow(eff, ownerNm) || namesMatchRelaxedForStaffRow(eff, ownerNm);
}

/**
 * ドキュメントの userId が「別の一覧スタッフのUID」に誤って付いていても、
 * archivedUserName / name_* デコードがこの行の氏名と一致すれば表示する。
 * （復元データ・取り込みずれで本文 userId と氏名が食い違うケース）
 */
export function shiftBelongsToStaffRow(
    s: Shift,
    staffRowUserId: string,
    staffRowName: string,
    staffIdSet: Set<string>,
    orphanUidToArchivedName: Record<string, string>,
    staffIdToName: Record<string, string>,
    allStaffRows: readonly { id: string; name: string }[]
): boolean {
    const eff = effectiveNameForOrphanShift(s, orphanUidToArchivedName);
    const ownerNm = (staffIdToName[s.userId] ?? "").trim();
    const nm = staffRowName.trim();

    if (s.userId === staffRowUserId) {
        if (shiftDocIdProvesCanonicalUserOwnership(s)) return true;
        if (!eff) return true;
        if (!staffIdSet.has(s.userId)) return true;
        if (
            ownerNm &&
            !namesMatchForStaffRow(eff, ownerNm) &&
            !namesMatchRelaxedForStaffRow(eff, ownerNm)
        )
            return false;
        return true;
    }

    if (staffIdSet.has(s.userId)) {
        if (!eff) return false;
        if (!archivedNameMatchesStaffRow(eff, staffRowUserId, staffRowName, allStaffRows)) return false;
        if (
            ownerNm &&
            (namesMatchForStaffRow(eff, ownerNm) || namesMatchRelaxedForStaffRow(eff, ownerNm))
        )
            return false;
        return true;
    }

    if (!nm) return false;
    return archivedNameMatchesStaffRow(eff, staffRowUserId, staffRowName, allStaffRows);
}

export function findShiftForStaffCell(
    shifts: Shift[],
    staffRowUserId: string,
    staffRowName: string,
    dateStrPadded: string,
    staffIdSet: Set<string>,
    orphanUidToArchivedName: Record<string, string>,
    staffIdToName: Record<string, string>,
    allStaffRows: readonly { id: string; name: string }[]
): Shift | undefined {
    return shifts.find((s) => {
        if (s.status === "draft") return false;
        const d = resolvedDateForShift(s);
        if (d !== dateStrPadded) return false;
        return shiftBelongsToStaffRow(
            s,
            staffRowUserId,
            staffRowName,
            staffIdSet,
            orphanUidToArchivedName,
            staffIdToName,
            allStaffRows
        );
    });
}

/** 表の1セル用。一覧外ID行は userId がスタッフ一覧に無いのでそのまま doc の userId で照合 */
export function findShiftForGridCell(
    user: { id: string; name: string },
    dateStrPadded: string,
    shifts: Shift[],
    staffIdSet: Set<string>,
    orphanUidToArchivedName: Record<string, string>,
    staffIdToName: Record<string, string>,
    allStaffRows: readonly { id: string; name: string }[]
): Shift | undefined {
    if (staffIdSet.has(user.id)) {
        return findShiftForStaffCell(
            shifts,
            user.id,
            user.name,
            dateStrPadded,
            staffIdSet,
            orphanUidToArchivedName,
            staffIdToName,
            allStaffRows
        );
    }
    return shifts.find((s) => {
        if (s.status === "draft") return false;
        const d = resolvedDateForShift(s);
        return s.userId === user.id && d === dateStrPadded;
    });
}

/** Firestore 上のシフト所有者 UID（確定・却下・取り消しで複数回呼ぶ） */
export function collectFirestoreOwnerIdsForStaffRow(
    shifts: Shift[],
    staffRowUserId: string,
    staffRowName: string,
    year: number,
    month: number,
    staffIdSet: Set<string>,
    orphanUidToArchivedName: Record<string, string>,
    staffIdToName: Record<string, string>,
    allStaffRows: readonly { id: string; name: string }[]
): string[] {
    const owners = new Set<string>();
    shifts.forEach((s) => {
        if (s.status === "draft") return;
        if (!shiftModelInCalendarMonth(s, year, month)) return;
        if (
            !shiftBelongsToStaffRow(
                s,
                staffRowUserId,
                staffRowName,
                staffIdSet,
                orphanUidToArchivedName,
                staffIdToName,
                allStaffRows
            )
        )
            return;
        owners.add(s.userId);
    });
    return Array.from(owners);
}

/**
 * 「一覧外ID」行を出す uid 一覧。名前が現行スタッフと一意に一致し紐づけできる orphan は除外（重複表示防止）。
 */
export function computeOrphanUserIdsForTable(
    shifts: Shift[],
    staffList: { id: string; name: string }[],
    staffIdSet: Set<string>,
    year: number,
    month: number,
    orphanUidToArchivedName: Record<string, string>
): string[] {
    const monthShifts = shifts.filter((s) => shiftModelInCalendarMonth(s, year, month));
    const orphanUids = [...new Set(monthShifts.map((s) => s.userId).filter((uid) => !staffIdSet.has(uid)))];

    const nameToStaffCount = new Map<string, number>();
    staffList.forEach((s) => {
        const k = normalizePersonNameForMatch(s.name);
        if (!k) return;
        nameToStaffCount.set(k, (nameToStaffCount.get(k) ?? 0) + 1);
    });

    const hide = new Set<string>();
    for (const oid of orphanUids) {
        const sample = monthShifts.find((s) => s.userId === oid);
        const fromDoc = typeof sample?.archivedUserName === "string" ? sample.archivedUserName.trim() : "";
        const anRaw =
            fromDoc ||
            (orphanUidToArchivedName[oid] ?? "").trim() ||
            displayNameFromArchiveUserKey(oid)?.trim() ||
            "";
        if (!anRaw) continue;
        const lcsOnly = uniqueStaffIdBySimilarArchivedName(anRaw, staffList);
        if (lcsOnly) {
            hide.add(oid);
            continue;
        }
        const anKey = normalizePersonNameForMatch(anRaw);
        if (!anKey) continue;
        if ((nameToStaffCount.get(anKey) ?? 0) !== 1) continue;
        const sameNameOrphans = orphanUids.filter((o) => {
            if (o === oid) return false;
            const sm = monthShifts.find((x) => x.userId === o);
            const fd = typeof sm?.archivedUserName === "string" ? sm.archivedUserName.trim() : "";
            const nmRaw =
                fd ||
                (orphanUidToArchivedName[o] ?? "").trim() ||
                displayNameFromArchiveUserKey(o)?.trim() ||
                "";
            return normalizePersonNameForMatch(nmRaw) === anKey;
        });
        if (sameNameOrphans.length > 0) continue;
        hide.add(oid);
    }
    return orphanUids.filter((id) => !hide.has(id)).sort();
}
