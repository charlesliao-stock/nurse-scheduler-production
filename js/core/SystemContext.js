import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
    }

    async init(user) {
        try {
            console.log("[System] 初始化使用者:", user.uid);
            this.currentUser = await FirestoreService.getUserProfile(user.uid);
            
            // 1. 如果使用者沒有 unitId，直接結束
            if (!this.currentUser || !this.currentUser.unitId) {
                console.log("[System] 此帳號尚未綁定單位");
                this.unitConfig = null;
                this.isReady = true;
                return; 
            }

            // 2. 嘗試讀取單位設定
            const unitId = this.currentUser.unitId;
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log("[System] 單位設定載入完成:", this.unitConfig);
            } catch (err) {
                console.warn("[System] 找不到單位設定文件 (可能已被刪除):", unitId);
                this.unitConfig = null; // 設定檔為空
            }
            
            this.isReady = true;
        } catch (error) {
            console.error("[System Error]", error);
            throw error;
        }
    }

    // --- 狀態判斷 ---

    /**
     * 檢查是否擁有有效的單位設定
     * 修正：這將決定 App 是否要把使用者踢回 Setup 畫面
     */
    hasUnitConfig() {
        // 必須 unitConfig 存在，且資料庫文件不是空的
        return this.unitConfig !== null;
    }

    // --- 資料存取方法 (補回遺失的 getShifts) ---

    /**
     * 取得班別設定
     * 安全存取：即使 config 為 null，也回傳空物件，防止報錯
     */
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
