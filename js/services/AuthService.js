// js/services/AuthService.js
import { auth } from "../firebase-init.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

export const AuthService = {
    login: async (email, password) => {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            return userCredential.user;
        } catch (error) {
            throw error;
        }
    },

    logout: async () => {
        await signOut(auth);
    },

    // 監聽登入狀態
    onAuthStateChanged: (callback) => {
        auth.onAuthStateChanged(callback);
    }
};
