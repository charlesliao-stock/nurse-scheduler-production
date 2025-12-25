import { db } from "../firebase-init.js";
import { doc, setDoc, updateDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const UnitService = {
    /**
     * 建立新單位
     * @param {string} userId - 建立者的 UID
     * @param {string} unitId - 單位代號 (Key)
     * @param {string} unitName - 單位名稱
     * @param {boolean} bindUser - [關鍵] 是否將使用者綁定到此單位 (Setup=true, Admin=false)
     */
    async createUnit(userId, unitId, unitName, bindUser = true) {
        const unitRef = doc(db, "units", unitId);
        const snap = await getDoc(unitRef);
        
        if (snap.exists()) {
            throw new Error(`單位代號 ${unitId} 已存在，請更換代號。`);
        }

        // 1. 建立單位文件
        await setDoc(unitRef, {
            name: unitName,
            managers: [userId], // 建立者預設為管理者
            createdAt: new Date(),
            shifts: {}, 
            groups: [], 
            titles: []  
        });

        // 2. 只有在 Setup 流程 (bindUser=true)，才強制將使用者綁定過去
        // 系統管理員新增單位時，bindUser 會是 false，確保管理員保留在原單位或無單位狀態
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

    async getAllUnits() {
        const q = query(collection(db, "units"), orderBy("name"));
        const snapshot = await getDocs(q);
        const list = [];
        snapshot.forEach(doc => {
            list.push({ id: doc.id, name: doc.data().name });
        });
        return list;
    },

    async updateUnitBasicInfo(unitId, newName) {
        const unitRef = doc(db, "units", unitId);
        await updateDoc(unitRef, { name: newName });
    },

    /**
     * 🌟 新增：刪除單位
     */
    async deleteUnit(unitId) {
        const unitRef = doc(db, "units", unitId);
        await deleteDoc(unitRef);
        // 注意：Firestore 用戶端 SDK 無法自動遞迴刪除子集合 (Subcollections)。
        // 雖然單位文件被刪除，但底下的 staffs/shifts 可能會殘留 (這是 Firebase 的特性)。
        // 但在 UI 上，因為讀不到單位文件，這些資料實際上就看不到了，符合一般需求。
    }
};
