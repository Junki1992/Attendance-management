
import { db } from "@/lib/firebase/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

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
