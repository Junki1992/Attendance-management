import excludedUids from "../../notification-excluded-uids.json";

/** チャット着信通知・提出催促・Chatwork ID 未設定リマインドなどから除外する UID（テスト・運用用アカウント） */
export const NOTIFICATION_EXCLUDED_USER_IDS = new Set<string>(excludedUids);

export function isNotificationExcludedUserId(userId: string): boolean {
    return NOTIFICATION_EXCLUDED_USER_IDS.has(userId);
}

/** 除外 UID には作らない通知タイプ（確定・却下など業務通知は送る） */
const SUPPRESSED_TYPES = new Set(["message", "remind_submit", "chatwork_id_required"]);

export function shouldSuppressNotificationForUser(userId: string, type: string): boolean {
    if (!isNotificationExcludedUserId(userId)) return false;
    return SUPPRESSED_TYPES.has(type);
}
