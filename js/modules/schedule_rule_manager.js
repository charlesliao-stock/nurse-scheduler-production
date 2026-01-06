// js/modules/schedule_rule_manager.js
// ⏪ 還原版：恢復舊版 ID 讀取邏輯

const scheduleRuleManager = {
    currentUnitId: null,
    
    init: async function() {
        console.log("Scheduling Rules Manager (Restored).");
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

            // 還原舊版 ID 對應
            this.setCheck('rule_minGap11', rules.minGap11, true);
            this.setVal('rule_maxConsDays', rules.maxConsecutiveDays, 6);
            this.setVal('rule_fairNightVar', rules.fairNightVar, 2);

            const ai = rules.aiParams || {};
            this.setVal('ai_tolerance', ai.tolerance, 2);
            
            // 相容性處理
            const backtrack = (ai.backtrack_depth !== undefined) ? ai.backtrack_depth : 
                             (ai.backtrackDepth !== undefined ? ai.backtrackDepth : 3);
            this.setVal('ai_backtrack_depth', backtrack, 3);
            
            this.setVal('ai_max_attempts', ai.max_attempts, 20);
            this.setVal('ai_w_balance', ai.w_balance, 200);
            this.setVal('ai_w_continuity', ai.w_continuity, 50);
            this.setVal('ai_w_surplus', ai.w_surplus, 150);

        } catch(e) {
            console.error(e);
            alert("讀取規則失敗: " + e.message);
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) return alert("請先選擇單位");

        const getVal = (id) => parseInt(document.getElementById(id).value) || 0;
        const getCheck = (id) => document.getElementById(id).checked;

        const rules = {
            minGap11: getCheck('rule_minGap11'),
            maxConsecutiveDays: getVal('rule_maxConsDays'),
            fairNightVar: getVal('rule_fairNightVar'),
            
            aiParams: {
                tolerance: getVal('ai_tolerance'),
                backtrack_depth: getVal('ai_backtrack_depth'),
                max_attempts: getVal('ai_max_attempts'),
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
            alert("✅ 規則已儲存成功！");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
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
