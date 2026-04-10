/**
 * Firestore settings/chatwork の notifyHour / notifyMinute を解決（chatwork-notify.js と同一規則）
 * - 数値・数字のみの文字列
 * - notifyHour に "18:00" 形式（コンソール直編集などで入った場合）
 * - rawMin があれば分はそちらを優先
 */
function resolveChatworkNotifySchedule(cfgData) {
  const rawHour = cfgData?.notifyHour;
  const rawMin = cfgData?.notifyMinute;

  let notifyHour = null;
  let minuteFromCombined = null;

  if (typeof rawHour === "string" && rawHour.includes(":")) {
    const parts = rawHour
      .trim()
      .split(":")
      .map((x) => x.trim());
    const h = parseInt(parts[0], 10);
    const mi = parts[1] != null && parts[1] !== "" ? parseInt(parts[1], 10) : NaN;
    if (!Number.isNaN(h) && h >= 0 && h <= 23) notifyHour = h;
    if (!Number.isNaN(mi) && mi >= 0 && mi <= 59) minuteFromCombined = mi;
    else if (notifyHour != null && Number.isNaN(mi)) minuteFromCombined = 0;
  } else if (typeof rawHour === "number" && !Number.isNaN(rawHour)) {
    const h = Math.floor(rawHour);
    if (h >= 0 && h <= 23) notifyHour = h;
  } else if (typeof rawHour === "string" && /^\d+$/.test(rawHour.trim())) {
    const h = parseInt(rawHour.trim(), 10);
    if (h >= 0 && h <= 23) notifyHour = h;
  }

  let notifyMinute = null;
  if (typeof rawMin === "number" && !Number.isNaN(rawMin)) {
    const mm = Math.floor(rawMin);
    if (mm >= 0 && mm <= 59) notifyMinute = mm;
  } else if (typeof rawMin === "string" && /^\d+$/.test(String(rawMin).trim())) {
    const mm = parseInt(String(rawMin).trim(), 10);
    if (mm >= 0 && mm <= 59) notifyMinute = mm;
  }
  if (notifyMinute === null) notifyMinute = minuteFromCombined !== null ? minuteFromCombined : 0;
  if (notifyHour === null) notifyHour = 21;

  return { notifyHour, notifyMinute, rawHour, rawMin };
}

module.exports = { resolveChatworkNotifySchedule };
