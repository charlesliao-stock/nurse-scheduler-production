import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc, writeBatch, where } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 建立新單位
     * @param {boolean} bindUser - [關鍵] 是否將使用者綁定到此單位 (Setup=true, Admin=false)
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

        // 系統管理員後台新增時 bindUser 為 false，不轉調
        if (bindUser) {
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

    async deleteUnit(unitId) {
        // 1. 釋放該單位人員
        const q = query(collection(db, "staffs"), where("unitId", "==", unitId));
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        
        snapshot.forEach(docSnap => {
            const staffRef = doc(db, "staffs", docSnap.id);
            batch.update(staffRef, { unitId: "", group: "", updatedAt: new Date() });
        });
        await batch.commit();

        // 2. 刪除單位
        const unitRef = doc(db, "units", unitId);
        await deleteDoc(unitRef);
    }
};
