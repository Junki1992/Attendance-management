import { db } from "@/lib/firebase/firebase";
import { getDoc } from "@/lib/firebase/firestoreHelpers";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

/** 月別締切上書きのキー: "YYYY-MM_first" | "YYYY-MM_second"、値: ISO日時文字列 */
export type DeadlineOverrides = Record<string, string>;

export interface AppSettings {
  /** @deprecated 旧仕様。firstBlockDeadlineDay / secondBlockDeadlineDay を使用 */
  shiftSubmitDeadlineDay?: number;
  /** 1～15日分の締切：前月の何日か（1～31、デフォルト25） */
  firstBlockDeadlineDay: number;
  /** 1～15日分の締切：時刻 "HH:mm"（デフォルト "23:59"） */
  firstBlockDeadlineTime: string;
  /** 16日～月末分の締切：当月の何日か（1～31、デフォルト10） */
  secondBlockDeadlineDay: number;
  /** 16日～月末分の締切：時刻 "HH:mm"（デフォルト "23:59"） */
  secondBlockDeadlineTime: string;
  /** 月別の締切上書き（土日祝でずらす場合など）。キー "YYYY-MM_first" / "YYYY-MM_second"、値 ISO日時 */
  deadlineOverrides?: DeadlineOverrides;
}

const DEFAULTS: AppSettings = {
  shiftSubmitDeadlineDay: 25,
  firstBlockDeadlineDay: 25,
  firstBlockDeadlineTime: "23:59",
  secondBlockDeadlineDay: 10,
  secondBlockDeadlineTime: "23:59",
  deadlineOverrides: {},
};

const SETTINGS_DOC_ID = "app";

/** Firestore の既存データにないフィールドを DEFAULTS で埋める */
function mergeWithDefaults(data: Record<string, unknown>): AppSettings {
  return {
    ...DEFAULTS,
    ...data,
    deadlineOverrides: { ...(DEFAULTS.deadlineOverrides ?? {}), ...(data.deadlineOverrides as Record<string, string> | undefined) },
  } as AppSettings;
}

export const getSettings = async (): Promise<AppSettings> => {
  const ref = doc(db, "settings", SETTINGS_DOC_ID);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return mergeWithDefaults(snap.data() as Record<string, unknown>);
  }
  return { ...DEFAULTS };
};

/** 設定の変更をリアルタイム購読（締切変更が即時反映される） */
export const subscribeSettings = (callback: (s: AppSettings) => void): (() => void) => {
  const ref = doc(db, "settings", SETTINGS_DOC_ID);
  return onSnapshot(ref, (snap) => {
    const s = snap.exists() ? mergeWithDefaults(snap.data() as Record<string, unknown>) : { ...DEFAULTS };
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

// --- 15日区切りルール（設定可能：1–15日分→前月X日、16日〜→当月Y日）---

function parseTimeString(timeStr: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeStr || "23:59").trim());
  if (!match) return { hour: 23, minute: 59 };
  const hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return { hour, minute };
}

/**
 * 指定日付 YYYY-MM-DD の締切日時を返す（設定＋月別上書きを反映）
 * 1～15日 → その月の「1ブロック」締切（前月の設定日）、16～月末 → 「2ブロック」締切（当月の設定日）
 */
export const getDeadlineForDateWithSettings = (dateStr: string, settings: AppSettings): Date => {
  const [y, m, day] = dateStr.split("-").map(Number); // m は 1-12
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;

  if (day <= 15) {
    const key = `${monthKey}_first`;
    const override = settings.deadlineOverrides?.[key];
    if (override) {
      const d = new Date(override);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const prev = new Date(y, m - 1, 1);
    prev.setMonth(prev.getMonth() - 1);
    const prevYear = prev.getFullYear();
    const prevMonth0 = prev.getMonth();
    const lastDayPrev = new Date(prevYear, prevMonth0 + 1, 0).getDate();
    const d = Math.min(settings.firstBlockDeadlineDay ?? 25, lastDayPrev);
    const { hour, minute } = parseTimeString(settings.firstBlockDeadlineTime ?? "23:59");
    return new Date(prevYear, prevMonth0, d, hour, minute, 59, 999);
  } else {
    const key = `${monthKey}_second`;
    const override = settings.deadlineOverrides?.[key];
    if (override) {
      const d = new Date(override);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const lastDay = new Date(y, m, 0).getDate();
    const d = Math.min(settings.secondBlockDeadlineDay ?? 10, lastDay);
    const { hour, minute } = parseTimeString(settings.secondBlockDeadlineTime ?? "23:59");
    return new Date(y, m - 1, d, hour, minute, 59, 999);
  }
};

/** 指定日付の提出締切を過ぎているか（設定を渡して使用） */
export const isPastSubmitDeadlineForDateWithSettings = (dateStr: string, settings: AppSettings): boolean => {
  const deadline = getDeadlineForDateWithSettings(dateStr, settings);
  return new Date() > deadline;
};

/** 設定を読み込んで締切を過ぎているか判定（非同期・shiftService 等で使用） */
export const isPastSubmitDeadlineForDateAsync = async (dateStr: string): Promise<boolean> => {
  const s = await getSettings();
  return isPastSubmitDeadlineForDateWithSettings(dateStr, s);
};

/** 指定日付 YYYY-MM-DD の締切日を返す（設定未読・デフォルト値。互換用） */
export const getDeadlineForDate = (dateStr: string): Date => {
  return getDeadlineForDateWithSettings(dateStr, DEFAULTS);
};

/** 指定日付の提出締切を過ぎているか（デフォルト設定で判定。設定反映には isPastSubmitDeadlineForDateWithSettings を使用） */
export const isPastSubmitDeadlineForDate = (dateStr: string): boolean => {
  return isPastSubmitDeadlineForDateWithSettings(dateStr, DEFAULTS);
};

/** 指定年月の2ブロックの締切表示用ラベルを返す（month は 0-indexed、設定を渡す） */
export const getDeadlineLabelsForMonthWithSettings = (
  year: number,
  month: number,
  settings: AppSettings
): { firstBlock: string; secondBlock: string } => {
  const month1 = month + 1;
  const firstDeadline = getDeadlineForDateWithSettings(
    `${year}-${String(month1).padStart(2, "0")}-01`,
    settings
  );
  const secondDeadline = getDeadlineForDateWithSettings(
    `${year}-${String(month1).padStart(2, "0")}-16`,
    settings
  );
  const fmt = (d: Date) =>
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    firstBlock: fmt(firstDeadline),
    secondBlock: fmt(secondDeadline),
  };
};

/** 指定年月の2ブロックの締切表示用ラベル（デフォルト設定。設定反映には getDeadlineLabelsForMonthWithSettings を使用） */
export const getDeadlineLabelsForMonth = (
  year: number,
  month: number
): { firstBlock: string; secondBlock: string } => {
  return getDeadlineLabelsForMonthWithSettings(year, month, DEFAULTS);
};
