/**
 * ユーザー削除時に DB 上の全関連データを削除するオーケストレーション
 */
import { deleteShiftsByUserId } from "@/services/shiftService";
import { deleteNotificationsByUserId } from "@/services/notificationService";
import { deleteShiftChangeRequestsByUserId } from "@/services/shiftChangeRequestService";
import { deleteMessagesAndChatRoomsByUserId } from "@/services/chatService";
import { deleteWageHistoryByUserId } from "@/services/wageChangeLogService";
import {
    deleteProfileImageFromStorage,
    deleteUserDocument,
} from "@/services/userService";

/** 指定ユーザーの全データを DB から削除（設定画面の削除時に呼ぶ） */
export const deleteAllUserData = async (uid: string): Promise<void> => {
    await deleteNotificationsByUserId(uid);
    await deleteShiftChangeRequestsByUserId(uid);
    await deleteMessagesAndChatRoomsByUserId(uid);
    await deleteWageHistoryByUserId(uid);
    await deleteShiftsByUserId(uid);
    await deleteProfileImageFromStorage(uid);
    await deleteUserDocument(uid);
};
