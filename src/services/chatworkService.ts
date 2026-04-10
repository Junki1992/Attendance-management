import { db } from "@/lib/firebase/firebase";
import { isNotificationExcludedUserId } from "@/lib/notificationExclusions";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { doc, setDoc, collection, query, where } from "firebase/firestore";

/** 通知先1件：ルーム（グループ）または個人アカウント */
export interface NotificationDestination {
  type: "room" | "personal";
  id: string;
}

export interface ChatworkConfig {
  apiToken: string;
  /** 通知先一覧。管理者が任意に追加・変更・削除 */
  notificationDestinations: NotificationDestination[];
  /** 自動通知時刻（0-23、日本時間）デフォルト 21 */
  notifyHour?: number;
  /** 自動通知の分（0-59）デフォルト 0 */
  notifyMinute?: number;
  /** @deprecated 後方互換。notificationDestinations に移行 */
  roomId?: string;
  /** @deprecated 後方互換。notificationDestinations に移行 */
  personalAccountId?: string;
}

const CHATWORK_CONFIG_DOC = "chatwork";
const DEFAULT_NOTIFY_HOUR = 21;
const DEFAULT_NOTIFY_MINUTE = 0;

/** Firestore の notifyHour/notifyMinute（scripts/resolveChatworkNotifySchedule.js と同じ規則） */
function resolveNotifyFromDoc(d: Record<string, unknown>): { notifyHour: number; notifyMinute: number } {
  const rawHour = d?.notifyHour;
  const rawMin = d?.notifyMinute;

  let notifyHour: number | null = null;
  let minuteFromCombined: number | null = null;

  if (typeof rawHour === "string" && rawHour.includes(":")) {
    const parts = rawHour.trim().split(":").map((x) => x.trim());
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

  let notifyMinute: number | null = null;
  if (typeof rawMin === "number" && !Number.isNaN(rawMin)) {
    const mm = Math.floor(rawMin);
    if (mm >= 0 && mm <= 59) notifyMinute = mm;
  } else if (typeof rawMin === "string" && /^\d+$/.test(String(rawMin).trim())) {
    const mm = parseInt(String(rawMin).trim(), 10);
    if (mm >= 0 && mm <= 59) notifyMinute = mm;
  }
  if (notifyMinute === null) notifyMinute = minuteFromCombined !== null ? minuteFromCombined : DEFAULT_NOTIFY_MINUTE;
  if (notifyHour === null) notifyHour = DEFAULT_NOTIFY_HOUR;

  return { notifyHour, notifyMinute };
}

/** Firestore の生データを取得（chatwork-notify.js が読むのと同じドキュメント） */
export const getChatworkConfigRaw = async (): Promise<Record<string, unknown> | null> => {
  const ref = doc(db, "settings", CHATWORK_CONFIG_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as Record<string, unknown>;
};

function parseDestinations(d: Record<string, unknown>): NotificationDestination[] {
  const raw = d?.notificationDestinations;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((x) => x && typeof x === "object" && (x.type === "room" || x.type === "personal") && typeof (x as { id?: unknown }).id === "string" && (x as { id: string }).id.trim())
      .map((x) => ({ type: (x as { type: "room" | "personal" }).type, id: (x as { id: string }).id.trim() }));
  }
  const dests: NotificationDestination[] = [];
  const roomId = typeof d?.roomId === "string" ? d.roomId.trim() : "";
  const personalAccountId = typeof d?.personalAccountId === "string" ? d.personalAccountId.trim() : "";
  if (roomId) dests.push({ type: "room", id: roomId });
  if (personalAccountId) dests.push({ type: "personal", id: personalAccountId });
  return dests;
}

export const getChatworkConfig = async (): Promise<ChatworkConfig | null> => {
  const ref = doc(db, "settings", CHATWORK_CONFIG_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  if (!d?.apiToken || typeof d.apiToken !== "string" || !d.apiToken.trim()) return null;
  const notificationDestinations = parseDestinations(d);
  if (notificationDestinations.length === 0) return null;
  const { notifyHour, notifyMinute } = resolveNotifyFromDoc(d);
  return {
    apiToken: d.apiToken.trim(),
    notificationDestinations,
    notifyHour,
    notifyMinute,
    ...(d?.roomId != null && { roomId: String(d.roomId).trim() }),
    ...(d?.personalAccountId != null && { personalAccountId: String(d.personalAccountId).trim() }),
  };
};

export const saveChatworkConfig = async (config: ChatworkConfig): Promise<void> => {
  const ref = doc(db, "settings", CHATWORK_CONFIG_DOC);
  const { apiToken, notificationDestinations, notifyHour, notifyMinute } = config;
  const data: Record<string, unknown> = {
    apiToken,
    notificationDestinations: (notificationDestinations || []).filter((d) => d.id.trim()).map((d) => ({ type: d.type, id: d.id.trim() })),
  };
  if (typeof notifyHour === "number" && notifyHour >= 0 && notifyHour <= 23) {
    data.notifyHour = notifyHour;
  }
  if (typeof notifyMinute === "number" && notifyMinute >= 0 && notifyMinute <= 59) {
    data.notifyMinute = notifyMinute;
  }
  await setDoc(ref, data, { merge: true });
};

/** 1対1ルームを作成して room_id を返す（パターンB） */
async function createChatworkPrivateRoom(apiToken: string, accountId: string): Promise<number> {
  const res = await fetch("https://api.chatwork.com/v2/rooms", {
    method: "POST",
    headers: {
      "X-ChatworkToken": apiToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      name: "翌日出勤通知",
      members_admin_ids: accountId.trim(),
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ルーム作成失敗 ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { room_id?: number };
  if (typeof json?.room_id !== "number") throw new Error("ルーム作成の応答に room_id がありません");
  return json.room_id;
}

/** 翌日出勤を Chatwork に送信（管理者が手動実行）。通知先一覧に送信 */
export const sendNextDayAttendanceToChatwork = async (): Promise<{ ok: boolean; count: number; error?: string }> => {
  const config = await getChatworkConfig();
  if (!config || config.notificationDestinations.length === 0) {
    return { ok: false, count: 0, error: "Chatwork の API トークンと、通知先を1件以上設定してください" };
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const shiftsRef = collection(db, "shifts");
  const q = query(
    shiftsRef,
    where("date", "==", dateStr),
    where("status", "==", "confirmed")
  );
  const shiftsSnap = await getDocs(q);

  const entries: { name: string; start: string; end: string; chatworkAccountId?: string }[] = [];
  for (const d of shiftsSnap.docs) {
    const data = d.data();
    const uid = String(data.userId ?? "").trim();
    if (uid && isNotificationExcludedUserId(uid)) continue;
    const start = (data.startTime || "").trim();
    const end = (data.endTime || "").trim();
    if (!start || !end || (start === "00:00" && end === "00:00")) continue;
    const userRef = doc(db, "users", data.userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : null;
    const name = userData?.name || data.userId;
    const chatworkAccountId = (userData?.chatworkAccountId || "").trim() || undefined;
    entries.push({ name, start, end, chatworkAccountId });
  }

  const dateLabel = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
  const lines =
    entries.length > 0
      ? entries.map((e) => {
          const mention = e.chatworkAccountId ? `[To:${e.chatworkAccountId}] ` : "";
          return `${mention}${e.name} ${e.start}-${e.end}`;
        })
      : ["（出勤なし）"];
  const body = `【翌日出勤】${dateLabel}\n${lines.join("\n")}`;

  const token = config.apiToken;
  let lastError: string | undefined;
  for (const dest of config.notificationDestinations) {
    if (!dest.id.trim()) continue;
    if (dest.type === "personal" && entries.length === 0) continue;
    let roomId: number | string;
    if (dest.type === "personal") {
      try {
        roomId = await createChatworkPrivateRoom(token, dest.id);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
    } else {
      roomId = dest.id;
    }
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        "X-ChatworkToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ body }).toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      lastError = `Chatwork API ${res.status}: ${text}`;
    }
  }
  if (lastError) return { ok: false, count: 0, error: lastError };
  return { ok: true, count: entries.length };
};
