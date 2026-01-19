// js/modules/score_settings_manager.js
// 🔧 修正版：修復 "Cannot set properties of null" 錯誤 (對應 HTML ID)

const scoreSettingsManager = {
    currentUnitId: null,

    // 定義欄位對應關係，確保 JS 能找到 HTML 元素
    // checkId: 開關 Checkbox 的 ID
    // valId:   數值 Input 的 ID (這是我們在 HTML 中新增的)
    // key:     存入 DB 的欄位名稱
    fieldMap: [
        // 1. 公平性
        { checkId: 'metric_fairness_off', valId: 'val_fairness_off', key: 'fairness_off' },
        { checkId: 'metric_fairness_night', valId: 'val_fairness_night', key: 'fairness_night' },
        { checkId: 'metric_fairness_weekend', valId: 'val_fairness_weekend', key: 'fairness_weekend' },
        // 2. 滿意度
        { checkId: 'metric_sat_pref', valId: 'val_sat_pref', key: 'sat_pref' },
        { checkId: 'metric_sat_req', valId: 'val_sat_req', key: 'sat_req' },
        // 3. 疲勞度
        { checkId: 'metric_fat_consec', valId: 'val_fat_consec', key: 'fat_consec' },
        { checkId: 'metric_fat_night', valId: 'val_fat_night', key: 'fat_night' },
        { checkId: 'metric_fat_rest', valId: 'val_fat_rest', key: 'fat_rest' },
        { checkId: 'metric_fat_sd', valId: 'val_fat_sd', key: 'fat_sd' },
        // 4. 效率
        { checkId: 'metric_eff_gap', valId: 'val_eff_gap', key: 'eff_gap' },
        { checkId: 'metric_eff_over', valId: 'val_eff_over', key: 'eff_over' },
        { checkId: 'metric_eff_dist', valId: 'val_eff_dist', key: 'eff_dist' },
        // 5. 成本
        { checkId: 'metric_cost_over', valId: 'val_cost_over', key: 'cost_over' }
    ],

    init: async function() {
        console.log("🎯 Score Settings Manager Init START");
        const container = document.getElementById('scoreSettingsContainer');
        if (container) container.style.display = 'none';

        await this.loadUnitDropdown();
        console.log("🎯 Score Settings Manager Init COMPLETE");
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
        if(!select) {
            console.error("❌ 找不到 scoreUnitSelect 元素");
            return;
        }
        console.log("✅ 找到 scoreUnitSelect 元素");

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            console.log("📥 開始載入單位列表...");
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            console.log(`✅ Firestore 查詢成功, 共 ${snapshot.size} 個單位`);
            
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            let idx = 1;
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
                console.log(`  - 單位 ${idx++}: ${doc.id} (${doc.data().name})`);
            });

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change'));
            }

            select.onchange = () => this.onUnitChange();
            console.log("✅ 成功載入單位選項");

        } catch (e) { 
            console.error("❌ 載入單位列表失敗:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    onUnitChange: async function() {
        const select = document.getElementById('scoreUnitSelect');
        this.currentUnitId = select.value;
        const container = document.getElementById('scoreSettingsContainer');

        if(this.currentUnitId) {
            console.log(`📌 單位切換: ${this.currentUnitId}`);
            if(container) {
                container.style.display = 'block';
                console.log("顯示設定容器");
            }
            await this.loadSettings();
        } else {
            console.log("未選擇單位，隱藏容器");
            if(container) container.style.display = 'none';
        }
    },

    loadSettings: async function() {
        if(!this.currentUnitId) return;
        
        console.log(`📥 載入單位設定: ${this.currentUnitId}`);
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            const data = doc.data().scoreSettings || {};
            
            console.log("✅ 取得評分設定資料:", data);

            // 1. 載入權重顯示
            const weights = data.weights || {};
            const setWeight = (id, val) => {
                const el = document.getElementById(id);
                if(el) el.innerText = (val || 0) + '%';
                else console.warn(`⚠️ 找不到權重元素: ${id}`);
            };

            setWeight('fairness_weight_display', weights.fairness || 10);
            setWeight('satisfaction_weight_display', weights.satisfaction || 25);
            setWeight('fatigue_weight_display', weights.fatigue || 25);
            setWeight('efficiency_weight_display', weights.efficiency || 15);
            setWeight('cost_weight_display', weights.cost || 5);

            // 2. 載入各項指標 (Thresholds & Enables)
            const thresholds = data.thresholds || {};
            const enables = data.enables || {};

            this.fieldMap.forEach(item => {
                // 設定 Checkbox
                const checkEl = document.getElementById(item.checkId);
                if(checkEl) {
                    checkEl.checked = enables[item.key] !== false; // 預設 true
                } else {
                    console.warn(`⚠️ 找不到 Checkbox: ${item.checkId}`);
                }

                // 設定數值 Input
                const valEl = document.getElementById(item.valId);
                if(valEl) {
                    valEl.value = thresholds[item.key] !== undefined ? thresholds[item.key] : this.getDefaultValue(item.key);
                } else {
                    console.error(`❌ 嚴重錯誤: 找不到數值輸入框 ID: ${item.valId} (這導致了之前的錯誤)`);
                }
            });
            
            console.log("✅ 設定載入完成");

        } catch (e) { 
            console.error("❌ 載入設定失敗:", e);
            alert("載入設定失敗，請查看 Console");
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        console.log("💾 開始儲存設定...");
        
        const weights = {
            fairness: 10, // 暫時寫死，因為 UI 上目前是靜態顯示，若要修改需增加輸入介面
            satisfaction: 25,
            fatigue: 25,
            efficiency: 15,
            cost: 5
        };

        const thresholds = {};
        const enables = {};

        this.fieldMap.forEach(item => {
            const checkEl = document.getElementById(item.checkId);
            const valEl = document.getElementById(item.valId);

            if(checkEl) enables[item.key] = checkEl.checked;
            if(valEl) thresholds[item.key] = parseFloat(valEl.value) || 0;
        });

        const scoreSettings = {
            weights,
            thresholds,
            enables,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                scoreSettings: scoreSettings
            });
            console.log("✅ 設定儲存成功");
            alert("評分設定已儲存！");
        } catch(e) { 
            console.error("❌ 儲存失敗:", e); 
            alert("儲存失敗: " + e.message); 
        }
    },

    getDefaultValue: function(key) {
        const defaults = {
            fairness_off: 10, fairness_night: 10, fairness_weekend: 10,
            sat_pref: 15, sat_req: 10,
            fat_consec: 8, fat_night: 7, fat_rest: 5, fat_sd: 5,
            eff_gap: 8, eff_over: 4, eff_dist: 3,
            cost_over: 5
        };
        return defaults[key] || 0;
    }
};
