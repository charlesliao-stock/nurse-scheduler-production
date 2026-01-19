// js/modules/score_settings_manager.js
const scoreSettingsManager = {
    currentUnitId: null,
    allSettings: {}, 
    
    config: {
        fairness: {
            label: "1. 公平性指標", displayId: 'fairness_weight_display',
            subs: {
                hoursDiff: { label: "(1) 工時差異 (標準差)", desc: "所有員工工時與平均工時的標準差差異程度", weight: 10, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 2, score: 4, label: "良好"}, {limit: 4, score: 3, label: "普通"}, {limit: 6, score: 2, label: "待改進"}, {limit: 8, score: 1, label: "極差"}] },
                nightDiff: { label: "(2) 夜班差異 (次)", desc: "員工之間夜班天數差異程度 (Max - Min)", weight: 10, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 1, score: 4, label: "良好"}, {limit: 2, score: 3, label: "普通"}, {limit: 3, score: 2, label: "待改進"}, {limit: 4, score: 1, label: "極差"}] },
                holidayDiff: { label: "(3) 假日差異 (天)", desc: "員工之間假日放假天數差異程度 (Max - Min)", weight: 10, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 1, score: 4, label: "良好"}, {limit: 2, score: 3, label: "普通"}, {limit: 3, score: 2, label: "待改進"}, {limit: 4, score: 1, label: "極差"}] }
            }
        },
        satisfaction: {
            label: "2. 滿意度指標", displayId: 'satisfaction_weight_display',
            subs: {
                prefRate: { label: "(1) 排班偏好滿足度 (%)", desc: "符合員工偏好的程度", weight: 15, tiers: [{limit: 90, score: 5, label: "極佳"}, {limit: 80, score: 4, label: "良好"}, {limit: 70, score: 3, label: "普通"}, {limit: 60, score: 2, label: "待改進"}, {limit: 0, score: 1, label: "極差"}] },
                wishRate: { label: "(2) 預班達成率 (%)", desc: "符合員工預班OFF的程度", weight: 10, tiers: [{limit: 95, score: 5, label: "極佳"}, {limit: 90, score: 4, label: "良好"}, {limit: 85, score: 3, label: "普通"}, {limit: 80, score: 2, label: "待改進"}, {limit: 0, score: 1, label: "極差"}] }
            }
        },
        fatigue: {
            label: "3. 疲勞度指標", displayId: 'fatigue_weight_display',
            subs: {
                consWork: { label: "(1) 連續工作>6天 (人次)", desc: "最長連續工作天數達6天(以上)的人次", weight: 8, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 1, score: 4, label: "良好"}, {limit: 3, score: 3, label: "普通"}, {limit: 5, score: 2, label: "待改進"}, {limit: 10, score: 1, label: "極差"}] },
                nToD: { label: "(2) 大夜接白 (次)", desc: "前一天大夜，隔天早班的次數", weight: 7, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 1, score: 4, label: "良好"}, {limit: 3, score: 3, label: "普通"}, {limit: 5, score: 2, label: "待改進"}, {limit: 10, score: 1, label: "極差"}] },
                offTargetRate: { label: "(3) 休假達標率 (%)", desc: "符合應放天數規定的員工比例", weight: 5, tiers: [{limit: 100, score: 5, label: "極佳"}, {limit: 95, score: 4, label: "良好"}, {limit: 90, score: 3, label: "普通"}, {limit: 85, score: 2, label: "待改進"}, {limit: 0, score: 1, label: "極差"}] },
                weeklyNight: { label: "(4) 週夜班頻率 (SD)", desc: "每位員工週平均夜班次數的標準差", weight: 5, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 0.3, score: 4, label: "良好"}, {limit: 0.5, score: 3, label: "普通"}, {limit: 0.7, score: 2, label: "待改進"}, {limit: 1.0, score: 1, label: "極差"}] }
            }
        },
        efficiency: {
            label: "4. 排班效率", displayId: 'efficiency_weight_display',
            subs: {
                shortageRate: { label: "(1) 缺班率 (%)", desc: "未成功分配人員的班次比例", weight: 8, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 2, score: 4, label: "良好"}, {limit: 5, score: 3, label: "普通"}, {limit: 10, score: 2, label: "待改進"}, {limit: 20, score: 1, label: "極差"}] },
                seniorDist: { label: "(2) 資深分佈 (%)", desc: "各班至少1位年資2年以上員工", weight: 4, tiers: [{limit: 100, score: 5, label: "極佳"}, {limit: 95, score: 4, label: "良好"}, {limit: 90, score: 3, label: "普通"}, {limit: 85, score: 2, label: "待改進"}, {limit: 0, score: 1, label: "極差"}] },
                juniorDist: { label: "(3) 資淺分佈 (%)", desc: "各班最多1位年資2年以下員工", weight: 3, tiers: [{limit: 100, score: 5, label: "極佳"}, {limit: 90, score: 4, label: "良好"}, {limit: 80, score: 3, label: "普通"}, {limit: 70, score: 2, label: "待改進"}, {limit: 0, score: 1, label: "極差"}] }
            }
        },
        cost: {
            label: "5. 成本控制", displayId: 'cost_weight_display',
            subs: {
                overtimeRate: { label: "(1) 加班費比率 (%)", desc: "加班班數佔總班數比例", weight: 5, tiers: [{limit: 0, score: 5, label: "極佳"}, {limit: 3, score: 4, label: "良好"}, {limit: 5, score: 3, label: "普通"}, {limit: 8, score: 2, label: "待改進"}, {limit: 12, score: 1, label: "極差"}] }
            }
        }
    },

    init: async function() {
        console.log("Score Settings Manager Loaded.");
        await this.loadUnitDropdown();
        document.addEventListener('change', (e) => {
            if (e.target.id.startsWith('metric_') || e.target.id.startsWith('val_')) {
                this.calculateWeights();
            }
        });
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole !== 'system_admin' && app.userUnitId) {
                query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snap = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snap.forEach(doc => {
                const opt = document.createElement('option');
                opt.value = doc.id; opt.textContent = doc.data().name;
                select.appendChild(opt);
            });
            select.onchange = () => this.loadData();
        } catch(e) { console.error("Load Units Error:", e); }
    },

    loadData: async function() {
        const unitId = document.getElementById('scoreUnitSelect').value;
        if(!unitId) return;
        this.currentUnitId = unitId;

        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data()?.scoreSettings || {};
            this.allSettings = data;

            this.renderUI();

            for (let group in this.config) {
                for (let sub in this.config[group].subs) {
                    const savedVal = data.thresholds?.[sub];
                    const savedEnabled = data.enables?.[sub];
                    if (savedVal !== undefined) document.getElementById(`val_${sub}`).value = savedVal;
                    if (savedEnabled !== undefined) document.getElementById(`metric_${sub}`).checked = savedEnabled;
                }
            }
            this.calculateWeights();
            document.getElementById('scoreSettingsContainer').style.display = 'block';
        } catch(e) { console.error("Load Data Error:", e); }
    },

    renderUI: function() {
        for (let group in this.config) {
            const container = document.getElementById(`metrics_${group}`);
            if (!container) continue;
            container.innerHTML = '';
            for (let subKey in this.config[group].subs) {
                const sub = this.config[group].subs[subKey];
                container.innerHTML += `
                    <div class="metric-item">
                        <div class="metric-header">
                            <label class="switch"><input type="checkbox" id="metric_${subKey}" checked><span class="slider"></span></label>
                            <span class="metric-name">${sub.label}<i class="fas fa-question-circle tip-icon" title="${sub.desc}"></i></span>
                            <button class="btn-standard" onclick="scoreSettingsManager.openGradingModal('${subKey}')">評分標準</button>
                        </div>
                        <div class="metric-value"><input type="number" id="val_${subKey}" class="metric-input" value="${sub.weight}"> %</div>
                    </div>`;
            }
        }
    },

    calculateWeights: function() {
        let grandTotal = 0;
        for (let groupKey in this.config) {
            let groupSum = 0;
            for (let sub in this.config[groupKey].subs) {
                const val = parseFloat(document.getElementById(`val_${sub}`)?.value || 0);
                if (document.getElementById(`metric_${sub}`)?.checked) groupSum += val;
            }
            document.getElementById(this.config[groupKey].displayId).innerText = `${groupSum}%`;
            grandTotal += groupSum;
        }
        const totalEl = document.getElementById('totalWeight');
        totalEl.innerText = `${grandTotal}%`;
        totalEl.style.color = (grandTotal === 100) ? '#2ecc71' : '#e74c3c';
    },

    openGradingModal: function(key) {
        this.currentKey = key;
        const sub = this.findMetric(key);
        document.getElementById('gradingTargetName').innerText = sub.label;
        document.getElementById('gradingTargetDesc').innerText = sub.desc;
        this.tempTiers = JSON.parse(JSON.stringify(this.allSettings.tiers?.[key] || sub.tiers));
        this.renderTierRows();
        document.getElementById('gradingModal').classList.add('show');
    },

    renderTierRows: function() {
        const tbody = document.getElementById('gradingTableBody');
        tbody.innerHTML = '';
        // 渲染時按 limit 由大到小排序，方便使用者理解 >= 邏輯
        this.tempTiers.sort((a, b) => b.limit - a.limit);
        this.tempTiers.forEach((t, i) => {
            tbody.innerHTML += `
                <tr>
                    <td><input type="number" step="0.1" class="metric-input" value="${t.limit}" onchange="scoreSettingsManager.updateTier(${i},'limit',this.value)"></td>
                    <td><input type="number" class="metric-input" value="${t.score}" onchange="scoreSettingsManager.updateTier(${i},'score',this.value)"></td>
                    <td><input type="text" class="metric-input" value="${t.label}" onchange="scoreSettingsManager.updateTier(${i},'label',this.value)"></td>
                    <td><button class="btn btn-delete btn-sm" onclick="scoreSettingsManager.removeTier(${i})">×</button></td>
                </tr>`;
        });
    },

    updateTier: function(i, f, v) { this.tempTiers[i][f] = (f==='label')? v : parseFloat(v); },
    addTierRow: function() { this.tempTiers.push({limit:99, score:1, label:"新區間"}); this.renderTierRows(); },
    removeTier: function(i) { this.tempTiers.splice(i, 1); this.renderTierRows(); },
    saveTiers: function() {
        if(!this.allSettings.tiers) this.allSettings.tiers = {};
        // 儲存時按 limit 由大到小排序
        this.tempTiers.sort((a,b) => b.limit - a.limit);
        this.allSettings.tiers[this.currentKey] = this.tempTiers;
        this.closeGradingModal();
    },
    closeGradingModal: function() { document.getElementById('gradingModal').classList.remove('show'); },

    saveData: async function() {
        if(!this.currentUnitId) return;
        const thresholds = {}; const enables = {};
        for (let g in this.config) {
            for (let s in this.config[g].subs) {
                thresholds[s] = parseFloat(document.getElementById(`val_${s}`).value);
                enables[s] = document.getElementById(`metric_${s}`).checked;
            }
        }
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                scoreSettings: { thresholds, enables, tiers: this.allSettings.tiers || {}, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }
            });
            alert("儲存成功！");
        } catch(e) { alert("失敗: " + e.message); }
    },

    findMetric: function(key) {
        for (let g in this.config) if (this.config[g].subs[key]) return this.config[g].subs[key];
        return null;
    }
};
