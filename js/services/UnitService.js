import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    // ... (保留 createUnit, updateShifts, updateUnitSettings) ...
    async createUnit(userId, unitId, unitName) {
        const unitRef = doc(db, "units", unitId);
        const snap = await getDoc(unitRef);
        if(!snap.exists()) {
            await setDoc(unitRef, {
                name: unitName,
                shifts: {},
                groups: ['A', 'B'], 
                titles: ['護理長', '護理師'],
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

    async updateUnitSettings(unitId, settings) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, settings);
    },

    /**
     * 🌟 新增：取得所有單位列表 (供系統管理員選單用)
     */
    async getAllUnits() {
        const q = query(collection(db, "units"), orderBy("name"));
        const snapshot = await getDocs(q);
        const list = [];
        snapshot.forEach(doc => {
            list.push({ id: doc.id, name: doc.data().name });
        });
        return list;
    }
};
