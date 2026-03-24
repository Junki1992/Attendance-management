/**
 * shifts / shiftArchives の date フィールドを月次クエリ（文字列範囲）と一致させるための正規化。
 * Timestamp 型・ "2026-2-5" のような非ゼロ埋め文字列を "2026-02-05" に揃える。
 */
function dateFromYmdParts(y: number, mo: number, day: number): string | null {
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timestampLikeToLocalYmd(raw: unknown): string | null {
    if (raw == null || typeof raw !== "object") return null;
    const o = raw as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof o.toDate === "function") {
        const d = o.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
    }
    if (typeof o.seconds === "number") {
        const ms = o.seconds * 1000 + (typeof o.nanoseconds === "number" ? o.nanoseconds / 1e6 : 0);
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
    }
    return null;
}

export function normalizeShiftDateFromFirestore(raw: unknown): string | null {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        // 秒（~1e9）とミリ秒（~1e12）の両方
        const ms = raw < 1e11 ? raw * 1000 : raw;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
        return null;
    }
    if (typeof raw === "string") {
        const t = raw.trim();
        const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (m) {
            return dateFromYmdParts(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10));
        }
        return null;
    }
    return timestampLikeToLocalYmd(raw);
}

/**
 * ドキュメント ID が `{uid}_{YYYY-MM-DD}` のとき、フィールドの userId / date が壊れていても復元する。
 * （インシデント等で body の userId だけズレると、従来ロジックでは日付も取れず月外扱いになる）
 */
export function parseUserIdAndDateFromShiftDocId(docId: string): { userId: string; date: string } | null {
    const m1 = docId.match(/^(.+)_(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m1) {
        const date = dateFromYmdParts(parseInt(m1[2]!, 10), parseInt(m1[3]!, 10), parseInt(m1[4]!, 10));
        if (date) return { userId: m1[1]!, date };
    }
    const m2 = docId.match(/^(.+)_(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m2) {
        const date = dateFromYmdParts(parseInt(m2[2]!, 10), parseInt(m2[3]!, 10), parseInt(m2[4]!, 10));
        if (date) return { userId: m2[1]!, date };
    }
    return null;
}

/** ドキュメント ID と一致しない body.userId は無視し、ID 上の所有者を採用 */
export function canonicalUserIdForShiftDoc(docId: string, rawUserId: string): string {
    const parsed = parseUserIdAndDateFromShiftDocId(docId);
    const u = String(rawUserId ?? "").trim();
    if (!parsed) return u;
    if (!u || !docId.startsWith(`${u}_`)) return parsed.userId;
    return u;
}

/**
 * ドキュメント ID が `userId_YYYY-MM-DD`（日付はゼロ埋め任意）のとき、date フィールドが壊れていても日付を復元する。
 * これが無いと rawShiftDateInCalendarMonth が false になり「シフトが消えた」ように見える。
 */
export function parseShiftDateFromDocId(docId: string, userId: string): string | null {
    const uid = String(userId ?? "").trim();
    if (!uid || !docId.startsWith(`${uid}_`)) return null;
    const rest = docId.slice(uid.length + 1);
    const m = rest.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return dateFromYmdParts(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10));
}

/**
 * 表示・月判定用に必ず YYYY-MM-DD を返す。
 * 標準ドキュメントID（`UID_YYYY-MM-DD` 等）があるときは本文 date より常に ID を正とする（本文のみ破損・ズレしたケースの復旧）。
 */
export function resolveShiftDateString(raw: unknown, docId: string, userId: string): string {
    const parsed = parseUserIdAndDateFromShiftDocId(docId);
    if (parsed?.date) return parsed.date;
    const fromField = normalizeShiftDateFromFirestore(raw);
    if (fromField) return fromField;
    const fromId = parseShiftDateFromDocId(docId, userId);
    if (fromId) return fromId;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return "";
}

/**
 * 正規化済み YYYY-MM-DD が、year + month0（JS の月 0〜11）の暦月に含まれるか。
 * Firestore の where("date", ">=", "2026-03-01") は非ゼロ埋め文字列と辞書順が噛み合わず取りこぼすため、クライアント側の月判定に使う。
 */
export function isNormalizedDateInCalendarMonth(
    dateNorm: string | null,
    year: number,
    month0: number
): boolean {
    if (!dateNorm) return false;
    const parts = dateNorm.split("-");
    if (parts.length < 3) return false;
    const y = parseInt(parts[0]!, 10);
    const m = parseInt(parts[1]!, 10);
    if (Number.isNaN(y) || Number.isNaN(m)) return false;
    return y === year && m === month0 + 1;
}

/** Firestore の生の date 値が指定暦月に含まれるか（Timestamp・非ゼロ埋め文字列対応） */
export function rawShiftDateInCalendarMonth(raw: unknown, year: number, month0: number): boolean {
    return isNormalizedDateInCalendarMonth(normalizeShiftDateFromFirestore(raw), year, month0);
}

/** 生ドキュメントを月判定するときは必ず docId + userId も渡す（date 欠損でも ID から復元） */
export function shiftDocumentInCalendarMonth(
    dateRaw: unknown,
    docId: string,
    userId: string,
    year: number,
    month0: number
): boolean {
    const uid = canonicalUserIdForShiftDoc(docId, userId);
    const ds = resolveShiftDateString(dateRaw, docId, uid);
    return isNormalizedDateInCalendarMonth(ds, year, month0);
}

/** 既に Shift 化済みでも id があれば日付を再解決して月判定（表示層の取りこぼし防止） */
export function shiftModelInCalendarMonth(
    s: { date: string; id?: string; userId: string },
    year: number,
    month0: number
): boolean {
    const id = s.id ?? "";
    const uid = canonicalUserIdForShiftDoc(id, s.userId);
    const ds = resolveShiftDateString(s.date, id, uid);
    return isNormalizedDateInCalendarMonth(ds, year, month0);
}
