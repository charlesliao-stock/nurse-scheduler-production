import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    // ... (保留原本的 createUnit, updateShifts) ...

    async createUnit(userId, unitId, unitName) {
        // ... (保持原本邏輯) ...
        // 建議這裡初始建立時，也可以給預設的 groups 和 titles
        const unitRef = doc(db, "units", unitId);
        // 若文件不存在才建立
        const snap = await getDoc(unitRef);
        if(!snap.exists()) {
            await setDoc(unitRef, {
                name: unitName,
                shifts: {},
                groups: ['A', 'B'], // 預設組別
                titles: ['護理長', '護理師', '專科護理師'], // 預設職稱
                managers: [userId],
                createdAt: new Date()
            });
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { unitId: unitId });
        }
        return true;
    },

    async updateShifts(unitId, shiftsMap) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { shifts: shiftsMap });
    },

    /**
     * 🌟 新增：更新單位的組別與職稱設定
     */
    async updateUnitSettings(unitId, settings) {
        // settings = { groups: [], titles: [] }
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, settings);
    }
};
