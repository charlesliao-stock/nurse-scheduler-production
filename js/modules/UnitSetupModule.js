import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const UnitSetupModule = {
    init: function() {
        this.form = document.getElementById('unit-setup-form');
        if (this.form) {
            // 防止重複綁定
            this.form.onsubmit = null;
            this.form.onsubmit = (e) => this.handleSave(e);
        }
    },

    handleSave: async function(e) {
        e.preventDefault();
        const unitId = document.getElementById('setup-unit-id').value.trim();
        const unitName = document.getElementById('setup-unit-name').value.trim();
        
        if (!unitId || !unitName) {
            alert("請填寫完整資訊");
            return;
        }

        try {
            const userId = sysContext.getCurrentUserId();
            if(!userId) throw new Error("使用者狀態異常，請重新登入");

            console.log(`[Setup] 正在建立單位: ${unitId}`);
            
            await UnitService.createUnit(userId, unitId, unitName);
            
            alert("✅ 單位建立成功！正在進入系統...");
            window.location.reload(); // 重整進入主畫面

        } catch (error) {
            alert("❌ 失敗: " + error.message);
        }
    }
};
