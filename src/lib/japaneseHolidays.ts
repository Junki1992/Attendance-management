/**
 * 日本の祝日・休日判定
 * - 国民の祝日（内閣府）、ハッピーマンデー、春分・秋分、振替休日
 * - 一般的な休日: 三が日（1/2, 1/3）、年末（12/29〜31）
 * - 振替休日: 日曜と重なった祝日の翌日以降で、既に祝日として占められていない最初の日（GWの 5/6、年またぎの振替など）
 */

/** 第n月曜の日付（1日が何曜かから算出） */
function getNthMonday(year: number, month: number, n: number): Date {
  const firstDow = new Date(year, month, 1).getDay(); // 0=日, 1=月, ...
  const firstMondayDate = 1 + ((8 - firstDow) % 7);
  const nthMondayDate = firstMondayDate + (n - 1) * 7;
  return new Date(year, month, nthMondayDate);
}

function vernalEquinoxDay(year: number): number {
  if (year <= 2099) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return 20;
}

function autumnEquinoxDay(year: number): number {
  if (year <= 2099) return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return 23;
}

const FIXED_HOLIDAYS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], // 元日、三が日（1/2, 1/3）
  [1, 11], [1, 23], // 建国記念の日、天皇誕生日
  [3, 29], [4, 3], [4, 4], [4, 5], [7, 11], [10, 3], [10, 23],
  [11, 29], [11, 30], [11, 31], // 年末休み（12/29〜31）
];

const NTH_MONDAYS: [number, number][] = [
  [0, 2], // 成人の日 1月第2月曜
  [6, 3], // 海の日 7月第3月曜
  [8, 3], // 敬老の日 9月第3月曜
  [9, 2], // スポーツの日 10月第2月曜
];

/** month は Date と同様 0 始まり */
function holidayKey(y: number, month0: number, day: number): string {
  return `${y}-${month0}-${day}`;
}

function parseHolidayKey(k: string): Date {
  const [ys, ms, ds] = k.split("-").map(Number);
  return new Date(ys, ms, ds);
}

function collectBaseHolidayKeys(year: number): Set<string> {
  const base = new Set<string>();
  for (const [mm, dd] of FIXED_HOLIDAYS) {
    base.add(holidayKey(year, mm, dd));
  }
  base.add(holidayKey(year, 2, vernalEquinoxDay(year)));
  base.add(holidayKey(year, 8, autumnEquinoxDay(year)));
  for (const [month, n] of NTH_MONDAYS) {
    const h = getNthMonday(year, month, n);
    base.add(holidayKey(h.getFullYear(), h.getMonth(), h.getDate()));
  }
  return base;
}

const holidayKeysByYear = new Map<number, Set<string>>();
const builtYears = new Set<number>();
/** 振替をすでに割り当てた「日曜の祝日」（重複処理防止） */
const processedSundayHolidayKeys = new Set<string>();

function getSet(year: number): Set<string> {
  if (!holidayKeysByYear.has(year)) {
    holidayKeysByYear.set(year, new Set(collectBaseHolidayKeys(year)));
  }
  return holidayKeysByYear.get(year)!;
}

function isBusy(ck: string): boolean {
  const y = parseHolidayKey(ck).getFullYear();
  return getSet(y).has(ck);
}

function findSubstituteHolidayKey(sun: Date): string | null {
  const cursor = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1);
  for (let i = 0; i < 400; i++) {
    const ck = holidayKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    if (!isBusy(ck)) return ck;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function processSundayHolidaysInBaseYear(baseYear: number): void {
  const base = collectBaseHolidayKeys(baseYear);
  const sundays = Array.from(base)
    .map(parseHolidayKey)
    .filter((dt) => dt.getFullYear() === baseYear && dt.getDay() === 0)
    .sort((a, b) => a.getTime() - b.getTime());

  for (const sun of sundays) {
    const sk = holidayKey(sun.getFullYear(), sun.getMonth(), sun.getDate());
    if (processedSundayHolidayKeys.has(sk)) continue;
    const ck = findSubstituteHolidayKey(sun);
    if (!ck) continue;
    processedSundayHolidayKeys.add(sk);
    const ty = parseHolidayKey(ck).getFullYear();
    getSet(ty).add(ck);
  }
}

const MIN_BUILD_YEAR = 1970;

function ensureYearBuilt(year: number): void {
  if (builtYears.has(year)) return;
  getSet(year);
  if (year - 1 >= MIN_BUILD_YEAR) {
    processSundayHolidaysInBaseYear(year - 1);
  }
  processSundayHolidaysInBaseYear(year);
  builtYears.add(year);
}

/**
 * 指定した日付が日本の祝日（または振替休日）かどうかを返す
 */
export function isJapaneseHoliday(d: Date): boolean {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  ensureYearBuilt(y);
  return getSet(y).has(holidayKey(y, m, day));
}
