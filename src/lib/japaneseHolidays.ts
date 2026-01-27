/**
 * 日本の祝日・休日判定
 * - 国民の祝日（内閣府）、ハッピーマンデー、春分・秋分、振替休日
 * - 一般的な休日: 三が日（1/2, 1/3）、年末（12/29〜31）
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

function dateMatch(d: Date, month: number, day: number): boolean {
  return d.getMonth() === month && d.getDate() === day;
}

/**
 * 指定した日付が日本の祝日（または振替休日）かどうかを返す
 */
export function isJapaneseHoliday(d: Date): boolean {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();

  const fixed: [number, number][] = [
    [0, 1], [0, 2], [0, 3],   // 元日、三が日（1/2, 1/3）
    [1, 11], [1, 23],         // 建国記念の日、天皇誕生日
    [3, 29], [4, 3], [4, 4], [4, 5], [7, 11], [10, 3], [10, 23],
    [11, 29], [11, 30], [11, 31], // 年末休み（12/29〜31）
  ];
  if (fixed.some(([mm, dd]) => m === mm && day === dd)) return true;

  if (dateMatch(d, 2, vernalEquinoxDay(y))) return true;  // 春分の日（3月）
  if (dateMatch(d, 8, autumnEquinoxDay(y))) return true; // 秋分の日（9月=month 8）

  const nthMondays: [number, number][] = [
    [0, 2],  // 成人の日 1月第2月曜
    [6, 3],  // 海の日 7月第3月曜
    [8, 3],  // 敬老の日 9月第3月曜
    [9, 2],  // スポーツの日 10月第2月曜
  ];
  for (const [month, n] of nthMondays) {
    const h = getNthMonday(y, month, n);
    if (dateMatch(d, h.getMonth(), h.getDate())) return true;
  }

  // 振替休日: 日曜と重なった祝日の翌日（月曜）が休み。簡易に「前日が祝日かつ日曜」なら当日を祝日扱い
  const prev = new Date(y, m, day - 1);
  if (prev.getDay() === 0) {
    const prevY = prev.getFullYear();
    const prevM = prev.getMonth();
    const prevD = prev.getDate();
    const prevFixed: [number, number][] = [
      [0, 1], [1, 11], [1, 23], [3, 29], [4, 3], [4, 4], [4, 5], [7, 11], [10, 3], [10, 23],
    ];
    if (prevFixed.some(([mm, dd]) => prevM === mm && prevD === dd)) return true;
    if (prevM === 2 && prevD === vernalEquinoxDay(prevY)) return true;
    if (prevM === 8 && prevD === autumnEquinoxDay(prevY)) return true;
    for (const [pMonth, pN] of nthMondays) {
      const h = getNthMonday(prevY, pMonth, pN);
      if (prevM === h.getMonth() && prevD === h.getDate()) return true;
    }
  }

  return false;
}
