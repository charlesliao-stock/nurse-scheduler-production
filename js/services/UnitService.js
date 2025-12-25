import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    // ... (createUnit, updateShifts, updateUnitSettings, getAllUnits 保持不變) ...

    async createUnit(userId, unitId, unitName) {
        const unitRef = doc(db, "units", unitId);
        const snap = await getDoc(unitRef);
        if(!snap.exists()) {
            await setDoc(unitRef, {
                name: unitName,
                managers: [userId],
                createdAt: new Date(),
                shifts: {}, 
                groups: [], 
                titles: []  
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

    async updateUnitSettings(unitId, settings) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, settings);
    },

    async getAllUnits() {
        const q = query(collection(db, "units"), orderBy("name"));
        const snapshot = await getDocs(q);
        const list = [];
        snapshot.forEach(doc => {
            list.push({ id: doc.id, name: doc.data().name });
        });
        return list;
    },

    /**
     * 🌟 新增：更新單位基本資料 (名稱)
     */
    async updateUnitBasicInfo(unitId, newName) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { name: newName });
    }
};
