import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, query, where, getDocFromCache } from "firebase/firestore";

export interface UserProfile {
    uid: string;
    name: string;
    role: 'admin' | 'staff';
    email: string;
    hourlyWage: number; // Required now, default 1000
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
}

/** users の role='staff' 一覧。 Firestore に staff がいない場合のフォールバック用にモックを返す */
export const getAllStaff = async (): Promise<StaffItem[]> => {
    const q = query(
        collection(db, "users"),
        where("role", "==", "staff")
    );
    const snap = await getDocs(q);
    const list: StaffItem[] = [];
    snap.forEach((d) => {
        const data = d.data();
        list.push({ id: d.id, name: data.name || "（名前なし）" });
    });
    if (list.length === 0) {
        return [
            { id: "staff-456", name: "アルバイト 花子" },
            { id: "1", name: "佐藤 一郎" },
            { id: "2", name: "鈴木 次郎" },
        ];
    }
    return list;
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
        });
    });
    return list;
};

/** ユーザーのロールを更新（管理者用） */
export const updateUserRole = async (uid: string, role: "admin" | "staff"): Promise<void> => {
    const docRef = doc(db, "users", uid);
    await setDoc(docRef, { role }, { merge: true });
};

/** 管理者のUIDを取得 */
export const getAdminId = async (): Promise<string | null> => {
    // 環境変数で管理者のUIDが指定されている場合はそれを使用
    const adminUidFromEnv = process.env.NEXT_PUBLIC_ADMIN_UID?.trim();
    if (adminUidFromEnv) {
        return adminUidFromEnv;
    }
    
    // 環境変数が設定されていない場合、Firestoreから取得を試みる
    // ただし、スタッフはクエリを実行できないため、管理者のみが実行可能
    try {
        const q = query(
            collection(db, "users"),
            where("role", "==", "admin")
        );
        const snap = await getDocs(q);
        if (snap.empty) {
            return null;
        }
        // 最初の管理者のUIDを返す
        return snap.docs[0].id;
    } catch (err) {
        // クエリが失敗した場合（スタッフが実行した場合など）、null を返す
        if (process.env.NODE_ENV === "development") {
            console.warn("[userService] getAdminId: query failed, use NEXT_PUBLIC_ADMIN_UID env var", err);
        }
        return null;
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
