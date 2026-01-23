/**
 * getDoc / getDocs のオフライン時フォールバック。
 * オフラインかつキャッシュに無い場合はエラーを出さず、空の結果を返して処理を続行する。
 */
import {
    getDoc as firestoreGetDoc,
    getDocs as firestoreGetDocs,
    getDocFromCache,
    getDocsFromCache,
    type DocumentReference,
    type Query,
    type DocumentSnapshot,
    type QuerySnapshot,
} from "firebase/firestore";

function isOfflineError(e: unknown): boolean {
    const msg = (e as { message?: string })?.message ?? "";
    const code = (e as { code?: string })?.code ?? "";
    return (typeof msg === "string" && msg.includes("offline")) || code === "unavailable";
}

/** オフライン＋キャッシュなし時用の「存在しないドキュメント」の偽 Snapshot（exists=false） */
function emptyDocSnapshot(ref: DocumentReference): DocumentSnapshot {
    return {
        exists: () => false,
        data: () => undefined,
        ref,
        id: ref.id,
        metadata: { fromCache: true, hasPendingWrites: false },
    } as DocumentSnapshot;
}

/** オフライン＋キャッシュなし時用の空の QuerySnapshot */
function emptyQuerySnapshot(): QuerySnapshot {
    return {
        docs: [],
        forEach: () => {},
        empty: true,
        size: 0,
        metadata: { fromCache: true, hasPendingWrites: false },
    } as unknown as QuerySnapshot;
}

/**
 * getDoc のラッパー。オフライン時はキャッシュを試し、それでも無い場合は
 * エラーを出さず「存在しない」扱いの Snapshot を返す。
 */
export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    try {
        return await firestoreGetDoc(ref);
    } catch (e) {
        if (isOfflineError(e)) {
            try {
                return await getDocFromCache(ref);
            } catch {
                return emptyDocSnapshot(ref);
            }
        }
        throw e;
    }
}

/**
 * getDocs のラッパー。オフライン時はキャッシュを試し、それでも無い場合は
 * エラーを出さず空の QuerySnapshot を返す。
 */
export async function getDocs(q: Query): Promise<QuerySnapshot> {
    try {
        return await firestoreGetDocs(q);
    } catch (e) {
        if (isOfflineError(e)) {
            try {
                return await getDocsFromCache(q);
            } catch {
                return emptyQuerySnapshot();
            }
        }
        throw e;
    }
}
