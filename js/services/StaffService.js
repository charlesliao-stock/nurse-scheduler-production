import { db } from "../firebase-init.js";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const StaffService = {
    /**
     * 取得指定單位的人員列表
     */
    async getStaffList(unitId) {
        if (!unitId) return [];
        const q = query(collection(db, "staffs"), where("unitId", "==", unitId));
        const snapshot = await getDocs(q);
        const list = [];
        snapshot.forEach(doc => {
            // 將 Document ID (empId) 與資料合併
            list.push({ id: doc.id, ...doc.data() });
        });
        return list;
    },

    /**
     * 新增人員
     * 使用 empId (員工編號) 當作 Document ID
     */
    async addStaff(data) {
        // 資料清理與建構
        const payload = {
            unitId: data.unitId,
            empId: data.empId,
            name: data.name,
            email: data.email || "",
            password: "123456", // 預設密碼
            level: data.level || "N",
            group: data.group || "",
            role: data.role || "User",
            hireDate: data.hireDate || null,
            attributes: {
                isPregnant: data.isPregnant || false,
                isNursing: data.isNursing || false, 
                isSpecial: data.isSpecial || false, 
                canBundle: data.canBundle || false  
            },
            updatedAt: new Date()
        };

        // 使用員工編號當作文件 ID (Key)
        const docRef = doc(db, "staffs", data.empId); 
        await setDoc(docRef, payload);
    },

    /**
     * 🌟 更新人員 (您原本缺失的部分)
     */
    async updateStaff(empId, data) {
        if (!empId) throw new Error("缺少員工編號，無法更新");

        const docRef = doc(db, "staffs", empId);
        
        // 準備更新的資料
        const payload = { ...data, updatedAt: new Date() };
        
        // 確保 attributes 結構正確 (若有傳入 attributes 物件)
        if(data.attributes) {
            payload.attributes = data.attributes; 
        }

        await updateDoc(docRef, payload);
    },

    /**
     * 刪除人員
     */
    async deleteStaff(empId) {
        if (!empId) throw new Error("缺少員工編號");
        const docRef = doc(db, "staffs", empId);
        await deleteDoc(docRef);
    }
};
