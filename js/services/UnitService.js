import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 1. 建立單位 (僅基本資料)
     */
    async createUnit(userId, unitId, unitName) {
        try {
            // 檢查單位是否已存在
            const unitRef = doc(db, "units", unitId);
            const snap = await getDoc(unitRef);
            if(snap.exists()) {
                throw new Error("此單位代號已存在，請使用其他代號");
            }

            // 建立單位 (shifts 給空物件)
            await setDoc(unitRef, {
                name: unitName,
                shifts: {}, 
                managers: [userId],
                createdAt: new Date()
            });

            // 更新使用者的 unitId
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { unitId: unitId });

            return true;
        } catch (error) {
            console.error("建立單位失敗:", error);
            throw error;
        }
    },

    /**
     * 2. 更新班別設定
     */
    async updateShifts(unitId, shiftsMap) {
        try {
            const unitRef = doc(db, "units", unitId);
            await updateDoc(unitRef, {
                shifts: shiftsMap
            });
            return true;
        } catch (error) {
            console.error("更新班別失敗:", error);
            throw error;
        }
    }
};
