// 自動化報告生成排程模組
// 負責在次月自動生成上月的統計分析報告

const automatedReportScheduler = {
    
    // --- 1. 初始化排程 ---
    /**
     * 初始化自動化報告生成排程
     * 每月 1 號凌晨 1 點執行
     */
    init: function() {
        console.log('初始化自動化報告生成排程');
        
        // 檢查是否需要生成報告
        this.checkAndGenerateReports();
        
        // 設置每日檢查（簡化版，實際應使用 Cloud Scheduler）
        setInterval(() => {
            this.checkAndGenerateReports();
        }, 24 * 60 * 60 * 1000); // 每天檢查一次
    },
    
    // --- 2. 檢查並生成報告 ---
    checkAndGenerateReports: async function() {
        try {
            const today = new Date();
            const currentDay = today.getDate();
            const currentHour = today.getHours();
            
            // 只在每月 1 號凌晨 1-2 點執行
            if (currentDay === 1 && currentHour === 1) {
                console.log('開始生成上月的統計報告');
                await this.generateMonthlyReports();
            }
        } catch (e) {
            console.error('檢查報告生成失敗:', e);
        }
    },
    
    // --- 3. 生成月度報告 ---
    generateMonthlyReports: async function() {
        try {
            // 計算上月的年月
            const today = new Date();
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const year = lastMonth.getFullYear();
            const month = lastMonth.getMonth() + 1;
            const monthStr = `${year}-${String(month).padStart(2, '0')}`;
            
            console.log(`生成 ${monthStr} 的統計報告`);
            
            // 獲取該月份的所有班表
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59);
            
            const scheduleSnapshot = await db.collection('schedules')
                .where('createdAt', '>=', startDate)
                .where('createdAt', '<=', endDate)
                .get();
            
            if (scheduleSnapshot.empty) {
                console.log(`${monthStr} 沒有班表資料`);
                return;
            }
            
            // 為每個班表生成報告
            const promises = [];
            scheduleSnapshot.forEach(doc => {
                promises.push(this.generateReportForSchedule(doc.id, doc.data(), monthStr));
            });
            
            await Promise.all(promises);
            console.log(`✅ ${monthStr} 的統計報告生成完成`);
            
        } catch (e) {
            console.error('生成月度報告失敗:', e);
            throw e;
        }
    },
    
    // --- 4. 為單個班表生成報告 ---
    generateReportForSchedule: async function(scheduleId, scheduleData, monthStr) {
        try {
            // 檢查是否已生成報告
            if (scheduleData.analysisReport && scheduleData.analysisReport.period === monthStr) {
                console.log(`班表 ${scheduleId} 已有 ${monthStr} 的報告`);
                return;
            }
            
            // 獲取換班申請
            const exchangeSnapshot = await db.collection('shift_requests')
                .where('scheduleId', '==', scheduleId)
                .get();
            
            const exchanges = exchangeSnapshot.docs.map(doc => doc.data());
            
            // 計算統計資料
            const statistics = await this.calculateStatistics(scheduleData, exchanges, monthStr);
            
            // 生成分析報告
            const report = analysisReportGenerator.generateReport(statistics);
            
            // 保存報告
            await db.collection('schedules').doc(scheduleId).update({
                analysisReport: report,
                reportGeneratedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ 班表 ${scheduleId} 的報告已保存`);
            
            // 發送通知（可選）
            await this.sendNotification(scheduleData.unitId, monthStr, report);
            
        } catch (e) {
            console.error(`生成班表 ${scheduleId} 的報告失敗:`, e);
        }
    },
    
    // --- 5. 計算統計資料 ---
    calculateStatistics: async function(scheduleData, exchanges, monthStr) {
        const [year, month] = monthStr.split('-').map(Number);
        const staffList = scheduleData.staffList || [];
        
        // 計算缺班率
        const vacancyStats = this.calculateVacancyRate(scheduleData, staffList, year, month);
        
        // 計算修正率
        const adjustmentStats = this.calculateAdjustmentRate(scheduleData, year, month);
        
        // 計算換班統計
        const exchangeStats = this.calculateExchangeStats(exchanges);
        
        // 班表評分
        const originalScore = scheduleData.originalScore || 0;
        const currentScore = scheduleData.currentScore || 0;
        
        const statistics = {
            period: monthStr,
            generatedAt: new Date().toISOString(),
            schedulingAttempts: scheduleData.schedulingAttempts || 1,
            schedulingTime: scheduleData.schedulingTime || 0,
            originalScore: originalScore,
            currentScore: currentScore,
            scoreImprovement: currentScore - originalScore,
            vacancyStats: vacancyStats,
            adjustmentStats: adjustmentStats,
            exchangeStats: exchangeStats
        };
        
        return statistics;
    },
    
    // --- 6. 計算缺班率 ---
    calculateVacancyRate: function(scheduleData, staffList, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const shiftRequirements = scheduleData.shiftRequirements || {};
        
        const stats = {
            overall: 0,
            totalVacancies: 0,
            totalRequired: 0,
            byShift: {}
        };
        
        Object.keys(shiftRequirements).forEach(shiftCode => {
            const dailyRequired = shiftRequirements[shiftCode] || 0;
            const totalRequired = dailyRequired * daysInMonth;
            
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
        
        stats.overall = stats.totalRequired > 0 
            ? Math.round((stats.totalVacancies / stats.totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 7. 計算修正率 ---
    calculateAdjustmentRate: function(scheduleData, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const shiftRequirements = scheduleData.shiftRequirements || {};
        
        let totalRequired = 0;
        Object.keys(shiftRequirements).forEach(shiftCode => {
            const dailyRequired = shiftRequirements[shiftCode] || 0;
            totalRequired += dailyRequired * daysInMonth;
        });
        
        const stats = {
            totalAdjustments: scheduleData.adjustmentCount || 0,
            adjustmentRate: 0,
            byReason: {
                vacancy: { count: 0 },
                scheduling: { count: 0 },
                staffing: { count: 0 }
            }
        };
        
        stats.adjustmentRate = totalRequired > 0 
            ? Math.round((stats.totalAdjustments / totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 8. 計算換班統計 ---
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
    
    // --- 9. 發送通知 ---
    sendNotification: async function(unitId, monthStr, report) {
        try {
            // 這裡可以集成通知服務（如 Firebase Cloud Messaging）
            // 暫時只記錄日誌
            console.log(`📧 發送通知給單位 ${unitId}: ${monthStr} 的報告已生成`);
            
            // 未來可以添加：
            // - 發送郵件給單位主管
            // - 推送應用通知
            // - 記錄到通知表
            
        } catch (e) {
            console.error('發送通知失敗:', e);
        }
    },
    
    // --- 10. 手動觸發報告生成（用於測試） ---
    manualTrigger: async function(monthStr) {
        try {
            console.log(`手動觸發 ${monthStr} 的報告生成`);
            
            const [year, month] = monthStr.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59);
            
            const scheduleSnapshot = await db.collection('schedules')
                .where('createdAt', '>=', startDate)
                .where('createdAt', '<=', endDate)
                .get();
            
            if (scheduleSnapshot.empty) {
                console.log(`${monthStr} 沒有班表資料`);
                return;
            }
            
            const promises = [];
            scheduleSnapshot.forEach(doc => {
                promises.push(this.generateReportForSchedule(doc.id, doc.data(), monthStr));
            });
            
            await Promise.all(promises);
            console.log(`✅ ${monthStr} 的報告生成完成`);
            
        } catch (e) {
            console.error('手動觸發報告生成失敗:', e);
            throw e;
        }
    },
    
    // --- 11. 查詢報告生成狀態 ---
    getReportStatus: async function(monthStr) {
        try {
            const [year, month] = monthStr.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59);
            
            const scheduleSnapshot = await db.collection('schedules')
                .where('createdAt', '>=', startDate)
                .where('createdAt', '<=', endDate)
                .get();
            
            let totalSchedules = 0;
            let reportsGenerated = 0;
            
            scheduleSnapshot.forEach(doc => {
                totalSchedules++;
                if (doc.data().analysisReport && doc.data().analysisReport.period === monthStr) {
                    reportsGenerated++;
                }
            });
            
            return {
                month: monthStr,
                totalSchedules: totalSchedules,
                reportsGenerated: reportsGenerated,
                percentage: totalSchedules > 0 ? Math.round((reportsGenerated / totalSchedules) * 100) : 0
            };
            
        } catch (e) {
            console.error('查詢報告生成狀態失敗:', e);
            throw e;
        }
    }
};
