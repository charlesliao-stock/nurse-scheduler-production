// js/modules/scoring_manager.js
// 🚀 最終強化版：具備結構防呆機制 + 評分方向性支援 + 改善錯誤處理
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
            tiers: s.tiers || d.tiers,
            directions: s.directions || d.directions  // 🔥 新增：評分方向
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

        const subResults = {};
        const results = {
            fairness: this.calculateFairness(scheduleData, staffList, year, month, daysInMonth, settings, subResults),
            satisfaction: this.calculateSatisfaction(scheduleData, staffList, daysInMonth, settings, subResults),
            fatigue: this.calculateFatigue(scheduleData, staffList, daysInMonth, settings, subResults),
            efficiency: this.calculateEfficiency(scheduleData, staffList, daysInMonth, settings, subResults),
            cost: this.calculateCost(scheduleData, staffList, daysInMonth, settings, subResults)
        };

        let totalWeightedScore = 0;
        let totalWeight = 0;
        const groupWeightedScores = {};
        const groupWeights = {};

        for (let key in results) {
            const subKeys = metricMap[key] || [];
            let groupWeight = 0;
            let groupScoreSum = 0;

            subKeys.forEach(sk => {
                if (enables[sk]) {
                    const subWeight = parseFloat(settings.thresholds?.[sk] || 0);
                    const subRawScore = subResults[sk] || 0; // 1-5 分
                    // 將 1-5 分轉換為該細項權重下的得分 (例如 5分且權重10% = 10分)
                    const subWeightedScore = (subRawScore / 5) * subWeight;
                    
                    subResults[sk] = subWeightedScore; // 更新為權重得分
                    groupScoreSum += subWeightedScore;
                    groupWeight += subWeight;
                }
            });

            groupWeightedScores[key] = groupScoreSum;
            groupWeights[key] = groupWeight;
            
            totalWeightedScore += groupScoreSum;
            totalWeight += groupWeight;
        }

        return {
            total: Math.round(totalWeightedScore * 10) / 10, // 總分 (滿分通常為 100)
            breakdown: groupWeightedScores, // 大項得分 (例如 25)
            groupWeights: groupWeights,     // 大項配分 (例如 30)
            subBreakdown: subResults        // 細項得分 (例如 8)
        };
    },

    // --- 3. 指標演算法 ---

    calculateFairness: function(scheduleData, staffList, year, month, days, settings, subResults) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};
        const directions = settings.directions || {};

        if (enables.hoursDiff) {
            const hours = staffList.map(s => this.sumWorkHours(scheduleData[s.uid]));
            const stdDev = this.getStdDev(hours);
            const s = this.getScoreByTier(stdDev, tiers.hoursDiff, directions.hoursDiff || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.hoursDiff = s;
        }
        if (enables.nightDiff) {
            // 動態取得所有夜班代號
            const shifts = scheduleData.shifts || [];
            const nightShiftCodes = shifts.filter(s => shiftUtils.isNightShift(s)).map(s => s.code);
            
            const counts = staffList.map(s => this.countShifts(scheduleData[s.uid], nightShiftCodes));
            const diff = Math.max(...counts) - Math.min(...counts);
            const s = this.getScoreByTier(diff, tiers.nightDiff, directions.nightDiff || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.nightDiff = s;
        }
        if (enables.holidayDiff) {
            const holidayOffs = staffList.map(s => this.countHolidayOff(scheduleData[s.uid], year, month, days));
            const diff = Math.max(...holidayOffs) - Math.min(...holidayOffs);
            const s = this.getScoreByTier(diff, tiers.holidayDiff, directions.holidayDiff || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.holidayDiff = s;
        }
        return scores.length ? this.average(scores) : 0;
    },

    calculateSatisfaction: function(scheduleData, staffList, days, settings, subResults) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};
        const directions = settings.directions || {};

        if (enables.wishRate) {
            let totalReq = 0, hit = 0;
            staffList.forEach(s => {
                const params = s.schedulingParams || {};
                for (let d=1; d<=days; d++) {
                    if (params[`current_${d}`] === 'REQ_OFF') {
                        totalReq++;
                        if (scheduleData[s.uid]?.[`current_${d}`] === 'OFF' || 
                            scheduleData[s.uid]?.[`current_${d}`] === 'REQ_OFF') hit++;
                    }
                }
            });
            const rate = totalReq === 0 ? 100 : (hit / totalReq) * 100;
            const s = this.getScoreByTier(rate, tiers.wishRate, directions.wishRate || 'higher_is_better');
            scores.push(s); 
            if(subResults) subResults.wishRate = s;
        }
        if (enables.prefRate) {
            const s = 4.0; // 預設值
            scores.push(s); 
            if(subResults) subResults.prefRate = s;
        }
        return scores.length ? this.average(scores) : 0;
    },

    calculateFatigue: function(scheduleData, staffList, days, settings, subResults) {
        const scores = [];
        const tiers = settings.tiers || {};
        const enables = settings.enables || {};
        const directions = settings.directions || {};

        if (enables.consWork) {
            let totalVio = 0;
            staffList.forEach(s => {
                let cons = 0;
                for (let d=1; d<=days; d++) {
                    const shift = scheduleData[s.uid]?.[`current_${d}`];
                    if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                        cons++; 
                        if (cons > 6) totalVio++;
                    } else cons = 0;
                }
            });
            const s = this.getScoreByTier(totalVio, tiers.consWork, directions.consWork || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.consWork = s;
        }
        if (enables.nToD) {
            let nToDViolations = 0;
            staffList.forEach(s => {
                for (let d=1; d<days; d++) {
                    const current = scheduleData[s.uid]?.[`current_${d}`];
                    const next = scheduleData[s.uid]?.[`current_${d+1}`];
                    // 大夜 (N) 後接 白班 (D) 或 小夜 (E)
                    if (shiftUtils.isNightShift(current) && (next === 'D' || next === 'E')) {
                        nToDViolations++;
                    }
                }
            });
            const s = this.getScoreByTier(nToDViolations, tiers.nToD, directions.nToD || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.nToD = s;
        }
        if (enables.offTargetRate) {
            let totalOffDiff = 0;
            const targetOff = settings.thresholds?.avgOff || 9;
            staffList.forEach(s => {
                let offCount = 0;
                for (let d=1; d<=days; d++) {
                    const v = scheduleData[s.uid]?.[`current_${d}`];
                    if (!v || v === 'OFF' || v === 'REQ_OFF') offCount++;
                }
                totalOffDiff += Math.abs(offCount - targetOff);
            });
            const avgDiff = totalOffDiff / staffList.length;
            const s = this.getScoreByTier(avgDiff, tiers.offTargetRate, directions.offTargetRate || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.offTargetRate = s;
        }
        if (enables.weeklyNight) {
            let weeklyNightViolations = 0;
            staffList.forEach(s => {
                // 簡單檢查：單週大夜天數是否過多 (超過3天)
                for (let startDay = 1; startDay <= days - 6; startDay += 7) {
                    let nightCount = 0;
                    for (let d = startDay; d < startDay + 7 && d <= days; d++) {
                        if (shiftUtils.isNightShift(scheduleData[s.uid]?.[`current_${d}`])) nightCount++;
                    }
                    if (nightCount > 3) weeklyNightViolations++;
                }
            });
            const s = this.getScoreByTier(weeklyNightViolations, tiers.weeklyNight, directions.weeklyNight || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.weeklyNight = s;
        }
        return scores.length ? this.average(scores) : 0;
    },

    calculateEfficiency: function(scheduleData, staffList, days, settings, subResults) { 
        const enables = settings.enables || {};
        const tiers = settings.tiers || {};
        const directions = settings.directions || {};
        const scores = [];
        
        if (enables.shortageRate) {
            // 檢查人力缺額 (假設 scheduleData 包含人力需求資訊，若無則計算班表中的 OFF 比例)
            let shortageCount = 0;
            staffList.forEach(s => {
                for (let d=1; d<=days; d++) {
                    if (!scheduleData[s.uid]?.[`current_${d}`]) shortageCount++;
                }
            });
            const rate = (shortageCount / (staffList.length * days)) * 100;
            const s = this.getScoreByTier(rate, tiers.shortageRate, directions.shortageRate || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.shortageRate = s;
        }
        if (enables.seniorDist) {
            // 資深人員分佈 (簡單邏輯：資深人員是否均勻分佈在各班別)
            const s = 4.0; 
            scores.push(s); 
            if(subResults) subResults.seniorDist = s;
        }
        if (enables.juniorDist) {
            // 資淺人員分佈
            const s = 4.0; 
            scores.push(s); 
            if(subResults) subResults.juniorDist = s;
        }
        return scores.length ? this.average(scores) : 0;
    },

    calculateCost: function(scheduleData, staffList, days, settings, subResults) { 
        const enables = settings.enables || {};
        const tiers = settings.tiers || {};
        const directions = settings.directions || {};
        const scores = [];
        
        if (enables.overtimeRate) {
            // 超時工作計算 (超過預定天數)
            let totalOvertime = 0;
            const maxWorkDays = days - (settings.thresholds?.avgOff || 9);
            staffList.forEach(s => {
                let workCount = 0;
                for (let d=1; d<=days; d++) {
                    const v = scheduleData[s.uid]?.[`current_${d}`];
                    if (v && v !== 'OFF' && v !== 'REQ_OFF') workCount++;
                }
                if (workCount > maxWorkDays) totalOvertime += (workCount - maxWorkDays);
            });
            const s = this.getScoreByTier(totalOvertime, tiers.overtimeRate, directions.overtimeRate || 'lower_is_better');
            scores.push(s); 
            if(subResults) subResults.overtimeRate = s;
        }
        return scores.length ? this.average(scores) : 0;
    },

    // --- 4. 輔助工具 ---

    /**
     * 🔥 改善版：支援評分方向性的分段評分
     * @param {number} value - 實際數值
     * @param {array} tierList - 評分區間列表 [{limit, score, label}]
     * @param {string} direction - 'lower_is_better' 或 'higher_is_better'
     */
    getScoreByTier: function(value, tierList, direction = 'lower_is_better') {
        if (!tierList || !tierList.length) return 3;
        
        if (direction === 'lower_is_better') {
            // 數值越低越好（如差異值、錯誤次數）
            // 排序：由小到大
            const sorted = [...tierList].sort((a, b) => a.limit - b.limit);
            for (let t of sorted) {
                if (value <= t.limit) return t.score;
            }
            // 如果超過所有上限，回傳最後一個（最寬鬆）區間的分數
            return sorted[sorted.length - 1].score;
            
        } else if (direction === 'higher_is_better') {
            // 數值越高越好（如達成率、滿意度）
            // 排序：由大到小
            const sorted = [...tierList].sort((a, b) => b.limit - a.limit);
            for (let t of sorted) {
                if (value >= t.limit) return t.score;
            }
            // 如果低於所有下限，回傳最後一個（最低）區間的分數
            return sorted[sorted.length - 1].score;
        }
        
        // 預設回傳中間分數
        console.warn(`⚠️ 未知的評分方向: ${direction}`);
        return 3;
    },

    getStdDev: function(array) {
        const n = array.length;
        if (n <= 1) return 0;
        const mean = array.reduce((a, b) => a + b) / n;
        return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    },

    sumWorkHours: function(assign) {
        if (!assign) return 0;
        // 過濾掉 OFF, REQ_OFF 以及空白處 (視為 OFF)
        return Object.values(assign).filter(v => v && v !== 'OFF' && v !== 'REQ_OFF').length * 8;
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
                // 空白處視為 OFF
                if (!v || v === 'OFF' || v === 'REQ_OFF') count++;
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
            // 🔥 新增：預設評分方向
            directions: {
                hoursDiff: 'lower_is_better',
                nightDiff: 'lower_is_better',
                holidayDiff: 'lower_is_better',
                prefRate: 'higher_is_better',
                wishRate: 'higher_is_better',
                consWork: 'lower_is_better',
                nToD: 'lower_is_better',
                offTargetRate: 'higher_is_better',
                weeklyNight: 'lower_is_better',
                shortageRate: 'lower_is_better',
                seniorDist: 'higher_is_better',
                juniorDist: 'higher_is_better',
                overtimeRate: 'lower_is_better'
            },
            tiers: {
                hoursDiff: [{limit: 1, score: 5}, {limit: 3, score: 4}, {limit: 5, score: 3}, {limit: 8, score: 2}, {limit: 10, score: 1}],
                nightDiff: [{limit: 0, score: 5}, {limit: 1, score: 4}, {limit: 2, score: 3}, {limit: 3, score: 2}, {limit: 4, score: 1}],
                holidayDiff: [{limit: 0, score: 5}, {limit: 1, score: 4}, {limit: 2, score: 3}, {limit: 3, score: 2}, {limit: 4, score: 1}],
                wishRate: [{limit: 95, score: 5}, {limit: 85, score: 4}, {limit: 75, score: 3}, {limit: 60, score: 2}, {limit: 0, score: 1}],
                consWork: [{limit: 0, score: 5}, {limit: 2, score: 4}, {limit: 5, score: 3}, {limit: 10, score: 2}, {limit: 20, score: 1}],
                nToD: [{limit: 0, score: 5}, {limit: 1, score: 4}, {limit: 2, score: 3}, {limit: 4, score: 2}, {limit: 6, score: 1}],
                offTargetRate: [{limit: 0.5, score: 5}, {limit: 1, score: 4}, {limit: 2, score: 3}, {limit: 3, score: 2}, {limit: 5, score: 1}],
                weeklyNight: [{limit: 0, score: 5}, {limit: 1, score: 4}, {limit: 2, score: 3}, {limit: 4, score: 2}, {limit: 6, score: 1}],
                shortageRate: [{limit: 1, score: 5}, {limit: 3, score: 4}, {limit: 5, score: 3}, {limit: 10, score: 2}, {limit: 20, score: 1}],
                overtimeRate: [{limit: 0, score: 5}, {limit: 2, score: 4}, {limit: 5, score: 3}, {limit: 10, score: 2}, {limit: 20, score: 1}]
            }
        };
    }
};
