// js/modules/schedule_rule_manager.js
// 第一階段：實作規則儲存與救火機制參數

const scheduleRuleManager = {
    currentUnitId: null,

    init: async function() {
        console.log("Scheduling Rules Manager Loaded (Phase 1).");
        await this.loadUnitDropdown();
    },

    // 1. 載入單位下拉選單
    loadUnitDropdown: async function() {
        const select = document.getElementById('ruleUnitSelect');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });

            // 自動選擇第一個單位 (方便測試)
            if (snapshot.size === 1 || (snapshot.size > 0 && app.userUnitId)) {
                select.selectedIndex = 1;
                this.loadUnitData(select.value);
            }

            select.onchange = () => {
                if(select.value) this.loadUnitData(select.value);
                else document.getElementById('rulesContainer').style.display = 'none';
            };

        } catch(e) { console.error(e); }
    },

    // 2. 載入單位規則資料
    loadUnitData: async function(unitId) {
        this.currentUnitId = unitId;
        document.getElementById('rulesContainer').style.display = 'block';

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            const rules = data.schedulingRules || {}; // 讀取現有規則

            // --- 讀取並填入 UI ---

            // A. 單位規範 (硬規則)
            this.setVal('input_minGapHours', rules.minGapHours, 11);
            this.setVal('input_maxConsDays', rules.maxConsecutiveDays, 6);
            this.setCheck('check_enableFirefighting', rules.enableFirefighting, false); // 預設關閉

            // B. AI 參數
            const ai = rules.aiParams || {};
            this.setVal('ai_tolerance', ai.tolerance, 2);
            this.setVal('ai_backtrack_depth', ai.backtrack_depth, 3);

            // C. 權重
            this.setVal('ai_w_balance', ai.w_balance, 200);
            this.setVal('ai_w_continuity', ai.w_continuity, 50);
            this.setVal('ai_w_surplus', ai.w_surplus, 150);

        } catch(e) {
            console.error("Load Rules Error:", e);
            alert("讀取規則失敗");
        }
    },

    // 3. 儲存規則
    saveData: async function() {
        if(!this.currentUnitId) return alert("請先選擇單位");

        const getVal = (id) => parseInt(document.getElementById(id).value) || 0;
        const getCheck = (id) => document.getElementById(id).checked;

        // 建構規則物件
        const rules = {
            // 新增：救火機制與工時設定
            minGapHours: getVal('input_minGapHours'),
            maxConsecutiveDays: getVal('input_maxConsDays'),
            enableFirefighting: getCheck('check_enableFirefighting'),

            // AI 參數結構
            aiParams: {
                tolerance: getVal('ai_tolerance'),
                backtrack_depth: getVal('ai_backtrack_depth'),
                w_balance: getVal('ai_w_balance'),
                w_continuity: getVal('ai_w_continuity'),
                w_surplus: getVal('ai_w_surplus')
            },
            
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: rules
            });
            alert("✅ 規則已儲存成功！\n(將應用於下一次新建立的排班表)");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    // UI 切換
    switchTab: function(tabName) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');
    },

    // 輔助函式
    setVal: function(id, val, def) {
        const el = document.getElementById(id);
        if(el) el.value = (val !== undefined) ? val : def;
    },
    setCheck: function(id, val, def) {
        const el = document.getElementById(id);
        if(el) el.checked = (val !== undefined) ? val : def;
    }
};
