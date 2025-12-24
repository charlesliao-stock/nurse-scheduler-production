import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
    }

    async init(user) {
        try {
            console.log("[System] 初始化使用者 UID:", user.uid);
            this.currentUser = await FirestoreService.getUserProfile(user.uid);
            
            // 1. 檢查是否有 UnitID
            if (!this.currentUser || !this.currentUser.unitId) {
                console.log("[System] 此帳號尚未綁定單位 (New User)");
                this.unitConfig = null;
                this.isReady = true;
                return;
            }

            // 2. 嘗試讀取設定檔
            const unitId = this.currentUser.unitId;
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log("[System] 單位設定讀取成功:", this.unitConfig);
            } catch (err) {
                // 🌟 修正點：這裡不是錯誤，而是代表「尚未建立」
                console.warn(`[System] 尚未建立單位資料 (UnitID: ${unitId} 無對應設定)`);
                this.unitConfig = null; 
            }
            
            this.isReady = true;
        } catch (error) {
            console.error("[System Error] 初始化過程異常:", error);
            throw error;
        }
    }

    /**
     * 判斷單位設定是否完整
     */
    hasUnitConfig() {
        return !!(this.unitConfig && this.unitConfig.name);
    }

    // --- 資料存取 ---

    getShifts() {
        return this.unitConfig?.shifts || {};
    }

    getUnitId() {
        return this.currentUser?.unitId || null;
    }

    getUnitName() {
        return this.unitConfig?.name || "";
    }

    getUserName() {
        return this.currentUser?.name || this.currentUser?.staffName || "Admin";
    }

    getCurrentUserId() {
        return this.currentUser?.uid;
    }
}

export const sysContext = new SystemContext();
