
import { db } from "@/lib/firebase/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export interface UserProfile {
    uid: string;
    name: string;
    role: 'admin' | 'staff';
    email: string;
    hourlyWage?: number;
}

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data() as UserProfile;
    } else {
        return null;
    }
};

export const saveUserProfile = async (user: UserProfile) => {
    const docRef = doc(db, "users", user.uid);
    await setDoc(docRef, user, { merge: true });
};
