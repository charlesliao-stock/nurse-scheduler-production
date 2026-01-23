// 系統統計 UI 管理模組
// 負責系統統計頁面的 UI 邏輯和交互

const systemStatisticsManager = {
    currentStatistics: null,
    currentReport: null,
    currentDisplayMode: 'cards',
    
    // --- 1. 初始化 ---
    init: async function() {
        console.log("System Statistics Manager Init");
        
        // 設置預設月份為當前月份
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('statisticsMonth').value = `${year}-${month}`;
        
        // 載入單位列表
        await this.loadUnits();
    },
    
    // --- 2. 載入單位列表 ---
    loadUnits: async function() {
        try {
            const snapshot = await db.collection('units').get();
            const unitSelect = document.getElementById('unitFilter');
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name || doc.id;
                unitSelect.appendChild(option);
            });
        } catch (e) {
            console.error('載入單位失敗:', e);
        }
    },
    
    // --- 3. 切換查詢模式 ---
    toggleQueryMode: function() {
        const queryType = document.getElementById('queryType').value;
        const monthGroup = document.getElementById('monthGroup');
        const rangeGroup = document.getElementById('rangeGroup');
        
        if (queryType === 'month') {
            monthGroup.style.display = 'block';
            rangeGroup.style.display = 'none';
        } else {
            monthGroup.style.display = 'none';
            rangeGroup.style.display = 'flex';
        }
    },
    
    // --- 4. 載入統計資料 ---
    loadStatistics: async function() {
        try {
            const unitId = document.getElementById('unitFilter').value;
            const queryType = document.getElementById('queryType').value;
            
            let scheduleQuery = db.collection('schedules');
            
            if (unitId) {
                scheduleQuery = scheduleQuery.where('unitId', '==', unitId);
            }
            
            // 根據查詢方式篩選
            if (queryType === 'month') {
                const monthStr = document.getElementById('statisticsMonth').value;
                if (!monthStr) {
                    alert('請選擇月份');
                    return;
                }
                
                const [year, month] = monthStr.split('-').map(Number);
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0, 23, 59, 59);
                
                scheduleQuery = scheduleQuery
                    .where('createdAt', '>=', startDate)
                    .where('createdAt', '<=', endDate);
            } else {
                const startMonthStr = document.getElementById('startMonth').value;
                const endMonthStr = document.getElementById('endMonth').value;
                
                if (!startMonthStr || !endMonthStr) {
                    alert('請選擇開始和結束月份');
                    return;
                }
                
                const [startYear, startMonth] = startMonthStr.split('-').map(Number);
                const [endYear, endMonth] = endMonthStr.split('-').map(Number);
                
                const startDate = new Date(startYear, startMonth - 1, 1);
                const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
                
                scheduleQuery = scheduleQuery
                    .where('createdAt', '>=', startDate)
                    .where('createdAt', '<=', endDate);
            }
            
            const snapshot = await scheduleQuery.get();
            
            if (snapshot.empty) {
                alert('找不到符合條件的班表資料');
                return;
            }
            
            // 載入第一個班表的統計資料
            const scheduleDoc = snapshot.docs[0];
            const scheduleData = scheduleDoc.data();
            
            // 載入換班申請
            const exchangeSnapshot = await db.collection('shift_requests')
                .where('scheduleId', '==', scheduleDoc.id)
                .get();
            
            const exchanges = exchangeSnapshot.docs.map(doc => doc.data());
            
            // 計算統計資料
            const statistics = await systemStatisticsManager.calculateStatistics(
                scheduleData,
                exchanges
            );
            
            // 生成分析報告
            const report = analysisReportGenerator.generateReport(statistics);
            
            this.currentStatistics = statistics;
            this.currentReport = report;
            
            // 更新 UI
            this.displayStatistics(statistics, report);
            
        } catch (e) {
            console.error('載入統計資料失敗:', e);
            alert('載入失敗: ' + e.message);
        }
    },
    
    // --- 5. 計算統計資料 ---
    calculateStatistics: async function(scheduleData, exchanges) {
        const year = scheduleData.year || new Date().getFullYear();
        const month = scheduleData.month || new Date().getMonth() + 1;
        const staffList = scheduleData.staffList || [];
        
        // 使用 systemStatisticsManager 計算統計
        const statistics = await systemStatisticsManager.aggregateStatistics(
            scheduleData,
            staffList,
            exchanges,
            year,
            month
        );
        
        return statistics;
    },
    
    // 聚合統計資料 (複製自 system_statistics_manager.js)
    aggregateStatistics: async function(scheduleData, staffList, exchanges, year, month) {
        try {
            const vacancyStats = this.calculateVacancyRate(scheduleData, staffList, year, month);
            const adjustmentStats = this.calculateAdjustmentRate(scheduleData, year, month);
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
                vacancyStats: vacancyStats,
                adjustmentStats: adjustmentStats,
                exchangeStats: exchangeStats
            };
            
            return statistics;
        } catch (e) {
            console.error('統計聚合失敗:', e);
            throw e;
        }
    },
    
    // 計算缺班率
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
    
    // 計算修正率
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
    
    // 計算換班統計
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
    
    // --- 6. 顯示統計資料 ---
    displayStatistics: function(statistics, report) {
        // 更新卡片式統計
        document.getElementById('schedulingAttempts').textContent = statistics.schedulingAttempts;
        document.getElementById('schedulingTime').textContent = `${statistics.schedulingTime.toFixed(2)}秒`;
        document.getElementById('originalScore').textContent = `${statistics.originalScore}分`;
        document.getElementById('currentScore').textContent = `${statistics.currentScore}分`;
        
        const improvement = statistics.scoreImprovement;
        const improvementElement = document.getElementById('scoreImprovement');
        improvementElement.textContent = improvement >= 0 ? `+${improvement}分` : `${improvement}分`;
        improvementElement.style.color = improvement >= 0 ? '#27ae60' : '#e74c3c';
        
        document.getElementById('overallVacancyRate').textContent = `${statistics.vacancyStats.overall}%`;
        document.getElementById('totalAdjustments').textContent = statistics.adjustmentStats.totalAdjustments;
        document.getElementById('adjustmentRate').textContent = `${statistics.adjustmentStats.adjustmentRate}%`;
        document.getElementById('totalExchanges').textContent = statistics.exchangeStats.totalExchanges;
        
        // 更新班別缺班率表格
        this.displayVacancyByShift(statistics.vacancyStats.byShift);
        
        // 更新調整原因分布表格
        this.displayAdjustmentReasons(statistics.adjustmentStats.byReason);
        
        // 更新換班原因分布表格
        this.displayExchangeReasons(statistics.exchangeStats.byReason);
        
        // 顯示分析報告
        if (report) {
            this.displayAnalysisReport(report);
        }
    },
    
    // 顯示班別缺班率
    displayVacancyByShift: function(byShift) {
        const tbody = document.getElementById('vacancyByShiftBody');
        tbody.innerHTML = '';
        
        Object.keys(byShift).forEach(shiftCode => {
            const data = byShift[shiftCode];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${shiftCode}</td>
                <td>${data.rate}%</td>
                <td>${data.vacancies}</td>
                <td>${data.required}</td>
            `;
            tbody.appendChild(tr);
        });
    },
    
    // 顯示調整原因分布
    displayAdjustmentReasons: function(byReason) {
        const tbody = document.getElementById('adjustmentReasonBody');
        tbody.innerHTML = '';
        
        const reasonMap = {
            'vacancy': '缺額調整',
            'scheduling': '排班不順調整',
            'staffing': '人力調整'
        };
        
        Object.keys(byReason).forEach(reason => {
            const data = byReason[reason];
            if (data.count > 0) {
                const tr = document.createElement('tr');
                const percentage = data.count > 0 ? ((data.count / (byReason.vacancy.count + byReason.scheduling.count + byReason.staffing.count)) * 100).toFixed(1) : 0;
                tr.innerHTML = `
                    <td>${reasonMap[reason]}</td>
                    <td>${data.count}</td>
                    <td>${percentage}%</td>
                `;
                tbody.appendChild(tr);
            }
        });
    },
    
    // 顯示換班原因分布
    displayExchangeReasons: function(byReason) {
        const tbody = document.getElementById('exchangeReasonBody');
        tbody.innerHTML = '';
        
        const reasonMap = {
            'unit_staffing_adjustment': '單位人力調整',
            'public_holiday': '公假',
            'sick_leave': '病假',
            'bereavement': '喪假',
            'support': '支援',
            'personal_factors': '個人因素',
            'other': '其他'
        };
        
        Object.keys(byReason).forEach(reason => {
            const data = byReason[reason];
            if (data.count > 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${reasonMap[reason]}</td>
                    <td>${data.count}</td>
                    <td>${data.percentage}%</td>
                `;
                tbody.appendChild(tr);
            }
        });
    },
    
    // 顯示分析報告
    displayAnalysisReport: function(report) {
        const section = document.getElementById('analysisReportSection');
        const insightsContainer = document.getElementById('insightsContainer');
        const recommendationsContainer = document.getElementById('recommendationsContainer');
        
        insightsContainer.innerHTML = '<h4>分析洞察</h4>';
        report.insights.forEach(insight => {
            const div = document.createElement('div');
            div.className = `insight-item ${insight.severity}`;
            div.innerHTML = `<strong>${insight.message}</strong>`;
            insightsContainer.appendChild(div);
        });
        
        recommendationsContainer.innerHTML = '<h4>改進建議</h4>';
        report.recommendations.forEach(rec => {
            const div = document.createElement('div');
            div.className = 'recommendation-item';
            div.textContent = rec;
            recommendationsContainer.appendChild(div);
        });
        
        section.style.display = 'block';
    },
    
    // --- 7. 切換呈現方式 ---
    switchDisplayMode: function() {
        const mode = document.getElementById('displayMode').value;
        this.currentDisplayMode = mode;
        
        document.getElementById('cardsView').style.display = mode === 'cards' ? 'block' : 'none';
        document.getElementById('tableView').style.display = mode === 'table' ? 'block' : 'none';
        document.getElementById('chartView').style.display = mode === 'chart' ? 'block' : 'none';
        
        if (mode === 'table') {
            this.displayTableView();
        } else if (mode === 'chart') {
            this.displayChartView();
        }
    },
    
    // 表格式詳細列表
    displayTableView: function() {
        const tbody = document.getElementById('statisticsTableBody');
        tbody.innerHTML = '';
        
        if (!this.currentStatistics) return;
        
        const stats = this.currentStatistics;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${stats.period}</td>
            <td>${stats.schedulingAttempts}</td>
            <td>${stats.schedulingTime.toFixed(2)}秒</td>
            <td>${stats.originalScore}分</td>
            <td>${stats.currentScore}分</td>
            <td>${stats.scoreImprovement >= 0 ? '+' : ''}${stats.scoreImprovement}分</td>
            <td>${stats.vacancyStats.overall}%</td>
            <td>${stats.adjustmentStats.adjustmentRate}%</td>
            <td>${stats.exchangeStats.totalExchanges}</td>
            <td><button class="btn btn-sm btn-info" onclick="systemStatisticsManager.viewDetails()">查看詳情</button></td>
        `;
        tbody.appendChild(tr);
    },
    
    // 圖表呈現
    displayChartView: function() {
        if (!this.currentStatistics) return;
        
        // 使用 Recharts 繪製圖表
        this.drawScoreChart();
        this.drawVacancyChart();
        this.drawAdjustmentChart();
    },
    
    // 繪製班表評分趨勢圖
    drawScoreChart: function() {
        const stats = this.currentStatistics;
        const chartContainer = document.getElementById('scoreChart');
        
        // 使用簡單的 SVG 繪製
        const data = [
            { name: '原始評分', value: stats.originalScore },
            { name: '調整後評分', value: stats.currentScore }
        ];
        
        const maxValue = Math.max(...data.map(d => d.value), 100);
        const width = chartContainer.offsetWidth || 800;
        const height = 400;
        const barWidth = width / (data.length * 2);
        const padding = 50;
        
        let svg = `<svg width="${width}" height="${height}" style="border: 1px solid #ddd;">`;
        
        // Y軸
        svg += `<line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        // X軸
        svg += `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        
        // 繪製柱子
        data.forEach((d, i) => {
            const x = padding + (i + 1) * barWidth;
            const barHeight = (d.value / maxValue) * (height - 2 * padding);
            const y = height - padding - barHeight;
            
            const color = i === 0 ? '#3498db' : '#27ae60';
            svg += `<rect x="${x}" y="${y}" width="${barWidth * 0.8}" height="${barHeight}" fill="${color}" />`;
            svg += `<text x="${x + barWidth * 0.4}" y="${height - padding + 25}" text-anchor="middle" font-size="14">${d.name}</text>`;
            svg += `<text x="${x + barWidth * 0.4}" y="${y - 10}" text-anchor="middle" font-size="14" font-weight="bold">${d.value}</text>`;
        });
        
        svg += '</svg>';
        chartContainer.innerHTML = svg;
    },
    
    // 繪製缺班率趨勢圖
    drawVacancyChart: function() {
        const stats = this.currentStatistics;
        const chartContainer = document.getElementById('vacancyChart');
        
        const data = Object.keys(stats.vacancyStats.byShift).map(shift => ({
            name: shift,
            value: stats.vacancyStats.byShift[shift].rate
        }));
        
        const maxValue = Math.max(...data.map(d => d.value), 10);
        const width = chartContainer.offsetWidth || 800;
        const height = 400;
        const barWidth = width / (data.length * 2);
        const padding = 50;
        
        let svg = `<svg width="${width}" height="${height}" style="border: 1px solid #ddd;">`;
        
        // Y軸
        svg += `<line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        // X軸
        svg += `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        
        // 繪製柱子
        data.forEach((d, i) => {
            const x = padding + (i + 1) * barWidth;
            const barHeight = (d.value / maxValue) * (height - 2 * padding);
            const y = height - padding - barHeight;
            
            const color = d.value > 10 ? '#e74c3c' : d.value > 5 ? '#f39c12' : '#27ae60';
            svg += `<rect x="${x}" y="${y}" width="${barWidth * 0.8}" height="${barHeight}" fill="${color}" />`;
            svg += `<text x="${x + barWidth * 0.4}" y="${height - padding + 25}" text-anchor="middle" font-size="14">${d.name}</text>`;
            svg += `<text x="${x + barWidth * 0.4}" y="${y - 10}" text-anchor="middle" font-size="14" font-weight="bold">${d.value}%</text>`;
        });
        
        svg += '</svg>';
        chartContainer.innerHTML = svg;
    },
    
    // 繪製修正率趨勢圖
    drawAdjustmentChart: function() {
        const stats = this.currentStatistics;
        const chartContainer = document.getElementById('adjustmentChart');
        
        const data = [
            { name: '修正率', value: stats.adjustmentStats.adjustmentRate }
        ];
        
        const maxValue = 20;
        const width = chartContainer.offsetWidth || 800;
        const height = 400;
        const barWidth = width / 4;
        const padding = 50;
        
        let svg = `<svg width="${width}" height="${height}" style="border: 1px solid #ddd;">`;
        
        // Y軸
        svg += `<line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        // X軸
        svg += `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#333" stroke-width="2"/>`;
        
        // 繪製柱子
        const x = padding + barWidth;
        const barHeight = (data[0].value / maxValue) * (height - 2 * padding);
        const y = height - padding - barHeight;
        
        const color = data[0].value > 15 ? '#e74c3c' : data[0].value > 10 ? '#f39c12' : '#27ae60';
        svg += `<rect x="${x}" y="${y}" width="${barWidth * 0.8}" height="${barHeight}" fill="${color}" />`;
        svg += `<text x="${x + barWidth * 0.4}" y="${height - padding + 25}" text-anchor="middle" font-size="14">${data[0].name}</text>`;
        svg += `<text x="${x + barWidth * 0.4}" y="${y - 10}" text-anchor="middle" font-size="14" font-weight="bold">${data[0].value}%</text>`;
        
        svg += '</svg>';
        chartContainer.innerHTML = svg;
    },
    
    // 查看詳情
    viewDetails: function() {
        if (this.currentReport) {
            this.displayAnalysisReport(this.currentReport);
        }
    }
};

// 新增 CSV 導出功能
systemStatisticsManager.exportToCSV = function() {
    if (!this.currentStatistics) {
        alert('沒有統計資料可以導出');
        return;
    }
    
    const stats = this.currentStatistics;
    const lines = [
        '統計項目,數值',
        '統計時間,' + stats.period,
        '排班次數,' + stats.schedulingAttempts,
        '排班時間(秒),' + stats.schedulingTime.toFixed(2),
        '原始評分,' + stats.originalScore,
        '調整後評分,' + stats.currentScore,
        '評分變化,' + stats.scoreImprovement,
        '整體缺班率(%),' + stats.vacancyStats.overall,
        '修正次數,' + stats.adjustmentStats.totalAdjustments,
        '修正率(%),' + stats.adjustmentStats.adjustmentRate,
        '換班次數,' + stats.exchangeStats.totalExchanges
    ];
    
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '統計_' + stats.period + '.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
