import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 建立新單位
     * ⚠️ 修正：移除所有寫死的預設值 (groups, titles)，確保系統純淨
     */
    async createUnit(userId, unitId, unitName) {
        const unitRef = doc(db, "units", unitId);
        const snap = await getDoc(unitRef);
        
        if(!snap.exists()) {
            await setDoc(unitRef, {
                name: unitName,
                managers: [userId],
                createdAt: new Date(),
                
                // --- 資料淨空區 ---
                
                // 1. 班別設定：空 (等待使用者至班別設定新增)
                shifts: {}, 
                
                // 2. 組別列表：空 (等待使用者至單位參數設定新增)
                groups: [], 
                
                // 3. 職稱列表：空 (等待使用者至單位參數設定新增)
                titles: []  
            });
            
            // 將使用者綁定到此單位
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { unitId: unitId });
        }
        return true;
    },

    /**
     * 更新班別設定
     */
    async updateShifts(unitId, shiftsMap) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { shifts: shiftsMap });
    },

    /**
     * 更新單位參數 (職稱、組別)
     */
    async updateUnitSettings(unitId, settings) {
        // settings = { titles: [], groups: [] }
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, settings);
    },

    /**
     * 取得所有單位列表 (供系統管理員下拉選單連動使用)
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
