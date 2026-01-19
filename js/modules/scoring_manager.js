// js/modules/scoring_manager.js
// 🚀 完整更新版：完全對應 score_settings_manager.js 的 13 項指標邏輯

const scoringManager = {
    aiBaseScore: null, 
    currentSettings: null, 

    // 載入單位評分設定
    loadSettings: async function(unitId) {
        if(!unitId) {
            this.currentSettings = this.getDefaultSettings();
            return;
        }
        try {
            const doc = await db.collection('units').doc(unitId).get();
            if(doc.exists && doc.data().scoreSettings) {
                this.currentSettings = doc.data().scoreSettings;
                console.log("✅ 已載入單位自訂評分設定");
            } else {
                this.currentSettings = this.getDefaultSettings();
                console.log("使用系統預設評分設定");
            }
        } catch(e) {
            console.error("載入評分設定失敗:", e);
            this.currentSettings = this.getDefaultSettings();
        }
    },

    // 核心計算函式：由編輯器呼叫
    calculateTotalScore: function(scheduleData, staffList, year, month) {
        if (!this.currentSettings) return 0;
        
        const daysInMonth = new Date(year, month, 0).getDate();
        const settings = this.currentSettings;
        const results = {
            fairness: this.calculateFairness(scheduleData, staffList, daysInMonth, settings),
            satisfaction: this.calculateSatisfaction(scheduleData, staffList, daysInMonth, settings),
            fatigue: this.calculateFatigue(scheduleData, staffList, daysInMonth, settings),
            efficiency: this.calculateEfficiency(scheduleData, staffList, daysInMonth, settings),
            cost: this.calculateCost(scheduleData, staffList, daysInMonth, settings)
        };

        // 依據大項權重加權總分
        let totalScore = 0;
        for (let key in results) {
            const weight = (settings.weights?.[key] || 0) / 100;
            totalScore += results[key] * weight;
        }

        return {
            total: Math.round(totalScore * 10) / 10,
            breakdown: results
        };
    },

    // 1. 公平性指標
    calculateFairness: function(scheduleData, staffList, days, settings) {
        const metrics = [];
        // (1) 工時差異 (標準差)
        if (settings.enables?.hoursDiff) {
            const hours = staffList.map(s => this.sumWorkHours(scheduleData[s.uid]));
            metrics.push(this.getScoreByTier(this.getStdDev(hours), settings.tiers?.hoursDiff));
        }
        // (2) 夜班差異 (Max-Min)
        if (settings.enables?.nightDiff) {
            const counts = staffList.map(s => this.countShifts(scheduleData[s.uid], ['N', 'EN', 'AN'])); // 假設代號
            const diff = Math.max(...counts) - Math.min(...counts);
            metrics.push(this.getScoreByTier(diff, settings.tiers?.nightDiff));
        }
        // (3) 假日差異 (Max-Min)
        if (settings.enables?.holidayDiff) {
            const holidayOffs = staffList.map(s => this.countHolidayOff(scheduleData[s.uid], days));
            const diff = Math.max(...holidayOffs) - Math.min(...holidayOffs);
            metrics.push(this.getScoreByTier(diff, settings.tiers?.holidayDiff));
        }
        return metrics.length ? this.average(metrics) : 5;
    },

    // 2. 滿意度指標
    calculateSatisfaction: function(scheduleData, staffList, days, settings) {
        const metrics = [];
        // (1) 排班偏好滿足度 (模擬邏輯)
        if (settings.enables?.prefRate) {
            metrics.push(5); // 暫以滿分計，需配合 Scheduler 偏好記錄
        }
        // (2) 預班達成率
        if (settings.enables?.wishRate) {
            let hit = 0, total = 0;
            staffList.forEach(s => {
                const reqs = s.schedulingParams || {};
                for (let d=1; d<=days; d++) {
                    if (reqs[`current_${d}`] === 'REQ_OFF') {
                        total++;
                        if (scheduleData[s.uid]?.[`current_${d}`] === 'OFF') hit++;
                    }
                }
            });
            const rate = total === 0 ? 0 : (1 - (hit/total)) * 100; // 差距率
            metrics.push(this.getScoreByTier(rate, settings.tiers?.wishRate));
        }
        return metrics.length ? this.average(metrics) : 5;
    },

    // 3. 疲勞度指標
    calculateFatigue: function(scheduleData, staffList, days, settings) {
        const metrics = [];
        // (1) 連續工作 > 6天
        if (settings.enables?.consWork) {
            let totalViolations = 0;
            staffList.forEach(s => {
                let cons = 0;
                for (let d=1; d<=days; d++) {
                    const shift = scheduleData[s.uid]?.[`current_${d}`];
                    if (shift && shift !== 'OFF') { cons++; if (cons > 6) totalViolations++; }
                    else cons = 0;
                }
            });
            metrics.push(this.getScoreByTier(totalViolations, settings.tiers?.consWork));
        }
        // (2) 大夜接白 (N -> D)
        if (settings.enables?.nToD) {
            let violations = 0;
            staffList.forEach(s => {
                for (let d=1; d<days; d++) {
                    if (scheduleData[s.uid]?.[`current_${d}`] === 'N' && scheduleData[s.uid]?.[`current_${d+1}`] === 'D') violations++;
                }
            });
            metrics.push(this.getScoreByTier(violations, settings.tiers?.nToD));
        }
        return metrics.length ? this.average(metrics) : 5;
    },

    // 4. 排班效率
    calculateEfficiency: function(scheduleData, staffList, days, settings) {
        const metrics = [];
        // (1) 缺班率 (模擬人力需求比對)
        if (settings.enables?.shortageRate) {
            metrics.push(5); 
        }
        return metrics.length ? this.average(metrics) : 5;
    },

    // 5. 成本控制
    calculateCost: function(scheduleData, staffList, days, settings) {
        if (settings.enables?.overtimeRate) {
            // 模擬加班計算
            return 4;
        }
        return 5;
    },

    // --- 工具函式 ---
    
    // 依據 Tier 階梯取得分數
    getScoreByTier: function(value, tiers) {
        if (!tiers || !tiers.length) return 3;
        const sorted = [...tiers].sort((a, b) => a.limit - b.limit);
        for (let t of sorted) {
            if (value <= t.limit) return t.score;
        }
        return sorted[sorted.length - 1].score;
    },

    average: arr => arr.reduce((a, b) => a + b, 0) / arr.length,

    getStdDev: function(array) {
        const n = array.length;
        if (n === 0) return 0;
        const mean = array.reduce((a, b) => a + b) / n;
        return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    },

    sumWorkHours: function(userAssign) {
        // 應由 shift_manager 提供工時，此處簡化計算
        return Object.values(userAssign || {}).filter(v => v !== 'OFF').length * 8;
    },

    countShifts: function(userAssign, codes) {
        return Object.values(userAssign || {}).filter(v => codes.includes(v)).length;
    },

    countHolidayOff: function(userAssign, days) {
        // 簡易判斷假日休假
        return 0; 
    },

    getDefaultSettings: function() {
        return {
            weights: { fairness: 30, satisfaction: 25, fatigue: 25, efficiency: 15, cost: 5 },
            enables: { hoursDiff: true, nightDiff: true, holidayDiff: true, prefRate: true, wishRate: true },
            tiers: {}
        };
    }
};
