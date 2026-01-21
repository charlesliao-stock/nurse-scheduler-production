// js/modules/scoring_manager.js
// 🚀 最終進化版：支援詳細評分視窗結構 (Details Structure)

const scoringManager = {
    aiBaseScore: null,     
    currentSettings: null, 

    // --- 1. 資料初始化 ---
    loadSettings: async function(unitId) {
        if(!unitId) { this.currentSettings = this.getDefaultSettings(); return; }
        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            if(doc.exists && data && data.scoreSettings) {
                this.currentSettings = this.ensureSettingsStructure(data.scoreSettings);
            } else {
                this.currentSettings = this.getDefaultSettings();
            }
        } catch(e) { console.error(e); this.currentSettings = this.getDefaultSettings(); }
    },

    ensureSettingsStructure: function(s) {
        const d = this.getDefaultSettings();
        return {
            weights: s.weights || d.weights,
            thresholds: s.thresholds || d.thresholds,
            enables: s.enables || d.enables,
            tiers: s.tiers || d.tiers
        };
    },

    setBase: function(score) { this.aiBaseScore = (score?.total) ? score.total : score; },
    getScoreDiff: function(currentScore) {
        if (this.aiBaseScore === null || typeof currentScore !== 'number') return null;
        return Math.round((currentScore - this.aiBaseScore) * 10) / 10;
    },

    // --- 2. 核心計算 (回傳詳細結構) ---
    calculate: function(scheduleData, staffList, year, month) {
        const settings = this.currentSettings || this.getDefaultSettings();
        const enables = settings.enables || {};
        const thresholds = settings.thresholds || {}; // 這裡當作各子項的"配分"
        const daysInMonth = new Date(year, month, 0).getDate();

        // 定義結構與標籤
        const structure = {
            fairness: { label: "1. 公平性指標", subs: {
                hoursDiff: "工時差異 (標準差)", nightDiff: "夜班差異 (次)", holidayDiff: "假日差異 (天)"
            }},
            satisfaction: { label: "2. 滿意度指標", subs: {
                prefRate: "排班偏好達成率", wishRate: "預班願望達成率"
            }},
            fatigue: { label: "3. 疲勞度指標", subs: {
                consWork: "連續上班超過限制", nToD: "夜接日 (N-D) 次數", offTargetRate: "積借休達成率", weeklyNight: "單週夜班過量"
            }},
            efficiency: { label: "4. 效率指標", subs: {
                shortageRate: "人力缺口率", seniorDist: "資深人員分佈", juniorDist: "新進人員分佈"
            }},
            cost: { label: "5. 成本指標", subs: {
                overtimeRate: "加班費控管"
            }}
        };

        let grandTotalScore = 0;
        let grandTotalMax = 0;
        const resultDetails = {};

        // 開始逐項計算
        for (let catKey in structure) {
            const catConfig = structure[catKey];
            const subResults = [];
            let catScore = 0;
            let catMax = 0;

            for (let subKey in catConfig.subs) {
                if (enables[subKey]) {
                    // 1. 取得該項配分 (Weight)
                    const weight = parseFloat(thresholds[subKey] || 0);
                    
                    // 2. 計算原始得分 (1-5分)
                    const rawTierScore = this.calculateSubItemRaw(subKey, scheduleData, staffList, year, month, daysInMonth, settings);
                    
                    // 3. 換算實際得分: (原始分 / 5) * 配分
                    // 例如: 拿4分(良好)，配分10分 => (4/5)*10 = 8分
                    const actualScore = (rawTierScore / 5) * weight;

                    subResults.push({
                        key: subKey,
                        label: catConfig.subs[subKey],
                        score: Math.round(actualScore * 10) / 10,
                        max: weight,
                        tier: rawTierScore // 保留原始級距分(除錯用)
                    });

                    catScore += actualScore;
                    catMax += weight;
                }
            }

            resultDetails[catKey] = {
                label: catConfig.label,
                score: Math.round(catScore * 10) / 10,
                max: catMax,
                subs: subResults
            };

            grandTotalScore += catScore;
            grandTotalMax += catMax;
        }

        // 雖然理論上總分是各項加總，但為了避免浮點數誤差，或是如果有些項目未啟用
        // 這裡我們直接回傳 grandTotalScore
        
        return {
            total: Math.round(grandTotalScore * 10) / 10,
            maxTotal: grandTotalMax,
            details: resultDetails
        };
    },

    // --- 3. 各子項原始分數計算 (回傳 1-5 分) ---
    calculateSubItemRaw: function(subKey, scheduleData, staffList, year, month, days, settings) {
        const tiers = settings.tiers || {};
        
        // 公平性
        if (subKey === 'hoursDiff') {
            const hours = staffList.map(s => this.sumWorkHours(scheduleData[s.uid]));
            return this.getScoreByTier(this.getStdDev(hours), tiers.hoursDiff);
        }
        if (subKey === 'nightDiff') {
            const counts = staffList.map(s => this.countShifts(scheduleData[s.uid], ['N', 'EN', 'AN']));
            return this.getScoreByTier(Math.max(...counts) - Math.min(...counts), tiers.nightDiff);
        }
        if (subKey === 'holidayDiff') {
            const holidayOffs = staffList.map(s => this.countHolidayOff(scheduleData[s.uid], year, month, days));
            return this.getScoreByTier(Math.max(...holidayOffs) - Math.min(...holidayOffs), tiers.holidayDiff);
        }

        // 滿意度
        if (subKey === 'wishRate') {
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
            return this.getScoreByTier(failRate, tiers.wishRate);
        }
        // 暫時給滿分項目 (未來可實作)
        if (['prefRate'].includes(subKey)) return 5;

        // 疲勞度
        if (subKey === 'consWork') {
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
            return this.getScoreByTier(totalVio, tiers.consWork);
        }
        // 暫時給滿分項目
        if (['nToD', 'offTargetRate', 'weeklyNight'].includes(subKey)) return 5;

        // 效率與成本 (暫時給滿分)
        if (['shortageRate', 'seniorDist', 'juniorDist', 'overtimeRate'].includes(subKey)) return 5;

        return 3; // 預設
    },

    // --- 4. 輔助工具 ---
    getScoreByTier: function(value, tierList) {
        if (!tierList || !tierList.length) return 3;
        const sorted = [...tierList].sort((a, b) => b.limit - a.limit);
        for (let t of sorted) {
            if (value >= t.limit) return t.score;
        }
        return sorted[sorted.length - 1].score;
    },

    getStdDev: function(array) {
        const n = array.length; if (n <= 1) return 0;
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
    getDefaultSettings: function() {
        // 回傳完整的預設結構，確保不會報錯
        return {
            weights: {}, enables: {}, thresholds: {}, tiers: {}
        };
    }
};
