import { db } from "@/lib/firebase/firebase";
import { collection, doc, getDoc, getDocs, setDoc, query, where } from "firebase/firestore";

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
        // Ensure hourlyWage exists or default it
        return {
            hourlyWage: 1000,
            ...data
        } as UserProfile;
    } else {
        return null;
    }
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
