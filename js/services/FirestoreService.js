// js/services/FirestoreService.js
import { db } from "../firebase-init.js";
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const FirestoreService = {
    /**
     * 獲取單一使用者的詳細資料
     * @param {string} uid 
     */
    async getUserProfile(uid) {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            throw new Error("找不到使用者資料 (User Profile Not Found)");
        }
    },

    /**
     * 獲取指定單位的完整設定 (班別、組別、規則)
     * 這是「動態設定」的核心來源
     * @param {string} unitId - 例如 "ICU", "ER"
     */
    async getUnitConfig(unitId) {
        const docRef = doc(db, "units", unitId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            throw new Error(`找不到單位設定: ${unitId}。請確認資料庫中已有此單位文件。`);
        }
    }
};
