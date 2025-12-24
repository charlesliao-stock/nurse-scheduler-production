// js/core/SystemContext.js
import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
    }

    /**
     * 系統初始化流程
     */
    async init(user) {
        try {
            console.log("[System] 1. 開始初始化，使用者 UID:", user.uid);
            
            // 1. 讀取使用者資料
            this.currentUser = await FirestoreService.getUserProfile(user.uid);
            console.log("[System] 2. 使用者資料載入成功:", this.currentUser);

            if (!this.currentUser || !this.currentUser.unitId) {
                throw new Error("此帳號資料不完整，缺少 unitId 欄位");
            }

            // 2. 讀取單位設定
            const unitId = this.currentUser.unitId;
            console.log(`[System] 3. 正在讀取單位設定 (ID: ${unitId})...`);
            
            this.unitConfig = await FirestoreService.getUnitConfig(unitId);
            console.log("[System] 4. 單位設定載入成功:", this.unitConfig);
            
            this.isReady = true;
            return this.unitConfig;

        } catch (error) {
            console.error("[System Error] 初始化過程失敗:", error);
            throw error;
        }
    }

    // --- 安全的資料存取方法 ---

    getShifts() {
        // 防呆：如果 unitConfig 是空的，或是 shifts 欄位不存在，回傳空物件
        return this.unitConfig?.shifts || {};
    }

    getGroups() {
        return this.unitConfig?.groups || {};
    }

    getUnitName() {
        return this.unitConfig?.name || "未命名單位";
    }

    getUserName() {
        return this.currentUser?.name || "未知使用者";
    }

    /**
     * 判斷是否為夜班
     */
    isNightShift(shiftCode) {
        const shift = this.getShifts()[shiftCode];
        return shift && (shift.category === 'Night' || shift.isNight === true);
    }
}

// 匯出 Singleton 實例
export const sysContext = new SystemContext();
