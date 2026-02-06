import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { doc, setDoc, collection, query, where } from "firebase/firestore";

export interface ChatworkConfig {
  apiToken: string;
  roomId: string;
  /** 自動通知時刻（0-23、日本時間）デフォルト 21 */
  notifyHour?: number;
}

const CHATWORK_CONFIG_DOC = "chatwork";
const DEFAULT_NOTIFY_HOUR = 21;

export const getChatworkConfig = async (): Promise<ChatworkConfig | null> => {
  const ref = doc(db, "settings", CHATWORK_CONFIG_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  if (!d?.apiToken?.trim() || !d?.roomId?.trim()) return null;
  let notifyHour = d?.notifyHour;
  if (typeof notifyHour !== "number" || notifyHour < 0 || notifyHour > 23) {
    notifyHour = DEFAULT_NOTIFY_HOUR;
  }
  return { apiToken: d.apiToken.trim(), roomId: d.roomId.trim(), notifyHour };
};

export const saveChatworkConfig = async (config: ChatworkConfig): Promise<void> => {
  const ref = doc(db, "settings", CHATWORK_CONFIG_DOC);
  const { apiToken, roomId, notifyHour } = config;
  const data: Record<string, unknown> = { apiToken, roomId };
  if (typeof notifyHour === "number" && notifyHour >= 0 && notifyHour <= 23) {
    data.notifyHour = notifyHour;
  }
  await setDoc(ref, data, { merge: true });
};

/** 翌日出勤を Chatwork に送信（管理者が手動実行） */
export const sendNextDayAttendanceToChatwork = async (): Promise<{ ok: boolean; count: number; error?: string }> => {
  const config = await getChatworkConfig();
  if (!config) return { ok: false, count: 0, error: "Chatwork の API トークンとルーム ID を設定してください" };

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

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${config.roomId}/messages`, {
    method: "POST",
    headers: {
      "X-ChatworkToken": config.apiToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ body }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, count: 0, error: `Chatwork API エラー ${res.status}: ${text}` };
  }
  return { ok: true, count: entries.length };
};
