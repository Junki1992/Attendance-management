/**
 * chatwork-notify.js / verify-chatwork-settings.js 共通の送信判定
 */

function jstTodayDateStr(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function jstTomorrowDateStr(now = new Date()) {
  const ymd = jstTodayDateStr(now);
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function jstYesterdayDateStr(now = new Date()) {
  const ymd = jstTodayDateStr(now);
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function normalizeYmd(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const t = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return jstTodayDateStr(value.toDate());
  }
  return "";
}

function getJstHourMinute(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

/**
 * この shift 日付について、記録上すでに通知済みか
 * lastNotificationJstDay が無い古いデータは「未送信扱い」で再送を許可（誤記録対策）
 */
function wasAlreadySent(cfgData, shiftDate, now = new Date()) {
  const lastShift = normalizeYmd(cfgData?.lastNotificationDate);
  const lastJstDay = normalizeYmd(cfgData?.lastNotificationJstDay);
  if (lastShift !== shiftDate) return false;
  if (!lastJstDay) return false;

  const todayStr = jstTodayDateStr(now);
  const yesterdayStr = jstYesterdayDateStr(now);
  const tomorrowStr = jstTomorrowDateStr(now);

  if (shiftDate === todayStr) {
    return lastJstDay === todayStr || lastJstDay === yesterdayStr;
  }
  if (shiftDate === tomorrowStr) {
    return lastJstDay === todayStr;
  }
  return lastJstDay === todayStr;
}

/**
 * @returns {{ dateStr: string, isCatchUp: boolean, inEveningWindow: boolean, notifyHour: number, notifyMinute: number, todayStr: string, tomorrowStr: string, skipReason: string | null }}
 */
function resolveNotifyPlan(cfgData, schedule, now = new Date(), forceSend = false) {
  const todayStr = jstTodayDateStr(now);
  const tomorrowStr = jstTomorrowDateStr(now);
  const { notifyHour, notifyMinute } = schedule;
  const { hour: jstHour, minute: jstMinute } = getJstHourMinute(now);
  const configuredMin = notifyHour * 60 + notifyMinute;
  const currentMin = jstHour * 60 + jstMinute;
  const endOfJstDayMin = 23 * 60 + 59;
  const inEveningWindow = currentMin >= configuredMin && currentMin <= endOfJstDayMin;

  if (forceSend) {
    return {
      dateStr: tomorrowStr,
      isCatchUp: false,
      inEveningWindow: true,
      notifyHour,
      notifyMinute,
      todayStr,
      tomorrowStr,
      skipReason: null,
      jstHour,
      jstMinute,
      minutesPastNotify: 0,
    };
  }

  const lastSentNorm = normalizeYmd(cfgData?.lastNotificationDate);
  const needsTodayCatchUp = !lastSentNorm || lastSentNorm < todayStr;

  let dateStr;
  let isCatchUp = false;

  if (inEveningWindow) {
    dateStr = tomorrowStr;
  } else if (needsTodayCatchUp) {
    isCatchUp = true;
    dateStr = todayStr;
  } else {
    return {
      dateStr: tomorrowStr,
      isCatchUp: false,
      inEveningWindow: false,
      notifyHour,
      notifyMinute,
      todayStr,
      tomorrowStr,
      skipReason: "before_notify_time",
      jstHour,
      jstMinute,
      minutesPastNotify: 0,
    };
  }

  if (wasAlreadySent(cfgData, dateStr, now)) {
    return {
      dateStr,
      isCatchUp,
      inEveningWindow,
      notifyHour,
      notifyMinute,
      todayStr,
      tomorrowStr,
      skipReason: "already_sent",
      jstHour,
      jstMinute,
      minutesPastNotify: Math.max(0, currentMin - configuredMin),
    };
  }

  return {
    dateStr,
    isCatchUp,
    inEveningWindow,
    notifyHour,
    notifyMinute,
    todayStr,
    tomorrowStr,
    skipReason: null,
    jstHour,
    jstMinute,
    minutesPastNotify: inEveningWindow ? Math.max(0, currentMin - configuredMin) : 0,
    lastSentNorm,
    needsTodayCatchUp,
  };
}

module.exports = {
  jstTodayDateStr,
  jstTomorrowDateStr,
  jstYesterdayDateStr,
  normalizeYmd,
  getJstHourMinute,
  wasAlreadySent,
  resolveNotifyPlan,
};
