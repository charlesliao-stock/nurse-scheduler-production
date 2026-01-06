// js/modules/schedule_rule_manager.js
// 🔧 修正版 v1.2：完整還原所有舊版設定欄位 (fairNightVar, max_attempts)

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], // 保留此屬性以相容其他模組
    originalRules: {}, 

    init: async function() {
        console.log("Scheduling Rules Manager Loaded (Full Restore).");
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
            
            this.originalRules = JSON.parse(JSON.stringify(rules));

            // --- 讀取設定 (含舊版遷移) ---

            // 1. 間隔時數 (相容 minGap11)
            let finalMinGap = 11;
            if (rules.minGapHours !== undefined) {
                finalMinGap = rules.minGapHours;
            } else if (rules.minGap11 === true) {
                finalMinGap = 11;
            }
            this.setVal('input_minGapHours', finalMinGap, 11);

            // 2. 連續天數
            this.setVal('input_maxConsDays', rules.maxConsecutiveDays, 6);
            
            // 3. 夜班公平變異數 (舊版欄位) [Restore]
            this.setVal('input_fairNightVar', rules.fairNightVar, 2);

            // 4. 救火機制
            this.setCheck('check_enableFirefighting', rules.enableFirefighting, false);

            // --- AI 參數 ---
            const ai = rules.aiParams || {};
            
            // 容許誤差
            this.setVal('ai_tolerance', ai.tolerance, 2);
            
            // 回溯深度 (相容不同命名)
            const backtrack = (ai.backtrack_depth !== undefined) ? ai.backtrack_depth : 
                             (ai.backtrackDepth !== undefined ? ai.backtrackDepth : 3);
            this.setVal('ai_backtrack_depth', backtrack, 3);

            // 單格嘗試上限 (舊版欄位) [Restore]
            this.setVal('ai_max_attempts', ai.max_attempts, 20);

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

        // 構建新規則物件
        const uiRules = {
            minGapHours: getVal('input_minGapHours'),
            maxConsecutiveDays: getVal('input_maxConsDays'),
            fairNightVar: getVal('input_fairNightVar'), // [Restore]
            enableFirefighting: getCheck('check_enableFirefighting'),
            
            // 相容舊欄位
            minGap11: (getVal('input_minGapHours') >= 11),

            aiParams: {
                tolerance: getVal('ai_tolerance'),
                backtrack_depth: getVal('ai_backtrack_depth'),
                max_attempts: getVal('ai_max_attempts'), // [Restore]
                w_balance: getVal('ai_w_balance'),
                w_continuity: getVal('ai_w_continuity'),
                w_surplus: getVal('ai_w_surplus')
            }
        };

        // 安全合併：確保隱藏的欄位不會被刪除
        const finalRules = {
            ...this.originalRules, 
            ...uiRules,
            aiParams: {
                ...(this.originalRules.aiParams || {}), 
                ...uiRules.aiParams
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: finalRules
            });
            this.originalRules = finalRules;
            alert("✅ 完整設定已儲存 (舊參數已保留)");
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
