// js/modules/schedule_rule_manager.js

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    // 定義預設規則 (防止 undefined 錯誤)
    DEFAULT_RULES: {
        aiParams: {
            w_balance: 200,      // 均富權重
            w_continuity: 50,    // 連續性權重
            w_surplus: 150,      // 補人權重
            backtrack_depth: 3,  // 回溯深度
            max_attempts: 20,    // 單格嘗試次數
            tolerance: 2         // 容許誤差 (天)
        },
        dailyNeeds: {},
        policy: { maxConsDays: 6, minRestHours: 11 }
    },

    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        
        // [修正 1] 等待 Auth 就緒 (防止重新整理頁面時 app.currentUser 為空)
        if (!app.currentUser) {
            let attempts = 0;
            while (!app.currentUser && attempts < 20) { // 等待最多 2 秒
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
        }
        
        // 確保使用者已登入，否則顯示提示
        if (!app.currentUser) {
            const select = document.getElementById('ruleUnitSelect');
            if(select) select.innerHTML = '<option>請先登入</option>';
            return;
        }

        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        // [修正 2] DOM 等待機制 (解決載入中...卡住的核心關鍵)
        let select = document.getElementById('ruleUnitSelect');
        let attempts = 0;
        
        // 如果找不到元素，每 0.1 秒重試一次，最多試 1 秒
        while (!select && attempts < 10) {
            console.log(`⏳ 等待下拉選單生成... (${attempts+1}/10)`);
            await new Promise(r => setTimeout(r, 100)); 
            select = document.getElementById('ruleUnitSelect');
            attempts++;
        }

        if(!select) {
            console.error("❌ 嚴重錯誤：找不到 #ruleUnitSelect 元素，請檢查 HTML ID");
            return;
        }

        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            
            // 權限判斷
            const role = app.userRole || 'user';
            
            // 單位主管只能看自己
            if (role === 'unit_manager' || role === 'unit_scheduler') {
                if (app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }
            // system_admin 預設看全部，不需要額外 where 條件

            const snapshot = await query.get();
            
            if (snapshot.empty) {
                select.innerHTML = '<option value="">無可用單位</option>';
                return;
            }

            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name || doc.id;
                select.appendChild(option);
            });

            // UX 優化：如果只有一個單位 (例如單位主管)，自動選取並載入
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadRules(select.value);
            }

            // 綁定切換事件
            select.onchange = () => {
                if(select.value) this.loadRules(select.value);
                else document.getElementById('rulesContainer').style.display = 'none';
            };

            console.log(`✅ 成功載入 ${snapshot.size} 個單位`);

        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = `<option>載入失敗: ${e.message}</option>`;
        }
    },

    loadRules: async function(unitId) {
        if(!unitId) return;
        this.currentUnitId = unitId;
        
        const container = document.getElementById('rulesContainer');
        if(container) container.style.display = 'block';

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            
            // 合併 DB 資料與預設值
            const rules = { ...this.DEFAULT_RULES, ...(data.schedulingRules || {}) };
            const ai = { ...this.DEFAULT_RULES.aiParams, ...(rules.aiParams || {}) };

            // 填入 UI
            this.setVal('ai_w_balance', ai.w_balance);
            this.setVal('ai_w_continuity', ai.w_continuity);
            this.setVal('ai_w_surplus', ai.w_surplus);
            this.setVal('ai_backtrack_depth', ai.backtrack_depth);
            this.setVal('ai_max_attempts', ai.max_attempts);
            this.setVal('ai_tolerance', ai.tolerance);
            
            console.log("Rules loaded for unit:", unitId);
        } catch(e) {
            console.error("Load rules error:", e);
            alert("規則載入失敗");
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) {
            alert("請先選擇單位");
            return;
        }

        const rules = {
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
                schedulingRules: rules
            }, { merge: true });
            
            alert("✅ 規則已儲存！");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    setVal: (id, val) => { const el = document.getElementById(id); if(el) el.value = val; },
    getInt: (id) => { const el = document.getElementById(id); return el ? (parseInt(el.value) || 0) : 0; },
    
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
