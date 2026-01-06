// js/modules/schedule_rule_manager.js
// 🔧 修正版 v1.1：資料相容性修復與安全儲存

const scheduleRuleManager = {
    currentUnitId: null,
    originalRules: {}, // 用於暫存原始資料，確保不丟失隱藏欄位

    init: async function() {
        console.log("Scheduling Rules Manager Loaded (Fixed).");
        await this.loadUnitDropdown();
    },

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

    loadUnitData: async function(unitId) {
        this.currentUnitId = unitId;
        document.getElementById('rulesContainer').style.display = 'block';

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            const rules = data.schedulingRules || {}; 
            
            // 暫存原始規則，儲存時用來合併
            this.originalRules = JSON.parse(JSON.stringify(rules));

            // --- 資料遷移邏輯 (相容舊版設定) ---
            
            // 1. 間隔時數：如果新版沒資料，但舊版 minGap11 為 true，則設為 11，否則預設 11
            let finalMinGap = 11;
            if (rules.minGapHours !== undefined) {
                finalMinGap = rules.minGapHours;
            } else if (rules.minGap11 === true) {
                finalMinGap = 11; // 從舊版遷移
            }
            this.setVal('input_minGapHours', finalMinGap, 11);

            // 2. 連續天數
            this.setVal('input_maxConsDays', rules.maxConsecutiveDays, 6);
            
            // 3. 救火機制 (新功能預設 false)
            this.setCheck('check_enableFirefighting', rules.enableFirefighting, false);

            // --- AI 參數讀取 ---
            const ai = rules.aiParams || {};
            
            // 4. AI 參數相容 (防止 key 名稱差異)
            // 容許誤差
            this.setVal('ai_tolerance', ai.tolerance, 2);
            
            // 回溯深度 (舊版可能用不同命名，這裡做防呆)
            const backtrack = (ai.backtrack_depth !== undefined) ? ai.backtrack_depth : 
                             (ai.backtrackDepth !== undefined ? ai.backtrackDepth : 3);
            this.setVal('ai_backtrack_depth', backtrack, 3);

            // 權重
            this.setVal('ai_w_balance', ai.w_balance, 200);
            this.setVal('ai_w_continuity', ai.w_continuity, 50);
            this.setVal('ai_w_surplus', ai.w_surplus, 150);

        } catch(e) {
            console.error("Load Rules Error:", e);
            alert("讀取規則失敗: " + e.message);
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) return alert("請先選擇單位");

        const getVal = (id) => parseInt(document.getElementById(id).value) || 0;
        const getCheck = (id) => document.getElementById(id).checked;

        // 1. 準備新資料
        const uiRules = {
            minGapHours: getVal('input_minGapHours'),
            maxConsecutiveDays: getVal('input_maxConsDays'),
            enableFirefighting: getCheck('check_enableFirefighting'),
            
            // 為了保持向後相容，也可以同步更新舊欄位 (可選)
            minGap11: (getVal('input_minGapHours') >= 11),

            aiParams: {
                tolerance: getVal('ai_tolerance'),
                backtrack_depth: getVal('ai_backtrack_depth'),
                w_balance: getVal('ai_w_balance'),
                w_continuity: getVal('ai_w_continuity'),
                w_surplus: getVal('ai_w_surplus')
            }
        };

        // 2. 安全合併 (Safe Merge)：保留原本資料庫中有、但 UI 沒顯示的欄位 (如 max_attempts)
        const finalRules = {
            ...this.originalRules, // 先展開舊資料
            ...uiRules,            // 覆蓋新資料
            aiParams: {
                ...(this.originalRules.aiParams || {}), // 先展開舊 AI 參數
                ...uiRules.aiParams                     // 覆蓋新 AI 參數
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: finalRules
            });
            
            // 更新暫存
            this.originalRules = finalRules;
            alert("✅ 規則已儲存成功！(舊設定已保留並更新)");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    switchTab: function(tabName) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');
    },

    setVal: function(id, val, def) {
        const el = document.getElementById(id);
        if(el) el.value = (val !== undefined && val !== null) ? val : def;
    },
    setCheck: function(id, val, def) {
        const el = document.getElementById(id);
        if(el) el.checked = (val !== undefined) ? val : def;
    }
};
