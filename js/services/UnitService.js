import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 建立新單位
     * @param {string} userId - 建立者的 UID
     * @param {string} unitId - 單位代號 (Key)
     * @param {string} unitName - 單位名稱
     * @param {boolean} bindUser - 是否將使用者綁定到此單位
     */
    async createUnit(userId, unitId, unitName, bindUser = true) {
        const unitRef = doc(db, "units", unitId);
        const snap = await getDoc(unitRef);
        
        if (snap.exists()) {
            throw new Error(`單位代號 ${unitId} 已存在，請更換代號。`);
        }

        await setDoc(unitRef, {
            name: unitName,
            managers: [userId],
            createdAt: new Date(),
            shifts: {}, 
            groups: [], 
            titles: []  
        });

        if (bindUser) {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { unitId: unitId });
        }

        return true;
    },

    // ... (updateShifts, updateUnitSettings, updateUnitBasicInfo 保持不變) ...
    async updateShifts(unitId, shiftsMap) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { shifts: shiftsMap });
    },

    async updateUnitSettings(unitId, settings) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, settings);
    },

    async updateUnitBasicInfo(unitId, newName) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { name: newName });
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
     * 🌟 關鍵修正：刪除單位 (並釋放人員)
     * 概念：Unit 刪除後，Staff 依然存在，只是變成無單位狀態。
     */
    async deleteUnit(unitId) {
        // 1. 找出所有隸屬於此單位的人員
        const q = query(collection(db, "staffs"), where("unitId", "==", unitId));
        const snapshot = await getDocs(q);

        // 2. 使用 Batch 批次操作來移除這些人的 unitId 與 group
        const batch = writeBatch(db);
        
        snapshot.forEach(docSnap => {
            const staffRef = doc(db, "staffs", docSnap.id);
            batch.update(staffRef, { 
                unitId: "", // 清空單位
                group: "",  // 清空組別 (因為組別是依附於單位的)
                updatedAt: new Date()
            });
        });

        // 3. 執行批次更新
        await batch.commit();

        // 4. 最後才刪除單位文件本身
        const unitRef = doc(db, "units", unitId);
        await deleteDoc(unitRef);
    }
};
