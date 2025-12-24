// js/services/StaffService.js
import { db } from "../firebase-init.js";
import { collection, query, where, getDocs, addDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

export const StaffService = {
    /**
     * 取得指定單位的所有員工
     * @param {string} unitId 
     */
    async getStaffList(unitId) {
        try {
            const q = query(collection(db, "users"), where("unitId", "==", unitId));
            const querySnapshot = await getDocs(q);
            
            let staffList = [];
            querySnapshot.forEach((doc) => {
                staffList.push({ id: doc.id, ...doc.data() });
            });
            return staffList;
        } catch (error) {
            console.error("Error getting staff:", error);
            throw error;
        }
    },

    /**
     * 新增員工 (建立 Firestore 文件)
     * 注意：這只是建立排班用的「人員資料」。
     * 若要建立「登入帳號(Auth)」，通常需要由員工自行註冊或透過後端 Admin SDK 建立。
     * 這裡我們先建立資料，讓排班表跑得動。
     */
    async addStaff(staffData) {
        try {
            // 使用 addDoc 讓 Firestore 自動生成 ID，或使用 setDoc 指定 ID (如員工編號)
            // 這裡我們假設使用員工編號 (empId) 作為 Document ID，方便管理
            if (!staffData.empId) throw new Error("必須輸入員工編號");

            const docRef = doc(db, "users", staffData.empId);
            await setDoc(docRef, {
                ...staffData,
                createdAt: new Date(),
                stats: { totalOff: 0, nightShiftCount: 0 } // 初始統計數據
            });
            
            return staffData.empId;
        } catch (error) {
            console.error("Error adding staff:", error);
            throw error;
        }
    }
};
