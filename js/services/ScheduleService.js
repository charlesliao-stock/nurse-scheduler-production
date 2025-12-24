import { db } from "../firebase-init.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const ScheduleService = {
    /**
     * 取得指定月份、單位的預班表
     * Doc ID 格式: "2025-02_ICU"
     */
    async getPreSchedule(unitId, year, month) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "pre_schedules", docId);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            return snap.data();
        } else {
            return null; // 尚無資料
        }
    },

    /**
     * 儲存個人的預班
     * @param {string} unitId 
     * @param {number} year 
     * @param {number} month 
     * @param {string} userId - 員工 UID
     * @param {object} wishesMap - { 1: 'D', 5: 'OFF' } (日期對應班別)
     */
    async savePersonalWishes(unitId, year, month, userId, wishesMap) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "pre_schedules", docId);

        // 使用 merge: true，如果文件不存在會自動建立，存在則只更新欄位
        // 資料結構: { wishes: { userId: { day: shift } } }
        // Firestore 巢狀更新語法: "wishes.userId"
        const updateData = {};
        updateData[`wishes.${userId}`] = wishesMap;
        updateData[`updatedAt`] = new Date();

        try {
            await setDoc(docRef, updateData, { merge: true });
            return true;
        } catch (error) {
            console.error("儲存預班失敗:", error);
            throw error;
        }
    }
};
