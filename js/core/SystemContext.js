// js/core/SystemContext.js
import { FirestoreService } from "../services/FirestoreService.js";

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null; // 這裡存放該單位的班別、組別設定
        this.isReady = false;
    }

    /**
     * 系統初始化流程：
     * 1. 記錄使用者
     * 2. 抓取使用者的 Unit ID
     * 3. 抓取該 Unit 的所有動態設定
     */
    async init(user) {
        try {
            console.log("[System] 初始化使用者資料...");
            // 1. 從 DB 讀取使用者完整資料 (包含他是哪個單位的)
            this.currentUser = await FirestoreService.getUserProfile(user.uid);
            
            if (!this.currentUser.unitId) {
                throw new Error("此帳號尚未指派單位 (unitId is missing)");
            }

            console.log(`[System] 載入單位設定: ${this.currentUser.unitId}...`);
            // 2. 從 DB 讀取該單位的動態設定
            this.unitConfig = await FirestoreService.getUnitConfig(this.currentUser.unitId);
            
            this.isReady = true;
            console.log("[System] 系統就緒 (設定已載入)", this.unitConfig);
            return this.unitConfig;

        } catch (error) {
            console.error("[System Error]", error);
            throw error; // 拋出錯誤讓 UI 層處理
        }
    }

    // --- 以下為動態存取介面 ---

    getShifts() {
        return this.unitConfig?.shifts || {};
    }

    getGroups() {
        return this.unitConfig?.groups || {};
    }

    /**
     * 判斷是否為夜班 (依據 DB 設定的屬性)
     */
    isNightShift(shiftCode) {
        const shift = this.unitConfig?.shifts?.[shiftCode];
        // 假設 DB 中的 shift 物件有 category 欄位
        return shift && (shift.category === 'Night' || shift.isNight === true);
    }
}

// 匯出 Singleton 實例
export const sysContext = new SystemContext();
