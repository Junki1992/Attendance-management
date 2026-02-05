import { db, auth, storage } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, updateDoc, query, where, getDocFromCache, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export interface UserProfile {
    uid: string;
    name: string;
    role: 'admin' | 'staff';
    email: string;
    hourlyWage: number; // Required now, default 1000
    photoURL?: string;
    chatworkAccountId?: string; // Chatwork の個人アカウントID（通知の To: メンション用）
}

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    const docRef = doc(db, "users", uid);
    // サーバーが激遅い/不安定な環境だと getDoc(=server 優先) が極端に待たされることがある。
    // まずキャッシュを試し、無ければサーバーへ（オフライン時は wrapper が空 Snapshot を返す）。
    const docSnap = await (async () => {
        try {
            const snap = await getDocFromCache(docRef);
            if (process.env.NODE_ENV === "development") {
                console.info("[userService] getUserProfile: cache hit", { uid });
            }
            return snap;
        } catch {
            if (process.env.NODE_ENV === "development") {
                console.info("[userService] getUserProfile: cache miss -> server", { uid });
            }
            return await getDoc(docRef);
        }
    })();

    if (docSnap.exists()) {
        const data = docSnap.data();
        return {
            ...data,
            uid: docRef.id,
            hourlyWage: data?.hourlyWage ?? 1000,
        } as UserProfile;
    } else {
        return null;
    }
};

export interface CreateUserParams {
    uid: string;
    email: string;
    name: string;
    role: "admin" | "staff";
    hourlyWage?: number;
    chatworkAccountId?: string;
}

/** Firestore の users/{uid} を作成。登録直後に呼ぶ。 */
export const createUser = async (params: CreateUserParams): Promise<void> => {
    const { uid, email, name, role, hourlyWage = 1000, chatworkAccountId } = params;
    const docRef = doc(db, "users", uid);
    const data: Record<string, unknown> = { email, name, role, hourlyWage };
    if (chatworkAccountId?.trim()) data.chatworkAccountId = chatworkAccountId.trim();
    await setDoc(docRef, data);
};

export const saveUserProfile = async (user: UserProfile) => {
    const docRef = doc(db, "users", user.uid);
    await setDoc(docRef, user, { merge: true });
};

export interface UpdateWageOptions {
    changedByUid?: string;
    changedByName?: string;
}

/** 指定ユーザーの時給のみ更新（管理者用・Firestore の update で部分更新）。変更ログを記録する場合は options を渡す */
export const updateUserHourlyWage = async (
    uid: string,
    hourlyWage: number,
    options?: UpdateWageOptions
): Promise<void> => {
    const docRef = doc(db, "users", uid);
    const snap = await getDoc(docRef);
    const previousWage = snap.exists() ? (snap.data()?.hourlyWage ?? 1000) : 1000;

    await updateDoc(docRef, { hourlyWage });

    if (options?.changedByUid && options?.changedByName) {
        try {
            const { recordWageChange } = await import("./wageChangeLogService");
            await recordWageChange(uid, previousWage, hourlyWage, options.changedByUid, options.changedByName);
        } catch (e) {
            console.warn("[updateUserHourlyWage] 時給変更ログの記録に失敗（時給は保存済み）:", e);
        }
    }
};

export interface StaffItem {
    id: string;
    name: string;
    photoURL?: string;
}

const STAFF_FALLBACK_LIST: StaffItem[] = [
    { id: "staff-456", name: "アルバイト 花子" },
    { id: "1", name: "佐藤 一郎" },
    { id: "2", name: "鈴木 次郎" },
];

/** users の role='staff' 一覧。 Firestore に staff がいない場合のフォールバック用にモックを返す（画面上は「アルバイト」と表示） */
export const getAllStaff = async (): Promise<StaffItem[]> => {
    // loginMock や未ログイン時は request.auth が null のため Firestore が permission-denied になる。
    if (!auth.currentUser) {
        return [];
    }
    try {
        const q = query(
            collection(db, "users"),
            where("role", "==", "staff")
        );
        const snap = await getDocs(q);
        const list: StaffItem[] = [];
        snap.forEach((d) => {
            const data = d.data();
            list.push({
                id: d.id,
                name: data.name || "（名前なし）",
                photoURL: data.photoURL ?? undefined,
            });
        });
        return list;
    } catch (err) {
        // 一般アカウント（アルバイト）が /admin/chat 等に来た場合、「role==staff」のクエリは
        // permission-denied になる。コンソールエラーを出さずフォールバックを返す。
        const code = (err as { code?: string })?.code ?? "";
        const msg = (err as { message?: string })?.message ?? "";
        if (
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            (typeof msg === "string" && msg.toLowerCase().includes("insufficient permissions"))
        ) {
            if (process.env.NODE_ENV === "development") {
                console.warn("[userService] getAllStaff: permission denied（管理者の users に role=admin があるか確認）");
            }
        }
        return [];
    }
};

function mapDocToUserProfile(d: { id: string; data: () => Record<string, unknown> }): UserProfile {
    const data = d.data();
    return {
        uid: d.id,
        email: (data.email as string) || "",
        name: (data.name as string) || "（名前なし）",
        role: data.role === "admin" ? "admin" : "staff",
        hourlyWage: (data.hourlyWage as number) ?? 1000,
        photoURL: (data.photoURL as string) ?? undefined,
        chatworkAccountId: (data.chatworkAccountId as string) ?? undefined,
    };
}

/** 全ユーザー一覧を取得（管理者用）。管理者以外が呼ぶと permission-denied になるため、事前にロールを確認する */
export const getAllUsers = async (): Promise<UserProfile[]> => {
    if (!auth.currentUser) return [];
    const myProfile = await getUserProfile(auth.currentUser.uid);
    if (!myProfile || myProfile.role !== "admin") return [];
    const snap = await getDocs(collection(db, "users"));
    const list: UserProfile[] = [];
    snap.forEach((d) => list.push(mapDocToUserProfile(d)));
    return list;
};

/** 全ユーザー一覧をリアルタイム購読（管理者用）。DBで削除されたユーザーは即座に一覧から消える */
export const subscribeAllUsers = (callback: (users: UserProfile[]) => void): (() => void) => {
    if (!auth.currentUser) {
        callback([]);
        return () => {};
    }
    let unsub: (() => void) | null = null;
    let cancelled = false;
    getUserProfile(auth.currentUser.uid).then((myProfile) => {
        if (cancelled) return;
        if (!myProfile || myProfile.role !== "admin") {
            callback([]);
            return;
        }
        unsub = onSnapshot(collection(db, "users"), (snap) => {
            const list: UserProfile[] = [];
            snap.forEach((d) => list.push(mapDocToUserProfile(d)));
            callback(list);
        });
    }).catch(() => {
        if (!cancelled) callback([]);
    });
    return () => {
        cancelled = true;
        unsub?.();
    };
};

const UPLOAD_TIMEOUT_MS = 30000;

/** プロフィール画像をアップロードし、users/{uid}.photoURL を更新。自分自身のみ可能。 */
export const uploadProfileImage = async (uid: string, file: File): Promise<string> => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
        throw new Error("自分のプロフィール画像のみ設定できます");
    }
    const path = `profileImages/${uid}/avatar`;
    const storageRef = ref(storage, path);

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("アップロードがタイムアウトしました。Firebase Storage が有効か確認してください。")), UPLOAD_TIMEOUT_MS);
    });

    const doUpload = async (): Promise<string> => {
        const contentType = file.type || "image/jpeg";
        try {
            await uploadBytes(storageRef, file, { contentType });
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? String(e);
            const code = (e as { code?: string })?.code ?? "";
            if (code === "storage/unauthorized" || (typeof msg === "string" && msg.includes("permission"))) {
                throw new Error("Storage の権限がありません。Firebase コンソールで Storage を有効にし、storage.rules をデプロイしてください。");
            }
            throw new Error(`画像のアップロードに失敗しました: ${msg}`);
        }
        let downloadURL: string;
        try {
            downloadURL = await getDownloadURL(storageRef);
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? String(e);
            throw new Error(`ダウンロードURLの取得に失敗しました: ${msg}`);
        }
        try {
            const docRef = doc(db, "users", uid);
            await setDoc(docRef, { photoURL: downloadURL }, { merge: true });
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? String(e);
            const code = (e as { code?: string })?.code ?? "";
            if (code === "permission-denied" || (typeof msg === "string" && msg.toLowerCase().includes("permission"))) {
                throw new Error("プロフィールの更新権限がありません。");
            }
            throw new Error(`プロフィールの更新に失敗しました: ${msg}`);
        }
        return downloadURL;
    };

    return Promise.race([doUpload(), timeoutPromise]);
};

/** ユーザーのロールを更新（管理者用） */
export const updateUserRole = async (uid: string, role: "admin" | "staff"): Promise<void> => {
    const docRef = doc(db, "users", uid);
    await setDoc(docRef, { role }, { merge: true });
};

/** 管理者のUIDを1件取得（表示用など） */
export const getAdminId = async (): Promise<string | null> => {
    const ids = await getAdminIds();
    return ids.length > 0 ? ids[0] : null;
};

/** 管理者のUIDを全件取得（アルバイトチャットで全管理者に届けるため必ず全員分返す） */
export const getAdminIds = async (): Promise<string[]> => {
    if (!auth.currentUser) return [];

    const ids = new Set<string>();
    const adminUidFromEnv = process.env.NEXT_PUBLIC_ADMIN_UID?.trim();
    if (adminUidFromEnv) ids.add(adminUidFromEnv);

    try {
        const q = query(
            collection(db, "users"),
            where("role", "==", "admin")
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => ids.add(d.id));
    } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        const msg = String((err as { message?: string })?.message ?? err);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            msg.toLowerCase().includes("insufficient permissions");
        if (!isPermissionDenied && process.env.NODE_ENV === "development") {
            console.warn("[userService] getAdminIds: query failed", err);
        }
        // クエリ失敗時は env があればそれだけ返す
    }
    return Array.from(ids);
};

/** 管理者のプロフィールを取得（最初に見つかった管理者を返す） */
export const getAdminProfile = async (): Promise<UserProfile | null> => {
    const adminId = await getAdminId();
    if (!adminId) {
        return null;
    }
    return await getUserProfile(adminId);
};
