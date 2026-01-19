// js/modules/score_settings_manager.js
// 🔧 自動加總修正版

const scoreSettingsManager = {
    currentUnitId: null,

    // 定義欄位對應關係
    fieldMap: [
        // 1. 公平性 (我們將針對這三個做連動)
        { checkId: 'metric_fairness_off', valId: 'val_fairness_off', key: 'fairness_off', group: 'fairness' },
        { checkId: 'metric_fairness_night', valId: 'val_fairness_night', key: 'fairness_night', group: 'fairness' },
        { checkId: 'metric_fairness_weekend', valId: 'val_fairness_weekend', key: 'fairness_weekend', group: 'fairness' },
        
        // 2. 滿意度
        { checkId: 'metric_sat_pref', valId: 'val_sat_pref', key: 'sat_pref', group: 'satisfaction' },
        { checkId: 'metric_sat_req', valId: 'val_sat_req', key: 'sat_req', group: 'satisfaction' },
        
        // 其他指標... (略)
        { checkId: 'metric_fat_consec', valId: 'val_fat_consec', key: 'fat_consec' },
        { checkId: 'metric_fat_night', valId: 'val_fat_night', key: 'fat_night' },
        { checkId: 'metric_fat_rest', valId: 'val_fat_rest', key: 'fat_rest' },
        { checkId: 'metric_fat_sd', valId: 'val_fat_sd', key: 'fat_sd' },
        { checkId: 'metric_eff_gap', valId: 'val_eff_gap', key: 'eff_gap' },
        { checkId: 'metric_eff_over', valId: 'val_eff_over', key: 'eff_over' },
        { checkId: 'metric_eff_dist', valId: 'val_eff_dist', key: 'eff_dist' },
        { checkId: 'metric_cost_over', valId: 'val_cost_over', key: 'cost_over' }
    ],

    init: async function() {
        console.log("🎯 Score Settings Manager Init START");
        const container = document.getElementById('scoreSettingsContainer');
        if (container) container.style.display = 'none';

        await this.loadUnitDropdown();
        this.setupAutoSum(); // <--- [新增] 啟動自動加總監聽
        console.log("🎯 Score Settings Manager Init COMPLETE");
    },

    // --- [新增] 自動加總邏輯 ---
    setupAutoSum: function() {
        // 定義要連動的群組
        const groups = {
            'fairness': { ids: ['val_fairness_off', 'val_fairness_night', 'val_fairness_weekend'], target: 'fairness_weight_display' },
            'satisfaction': { ids: ['val_sat_pref', 'val_sat_req'], target: 'satisfaction_weight_display' }
            // 您可以依此類推增加其他群組
        };

        Object.keys(groups).forEach(groupKey => {
            const config = groups[groupKey];
            const targetEl = document.getElementById(config.target);
            
            if (!targetEl) return;

            // 為每個輸入框綁定事件
            config.ids.forEach(inputId => {
                const inputEl = document.getElementById(inputId);
                if (inputEl) {
                    inputEl.addEventListener('input', () => {
                        this.calculateGroupSum(config.ids, targetEl);
                    });
                }
            });
        });
    },

    // --- [新增] 計算總和並更新顯示 ---
    calculateGroupSum: function(inputIds, targetElement) {
        let sum = 0;
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                sum += parseFloat(el.value) || 0;
            }
        });
        // 更新右上角的顯示文字
        targetElement.innerText = sum + '%';
        
        // 更新總權重顯示 (所有大項加總)
        this.calculateTotalWeight();
    },

    calculateTotalWeight: function() {
        // 這裡可以實作將所有大類別 (10% + 25%...) 加總顯示在最上方的邏輯
        // 暫時略過，視您需求而定
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
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

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change'));
            }

            select.onchange = () => this.onUnitChange();

        } catch (e) { 
            console.error("❌ 載入單位列表失敗:", e);
        }
    },

    onUnitChange: async function() {
        const select = document.getElementById('scoreUnitSelect');
        this.currentUnitId = select.value;
        const container = document.getElementById('scoreSettingsContainer');

        if(this.currentUnitId) {
            if(container) container.style.display = 'block';
            await this.loadSettings();
        } else {
            if(container) container.style.display = 'none';
        }
    },

    loadSettings: async function() {
        if(!this.currentUnitId) return;
        
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            const data = doc.data().scoreSettings || {};
            
            // 載入數值
            const thresholds = data.thresholds || {};
            const enables = data.enables || {};
            const weights = data.weights || {};

            this.fieldMap.forEach(item => {
                // Checkbox
                const checkEl = document.getElementById(item.checkId);
                if(checkEl) checkEl.checked = enables[item.key] !== false;

                // Input Value
                const valEl = document.getElementById(item.valId);
                if(valEl) {
                    valEl.value = thresholds[item.key] !== undefined ? thresholds[item.key] : this.getDefaultValue(item.key);
                }
            });

            // --- [修改] 載入後立即觸發一次計算，確保畫面同步 ---
            // 這會覆蓋掉原本直接讀取 weights 的邏輯，改由下方細項加總決定
            const fairnessIds = ['val_fairness_off', 'val_fairness_night', 'val_fairness_weekend'];
            const fairnessTarget = document.getElementById('fairness_weight_display');
            if(fairnessTarget) this.calculateGroupSum(fairnessIds, fairnessTarget);

            const satIds = ['val_sat_pref', 'val_sat_req'];
            const satTarget = document.getElementById('satisfaction_weight_display');
            if(satTarget) this.calculateGroupSum(satIds, satTarget);

            // 其他類別如果沒有細項加總邏輯，維持原樣讀取
            const setWeight = (id, val) => {
                const el = document.getElementById(id);
                if(el) el.innerText = (val || 0) + '%';
            };
            setWeight('fatigue_weight_display', weights.fatigue || 25);
            setWeight('efficiency_weight_display', weights.efficiency || 15);
            setWeight('cost_weight_display', weights.cost || 5);
            
        } catch (e) { 
            console.error("❌ 載入設定失敗:", e);
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        // --- [修改] 儲存時，權重(weights) 應該是當前畫面上顯示的加總值 ---
        const getWeightVal = (id) => parseInt(document.getElementById(id)?.innerText) || 0;

        const weights = {
            fairness: getWeightVal('fairness_weight_display'),      // 儲存加總後的值
            satisfaction: getWeightVal('satisfaction_weight_display'), // 儲存加總後的值
            fatigue: 25,   // 暫時寫死或另增輸入框
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
