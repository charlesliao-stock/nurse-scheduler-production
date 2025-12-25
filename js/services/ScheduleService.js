import { db } from "../firebase-init.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const ScheduleService = {
    /**
     * 取得指定月份的預班表 (Pre-Schedule)
     */
    async getPreSchedule(unitId, year, month) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "pre_schedules", docId);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    },

    /**
     * 儲存個人預班 (Pre-Schedule)
     */
    async savePersonalWishes(unitId, year, month, userId, wishesMap) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "pre_schedules", docId);
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
    },

    /**
     * 🌟 新增：儲存正式排班結果 (Final Schedule)
     * @param {string} unitId 
     * @param {number} year 
     * @param {number} month 
     * @param {object} scheduleMap - { userId: { 1: 'D', 2: 'OFF'... } }
     */
    async saveFinalSchedule(unitId, year, month, scheduleMap) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "schedules", docId); // 存到 schedules 集合
        
        try {
            await setDoc(docRef, {
                unitId, year, month,
                assignments: scheduleMap, 
                status: 'Draft', // Draft(草稿) / Published(公告)
                updatedAt: new Date()
            }, { merge: true });
            return true;
        } catch (error) {
            console.error("儲存排班失敗:", error);
            throw error;
        }
    },

    /**
     * 🌟 新增：讀取正式排班結果
     */
    async getFinalSchedule(unitId, year, month) {
        const docId = `${year}-${String(month).padStart(2, '0')}_${unitId}`;
        const docRef = doc(db, "schedules", docId);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    }
};
