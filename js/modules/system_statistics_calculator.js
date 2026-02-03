// 系統統計管理模組
// 負責計算和管理排班系統的各項統計指標

const systemStatisticsCalculator = {
    currentStatistics: null,
    
    // --- 1. 缺班率計算 ---
    calculateVacancyRate: function(scheduleData, staffList, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        // 🔥 修正：班表資料中的人力需求欄位應為 dailyNeeds 或從 settings 取得
        const dailyNeeds = scheduleData.dailyNeeds || {};
        
        const stats = {
            overall: 0,
            totalVacancies: 0,
            totalRequired: 0,
            byShift: {}
        };
        
        // 取得所有不重複的班別代碼
        const shiftCodes = new Set();
        Object.keys(dailyNeeds).forEach(key => {
            const shiftCode = key.split('_')[0];
            shiftCodes.add(shiftCode);
        });

        if (shiftCodes.size === 0) {
            // Fallback: 嘗試從 assignments 中找班別
            const assignments = scheduleData.assignments || {};
            Object.values(assignments).forEach(userAssign => {
                Object.values(userAssign).forEach(shift => {
                    if (shift && shift !== 'OFF') shiftCodes.add(shift);
                });
            });
        }
        
        shiftCodes.forEach(shiftCode => {
            let totalRequiredForShift = 0;
            let totalVacanciesForShift = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month - 1, d);
                const jsDay = dateObj.getDay();
                const dayOfWeek = (jsDay === 0) ? 6 : jsDay - 1; 
                
                // 需求數
                const needKey = `${shiftCode}_${dayOfWeek}`;
                const dailyRequired = parseInt(dailyNeeds[needKey]) || 0;
                totalRequiredForShift += dailyRequired;

                // 實際數
                let dailyActual = 0;
                const assignKey = `current_${d}`;
                const assignments = scheduleData.assignments || {};
                Object.keys(assignments).forEach(uid => {
                    if (assignments[uid]?.[assignKey] === shiftCode) {
                        dailyActual++;
                    }
                });

                // 如果當天實際人數小於需求人數，則計入缺班
                if (dailyActual < dailyRequired) {
                    totalVacanciesForShift += (dailyRequired - dailyActual);
                }
            }
            
            const vacancies = totalVacanciesForShift;
            const vacancyRate = totalRequiredForShift > 0 ? (vacancies / totalRequiredForShift * 100) : 0;
            
            stats.byShift[shiftCode] = {
                rate: Math.round(vacancyRate * 10) / 10,
                vacancies: vacancies,
                required: totalRequiredForShift
            };
            
            stats.totalVacancies += vacancies;
            stats.totalRequired += totalRequiredForShift;
        });
        
        stats.overall = stats.totalRequired > 0 
            ? Math.round((stats.totalVacancies / stats.totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 2. 修正率計算 ---
    calculateAdjustmentRate: function(originalSchedule, currentSchedule, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyNeeds = currentSchedule.dailyNeeds || {};
        
        let totalRequired = 0;
        Object.values(dailyNeeds).forEach(val => {
            totalRequired += (parseInt(val) || 0);
        });
        // 因為 dailyNeeds 是週循環，要乘以週數 (約 4.3 週)
        totalRequired = Math.round(totalRequired * (daysInMonth / 7));
        
        const stats = {
            totalAdjustments: currentSchedule.adjustmentCount || 0,
            adjustmentRate: 0,
            byReason: {
                vacancy: { count: 0 },
                scheduling: { count: 0 },
                staffing: { count: 0 }
            }
        };

        if (totalRequired === 0) {
            // 如果沒有需求設定，嘗試從實際排班總數估算
            const assignments = currentSchedule.assignments || {};
            Object.values(assignments).forEach(userAssign => {
                Object.values(userAssign).forEach(shift => {
                    if (shift && shift !== 'OFF') totalRequired++;
                });
            });
        }
        
        stats.adjustmentRate = totalRequired > 0 
            ? Math.round((stats.totalAdjustments / totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 3. 換班統計 ---
    calculateExchangeStats: function(exchanges) {
        const stats = {
            totalExchanges: 0,
            byReason: {
                'unit_staffing_adjustment': { count: 0, percentage: 0 },
                'public_holiday': { count: 0, percentage: 0 },
                'sick_leave': { count: 0, percentage: 0 },
                'bereavement': { count: 0, percentage: 0 },
                'support': { count: 0, percentage: 0 },
                'personal_factors': { count: 0, percentage: 0 },
                'other': { count: 0, percentage: 0 }
            }
        };
        
        const approvedExchanges = exchanges.filter(ex => ex.status === 'approved');
        stats.totalExchanges = approvedExchanges.length;
        
        approvedExchanges.forEach(ex => {
            const reason = ex.reasonCategory || 'other';
            if (stats.byReason[reason]) {
                stats.byReason[reason].count++;
            }
        });
        
        if (stats.totalExchanges > 0) {
            Object.keys(stats.byReason).forEach(reason => {
                stats.byReason[reason].percentage = 
                    Math.round((stats.byReason[reason].count / stats.totalExchanges * 100) * 10) / 10;
            });
        }
        
        return stats;
    },
    
    // --- 4. 統計資料聚合 ---
    aggregateStatistics: async function(scheduleData, staffList, exchanges, year, month) {
        try {
            const vacancyStats = this.calculateVacancyRate(scheduleData, staffList, year, month);
            const adjustmentStats = this.calculateAdjustmentRate(scheduleData, scheduleData, year, month);
            const exchangeStats = this.calculateExchangeStats(exchanges);
            
            const originalScore = scheduleData.originalScore || 0;
            const currentScore = scheduleData.currentScore || 0;
            
            const statistics = {
                period: `${year}-${String(month).padStart(2, '0')}`,
                generatedAt: new Date().toISOString(),
                schedulingAttempts: scheduleData.schedulingAttempts || 1,
                schedulingTime: scheduleData.schedulingTime || 0,
                originalScore: originalScore,
                currentScore: currentScore,
                scoreImprovement: currentScore - originalScore,
                ruleCompliance: scheduleData.ruleCompliance || 0,
                vacancyStats: vacancyStats,
                adjustmentStats: adjustmentStats,
                exchangeStats: exchangeStats
            };
            
            this.currentStatistics = statistics;
            return statistics;
            
        } catch (e) {
            console.error('統計聚合失敗:', e);
            throw e;
        }
    },
    
    // --- 6. 格式化統計資料用於顯示 ---
    formatStatisticsForDisplay: function(statistics) {
        if (!statistics) return null;
        
        return {
            period: statistics.period,
            schedulingAttempts: statistics.schedulingAttempts,
            schedulingTime: `${(statistics.schedulingTime || 0).toFixed(2)}秒`,
            originalScore: `${statistics.originalScore}分`,
            currentScore: `${statistics.currentScore}分`,
            scoreImprovement: statistics.scoreImprovement >= 0 
                ? `+${statistics.scoreImprovement}分` 
                : `${statistics.scoreImprovement}分`,
            overallVacancyRate: `${statistics.vacancyStats.overall}%`,
            vacancyByShift: statistics.vacancyStats.byShift,
            totalAdjustments: statistics.adjustmentStats.totalAdjustments,
            adjustmentRate: `${statistics.adjustmentStats.adjustmentRate}%`,
            adjustmentByReason: statistics.adjustmentStats.byReason,
            totalExchanges: statistics.exchangeStats.totalExchanges,
            exchangeByReason: statistics.exchangeStats.byReason
        };
    }
};
