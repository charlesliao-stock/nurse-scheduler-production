// js/modules/scoring_manager.js
// 負責計算排班分數與比較 (支援單位自訂設定)

const scoringManager = {
    aiBaseScore: null, // 記錄 AI 剛排完的原始分數
    currentSettings: null, // 當前單位的評分設定

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
                console.log("✅ 已載入單位評分設定:", unitId);
            } else {
                this.currentSettings = this.getDefaultSettings();
                console.log("使用預設評分設定");
            }
        } catch(e) {
            console.error("載入評分設定失敗:", e);
            this.currentSettings = this.getDefaultSettings();
        }
    },

    // 預設設定
    getDefaultSettings: function() {
        return {
            weights: {
                efficiency: 40,
                fatigue: 25,
                satisfaction: 20,
                fairness: 10,
                cost: 5
            },
            thresholds: {
                maxConsecutive: 6,
                fatigueLevel: 'moderate',
                offStdDev: 1.5,
                gapTolerance: 5
            }
        };
    },

    // 核心計算函式
    // scheduleData: { uid: { current_1: 'N', ... } }
    // staffList: [ { uid, name, ... } ]
    // dailyNeeds: { 'N_0': 3, ... } (週循環)
    // specificNeeds: { '2025-10-01': { 'N': 4 } } (特定日)
    calculate: function(scheduleData, staffList, dailyNeeds = {}, specificNeeds = {}) {
        // 如果沒有設定,使用預設值
        if(!this.currentSettings) {
            this.currentSettings = this.getDefaultSettings();
        }

        const weights = this.currentSettings.weights;
        const thresholds = this.currentSettings.thresholds;

        // 初始化分數結構
        let result = {
            totalScore: 0,
            maxScore: 100, 
            percentage: 0,
            details: { efficiency: 0, fatigue: 0, satisfaction: 0, fairness: 0, cost: 0 }
        };

        // 1. 取得當月天數 (從 scheduleData 推算)
        let daysInMonth = 30; 
        const uids = Object.keys(scheduleData);
        if (uids.length > 0) {
            const assign = scheduleData[uids[0]];
            const days = Object.keys(assign)
                .filter(k => k.startsWith('current_'))
                .map(k => parseInt(k.split('_')[1]))
                .sort((a,b) => b-a);
            if(days.length > 0) daysInMonth = days[0];
        }

        // --- 1. 排班效率 (Efficiency) ---
        result.details.efficiency = this.calculateEfficiency(scheduleData, staffList, dailyNeeds, specificNeeds, daysInMonth, thresholds);

        // --- 2. 疲勞度 (Fatigue) ---
        result.details.fatigue = this.calculateFatigue(scheduleData, staffList, daysInMonth, thresholds);

        // --- 3. 滿意度 (Satisfaction) ---
        result.details.satisfaction = this.calculateSatisfaction(scheduleData, staffList, daysInMonth);

        // --- 4. 公平性 (Fairness) ---
        result.details.fairness = this.calculateFairness(scheduleData, staffList, daysInMonth, thresholds);

        // --- 5. 成本 (Cost) ---
        result.details.cost = 4; // 預留項目

        // --- 總分加權計算 ---
        let weightedSum = 
            (result.details.efficiency * weights.efficiency) +
            (result.details.fatigue * weights.fatigue) +
            (result.details.satisfaction * weights.satisfaction) +
            (result.details.fairness * weights.fairness) +
            (result.details.cost * weights.cost);
            
        // 滿分基數 = 5分 * 100% = 500
        result.percentage = (weightedSum / 500 * 100).toFixed(1);

        return result;
    },

    // 效率計算
    calculateEfficiency: function(scheduleData, staffList, dailyNeeds, specificNeeds, daysInMonth, thresholds) {
        // 簡化計算:假設大部分情況 AI 已滿足需求
        // 實際應統計每日缺額
        return 5; // 暫時給滿分,可依需求擴充
    },

    // 疲勞度計算
    calculateFatigue: function(scheduleData, staffList, daysInMonth, thresholds) {
        let violations = 0;
        const maxCons = thresholds.maxConsecutive;
        const level = thresholds.fatigueLevel;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            let cons = 0;
            let prevShift = null;
            
            for(let d=1; d<=daysInMonth; d++) {
                const shift = assign[`current_${d}`];
                const isWork = (shift && shift !== 'OFF' && shift !== 'REQ_OFF');
                
                if(isWork) {
                    cons++;
                } else {
                    cons = 0;
                }
                
                if(cons > maxCons) violations++;

                // 簡易 N 接 D 檢查
                if(prevShift === 'N' && shift === 'D') {
                    violations++;
                }
                
                prevShift = shift;
            }
        });

        // 依等級評分
        if(level === 'strict') {
            if (violations === 0) return 5;
            if (violations === 1) return 3;
            return 1;
        } else if(level === 'moderate') {
            if (violations === 0) return 5;
            if (violations <= 2) return 4;
            if (violations <= 5) return 3;
            return 2;
        } else { // relaxed
            if (violations === 0) return 5;
            if (violations <= 5) return 4;
            return 2;
        }
    },

    // 滿意度計算
    calculateSatisfaction: function(scheduleData, staffList, daysInMonth) {
        let reqTotal = 0;
        let reqHit = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            Object.values(assign).forEach(val => {
                if(val === 'REQ_OFF') {
                    reqTotal++;
                    reqHit++; 
                }
            });
        });
        
        return 5; // 因 REQ_OFF 強制鎖定,通常滿分
    },

    // 公平性計算
    calculateFairness: function(scheduleData, staffList, daysInMonth, thresholds) {
        const offCounts = staffList.map(s => {
            const assign = scheduleData[s.uid] || {};
            let cnt = 0;
            Object.values(assign).forEach(v => {
                if(v === 'OFF' || v === 'REQ_OFF') cnt++;
            });
            return cnt;
        });
        
        const stdDev = this.getStdDev(offCounts);
        const threshold = thresholds.offStdDev;
        
        if(stdDev < 1.0) return 5;
        if(stdDev < threshold) return 4;
        if(stdDev < 2.0) return 3;
        return 2;
    },

    // 設定基準分 (AI 剛跑完時呼叫)
    setBase: function(score) {
        this.aiBaseScore = score;
    },

    // 計算標準差
    getStdDev: function(arr) {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b) / arr.length;
        return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
    }
};
