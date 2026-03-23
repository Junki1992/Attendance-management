/**
 * 管理者シフト表の「スプレッドシート用コピー」と同形式の TSV をパースする
 * （Googleスプレッドシートから範囲コピーしたタブ区切りを想定）
 */
import type { ShiftWorkType } from "@/services/shiftService";

/** タブ区切り（クォート・セル内改行対応）を行列に分解 */
export function parseTsvMatrix(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const len = content.length;

    const pushCell = () => {
        row.push(cell);
        cell = "";
    };
    const pushRow = () => {
        if (row.length > 0 && row.some((c) => c.length > 0)) {
            rows.push(row);
        }
        row = [];
    };

    while (i < len) {
        const c = content[i]!;
        if (inQuotes) {
            if (c === '"') {
                if (content[i + 1] === '"') {
                    cell += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            cell += c;
            i += 1;
            continue;
        }
        if (c === '"') {
            inQuotes = true;
            i += 1;
            continue;
        }
        if (c === "\t") {
            pushCell();
            i += 1;
            continue;
        }
        if (c === "\n") {
            pushCell();
            pushRow();
            i += 1;
            continue;
        }
        if (c === "\r") {
            if (content[i + 1] === "\n") {
                pushCell();
                pushRow();
                i += 2;
                continue;
            }
            pushCell();
            pushRow();
            i += 1;
            continue;
        }
        cell += c;
        i += 1;
    }
    pushCell();
    if (row.length > 0 && row.some((c) => c.length > 0)) {
        rows.push(row);
    }
    return rows;
}

/** 1列目の日付ラベル（例: 1/5(月)）から年月日を得る。year は画面で指定、月はラベル優先 */
export function parseShiftSheetDateLabel(
    label: string,
    year: number,
    expectedMonth1To12: number
): { ok: true; dateStr: string; labelMonth: number } | { ok: false; reason: string } {
    const trimmed = label.trim().normalize("NFKC").replace(/／/g, "/");
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})/);
    if (!m) {
        return { ok: false, reason: `日付が読み取れません: ${trimmed.slice(0, 30)}` };
    }
    const month = parseInt(m[1]!, 10);
    const day = parseInt(m[2]!, 10);
    if (month < 1 || month > 12) {
        return { ok: false, reason: "月が不正です" };
    }
    const lastDay = new Date(year, month, 0).getDate();
    if (day < 1 || day > lastDay) {
        return { ok: false, reason: `日が不正です: ${month}/${day}` };
    }
    if (month !== expectedMonth1To12) {
        /* 警告は呼び出し側 */
    }
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { ok: true, dateStr, labelMonth: month };
}

/** 先頭列ヘッダが「日付」か（BOM・空白・全角コロン等の揺れを許容） */
export function isShiftImportDateHeaderCell(raw: string): boolean {
    const s = raw
        .replace(/^\uFEFF/, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
        .normalize("NFKC");
    const compact = s.replace(/[\s\u3000]+/g, "").replace(/[：:]+$/, "");
    return compact === "日付";
}

/**
 * 「記入例」など取り込み対象にしない列（共有シートのテンプレ列）
 * @see https://docs.google.com/spreadsheets/... 運用シートの列構成
 */
export function isImportableStaffHeaderName(name: string): boolean {
    const t = name.trim().normalize("NFKC");
    if (!t) {
        return false;
    }
    const blockExact = new Set(["記入例", "入力例", "サンプル"]);
    if (blockExact.has(t)) {
        return false;
    }
    if (/^記入例/.test(t)) {
        return false;
    }
    if (/^入力例/.test(t)) {
        return false;
    }
    if (/^サンプル/.test(t)) {
        return false;
    }
    return true;
}

/** 1列目セルが「M/D…」形式の日付行っぽいか（ヘッダなし貼り付けの判定用） */
function col0LooksLikeShiftDateLabel(label: string): boolean {
    const t = label.trim().normalize("NFKC").replace(/／/g, "/");
    if (/^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/.test(t)) {
        return true;
    }
    return /^\d{1,2}\/\d{1,2}/.test(t);
}

function padMatrixToWidth(matrix: string[][], width: number): string[][] {
    return matrix.map((row) => {
        const next = row.slice();
        while (next.length < width) {
            next.push("");
        }
        return next;
    });
}

function matrixMaxWidth(matrix: string[][]): number {
    let w = 0;
    for (const row of matrix) {
        w = Math.max(w, row.length);
    }
    return w;
}

/**
 * 共有シフト表のコピーを正規化する。
 * - 基本: **1行目は列見出し行**（先頭が「日付」でなくてもそのまま通す。A1 が空なら「日付」だけ補う）
 * - ヘッダなしで 1列目が 1/5(月) から始まる塊だけ貼った場合だけ、見出し行を合成する
 */
export function normalizeShiftImportMatrix(raw: string[][]): string[][] | null {
    if (raw.length < 2) {
        return null;
    }
    const maxW = matrixMaxWidth(raw);
    if (maxW < 2) {
        return null;
    }
    const padded = padMatrixToWidth(raw, maxW);

    const cell00 = padded[0]![0] ?? "";

    if (isShiftImportDateHeaderCell(cell00)) {
        return padded;
    }

    // ヘッダなし: 先頭行から数行の 1列目が日付ラベル → 1行目を合成
    const row0Date = col0LooksLikeShiftDateLabel(cell00);
    const row1Date = col0LooksLikeShiftDateLabel(padded[1]![0] ?? "");
    if (row0Date && row1Date) {
        const rest = Math.max(0, maxW - 1);
        const synth = ["日付", ...Array.from({ length: rest }, (_, i) => `列${i + 2}`)];
        return [synth, ...padded];
    }

    // 運用シートどおり「1行目＝見出し」として採用（先頭セルが空のときだけ「日付」を補完）
    if (!cell00.trim()) {
        const header = padded[0]!.slice();
        header[0] = "日付";
        return [header, ...padded.slice(1)];
    }

    return padded;
}

export function importableStaffHeadersFromRow(header: string[]): { index: number; name: string }[] {
    const out: { index: number; name: string }[] = [];
    for (let c = 1; c < header.length; c++) {
        const name = header[c]?.trim() ?? "";
        if (name && isImportableStaffHeaderName(name)) {
            out.push({ index: c, name });
        }
    }
    return out;
}

export type ParsedSheetCell =
    | { kind: "off" }
    | { kind: "shift"; startTime: string; endTime: string; workType: ShiftWorkType }
    | { kind: "error"; message: string }
    /** メモ・変更指示など。Firestore には書かない */
    | { kind: "skip"; reason?: string };

/**
 * セル文字列をシフトに変換
 * - 管理者エクスポート: 10-18\n（出社/休憩1h）
 * - 実シート例: 13-18(在宅) / 10-19（在宅/休憩1h）→休み / ⇒3/1変更OK
 */
export function parseAdminShiftExportCell(raw: string): ParsedSheetCell {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { kind: "off" };
    }
    const firstLine = trimmed.split(/\r?\n/)[0]!.trim();
    if (/^off$/i.test(firstLine)) {
        return { kind: "off" };
    }

    // メモのみ（⇒3/1変更OK など）— 先頭が ⇒ か、勤務時間パターンが無い「変更OK」系
    if (/^⇒/.test(firstLine)) {
        return { kind: "skip", reason: "memo" };
    }
    if (!/^\d{1,2}-\d{1,2}/.test(firstLine) && /変更OK|変更/.test(firstLine)) {
        return { kind: "skip", reason: "memo" };
    }

    // 「→休み」は最終的に休み（OFF）
    if (/→\s*休み/.test(firstLine) || /→休み/.test(firstLine)) {
        return { kind: "off" };
    }

    // 先頭の H-H の直後に 空白・全角空白・（・(・→・行末 まで許可（13-18(在宅) 等）
    const hm = firstLine.match(/^(\d{1,2})-(\d{1,2})(?=[\s　（(→]|$)/);
    if (!hm) {
        return { kind: "error", message: `勤務時間が読み取れません: ${firstLine.slice(0, 40)}` };
    }
    const sh = parseInt(hm[1]!, 10);
    const eh = parseInt(hm[2]!, 10);
    if (sh < 0 || sh > 23 || eh < 0 || eh > 23) {
        return { kind: "error", message: "時刻の範囲が不正です" };
    }
    let workType: ShiftWorkType = "office";
    if (/当欠/.test(trimmed)) {
        workType = "absence";
    } else if (/在宅/.test(trimmed)) {
        workType = "remote";
    }
    return {
        kind: "shift",
        startTime: `${String(sh).padStart(2, "0")}:00`,
        endTime: `${String(eh).padStart(2, "0")}:00`,
        workType,
    };
}

export type PreviewRow = {
    dateLabel: string;
    dateStr: string | null;
    /** 日付の「日」1〜31。範囲フィルタ用 */
    calendarDay: number | null;
    dateError?: string;
    monthMismatch?: boolean;
    /** 日付範囲フィルタで取り込み対象か */
    includeByDayRange: boolean;
    cell: ParsedSheetCell;
};

export type ParseGridPreview = {
    ok: boolean;
    headers: string[];
    staffColumnHeaders: { index: number; name: string }[];
    rows: PreviewRow[];
    errors: string[];
    /** 日付範囲で実際に書き込む行数（プレビュー用） */
    importableRowCount: number;
};

export type BuildGridPreviewOptions = {
    /** 取り込む「日」（その月内）。未指定はフィルタなし */
    dayFrom?: number | null;
    dayTo?: number | null;
};

/**
 * 1行目が「日付」＋スタッフ名、2行目以降が日付列＋各セルのグリッドを想定
 */
export function buildGridPreviewFromTsv(
    tsv: string,
    year: number,
    monthIndex0To11: number,
    staffColumnIndex: number,
    options?: BuildGridPreviewOptions
): ParseGridPreview {
    const structuralErrors: string[] = [];
    const rawMatrix = parseTsvMatrix(tsv.trim());
    if (rawMatrix.length < 2) {
        return {
            ok: false,
            headers: [],
            staffColumnHeaders: [],
            rows: [],
            errors: ["行が2行未満です。ヘッダー＋データ行を貼り付けてください。"],
            importableRowCount: 0,
        };
    }

    const normalized = normalizeShiftImportMatrix(rawMatrix);
    if (!normalized) {
        const fallbackStaff = importableStaffHeadersFromRow(rawMatrix[0] ?? []);
        return {
            ok: false,
            headers: rawMatrix[0] ?? [],
            staffColumnHeaders: fallbackStaff,
            rows: [],
            errors: ["表が足りません。2行以上かつ2列以上の範囲を貼り付けてください。"],
            importableRowCount: 0,
        };
    }

    const matrix = normalized;
    const header = matrix[0]!;
    const staffColumnHeaders = importableStaffHeadersFromRow(header);

    if (staffColumnHeaders.length === 0) {
        structuralErrors.push(
            '取り込み対象のスタッフ列がありません。「記入例」列以外の見出しを含む範囲をコピーしてください。'
        );
    }
    if (
        staffColumnIndex < 1 ||
        staffColumnIndex >= header.length ||
        !staffColumnHeaders.some((x) => x.index === staffColumnIndex)
    ) {
        structuralErrors.push(
            '取り込む列が無効です。プルダウンからスタッフ列を選び直してください（「記入例」列は選べません）。'
        );
    }

    const expectedMonth = monthIndex0To11 + 1;
    const dayFrom = options?.dayFrom != null && options.dayFrom > 0 ? options.dayFrom : null;
    const dayTo = options?.dayTo != null && options.dayTo > 0 ? options.dayTo : null;

    const rows: PreviewRow[] = [];
    const rowIssues: string[] = [];
    let importableRowCount = 0;

    for (let r = 1; r < matrix.length; r++) {
        const line = matrix[r]!;
        const dateLabel = line[0]?.trim() ?? "";
        if (!dateLabel) {
            continue;
        }
        const parsedDate = parseShiftSheetDateLabel(dateLabel, year, expectedMonth);
        let dateStr: string | null = null;
        let calendarDay: number | null = null;
        let dateError: string | undefined;
        let monthMismatch: boolean | undefined;
        if (!parsedDate.ok) {
            dateError = parsedDate.reason;
        } else {
            dateStr = parsedDate.dateStr;
            calendarDay = parseInt(parsedDate.dateStr.slice(-2), 10);
            if (parsedDate.labelMonth !== expectedMonth) {
                monthMismatch = true;
            }
        }

        let includeByDayRange = true;
        if (calendarDay != null && (dayFrom != null || dayTo != null)) {
            if (dayFrom != null && calendarDay < dayFrom) {
                includeByDayRange = false;
            }
            if (dayTo != null && calendarDay > dayTo) {
                includeByDayRange = false;
            }
        }

        const cellRaw = line[staffColumnIndex] ?? "";
        const cell = parseAdminShiftExportCell(cellRaw);
        if (cell.kind === "error") {
            rowIssues.push(`${dateLabel}: ${cell.message}`);
        }

        const countsTowardImport =
            includeByDayRange &&
            dateStr != null &&
            (cell.kind === "off" || cell.kind === "shift");

        if (countsTowardImport) {
            importableRowCount += 1;
        }

        rows.push({
            dateLabel,
            dateStr,
            calendarDay,
            dateError,
            monthMismatch,
            includeByDayRange,
            cell,
        });
    }

    const structuralOk =
        structuralErrors.length === 0 &&
        staffColumnIndex >= 1 &&
        staffColumnIndex < header.length &&
        staffColumnHeaders.some((x) => x.index === staffColumnIndex);
    const ok = structuralOk && importableRowCount > 0;

    return {
        ok,
        headers: header,
        staffColumnHeaders,
        rows,
        errors: [...structuralErrors, ...rowIssues],
        importableRowCount,
    };
}

export type DerivedImportDefaults = {
    year: number;
    /** 0〜11 */
    monthIndex: number;
    staffColumnIndex: number;
    /** 列見出し（退職シフトの表示名の初期値） */
    archiveName: string;
};

/** 1列目の日付ラベルから月を読む（YYYY があれば年も） */
function scanDateLabelForMonthYear(label: string): { month: number; year: number | null } | null {
    const trimmed = label.trim().normalize("NFKC").replace(/／/g, "/");
    const ymd = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
    if (ymd) {
        return {
            year: parseInt(ymd[1]!, 10),
            month: parseInt(ymd[2]!, 10),
        };
    }
    const md = trimmed.match(/^(\d{1,2})\/(\d{1,2})/);
    if (!md) {
        return null;
    }
    return {
        year: null,
        month: parseInt(md[1]!, 10),
    };
}

/** 貼り付けに年が無いとき、現在日付と表の月から年を推定 */
function inferYearForSheetMonth(sheetMonth1To12: number, explicitYear: number | null): number {
    if (explicitYear != null) {
        return explicitYear;
    }
    const now = new Date();
    const y = now.getFullYear();
    const cm = now.getMonth() + 1;
    const sm = sheetMonth1To12;
    if (cm >= 1 && cm <= 3 && sm >= 10 && sm <= 12) {
        return y - 1;
    }
    if (cm >= 10 && cm <= 12 && sm >= 1 && sm <= 3) {
        return y + 1;
    }
    return y;
}

/**
 * コピペした TSV から 年・月・取り込み列 index・列見出し名 を推定（表の日付ラベルから月を推測）
 */
export function deriveImportDefaultsFromTsv(tsv: string): DerivedImportDefaults | null {
    const raw = parseTsvMatrix(tsv.trim());
    if (raw.length < 2) {
        return null;
    }
    const matrix = normalizeShiftImportMatrix(raw);
    if (!matrix) {
        return null;
    }
    const header = matrix[0]!;

    const staffCols: number[] = [];
    for (let c = 1; c < header.length; c++) {
        const name = header[c]?.trim() ?? "";
        if (name && isImportableStaffHeaderName(name)) {
            staffCols.push(c);
        }
    }
    if (staffCols.length === 0) {
        return null;
    }

    const months: number[] = [];
    let explicitYear: number | null = null;

    for (let r = 1; r < matrix.length; r++) {
        const label = matrix[r]![0]?.trim() ?? "";
        if (!label) {
            continue;
        }
        const parsed = scanDateLabelForMonthYear(label);
        if (!parsed) {
            continue;
        }
        months.push(parsed.month);
        if (parsed.year != null) {
            explicitYear = parsed.year;
        }
    }

    if (months.length === 0) {
        return null;
    }

    const monthCounts = new Map<number, number>();
    for (const m of months) {
        if (m < 1 || m > 12) {
            continue;
        }
        monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
    }
    if (monthCounts.size === 0) {
        return null;
    }

    let bestMonth = 1;
    let bestCount = 0;
    for (const [m, cnt] of monthCounts) {
        if (cnt > bestCount) {
            bestCount = cnt;
            bestMonth = m;
        }
    }

    const year = inferYearForSheetMonth(bestMonth, explicitYear);

    let bestCol = staffCols[0]!;
    let bestScore = -1;
    for (const c of staffCols) {
        let score = 0;
        for (let r = 1; r < matrix.length; r++) {
            const cell = matrix[r]![c]?.trim() ?? "";
            if (cell) {
                score++;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestCol = c;
        }
    }

    const archiveName = (header[bestCol] ?? "").trim();
    if (!archiveName) {
        return null;
    }

    return {
        year,
        monthIndex: bestMonth - 1,
        staffColumnIndex: bestCol,
        archiveName,
    };
}

/**
 * 貼り付けから「取り込む列」と「名前（列見出し）」のみ推定。
 * 年・月・日の範囲は画面で選ぶ場合はこちらを使う。
 */
export function deriveImportStaffDefaultsFromTsv(
    tsv: string
): { staffColumnIndex: number; archiveName: string } | null {
    const d = deriveImportDefaultsFromTsv(tsv);
    if (!d) {
        return null;
    }
    return { staffColumnIndex: d.staffColumnIndex, archiveName: d.archiveName };
}
