import { db, auth, storage } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, query, where, getDocFromCache } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export interface UserProfile {
    uid: string;
    name: string;
    role: 'admin' | 'staff';
    email: string;
    hourlyWage: number; // Required now, default 1000
    photoURL?: string;
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
}

/** Firestore の users/{uid} を作成。登録直後に呼ぶ。 */
export const createUser = async (params: CreateUserParams): Promise<void> => {
    const { uid, email, name, role, hourlyWage = 1000 } = params;
    const docRef = doc(db, "users", uid);
    await setDoc(docRef, { email, name, role, hourlyWage });
};

export const saveUserProfile = async (user: UserProfile) => {
    const docRef = doc(db, "users", user.uid);
    await setDoc(docRef, user, { merge: true });
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

/** users の role='staff' 一覧。 Firestore に staff がいない場合のフォールバック用にモックを返す */
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
        // 一般アカウント（スタッフ）が /admin/chat 等に来た場合、「role==staff」のクエリは
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

/** 全ユーザー一覧を取得（管理者用） */
export const getAllUsers = async (): Promise<UserProfile[]> => {
    const snap = await getDocs(collection(db, "users"));
    const list: UserProfile[] = [];
    snap.forEach((d) => {
        const data = d.data();
        list.push({
            uid: d.id,
            email: data.email || "",
            name: data.name || "（名前なし）",
            role: data.role === "admin" ? "admin" : "staff",
            hourlyWage: data.hourlyWage ?? 1000,
            photoURL: data.photoURL ?? undefined,
        });
    });
    return list;
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

/** 管理者のUIDを全件取得（スタッフチャットで「誰か管理者」からのメッセージを全て表示するため） */
export const getAdminIds = async (): Promise<string[]> => {
    if (!auth.currentUser) return [];

    const adminUidFromEnv = process.env.NEXT_PUBLIC_ADMIN_UID?.trim();
    if (adminUidFromEnv) {
        // env を鵜呑みにすると「users に存在しない uid」を管理者扱いしてしまい、
        // チャット/通知の宛先がズレて表示されない原因になる。存在確認してから採用する。
        try {
            const profile = await getUserProfile(adminUidFromEnv);
            if (profile?.role === "admin") {
                return [adminUidFromEnv];
            }
            if (process.env.NODE_ENV === "development") {
                console.warn("[userService] NEXT_PUBLIC_ADMIN_UID is not an admin user doc; fallback to query", {
                    adminUidFromEnv,
                    role: profile?.role ?? null,
                });
            }
        } catch (e) {
            if (process.env.NODE_ENV === "development") {
                console.warn("[userService] NEXT_PUBLIC_ADMIN_UID lookup failed; fallback to query", {
                    adminUidFromEnv,
                    error: e,
                });
            }
        }
    }

    try {
        const q = query(
            collection(db, "users"),
            where("role", "==", "admin")
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => d.id);
    } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        const msg = String((err as { message?: string })?.message ?? err);
        const isPermissionDenied =
            code === "permission-denied" ||
            code === "missing-or-insufficient-permissions" ||
            msg.toLowerCase().includes("insufficient permissions");
        if (!isPermissionDenied && process.env.NODE_ENV === "development") {
            console.warn("[userService] getAdminIds: query failed, use NEXT_PUBLIC_ADMIN_UID env var", err);
        }
        return [];
    }
};

/** 管理者のプロフィールを取得（最初に見つかった管理者を返す） */
export const getAdminProfile = async (): Promise<UserProfile | null> => {
    const adminId = await getAdminId();
    if (!adminId) {
        return null;
    }
    return await getUserProfile(adminId);
};
