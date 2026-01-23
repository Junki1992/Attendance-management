import { db } from "@/lib/firebase/firebase";
import { getDoc, getDocs } from "@/lib/firebase/firestoreHelpers";
import { collection, doc, setDoc, query, where } from "firebase/firestore";

export interface UserProfile {
    uid: string;
    name: string;
    role: 'admin' | 'staff';
    email: string;
    hourlyWage: number; // Required now, default 1000
}

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);

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
