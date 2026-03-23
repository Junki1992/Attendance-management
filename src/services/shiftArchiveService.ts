/**
 * ユーザー削除時にシフトをアーカイブし、管理者が退職・削除済み分として閲覧できるようにする
 */
import { db } from "@/lib/firebase/firebase";
import { getDocs } from "@/lib/firebase/firestoreHelpers";
import {
    collection,
    doc,
    query,
    where,
    writeBatch,
    setDoc,
    Timestamp,
    getCountFromServer,
    deleteDoc,
} from "firebase/firestore";
import { getDoc } from "@/lib/firebase/firestoreHelpers";
import { getUserProfile } from "@/services/userService";
import type { Shift, ShiftWorkType } from "@/services/shiftService";
import type { ParsedSheetCell } from "@/lib/shiftSheetTsv";

export const SHIFT_ARCHIVES_COLLECTION = "shiftArchives";
export const SHIFT_ARCHIVE_USERS_COLLECTION = "shiftArchiveUsers";

export interface ShiftArchiveUserMeta {
    userId: string;
    archivedUserName: string;
    archivedAt: Timestamp;
    archivedShiftCount: number;
}

/** 削除直前に呼ぶ。shifts を読み取り shiftArchives にコピーし、shiftArchiveUsers にメタを保存 */
export async function archiveShiftsBeforeUserDeletion(uid: string): Promise<{ archivedCount: number }> {
    const profile = await getUserProfile(uid);
    const archivedUserName = profile?.name?.trim() || "（名前なし）";
    const now = Timestamp.now();

    const q = query(collection(db, "shifts"), where("userId", "==", uid));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        await setDoc(
            doc(db, SHIFT_ARCHIVE_USERS_COLLECTION, uid),
            {
                userId: uid,
                archivedUserName,
                archivedAt: now,
                archivedShiftCount: 0,
            },
            { merge: true }
        );
        return { archivedCount: 0 };
    }

    const BATCH_SIZE = 400;
    let archivedCount = 0;
    const docs = snapshot.docs;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
            const data = d.data();
            const ref = doc(db, SHIFT_ARCHIVES_COLLECTION, d.id);
            batch.set(ref, {
                ...data,
                archivedUserName,
                archivedAt: now,
                archivedFromShiftDocId: d.id,
            });
            archivedCount++;
        }
        await batch.commit();
    }

    await setDoc(
        doc(db, SHIFT_ARCHIVE_USERS_COLLECTION, uid),
        {
            userId: uid,
            archivedUserName,
            archivedAt: now,
            archivedShiftCount: archivedCount,
        },
        { merge: true }
    );

    return { archivedCount };
}

/** 退職シフト一覧のユーザー（アーカイブ日が新しい順） */
export async function listArchivedShiftUsers(): Promise<ShiftArchiveUserMeta[]> {
    const snapshot = await getDocs(collection(db, SHIFT_ARCHIVE_USERS_COLLECTION));
    const list: ShiftArchiveUserMeta[] = [];
    snapshot.forEach((d) => {
        const data = d.data();
        const at = data.archivedAt;
        list.push({
            userId: d.id,
            archivedUserName: String(data.archivedUserName ?? "（名前なし）"),
            archivedAt: at instanceof Timestamp ? at : Timestamp.now(),
            archivedShiftCount: Number(data.archivedShiftCount ?? 0),
        });
    });
    list.sort((a, b) => b.archivedAt.toMillis() - a.archivedAt.toMillis());
    return list;
}

function docDataToShift(id: string, data: Record<string, unknown>): Shift {
    return {
        id,
        userId: String(data.userId ?? ""),
        date: String(data.date ?? ""),
        startTime: String(data.startTime ?? "00:00"),
        endTime: String(data.endTime ?? "00:00"),
        status: (data.status as Shift["status"]) ?? "draft",
        hourlyWage: typeof data.hourlyWage === "number" ? data.hourlyWage : undefined,
        editedAfterDeadline: data.editedAfterDeadline === true,
        editedAfterConfirmed: data.editedAfterConfirmed === true,
        wasUnconfirmed: data.wasUnconfirmed === true,
        isRemote: data.isRemote === true,
        workType: data.workType as Shift["workType"],
    };
}

/** 指定ユーザー・指定月の退職シフト（日付昇順） */
export async function getArchivedShiftsForUserMonth(
    userId: string,
    year: number,
    month: number
): Promise<Shift[]> {
    const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const q = query(
        collection(db, SHIFT_ARCHIVES_COLLECTION),
        where("userId", "==", userId),
        where("date", ">=", startStr),
        where("date", "<=", endStr)
    );
    const snapshot = await getDocs(q);
    const shifts: Shift[] = [];
    snapshot.forEach((d) => {
        shifts.push(docDataToShift(d.id, d.data() as Record<string, unknown>));
    });
    shifts.sort((a, b) => a.date.localeCompare(b.date));
    return shifts;
}

/** 指定月の退職シフトを全ユーザー分まとめて取得（日付・ユーザーでソート） */
export async function getAllArchivedShiftsForMonth(year: number, month: number): Promise<Shift[]> {
    const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const q = query(
        collection(db, SHIFT_ARCHIVES_COLLECTION),
        where("date", ">=", startStr),
        where("date", "<=", endStr)
    );
    const snapshot = await getDocs(q);
    const shifts: Shift[] = [];
    snapshot.forEach((d) => {
        shifts.push(docDataToShift(d.id, d.data() as Record<string, unknown>));
    });
    shifts.sort((a, b) => a.userId.localeCompare(b.userId) || a.date.localeCompare(b.date));
    return shifts;
}

/** 手動入力または取り込み用の行から退職シフトへ書き込み */
export async function commitShiftArchiveTsvImport(args: {
    targetUserId: string;
    archivedUserName: string;
    rows: Array<{ dateStr: string; cell: ParsedSheetCell }>;
}): Promise<{ written: number }> {
    const { targetUserId, archivedUserName, rows } = args;
    const now = Timestamp.now();
    const nameTrim = archivedUserName.trim() || "（名前なし）";

    const toWrite = rows.filter(
        (r) => r.dateStr && (r.cell.kind === "off" || r.cell.kind === "shift")
    );

    const BATCH_SIZE = 400;
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = toWrite.slice(i, i + BATCH_SIZE);
        for (const r of chunk) {
            const docId = `${targetUserId}_${r.dateStr}`;
            const ref = doc(db, SHIFT_ARCHIVES_COLLECTION, docId);
            const cell = r.cell;
            if (cell.kind === "off") {
                batch.set(ref, {
                    userId: targetUserId,
                    date: r.dateStr,
                    startTime: "00:00",
                    endTime: "00:00",
                    status: "confirmed",
                    workType: "office" as ShiftWorkType,
                    isRemote: false,
                    archivedUserName: nameTrim,
                    archivedAt: now,
                    archivedFromImport: true,
                });
            } else if (cell.kind === "shift") {
                const wt = cell.workType;
                batch.set(ref, {
                    userId: targetUserId,
                    date: r.dateStr,
                    startTime: cell.startTime,
                    endTime: cell.endTime,
                    status: "confirmed",
                    workType: wt,
                    isRemote: wt === "remote",
                    archivedUserName: nameTrim,
                    archivedAt: now,
                    archivedFromImport: true,
                });
            }
        }
        await batch.commit();
    }

    const metaRef = doc(db, SHIFT_ARCHIVE_USERS_COLLECTION, targetUserId);
    const prevSnap = await getDoc(metaRef);
    const prevAt = prevSnap.exists() ? (prevSnap.data() as { archivedAt?: Timestamp }).archivedAt : undefined;

    const countQ = query(collection(db, SHIFT_ARCHIVES_COLLECTION), where("userId", "==", targetUserId));
    const countAgg = await getCountFromServer(countQ);

    await setDoc(
        metaRef,
        {
            userId: targetUserId,
            archivedUserName: nameTrim,
            archivedAt: prevAt ?? now,
            archivedShiftCount: countAgg.data().count,
        },
        { merge: true }
    );

    return { written: toWrite.length };
}

/** 1人分の退職シフトをすべて削除（shiftArchives の該当 userId ＋ shiftArchiveUsers のメタ） */
export async function deleteArchivedShiftsTableForUser(archiveUserId: string): Promise<{ deletedShiftDocs: number }> {
    const uid = archiveUserId.trim();
    if (!uid) {
        throw new Error("削除対象の ID が空です");
    }

    const q = query(collection(db, SHIFT_ARCHIVES_COLLECTION), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const docs = snapshot.docs;

    const BATCH_SIZE = 400;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        for (const d of docs.slice(i, i + BATCH_SIZE)) {
            batch.delete(d.ref);
        }
        await batch.commit();
    }

    await deleteDoc(doc(db, SHIFT_ARCHIVE_USERS_COLLECTION, uid));

    return { deletedShiftDocs: docs.length };
}
