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
            
            // 如果使用者沒有 unitId，表示他是新用戶或尚未設定
            if (!this.currentUser || !this.currentUser.unitId) {
                console.log("[System] 此帳號尚未綁定單位");
                this.unitConfig = null;
                this.isReady = true;
                return; // 正常返回，讓 App 層決定要顯示設定畫面
            }

            // 嘗試讀取單位設定
            const unitId = this.currentUser.unitId;
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log("[System] 單位設定載入完成:", this.unitConfig);
            } catch (err) {
                console.warn("[System] 找不到單位設定文件:", unitId);
                this.unitConfig = null; // 設為 null，觸發設定流程
            }
            
            this.isReady = true;
        } catch (error) {
            console.error("[System Error]", error);
            throw error;
        }
    }

    hasUnitConfig() {
        return this.unitConfig !== null && this.unitConfig.shifts !== undefined;
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
}

export const sysContext = new SystemContext();
