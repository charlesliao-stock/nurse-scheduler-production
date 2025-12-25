import { db } from "../firebase-init.js";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const StaffService = {
    /**
     * 取得指定單位的人員列表
     * 🌟 修改：支援查詢 "UNASSIGNED" (未分發) 的人員
     */
    async getStaffList(unitId) {
        // 若未傳入 unitId，回傳空陣列
        if (!unitId) return [];

        let q;
        if (unitId === 'UNASSIGNED') {
            // 查詢 unitId 為空字串的人員
            q = query(collection(db, "staffs"), where("unitId", "==", ""));
        } else {
            // 正常查詢指定單位
            q = query(collection(db, "staffs"), where("unitId", "==", unitId));
        }

        const snapshot = await getDocs(q);
        const list = [];
        snapshot.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });
        return list;
    },

    async addStaff(data) {
        const payload = {
            unitId: data.unitId || "", // 允許空值 (未分發)
            empId: data.empId,
            name: data.name,
            title: data.title || "",
            email: data.email || "",
            password: data.password || "123456",
            level: data.level || "N",
            group: data.group || "",
            role: data.role || "User",
            hireDate: data.hireDate || null,
            attributes: {
                isPregnant: data.isPregnant || false,
                isNursing: data.isNursing || false, 
                isSpecial: data.isSpecial || false, 
                specialType: data.specialType || null,
                canBundle: data.canBundle || false  
            },
            updatedAt: new Date()
        };

        const docRef = doc(db, "staffs", data.empId); 
        await setDoc(docRef, payload);
    },

    async updateStaff(empId, data) {
        if (!empId) throw new Error("缺少員工編號");
        const docRef = doc(db, "staffs", empId);
        const payload = { ...data, updatedAt: new Date() };
        if(data.attributes) {
            payload.attributes = data.attributes; 
        }
        await updateDoc(docRef, payload);
    },

    async deleteStaff(empId) {
        if (!empId) throw new Error("缺少員工編號");
        const docRef = doc(db, "staffs", empId);
        await deleteDoc(docRef);
    }
};
