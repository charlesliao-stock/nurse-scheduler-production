// js/modules/scoring_manager.js
// 🚀 最終強化版：具備結構防呆機制，解決 'efficiency' undefined 報錯
// 修正：嚴格遵循 score_settings_manager.js 的啟用狀態與權重配分

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

    // 內部工具：確保設定結構完整
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
        const settings = this.currentSettings || this.getDefaultSettings();
        const enables = settings.enables || {};
        const daysInMonth = new Date(year, month, 0).getDate();

        // 定義大項與其對應的子項 key
        const metricMap = {
            fairness: ['hoursDiff', 'nightDiff', 'holidayDiff'],
            satisfaction: ['prefRate', 'wishRate'],
            fatigue: ['consWork', 'nToD', 'offTargetRate', 'weeklyNight'],
            efficiency: ['shortageRate', 'seniorDist', 'juniorDist'],
            cost: ['overtimeRate']
        };

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
            // 檢查該大項是否有任何子項被啟用
            const subKeys = metricMap[key] || [];
            const isAnySubEnabled = subKeys.some(sk => enables[sk] === true);

            if (isAnySubEnabled) {
                // 根據啟用的子項權重總和作為該大項的權重
                let groupWeight = 0;
                subKeys.forEach(sk => {
                    if (enables[sk]) {
                        groupWeight += parseFloat(settings.thresholds?.[sk] || 0);
                    }
                });

                if (groupWeight > 0) {
                    totalWeightedScore += (results[key] * groupWeight);
                    totalWeight += groupWeight;
                }
            } else {
                // 如果該大項完全沒啟用，分數設為 0 或 null，避免干擾介面
                results[key] = 0;
            }
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
        return scores.length ? this.average(scores) : 0;
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
        // prefRate 邏輯可在此擴充
        return scores.length ? this.average(scores) : 0;
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
        // nToD, offTargetRate, weeklyNight 邏輯可在此擴充
        return scores.length ? this.average(scores) : 0;
    },

    calculateEfficiency: function(scheduleData, staffList, days, settings) { 
        const enables = settings.enables || {};
        if (enables.shortageRate || enables.seniorDist || enables.juniorDist) {
            return 4.0; // 暫時回傳預設值，未來可實作具體邏輯
        }
        return 0; 
    },

    calculateCost: function(scheduleData, staffList, days, settings) { 
        const enables = settings.enables || {};
        if (enables.overtimeRate) {
            return 4.5; // 暫時回傳預設值，未來可實作具體邏輯
        }
        return 0; 
    },

    // --- 4. 輔助工具 ---

    getScoreByTier: function(value, tierList) {
        if (!tierList || !tierList.length) return 3;
        // 改為 >= 邏輯：由大到小排序，找到第一個符合 value >= limit 的區間
        const sorted = [...tierList].sort((a, b) => b.limit - a.limit);
        for (let t of sorted) {
            if (value >= t.limit) return t.score;
        }
        // 如果都不符合（比最小的下限還小），回傳最後一個（最小）的分數
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

    average: arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,

    getDefaultSettings: function() {
        return {
            weights: { fairness: 30, satisfaction: 25, fatigue: 20, efficiency: 15, cost: 10 },
            enables: {
                hoursDiff: true, nightDiff: true, holidayDiff: true,
                wishRate: true, consWork: true
            },
            thresholds: {
                hoursDiff: 10, nightDiff: 10, holidayDiff: 10,
                prefRate: 15, wishRate: 10,
                consWork: 8, nToD: 7, offTargetRate: 5, weeklyNight: 5,
                shortageRate: 8, seniorDist: 4, juniorDist: 3,
                overtimeRate: 5
            },
            tiers: {}
        };
    }
};
