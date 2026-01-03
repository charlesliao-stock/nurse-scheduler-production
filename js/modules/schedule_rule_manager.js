// js/modules/schedule_rule_manager.js
// 修正版：專注於 V2 演算法參數 (容許誤差、回溯深度)

const scheduleRuleManager = {
    currentUnitId: null,
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('ruleUnitSelect');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            // 權限過濾：如果是單位主管，只能選自己的單位
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

            // 如果只有一個單位，自動選取
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadUnitData(select.value);
            }

            select.onchange = () => {
                if(select.value) this.loadUnitData(select.value);
                else document.getElementById('rulesContainer').style.display = 'none';
            };

        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadUnitData: async function(unitId) {
        this.currentUnitId = unitId;
        document.getElementById('rulesContainer').style.display = 'block';

        try {
            const doc = await db.collection('units').doc(unitId).get();
            if(!doc.exists) return;

            const data = doc.data();
            const rules = data.schedulingRules || {};
            const params = rules.aiParams || {};

            // --- 載入設定值到 UI ---
            // 1. 回溯深度 (Backtrack Depth)
            const inputBacktrack = document.getElementById('ai_backtrack_depth');
            if(inputBacktrack) inputBacktrack.value = params.backtrack_depth || 3;

            // 2. 容許誤差 (Tolerance) - V2 核心參數
            const inputTolerance = document.getElementById('ai_tolerance');
            if(inputTolerance) inputTolerance.value = (params.tolerance !== undefined) ? params.tolerance : 2;

            // 3. 最大嘗試次數 (可選)
            const inputAttempts = document.getElementById('ai_max_attempts');
            if(inputAttempts) inputAttempts.value = params.max_attempts || 20;

            // 4. (舊參數) 權重設定
            // 如果 HTML 還有保留權重輸入框，為了避免報錯，我們也嘗試填入(或給預設值)，但 V2 不會用到它們
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
            setVal('ai_w_balance', params.w_balance || 0);
            setVal('ai_w_continuity', params.w_continuity || 0);

        } catch(e) {
            console.error("Load Rules Error:", e);
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }

        // 讀取 UI 數值
        const getVal = (id, def) => {
            const el = document.getElementById(id);
            return el ? (parseInt(el.value) || def) : def;
        };

        const rules = {
            // V2 關鍵參數
            aiParams: {
                backtrack_depth: getVal('ai_backtrack_depth', 3), // 回溯深度
                tolerance: getVal('ai_tolerance', 2),             // 容許誤差 (天數)
                max_attempts: getVal('ai_max_attempts', 20),      // 嘗試次數
                
                // 保留舊欄位結構以防萬一，但設為 0 或讀取 UI
                w_balance: getVal('ai_w_balance', 0),
                w_continuity: getVal('ai_w_continuity', 0)
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: rules,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("規則已儲存成功！\nAI V2 將套用新的「容許誤差」與「回溯深度」。");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    // 頁籤切換功能 (如果 HTML 有保留頁籤設計)
    switchTab: function(tabName) {
        const wrapper = document.querySelector('.tab-content-wrapper');
        if(wrapper) {
            wrapper.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById(`tab-${tabName}`);
            if(target) target.classList.add('active');
        }
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(tabName)) btn.classList.add('active');
        });
    }
};
