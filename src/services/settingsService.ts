import { db } from "@/lib/firebase/firebase";
import { getDoc } from "@/lib/firebase/firestoreHelpers";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

export interface AppSettings {
  /** シフト提出締切日（1〜28。当月の何日までに提出か） */
  shiftSubmitDeadlineDay: number;
}

const DEFAULTS: AppSettings = {
  shiftSubmitDeadlineDay: 25,
};

const SETTINGS_DOC_ID = "app";

export const getSettings = async (): Promise<AppSettings> => {
  const ref = doc(db, "settings", SETTINGS_DOC_ID);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { ...DEFAULTS, ...snap.data() } as AppSettings;
  }
  return { ...DEFAULTS };
};

/** 設定の変更をリアルタイム購読（締切変更が即時反映される） */
export const subscribeSettings = (callback: (s: AppSettings) => void): (() => void) => {
  const ref = doc(db, "settings", SETTINGS_DOC_ID);
  return onSnapshot(ref, (snap) => {
    const s = snap.exists() ? ({ ...DEFAULTS, ...snap.data() } as AppSettings) : { ...DEFAULTS };
    callback(s);
  });
};

export const saveSettings = async (s: Partial<AppSettings>) => {
  const ref = doc(db, "settings", SETTINGS_DOC_ID);
  const current = await getSettings();
  await setDoc(ref, { ...current, ...s }, { merge: true });
};

/** 設定を読み込んだ上で、指定年月の締切日 23:59:59 を返す */
export const getDeadlineForMonthWithSettings = async (
  year: number,
  month: number
): Promise<Date> => {
  const s = await getSettings();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const d = Math.min(s.shiftSubmitDeadlineDay, lastDay);
  return new Date(year, month, d, 23, 59, 59, 999);
};

/** 指定年月の提出締切を過ぎているか（月単位・旧仕様。互換用） */
export const isPastSubmitDeadline = async (
  year: number,
  month: number
): Promise<boolean> => {
  const deadline = await getDeadlineForMonthWithSettings(year, month);
  return new Date() > deadline;
};

// --- 15日区切りルール（1–15日分→前月25日、16日〜→当月10日）---

/** 指定日付 YYYY-MM-DD の締切日 23:59:59 を返す（設定に依存しない固定ルール） */
export const getDeadlineForDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split("-").map(Number); // m は 1-12
  const day = d;
  if (day <= 15) {
    // 1–15日分 → 前月25日 23:59:59
    const firstOfThisMonth = new Date(y, m - 1, 1);
    firstOfThisMonth.setMonth(firstOfThisMonth.getMonth() - 1);
    const prevYear = firstOfThisMonth.getFullYear();
    const prevMonth0 = firstOfThisMonth.getMonth();
    const lastDayPrev = new Date(prevYear, prevMonth0 + 1, 0).getDate();
    const deadlineDay = Math.min(25, lastDayPrev);
    return new Date(prevYear, prevMonth0, deadlineDay, 23, 59, 59, 999);
  } else {
    // 16日〜月末 → 当月10日 23:59:59
    const lastDay = new Date(y, m, 0).getDate();
    const deadlineDay = Math.min(10, lastDay);
    return new Date(y, m - 1, deadlineDay, 23, 59, 59, 999);
  }
};

/** 指定日付の提出締切を過ぎているか */
export const isPastSubmitDeadlineForDate = (dateStr: string): boolean => {
  const deadline = getDeadlineForDate(dateStr);
  return new Date() > deadline;
};

/** 指定年月の2ブロックの締切表示用ラベルを返す（month は 0-indexed） */
export const getDeadlineLabelsForMonth = (
  year: number,
  month: number
): { firstBlock: string; secondBlock: string } => {
  const month0 = month;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const prev = new Date(year, month0, 1);
  prev.setMonth(prev.getMonth() - 1);
  const prevYear = prev.getFullYear();
  const prevMonth1 = prev.getMonth() + 1;
  const lastDayPrev = new Date(prevYear, prev.getMonth() + 1, 0).getDate();
  const d25 = Math.min(25, lastDayPrev);
  const d10 = Math.min(10, lastDay);
  return {
    firstBlock: `${prevYear}年${prevMonth1}月${d25}日`,
    secondBlock: `${year}年${month0 + 1}月${d10}日`,
  };
};
