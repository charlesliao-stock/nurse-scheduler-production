// 系統統計管理模組
// 負責計算和管理排班系統的各項統計指標

const systemStatisticsManager = {
    currentStatistics: null,
    
    // --- 1. 缺班率計算 ---
    /**
     * 計算缺班率
     * @param {Object} scheduleData - 班表資料
     * @param {Array} staffList - 員工列表
     * @param {Number} year - 年份
     * @param {Number} month - 月份
     * @returns {Object} 缺班統計結果
     */
    calculateVacancyRate: function(scheduleData, staffList, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const shiftRequirements = scheduleData.shiftRequirements || {};
        
        // 初始化統計
        const stats = {
            overall: 0,
            totalVacancies: 0,
            totalRequired: 0,
            byShift: {}
        };
        
        // 遍歷每個班別
        Object.keys(shiftRequirements).forEach(shiftCode => {
            const dailyRequired = shiftRequirements[shiftCode] || 0;
            const totalRequired = dailyRequired * daysInMonth;
            
            // 計算該班別的實際排班人數
            let actualCount = 0;
            const assignments = scheduleData.assignments || {};
            
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                staffList.forEach(staff => {
                    const staffAssign = assignments[staff.uid] || {};
                    if (staffAssign[key] === shiftCode) {
                        actualCount++;
                    }
                });
            }
            
            // 計算該班別的缺班數
            const vacancies = Math.max(0, totalRequired - actualCount);
            const vacancyRate = totalRequired > 0 ? (vacancies / totalRequired * 100) : 0;
            
            stats.byShift[shiftCode] = {
                rate: Math.round(vacancyRate * 10) / 10,
                vacancies: vacancies,
                required: totalRequired
            };
            
            stats.totalVacancies += vacancies;
            stats.totalRequired += totalRequired;
        });
        
        // 計算整體缺班率
        stats.overall = stats.totalRequired > 0 
            ? Math.round((stats.totalVacancies / stats.totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 2. 修正率計算 ---
    /**
     * 分析班表調整並計算修正率
     * @param {Object} originalSchedule - 原始班表
     * @param {Object} currentSchedule - 當前班表
     * @param {Number} year - 年份
     * @param {Number} month - 月份
     * @returns {Object} 修正統計結果
     */
    calculateAdjustmentRate: function(originalSchedule, currentSchedule, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const shiftRequirements = currentSchedule.shiftRequirements || {};
        
        // 計算總班數
        let totalRequired = 0;
        Object.keys(shiftRequirements).forEach(shiftCode => {
            const dailyRequired = shiftRequirements[shiftCode] || 0;
            totalRequired += dailyRequired * daysInMonth;
        });
        
        // 分析調整
        const stats = {
            totalAdjustments: 0,
            adjustmentRate: 0,
            byReason: {
                vacancy: { count: 0, details: [] },
                scheduling: { count: 0, details: [] },
                staffing: { count: 0, details: [] }
            }
        };
        
        // 比較原始班表和當前班表，找出調整
        const originalAssignments = originalSchedule.assignments || {};
        const currentAssignments = currentSchedule.assignments || {};
        
        Object.keys(currentAssignments).forEach(uid => {
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                const originalShift = originalAssignments[uid]?.[key] || 'OFF';
                const currentShift = currentAssignments[uid]?.[key] || 'OFF';
                
                if (originalShift !== currentShift) {
                    stats.totalAdjustments++;
                    
                    // 分析調整原因 (簡化版本，實際需要更複雜的邏輯)
                    if (originalShift === 'OFF' && currentShift !== 'OFF') {
                        // 增加人員 - 可能是因為缺額
                        stats.byReason.vacancy.count++;
                        stats.byReason.vacancy.details.push({
                            day: d,
                            uid: uid,
                            action: 'add_staff',
                            oldShift: originalShift,
                            newShift: currentShift
                        });
                    } else if (originalShift !== 'OFF' && currentShift === 'OFF') {
                        // 減少班次
                        stats.byReason.vacancy.count++;
                        stats.byReason.vacancy.details.push({
                            day: d,
                            uid: uid,
                            action: 'remove_shift',
                            oldShift: originalShift,
                            newShift: currentShift
                        });
                    } else if (originalShift !== 'OFF' && currentShift !== 'OFF') {
                        // 班別轉換 - 排班不順調整
                        stats.byReason.scheduling.count++;
                        stats.byReason.scheduling.details.push({
                            day: d,
                            uid: uid,
                            action: 'shift_change',
                            oldShift: originalShift,
                            newShift: currentShift
                        });
                    }
                }
            }
        });
        
        // 計算修正率
        stats.adjustmentRate = totalRequired > 0 
            ? Math.round((stats.totalAdjustments / totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 3. 換班統計 ---
    /**
     * 統計換班申請資訊
     * @param {Array} exchanges - 換班申請列表
     * @returns {Object} 換班統計結果
     */
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
        
        // 統計已批准的換班
        const approvedExchanges = exchanges.filter(ex => ex.status === 'approved');
        stats.totalExchanges = approvedExchanges.length;
        
        // 按原因分類統計
        approvedExchanges.forEach(ex => {
            const reason = ex.reasonCategory || 'other';
            if (stats.byReason[reason]) {
                stats.byReason[reason].count++;
            }
        });
        
        // 計算百分比
        if (stats.totalExchanges > 0) {
            Object.keys(stats.byReason).forEach(reason => {
                stats.byReason[reason].percentage = 
                    Math.round((stats.byReason[reason].count / stats.totalExchanges * 100) * 10) / 10;
            });
        }
        
        return stats;
    },
    
    // --- 4. 統計資料聚合 ---
    /**
     * 聚合所有統計資料
     * @param {Object} scheduleData - 班表資料
     * @param {Array} staffList - 員工列表
     * @param {Array} exchanges - 換班申請列表
     * @param {Number} year - 年份
     * @param {Number} month - 月份
     * @returns {Object} 完整統計結果
     */
    aggregateStatistics: async function(scheduleData, staffList, exchanges, year, month) {
        try {
            // 計算各項統計
            const vacancyStats = this.calculateVacancyRate(scheduleData, staffList, year, month);
            
            // 獲取原始班表用於比較
            let originalSchedule = scheduleData;
            if (scheduleData.originalScheduleId) {
                const originalDoc = await db.collection('schedules').doc(scheduleData.originalScheduleId).get();
                if (originalDoc.exists) {
                    originalSchedule = originalDoc.data();
                }
            }
            
            const adjustmentStats = this.calculateAdjustmentRate(originalSchedule, scheduleData, year, month);
            const exchangeStats = this.calculateExchangeStats(exchanges);
            
            // 獲取班表評分
            const originalScore = scheduleData.originalScore || 0;
            const currentScore = scheduleData.currentScore || 0;
            
            // 組合完整統計結果
            const statistics = {
                period: `${year}-${String(month).padStart(2, '0')}`,
                generatedAt: new Date().toISOString(),
                
                // 排班過程
                schedulingAttempts: scheduleData.schedulingAttempts || 1,
                schedulingTime: scheduleData.schedulingTime || 0,
                
                // 排班結果
                originalScore: originalScore,
                currentScore: currentScore,
                scoreImprovement: currentScore - originalScore,
                
                // 缺班統計
                vacancyStats: vacancyStats,
                
                // 調整統計
                adjustmentStats: adjustmentStats,
                
                // 換班統計
                exchangeStats: exchangeStats
            };
            
            this.currentStatistics = statistics;
            return statistics;
            
        } catch (e) {
            console.error('統計聚合失敗:', e);
            throw e;
        }
    },
    
    // --- 5. 獲取統計資料 ---
    getStatistics: function() {
        return this.currentStatistics;
    },
    
    // --- 6. 格式化統計資料用於顯示 ---
    formatStatisticsForDisplay: function(statistics) {
        if (!statistics) return null;
        
        return {
            period: statistics.period,
            schedulingAttempts: statistics.schedulingAttempts,
            schedulingTime: `${statistics.schedulingTime.toFixed(2)}秒`,
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
