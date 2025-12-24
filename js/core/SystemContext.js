import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
        this.authUid = null;
    }

    async init(user) {
        try {
            this.authUid = user.uid;
            console.log("[System] 初始化使用者 UID:", this.authUid);

            this.currentUser = await FirestoreService.getUserProfile(this.authUid);
            
            if (!this.currentUser || !this.currentUser.unitId) {
                console.log("[System] 此帳號尚未綁定單位 (New User)");
                this.unitConfig = null;
                this.isReady = true;
                return;
            }

            const unitId = this.currentUser.unitId;
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log("[System] 單位設定讀取成功:", this.unitConfig);
            } catch (err) {
                console.warn(`[System] 尚未建立單位資料 (UnitID: ${unitId} 無對應設定)`);
                this.unitConfig = null; 
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
     * 🌟 新增：手動更新記憶體中的班別設定
     * 這樣就不需要重新整理網頁了
     */
    updateLocalShifts(newShiftsMap) {
        if (this.unitConfig) {
            this.unitConfig.shifts = newShiftsMap;
            console.log("[System] 記憶體中的班別設定已更新");
        }
    }

    hasUnitConfig() {
        return !!(this.unitConfig && this.unitConfig.name);
    }

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
        return this.authUid || this.currentUser?.uid;
    }
}

export const sysContext = new SystemContext();
