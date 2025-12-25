import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
        this.authUid = null;
        
        // 當前檢視的單位 ID (Active Unit)
        this.activeUnitId = null;
    }

    async init(user) {
        try {
            this.authUid = user.uid;
            console.log("[System] 初始化使用者 UID:", this.authUid);

            this.currentUser = await FirestoreService.getUserProfile(this.authUid);
            
            // 判斷角色與預設單位
            const role = this.currentUser?.role || 'User';
            const homeUnitId = this.currentUser?.unitId;

            // 核心邏輯：決定「當前檢視單位」
            if (role === 'SystemAdmin') {
                // 系統管理員：預設不選 (null)，需手動選擇
                this.activeUnitId = null;
                console.log("[System] 系統管理員登入，等待選擇單位...");
            } else {
                // 一般使用者/單位管理者：鎖定在自己的單位
                this.activeUnitId = homeUnitId;
            }

            // 如果有鎖定單位，就先讀取設定
            if (this.activeUnitId) {
                try {
                    this.unitConfig = await FirestoreService.getUnitConfig(this.activeUnitId);
                } catch (err) {
                    console.warn(`[System] 無法讀取單位設定: ${this.activeUnitId}`);
                    this.unitConfig = null; 
                }
            }
            
            this.isReady = true;
        } catch (error) {
            console.error("[System Error] 初始化過程異常:", error);
            if(this.authUid) {
                this.isReady = true;
            } else {
                throw error;
            }
        }
    }

    /**
     * 切換當前檢視的單位
     */
    async switchUnit(unitId) {
        this.activeUnitId = unitId;
        if (unitId) {
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log(`[System] 已切換至單位: ${unitId}`);
            } catch (error) {
                console.error("[System] 切換單位失敗:", error);
                this.unitConfig = null;
            }
        } else {
            this.unitConfig = null;
        }
    }

    /**
     * 取得當前「正在檢視」的單位 ID (新標準)
     */
    getActiveUnitId() {
        return this.activeUnitId;
    }

    /**
     * 🌟 [修復] 相容性方法：取得單位 ID
     * 讓尚未更新的模組也能正常運作，回傳 activeUnitId
     */
    getUnitId() {
        return this.activeUnitId;
    }

    // 取得使用者「所屬」的單位 ID (用於個人資料)
    getHomeUnitId() {
        return this.currentUser?.unitId || null;
    }

    getUnitConfig() {
        return this.unitConfig;
    }

    hasUnitConfig() {
        return !!(this.unitConfig && this.unitConfig.name);
    }

    getShifts() {
        return this.unitConfig?.shifts || {};
    }

    getUnitName() {
        return this.unitConfig?.name || "";
    }

    getUserName() {
        return this.currentUser?.name || this.currentUser?.staffName || "Admin";
    }

    getCurrentUserId() {
        return this.authUid || this.currentUser?.uid;
    }

    isSystemAdmin() {
        return this.currentUser?.role === 'SystemAdmin';
    }

    updateLocalSettings(settings) {
        if (this.unitConfig) {
            if(settings.groups) this.unitConfig.groups = settings.groups;
            if(settings.titles) this.unitConfig.titles = settings.titles;
        }
    }

    updateLocalShifts(shifts) {
        if(this.unitConfig) this.unitConfig.shifts = shifts;
    }
}

export const sysContext = new SystemContext();
