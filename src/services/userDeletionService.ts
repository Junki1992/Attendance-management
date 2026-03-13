/**
 * ユーザー削除時に DB 上の全関連データを削除するオーケストレーション
 * 各ステップで失敗した場合は「ステップ名: エラー内容」で再スローし、原因を特定しやすくする
 */
import { deleteShiftsByUserId } from "@/services/shiftService";
import { deleteNotificationsByUserId } from "@/services/notificationService";
import { deleteShiftChangeRequestsByUserId } from "@/services/shiftChangeRequestService";
import { deleteShiftSubmitCommentsByUserId } from "@/services/shiftSubmitCommentService";
import { deleteMessagesAndChatRoomsByUserId } from "@/services/chatService";
import { deleteWageHistoryByUserId } from "@/services/wageChangeLogService";
import {
    deleteProfileImageFromStorage,
    deleteUserDocument,
} from "@/services/userService";

function wrapStep<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
        throw new Error(`${stepName}: ${code || msg}`);
    });
}

/** 指定ユーザーの全データを DB から削除（設定画面の削除時に呼ぶ）。全ステップを並列実行して短時間で完了させる */
export const deleteAllUserData = async (uid: string): Promise<void> => {
    await Promise.all([
        wrapStep("notifications", () => deleteNotificationsByUserId(uid)),
        wrapStep("shiftChangeRequests", () => deleteShiftChangeRequestsByUserId(uid)),
        wrapStep("shiftSubmitComments", () => deleteShiftSubmitCommentsByUserId(uid)),
        wrapStep("messagesAndChatRooms", () => deleteMessagesAndChatRoomsByUserId(uid)),
        wrapStep("wageHistory", () => deleteWageHistoryByUserId(uid)),
        wrapStep("shifts", () => deleteShiftsByUserId(uid)),
        wrapStep("profileImage", () => deleteProfileImageFromStorage(uid)),
        wrapStep("userDocument", () => deleteUserDocument(uid)),
    ]);
};
