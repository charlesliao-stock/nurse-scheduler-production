// js/modules/score_settings_manager.js
// 🚀 完整版：包含 5 大項、13 細項、Tiers 編輯與說明文字

const scoreSettingsManager = {
    currentUnitId: null,
    allSettings: {}, // 儲存從資料庫載入的設定
    standardLabels: ["極佳", "良好", "普通", "待進步", "極差"],

    // --- 1. 核心配置：定義 5 大項與 13 細項邏輯 ---
    config: {
        fairness: {
            label: "1. 公平性指標",
            displayId: 'fairness_weight_display',
            subs: {
                hoursDiff: {
                    label: "(1) 工時差異 (標準差)", desc: "所有員工工時與平均工時的標準差差異程度", weight: 10, enabled: true,
                    tiers: [{limit: 2, score: 100, label: "極佳"}, {limit: 4, score: 80, label: "良好"}, {limit: 6, score: 60, label: "普通"}, {limit: 8, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                },
                nightDiff: {
                    label: "(2) 夜班差異 (次)", desc: "員工之間夜班天數差異程度 (Max - Min)", weight: 10, enabled: true, excludeBatch: true,
                    tiers: [{limit: 1, score: 100, label: "極佳"}, {limit: 2, score: 80, label: "良好"}, {limit: 3, score: 60, label: "普通"}, {limit: 4, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                },
                holidayDiff: {
                    label: "(3) 假日差異 (天)", desc: "員工之間假日放假天數差異程度 (Max - Min)", weight: 10, enabled: true,
                    tiers: [{limit: 1, score: 100, label: "極佳"}, {limit: 2, score: 80, label: "良好"}, {limit: 3, score: 60, label: "普通"}, {limit: 4, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                }
            }
        },
        satisfaction: {
            label: "2. 滿意度指標",
            displayId: 'satisfaction_weight_display',
            subs: {
                prefRate: {
                    label: "(1) 排班偏好滿足度 (%)", desc: "排班的結果符合員工偏好的程度", weight: 15, enabled: true,
                    tiers: [{limit: 10, score: 100, label: "極佳"}, {limit: 20, score: 80, label: "良好"}, {limit: 30, score: 60, label: "普通"}, {limit: 40, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                },
                wishRate: {
                    label: "(2) 預班達成率 (%)", desc: "排假的結果符合員工預班OFF的程度", weight: 10, enabled: true,
                    tiers: [{limit: 5, score: 100, label: "極佳"}, {limit: 10, score: 80, label: "良好"}, {limit: 15, score: 60, label: "普通"}, {limit: 20, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                }
            }
        },
        fatigue: {
            label: "3. 疲勞度指標",
            displayId: 'fatigue_weight_display',
            subs: {
                consWork: {
                    label: "(1) 連續工作>6天 (人次)", desc: "最長連續工作天數達6天(以上)的人次次數", weight: 8, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 2, score: 80, label: "良好"}, {limit: 4, score: 60, label: "普通"}, {limit: 6, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                },
                nToD: {
                    label: "(2) 大夜接白 (次)", desc: "前一天大夜，隔天早班的次數", weight: 7, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 3, score: 80, label: "良好"}, {limit: 6, score: 60, label: "普通"}, {limit: 10, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                },
                offTargetRate: {
                    label: "(3) 休假達標率 (%)", desc: "符合應放天數規定的員工比例", weight: 5, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 5, score: 80, label: "良好"}, {limit: 10, score: 60, label: "普通"}, {limit: 15, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                },
                weeklyNight: {
                    label: "(4) 週夜班頻率 (SD)", desc: "每位員工週平均夜班次數的標準差", weight: 5, enabled: true, excludeBatch: true,
                    tiers: [{limit: 0.3, score: 100, label: "極佳"}, {limit: 0.5, score: 80, label: "良好"}, {limit: 0.7, score: 60, label: "普通"}, {limit: 1.0, score: 40, label: "待進步"}, {limit: 999, score: 20, label: "極差"}]
                }
            }
        },
        efficiency: {
            label: "4. 排班效率",
            displayId: 'efficiency_weight_display',
            subs: {
                shortageRate: {
                    label: "(1) 缺班率 (%)", desc: "未成功分配人員的班次比例", weight: 8, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 2, score: 80, label: "良好"}, {limit: 5, score: 60, label: "普通"}, {limit: 10, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                },
                seniorDist: {
                    label: "(2) 資深分佈合理性 (%)", desc: "各班至少1位年資2年以上員工", weight: 4, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 5, score: 80, label: "良好"}, {limit: 10, score: 60, label: "普通"}, {limit: 15, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                },
                juniorDist: {
                    label: "(3) 資淺分佈合理性 (%)", desc: "各班最多1位年資2年以下員工", weight: 3, enabled: true,
                    tiers: [{limit: 0, score: 100, label: "極佳"}, {limit: 10, score: 80, label: "良好"}, {limit: 20, score: 60, label: "普通"}, {limit: 30, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                }
            }
        },
        cost: {
            label: "5. 成本控制",
            displayId: 'cost_weight_display',
            subs: {
                overtimeRate: {
                    label: "(1) 加班費比率 (%)", desc: "加班班數佔總班數的比例", weight: 5, enabled: true,
                    tiers: [{limit: 3, score: 100, label: "極佳"}, {limit: 5, score: 80, label: "良好"}, {limit: 8, score: 60, label: "普通"}, {limit: 12, score: 40, label: "待進步"}, {limit: 100, score: 20, label: "極差"}]
                }
            }
        }
    },

    currentKey: null,
    tempTiers: [],

    // --- 2. 初始化與事件綁定 ---
    init: async function() {
        console.log("Score Settings Manager Initializing...");
        await this.loadUnitDropdown();
        this.setupEventListeners();
    },

    setupEventListeners: function() {
        // 當勾選開關或修改數值時，即時更新大項與總權重
        document.addEventListener('change', (e) => {
            if (e.target.id.startsWith('metric_') || e.target.id.startsWith('val_')) {
                this.calculateWeights();
            }
        });
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
        if(!select) return;
        select.innerHTML = '<option value=\"\">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole !== 'system_admin' && app.userUnitId) {
                query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snap = await query.get();
            select.innerHTML = '<option value=\"\">請選擇單位</option>';
            snap.forEach(doc => {
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = doc.data().name;
                select.appendChild(opt);
            });
            select.onchange = () => this.loadData();
        } catch(e) { console.error(\"Load Units Error:\", e); }
    },

    // --- 3. 載入資料並更新介面 ---
    loadData: async function() {
        const unitId = document.getElementById('scoreUnitSelect').value;
        if(!unitId) return;
        this.currentUnitId = unitId;

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data()?.scoreSettings || {};
            this.allSettings = data; // 保存完整物件 (包含 tiers)

            // 根據 config 渲染 UI 數值
            for (let groupKey in this.config) {
                const group = this.config[groupKey];
                for (let subKey in group.subs) {
                    const savedVal = data.thresholds?.[subKey];
                    const savedEnabled = data.enables?.[subKey];
                    
                    const valInput = document.getElementById(`val_${subKey}`);
                    const checkInput = document.getElementById(`metric_${subKey}`);

                    if (valInput) valInput.value = savedVal !== undefined ? savedVal : group.subs[subKey].weight;
                    if (checkInput) checkInput.checked = savedEnabled !== undefined ? savedEnabled : group.subs[subKey].enabled;
                }
            }
            this.calculateWeights();
            document.getElementById('scoreSettingsContainer').style.display = 'block';
        } catch(e) { console.error(\"Load Settings Error:\", e); }
    },

    // --- 4. 權重與加總邏輯 ---
    calculateWeights: function() {
        let grandTotal = 0;
        for (let groupKey in this.config) {
            let groupSum = 0;
            const group = this.config[groupKey];
            for (let subKey in group.subs) {
                const val = parseFloat(document.getElementById(`val_${subKey}`)?.value || 0);
                const isEnabled = document.getElementById(`metric_${subKey}`)?.checked;
                if (isEnabled) groupSum += val;
            }
            // 更新各卡片標題的大項總分
            const displayEl = document.getElementById(group.displayId);
            if (displayEl) displayEl.innerText = `${groupSum}%`;
            grandTotal += groupSum;
        }
        
        const totalEl = document.getElementById('totalWeight');
        if (totalEl) {
            totalEl.innerText = `${grandTotal}%`;
            totalEl.style.color = (grandTotal === 100) ? '#2ecc71' : '#e74c3c';
        }
    },

    // --- 5. 評分標準 (Tiers) 編輯彈窗操作 ---
    openGradingModal: function(subKey) {
        this.currentKey = subKey;
        const sub = this.findMetricInfo(subKey);
        
        document.getElementById('gradingTargetName').innerText = sub.label;
        document.getElementById('gradingTargetDesc').innerText = `說明：${sub.desc}`;

        // 優先讀取 DB 已存標準，否則使用預設配置
        this.tempTiers = JSON.parse(JSON.stringify(this.allSettings.tiers?.[subKey] || sub.tiers));
        this.renderTierRows();
        document.getElementById('gradingModal').classList.add('show');
    },

    renderTierRows: function() {
        const tbody = document.getElementById('gradingTableBody');
        tbody.innerHTML = '';
        this.tempTiers.forEach((tier, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type=\"number\" step=\"0.1\" class=\"metric-input\" style=\"width:100px\" value=\"${tier.limit}\" onchange=\"scoreSettingsManager.updateTier(${idx}, 'limit', this.value)\"></td>
                <td><input type=\"number\" class=\"metric-input\" style=\"width:80px\" value=\"${tier.score}\" onchange=\"scoreSettingsManager.updateTier(${idx}, 'score', this.value)\"></td>
                <td><input type=\"text\" class=\"metric-input\" style=\"width:120px\" value=\"${tier.label}\" onchange=\"scoreSettingsManager.updateTier(${idx}, 'label', this.value)\"></td>
                <td><button class=\"btn btn-delete btn-sm\" onclick=\"scoreSettingsManager.removeTier(${idx})\"><i class=\"fas fa-trash\"></i></button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    updateTier: function(idx, field, value) {
        this.tempTiers[idx][field] = (field === 'label') ? value : parseFloat(value);
    },

    addTierRow: function() {
        this.tempTiers.push({ limit: 999, score: 0, label: "新標籤" });
        this.renderTierRows();
    },

    removeTier: function(idx) {
        this.tempTiers.splice(idx, 1);
        this.renderTierRows();
    },

    saveTiers: function() {
        // 依照數值上限由小到大排序
        this.tempTiers.sort((a, b) => a.limit - b.limit);
        if (!this.allSettings.tiers) this.allSettings.tiers = {};
        this.allSettings.tiers[this.currentKey] = this.tempTiers;
        
        console.log(`✅ Tier updated for ${this.currentKey}`);
        this.closeGradingModal();
    },

    closeGradingModal: function() {
        document.getElementById('gradingModal').classList.remove('show');
    },

    // --- 6. 最終儲存至資料庫 ---
    saveData: async function() {
        if(!this.currentUnitId) return;

        const weights = {};
        const thresholds = {};
        const enables = {};

        // 整理目前介面上的權重與開關狀態
        for (let groupKey in this.config) {
            let groupSum = 0;
            for (let subKey in this.config[groupKey].subs) {
                const val = parseFloat(document.getElementById(`val_${subKey}`)?.value || 0);
                const isEnabled = document.getElementById(`metric_${subKey}`)?.checked;
                
                enables[subKey] = isEnabled;
                thresholds[subKey] = val;
                if (isEnabled) groupSum += val;
            }
            weights[groupKey] = groupSum;
        }

        const grandTotal = Object.values(weights).reduce((a, b) => a + b, 0);
        if (grandTotal !== 100 && !confirm(`目前總權重為 ${grandTotal}%，非 100%，確定要儲存嗎？`)) return;

        try {
            const dataToSave = {
                weights,
                thresholds,
                enables,
                tiers: this.allSettings.tiers || {}, // 包含手動調整過的評分階梯
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('units').doc(this.currentUnitId).update({ scoreSettings: dataToSave });
            alert(\"✅ 評分與標準配置儲存成功！\");
        } catch(e) {
            console.error(\"Save Data Error:\", e);
            alert(\"儲存失敗: \" + e.message);
        }
    },

    // 輔助工具：在 config 物件中搜尋細項
    findMetricInfo: function(key) {
        for (let g in this.config) {
            if (this.config[g].subs[key]) return this.config[g].subs[key];
        }
        return {};
    }
};
