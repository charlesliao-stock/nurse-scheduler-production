// js/modules/score_settings_manager.js
// 🚀 完整版：連動計算 (細項 -> 大項 -> 總分)

const scoreSettingsManager = {
    currentUnitId: null,

    // 定義欄位對應關係與群組
    fieldMap: [
        // 1. 公平性 (Fairness)
        { checkId: 'metric_fairness_off', valId: 'val_fairness_off', key: 'fairness_off', group: 'fairness' },
        { checkId: 'metric_fairness_night', valId: 'val_fairness_night', key: 'fairness_night', group: 'fairness' },
        { checkId: 'metric_fairness_weekend', valId: 'val_fairness_weekend', key: 'fairness_weekend', group: 'fairness' },
        
        // 2. 滿意度 (Satisfaction)
        { checkId: 'metric_sat_pref', valId: 'val_sat_pref', key: 'sat_pref', group: 'satisfaction' },
        { checkId: 'metric_sat_req', valId: 'val_sat_req', key: 'sat_req', group: 'satisfaction' },
        
        // 3. 疲勞度 (Fatigue)
        { checkId: 'metric_fat_consec', valId: 'val_fat_consec', key: 'fat_consec', group: 'fatigue' },
        { checkId: 'metric_fat_night', valId: 'val_fat_night', key: 'fat_night', group: 'fatigue' },
        { checkId: 'metric_fat_rest', valId: 'val_fat_rest', key: 'fat_rest', group: 'fatigue' },
        { checkId: 'metric_fat_sd', valId: 'val_fat_sd', key: 'fat_sd', group: 'fatigue' },
        
        // 4. 排班效率 (Efficiency)
        { checkId: 'metric_eff_gap', valId: 'val_eff_gap', key: 'eff_gap', group: 'efficiency' },
        { checkId: 'metric_eff_over', valId: 'val_eff_over', key: 'eff_over', group: 'efficiency' },
        { checkId: 'metric_eff_dist', valId: 'val_eff_dist', key: 'eff_dist', group: 'efficiency' },
        
        // 5. 成本控制 (Cost)
        { checkId: 'metric_cost_over', valId: 'val_cost_over', key: 'cost_over', group: 'cost' }
    ],

    // 定義各群組對應的顯示 ID
    groupTargets: {
        'fairness': 'fairness_weight_display',
        'satisfaction': 'satisfaction_weight_display',
        'fatigue': 'fatigue_weight_display',
        'efficiency': 'efficiency_weight_display',
        'cost': 'cost_weight_display'
    },

    init: async function() {
        console.log("🎯 Score Settings Manager Init START");
        const container = document.getElementById('scoreSettingsContainer');
        if (container) container.style.display = 'none';

        await this.loadUnitDropdown();
        this.setupAutoSum(); // 啟動監聽器
        console.log("🎯 Score Settings Manager Init COMPLETE");
    },

    // --- [核心] 自動加總邏輯設定 ---
    setupAutoSum: function() {
        this.fieldMap.forEach(item => {
            // 監聽數值改變
            const valEl = document.getElementById(item.valId);
            if (valEl) {
                valEl.addEventListener('input', () => this.calculateAll());
            }
            // 監聽開關改變 (關閉時不計分)
            const checkEl = document.getElementById(item.checkId);
            if (checkEl) {
                checkEl.addEventListener('change', () => this.calculateAll());
            }
        });
    },

    // --- [核心] 計算所有分數 ---
    calculateAll: function() {
        let grandTotal = 0;
        const groupSums = { fairness: 0, satisfaction: 0, fatigue: 0, efficiency: 0, cost: 0 };

        // 1. 遍歷所有欄位，累加到對應群組
        this.fieldMap.forEach(item => {
            const checkEl = document.getElementById(item.checkId);
            const valEl = document.getElementById(item.valId);

            // 只有當 Checkbox 存在且被勾選時，才計算該分數
            if (checkEl && valEl && checkEl.checked) {
                const val = parseFloat(valEl.value) || 0;
                if (item.group && groupSums.hasOwnProperty(item.group)) {
                    groupSums[item.group] += val;
                }
            }
        });

        // 2. 更新各大項的顯示 Badge
        for (const [group, sum] of Object.entries(groupSums)) {
            const targetId = this.groupTargets[group];
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.innerText = sum + '%';
                grandTotal += sum; // 累加到總分
            }
        }

        // 3. 更新最上方的總分顯示
        const totalEl = document.getElementById('totalWeight');
        if (totalEl) {
            totalEl.innerText = grandTotal + '%';
            
            // 視覺回饋：若非 100%，顯示為橘色或紅色
            if (grandTotal === 100) {
                totalEl.style.color = '#2ecc71'; // 綠色 (OK)
            } else {
                totalEl.style.color = '#e74c3c'; // 紅色 (警告)
            }
        }
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
            
            const thresholds = data.thresholds || {};
            const enables = data.enables || {};
            // 注意：我們不再直接讀取 data.weights，而是由細項自動算出來

            this.fieldMap.forEach(item => {
                // 還原 Checkbox 狀態
                const checkEl = document.getElementById(item.checkId);
                if(checkEl) checkEl.checked = enables[item.key] !== false; // 預設 true

                // 還原 Input 數值
                const valEl = document.getElementById(item.valId);
                if(valEl) {
                    valEl.value = thresholds[item.key] !== undefined ? thresholds[item.key] : this.getDefaultValue(item.key);
                }
            });

            // 載入完成後，立即執行一次計算，更新所有 Badge 和總分
            this.calculateAll();
            
        } catch (e) { 
            console.error("❌ 載入設定失敗:", e);
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        // 取得目前的計算結果 (直接從畫面上抓取最準確)
        const getWeightVal = (id) => parseFloat(document.getElementById(id)?.innerText) || 0;

        // 這邊的 weights 將會是「自動加總」後的結果
        const weights = {
            fairness: getWeightVal('fairness_weight_display'),
            satisfaction: getWeightVal('satisfaction_weight_display'),
            fatigue: getWeightVal('fatigue_weight_display'),
            efficiency: getWeightVal('efficiency_weight_display'),
            cost: getWeightVal('cost_weight_display')
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
            weights,     // 儲存加總後的大項權重
            thresholds,  // 儲存各細項配分
            enables,     // 儲存開關狀態
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                scoreSettings: scoreSettings
            });
            alert("✅ 評分設定已儲存！");
        } catch(e) { 
            console.error("❌ 儲存失敗:", e); 
            alert("儲存失敗: " + e.message); 
        }
    },

    getDefaultValue: function(key) {
        const defaults = {
            fairness_off: 10, fairness_night: 10, fairness_weekend: 10, // 合計 30
            sat_pref: 15, sat_req: 10, // 合計 25
            fat_consec: 8, fat_night: 7, fat_rest: 5, fat_sd: 5, // 合計 25
            eff_gap: 8, eff_over: 4, eff_dist: 3, // 合計 15
            cost_over: 5 // 合計 5
        };
        // 預設總分 = 30+25+25+15+5 = 100
        return defaults[key] || 0;
    }
};
