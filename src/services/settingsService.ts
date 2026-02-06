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

/** 指定年月の提出締切を過ぎているか */
export const isPastSubmitDeadline = async (
  year: number,
  month: number
): Promise<boolean> => {
  const deadline = await getDeadlineForMonthWithSettings(year, month);
  return new Date() > deadline;
};
