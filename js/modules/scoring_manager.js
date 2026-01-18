// js/modules/scoring_manager.js
const scoringManager = {
    // 儲存原始 AI 分數，用於比較
    aiBaseScore: null,
    currentScore: null,

    // 主計算函式
    calculate: function(scheduleData, staffList, rules) {
        // 1. 初始化得分結構
        let scoreReport = {
            totalScore: 0,
            maxPossibleScore: 0,
            percentage: 0,
            categories: {
                fairness: { score: 0, weight: 0, items: {} },
                satisfaction: { score: 0, weight: 0, items: {} },
                fatigue: { score: 0, weight: 0, items: {} },
                efficiency: { score: 0, weight: 0, items: {} },
                cost: { score: 0, weight: 0, items: {} }
            }
        };

        // 模擬讀取規則權重 (若未設定則使用預設值)
        // 實務上應從 scheduleRuleManager.getRules() 讀取
        const weights = {
            fairness: 20, satisfaction: 20, fatigue: 30, efficiency: 15, cost: 15
        };

        // --- 1. 公平性 (Fairness) 計算 ---
        // 計算放假天數標準差 (Standard Deviation)
        const offCounts = staffList.map(s => this.countShift(scheduleData, s.id, 'OFF'));
        const offStd = this.calculateStdDev(offCounts);
        // 轉換為 5 分制 (標準差越小分越高)
        const scoreFairness = this.mapValueToScore(offStd, [0.5, 1.0, 1.5, 2.0], true); // true表示越小越好
        scoreReport.categories.fairness.score = scoreFairness;
        scoreReport.categories.fairness.weight = weights.fairness;
        scoreReport.categories.fairness.items['off_std'] = { val: offStd.toFixed(2), score: scoreFairness };


        // --- 2. 滿意度 (Satisfaction) 計算 ---
        // 計算預班達成率 (以 REQ_OFF 為例)
        let reqTotal = 0, reqSuccess = 0;
        staffList.forEach(s => {
            const params = s.schedulingParams || {};
            Object.keys(params).forEach(date => {
                if(params[date] === 'REQ_OFF') {
                    reqTotal++;
                    if(this.getShift(scheduleData, date, s.id) === 'OFF') reqSuccess++;
                }
            });
        });
        const reqRate = reqTotal === 0 ? 100 : (reqSuccess / reqTotal * 100);
        const scoreSat = this.mapValueToScore(reqRate, [99, 95, 90, 80], false); // false表示越大越好
        scoreReport.categories.satisfaction.score = scoreSat;
        scoreReport.categories.satisfaction.weight = weights.satisfaction;
        scoreReport.categories.satisfaction.items['req_rate'] = { val: reqRate.toFixed(0)+'%', score: scoreSat };


        // --- 3. 疲勞度 (Fatigue) 計算 ---
        // 計算連上 6 天的人次
        let cons6Count = 0;
        staffList.forEach(s => {
            if(this.checkConsecutiveWork(scheduleData, s.id) >= 6) cons6Count++;
        });
        const scoreFatigue = this.mapValueToScore(cons6Count, [0, 1, 3, 5], true);
        scoreReport.categories.fatigue.score = scoreFatigue;
        scoreReport.categories.fatigue.weight = weights.fatigue;
        scoreReport.categories.fatigue.items['cons_6'] = { val: cons6Count + '人次', score: scoreFatigue };


        // --- 4. 效率 & 5. 成本 (這裡暫用隨機或是簡易邏輯代替，待完整實作) ---
        scoreReport.categories.efficiency.score = 5; // 假設完美
        scoreReport.categories.efficiency.weight = weights.efficiency;
        scoreReport.categories.cost.score = 4;       // 假設不錯
        scoreReport.categories.cost.weight = weights.cost;


        // --- 總分匯總 ---
        // 公式：總分 = Σ (單項得分 * 權重)
        // 滿分 = Σ (5分 * 權重)
        Object.values(scoreReport.categories).forEach(cat => {
            scoreReport.totalScore += (cat.score * cat.weight);
            scoreReport.maxPossibleScore += (5 * cat.weight);
        });

        scoreReport.percentage = (scoreReport.totalScore / scoreReport.maxPossibleScore * 100).toFixed(1);
        
        this.currentScore = scoreReport.percentage;
        return scoreReport;
    },

    // --- 輔助工具 ---
    
    // 設定 AI 基準分 (當 AI 剛跑完時呼叫)
    setBaseScore: function(score) {
        this.aiBaseScore = score;
    },

    // 數值轉 5 分制映射
    // thresholds: [5分門檻, 4分門檻, 3分門檻, 2分門檻]
    // isLowerBetter: true 代表數值越小越好 (如標準差)，false 代表越大越好 (如達成率)
    mapValueToScore: function(val, thresholds, isLowerBetter) {
        if (isLowerBetter) {
            if (val <= thresholds[0]) return 5;
            if (val <= thresholds[1]) return 4;
            if (val <= thresholds[2]) return 3;
            if (val <= thresholds[3]) return 2;
            return 1;
        } else {
            if (val >= thresholds[0]) return 5;
            if (val >= thresholds[1]) return 4;
            if (val >= thresholds[2]) return 3;
            if (val >= thresholds[3]) return 2;
            return 1;
        }
    },

    calculateStdDev: function(array) {
        const n = array.length;
        if(n === 0) return 0;
        const mean = array.reduce((a, b) => a + b) / n;
        return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    },

    countShift: function(schedule, uid, targetShift) {
        let count = 0;
        Object.values(schedule).forEach(dayShifts => {
            if(targetShift === 'OFF') {
                if(dayShifts.OFF && dayShifts.OFF.includes(uid)) count++;
            } else {
                // 簡化判斷
                if(dayShifts[targetShift] && dayShifts[targetShift].includes(uid)) count++;
            }
        });
        return count;
    },
    
    getShift: function(schedule, dateStr, uid) {
        if(!schedule[dateStr]) return null;
        for(let code in schedule[dateStr]) {
            if(schedule[dateStr][code].includes(uid)) return code;
        }
        return null;
    },

    checkConsecutiveWork: function(schedule, uid) {
        // 簡易連續上班檢查 (僅回傳最大連續值)
        let maxCons = 0, current = 0;
        const dates = Object.keys(schedule).sort();
        dates.forEach(d => {
            const shift = this.getShift(schedule, d, uid);
            if(shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                current++;
            } else {
                maxCons = Math.max(maxCons, current);
                current = 0;
            }
        });
        return Math.max(maxCons, current);
    }
};
