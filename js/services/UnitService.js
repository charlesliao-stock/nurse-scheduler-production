import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 建立全新的單位與班別設定
     * @param {string} userId - 建立者的 UID (用於綁定)
     * @param {string} unitId - 單位代號 (如 ICU)
     * @param {string} unitName - 單位名稱
     * @param {object} shiftsMap - 班別 Map
     */
    async createUnitConfig(userId, unitId, unitName, shiftsMap) {
        try {
            // 1. 建立 units 文件
            const unitRef = doc(db, "units", unitId);
            await setDoc(unitRef, {
                name: unitName,
                shifts: shiftsMap,
                createdAt: new Date(),
                createdBy: userId
            });

            // 2. 更新使用者的 unitId
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, {
                unitId: unitId
            });

            return true;
        } catch (error) {
            console.error("Error creating unit config:", error);
            throw error;
        }
    }
};
