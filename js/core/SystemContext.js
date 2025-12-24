import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
        this.authUid = null; // 🌟 新增：用來強制儲存 Firebase Auth 的 UID
    }

    async init(user) {
        try {
            // 🌟 修正 1：直接鎖定 UID，不依賴資料庫讀取結果
            this.authUid = user.uid;
            console.log("[System] 初始化使用者 UID:", this.authUid);

            // 嘗試讀取使用者詳細資料 (Profile)
            this.currentUser = await FirestoreService.getUserProfile(this.authUid);
            
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
                console.warn(`[System] 尚未建立單位資料 (UnitID: ${unitId} 無對應設定)`);
                this.unitConfig = null; 
            }
            
            this.isReady = true;
        } catch (error) {
            console.error("[System Error] 初始化過程異常:", error);
            // 即使資料庫讀取失敗，只要有 authUid，我們仍視為已就緒(只是沒資料)
            if(this.authUid) {
                this.isReady = true;
            } else {
                throw error;
            }
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

    /**
     * 🌟 修正 2：優先回傳強制儲存的 authUid
     * 這保證了只要登入成功，絕對有 ID 可以用來建立資料
     */
    getCurrentUserId() {
        return this.authUid || this.currentUser?.uid;
    }
}

export const sysContext = new SystemContext();
