// js/modules/schedule_rule_manager.js

const scheduleRuleManager = {
    currentUnitId: null,
    
    // 定義預設規則 (Magic Numbers 的集中地)
    DEFAULT_RULES: {
        aiParams: {
            w_balance: 200,      // 均富權重
            w_continuity: 50,    // 連續性權重
            w_surplus: 150,      // 補人權重
            backtrack_depth: 3,  // 回溯深度
            max_attempts: 20,    // 單格嘗試次數
            tolerance: 2         // 容許誤差 (天)
        },
        dailyNeeds: {}, // 每日需求
        policy: {
            maxConsDays: 6,
            minRestHours: 11
        }
    },

    init: async function() {
        console.log("Rule Manager Loaded.");
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('ruleUnitSelect');
        if(!select) return;
        // ... (省略下拉選單載入代碼，與其他 manager 相同) ...
        // 假設已載入並綁定 onchange
        select.onchange = (e) => this.loadRules(e.target.value);
    },

    loadRules: async function(unitId) {
        if(!unitId) return;
        this.currentUnitId = unitId;
        document.getElementById('rulesContainer').style.display = 'block';

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            // 合併 DB 資料與預設值
            const rules = { ...this.DEFAULT_RULES, ...(data.schedulingRules || {}) };
            const ai = { ...this.DEFAULT_RULES.aiParams, ...(rules.aiParams || {}) };

            // 1. 填入 AI 參數
            this.setVal('ai_w_balance', ai.w_balance);
            this.setVal('ai_w_continuity', ai.w_continuity);
            this.setVal('ai_w_surplus', ai.w_surplus);
            this.setVal('ai_backtrack_depth', ai.backtrack_depth);
            this.setVal('ai_max_attempts', ai.max_attempts);
            this.setVal('ai_tolerance', ai.tolerance);

            // 2. 填入政策參數 (如有 UI)
            // ...

            console.log("Rules loaded for unit:", unitId);
        } catch(e) {
            console.error("Load rules error:", e);
            alert("規則載入失敗");
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) return;

        // 收集 UI 數據
        const newRules = {
            aiParams: {
                w_balance: this.getInt('ai_w_balance'),
                w_continuity: this.getInt('ai_w_continuity'),
                w_surplus: this.getInt('ai_w_surplus'),
                backtrack_depth: this.getInt('ai_backtrack_depth'),
                max_attempts: this.getInt('ai_max_attempts'),
                tolerance: this.getInt('ai_tolerance')
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).set({
                schedulingRules: newRules
            }, { merge: true }); // 使用 merge 避免覆蓋其他欄位
            
            alert("✅ 規則已儲存！下一次排班將套用新參數。");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    // 輔助函式
    setVal: (id, val) => { 
        const el = document.getElementById(id); 
        if(el) el.value = val; 
    },
    getInt: (id) => {
        const el = document.getElementById(id);
        return el ? parseInt(el.value) || 0 : 0;
    },
    switchTab: function(tab) {
        // ... (簡單的 Tab 切換邏輯) ...
    }
};
