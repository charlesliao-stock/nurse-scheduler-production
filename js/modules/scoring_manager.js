// js/modules/scoring_manager.js
// 🚀 最終強化版：具備結構防呆機制，解決 'efficiency' undefined 報錯

const scoringManager = {
    aiBaseScore: null,     // 記錄 AI 剛排完的原始分數
    currentSettings: null, // 當前單位的評分設定

    // --- 1. 資料初始化與設定載入 ---

    loadSettings: async function(unitId) {
        if(!unitId) {
            this.currentSettings = this.getDefaultSettings();
            return;
        }
        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            
            // 修正點：確保 scoreSettings 及其內部的 weights 存在
            if(doc.exists && data && data.scoreSettings) {
                this.currentSettings = this.ensureSettingsStructure(data.scoreSettings);
                console.log("✅ 評分模組：已載入單位自訂設定");
            } else {
                this.currentSettings = this.getDefaultSettings();
                console.log("⚠️ 評分模組：找不到設定，使用系統預設值");
            }
        } catch(e) {
            console.error("❌ 載入評分設定失敗:", e);
            this.currentSettings = this.getDefaultSettings();
        }
    },

    // 內部工具：確保設定結構完整，避免讀取 weights.efficiency 時報錯
    ensureSettingsStructure: function(s) {
        const d = this.getDefaultSettings();
        return {
            weights: s.weights || d.weights,
            thresholds: s.thresholds || d.thresholds,
            enables: s.enables || d.enables,
            tiers: s.tiers || d.tiers
        };
    },

    setBase: function(score) {
        this.aiBaseScore = (score && typeof score === 'object') ? score.total : score;
        console.log("📍 已設定 AI 原始基準分:", this.aiBaseScore);
    },

    getScoreDiff: function(currentScore) {
        if (this.aiBaseScore === null || typeof currentScore !== 'number') return null;
        const diff = currentScore - this.aiBaseScore;
        return Math.round(diff * 10) / 10;
    },

    // --- 2. 核心計算引擎 (calculate) ---

    calculate: function(scheduleData, staffList, year, month) {
        // 確保 settings 存在且 weights 不會為 undefined
        const settings = this.currentSettings || this.getDefaultSettings();
        const weights = settings.weights || {};
        
        const daysInMonth = new Date(year, month, 0).getDate();

        const results = {
            fairness: this.calculateFairness(scheduleData, staffList, year, month, daysInMonth, settings),
            satisfaction: this.calculateSatisfaction(scheduleData, staffList, daysInMonth, settings),
            fatigue: this.calculateFatigue(scheduleData, staffList, daysInMonth, settings),
            efficiency: this.calculateEfficiency(scheduleData, staffList, daysInMonth, settings),
            cost: this.calculateCost(scheduleData, staffList, daysInMonth, settings)
        };

        let totalWeightedScore = 0;
        let totalWeight = 0;

        for (let key in results) {
            // 使用 || 0 確保就算 weights[key] 不存在也不會出錯
            const w = parseFloat(weights[key] || 0);
            totalWeightedScore += (results[key] * w);
            totalWeight += w;
        }

        const finalScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) : 0;

        return {
            total: Math.round(finalScore * 10) / 10,
            breakdown: results
        };
    },

    // --- 3. 指標演算法 ---

    calculateFairness: function(scheduleData, staffList, year, month, days, settings) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};

        if (enables.hoursDiff) {
            const hours = staffList.map(s => this.sumWorkHours(scheduleData[s.uid]));
            scores.push(this.getScoreByTier(this.getStdDev(hours), tiers.hoursDiff));
        }
        if (enables.nightDiff) {
            const counts = staffList.map(s => this.countShifts(scheduleData[s.uid], ['N', 'EN', 'AN']));
            const diff = Math.max(...counts) - Math.min(...counts);
            scores.push(this.getScoreByTier(diff, tiers.nightDiff));
        }
        if (enables.holidayDiff) {
            const holidayOffs = staffList.map(s => this.countHolidayOff(scheduleData[s.uid], year, month, days));
            const diff = Math.max(...holidayOffs) - Math.min(...holidayOffs);
            scores.push(this.getScoreByTier(diff, tiers.holidayDiff));
        }
        return scores.length ? this.average(scores) : 5;
    },

    calculateSatisfaction: function(scheduleData, staffList, days, settings) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};

        if (enables.wishRate) {
            let totalReq = 0, hit = 0;
            staffList.forEach(s => {
                const params = s.schedulingParams || {};
                for (let d=1; d<=days; d++) {
                    if (params[`current_${d}`] === 'REQ_OFF') {
                        totalReq++;
                        if (scheduleData[s.uid]?.[`current_${d}`] === 'OFF') hit++;
                    }
                }
            });
            const failRate = totalReq === 0 ? 0 : ((totalReq - hit) / totalReq) * 100;
            scores.push(this.getScoreByTier(failRate, tiers.wishRate)); 
        }
        return scores.length ? this.average(scores) : 5;
    },

    calculateFatigue: function(scheduleData, staffList, days, settings) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};

        if (enables.consWork) {
            let totalVio = 0;
            staffList.forEach(s => {
                let cons = 0;
                for (let d=1; d<=days; d++) {
                    const shift = scheduleData[s.uid]?.[`current_${d}`];
                    if (shift && shift !== 'OFF') {
                        cons++; if (cons > 6) totalVio++;
                    } else cons = 0;
                }
            });
            scores.push(this.getScoreByTier(totalVio, tiers.consWork));
        }
        return scores.length ? this.average(scores) : 5;
    },

    calculateEfficiency: function() { return 4.0; },
    calculateCost: function() { return 4.5; },

    // --- 4. 輔助工具 ---

    getScoreByTier: function(value, tierList) {
        if (!tierList || !tierList.length) return 3;
        const sorted = [...tierList].sort((a, b) => a.limit - b.limit);
        for (let t of sorted) {
            if (value <= t.limit) return t.score;
        }
        return sorted[sorted.length - 1].score;
    },

    getStdDev: function(array) {
        const n = array.length;
        if (n <= 1) return 0;
        const mean = array.reduce((a, b) => a + b) / n;
        return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    },

    sumWorkHours: function(assign) {
        if (!assign) return 0;
        return Object.values(assign).filter(v => v !== 'OFF' && v !== 'REQ_OFF').length * 8;
    },

    countShifts: function(assign, codes) {
        if (!assign) return 0;
        return Object.values(assign).filter(v => codes.includes(v)).length;
    },

    countHolidayOff: function(assign, year, month, days) {
        if (!assign) return 0;
        let count = 0;
        for (let d=1; d<=days; d++) {
            const date = new Date(year, month - 1, d);
            const day = date.getDay();
            if (day === 0 || day === 6) { 
                const v = assign[`current_${d}`];
                if (v === 'OFF' || v === 'REQ_OFF') count++;
            }
        }
        return count;
    },

    average: arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 5,

    getDefaultSettings: function() {
        return {
            weights: { fairness: 30, satisfaction: 25, fatigue: 20, efficiency: 15, cost: 10 },
            enables: {},
            thresholds: {},
            tiers: {}
        };
    }
};
