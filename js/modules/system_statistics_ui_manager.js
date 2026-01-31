// 系統統計 UI 管理模組
// 負責系統統計頁面的 UI 邏輯和交互

const systemStatisticsManager = {
    currentStatistics: null,
    currentReport: null,
    currentDisplayMode: 'cards',
    
    // --- 1. 初始化 ---
    init: async function() {
        console.log("System Statistics Manager Init");
        
        // ✅ 權限檢查 - 使用當前有效角色
        const activeRole = app.impersonatedRole || app.userRole;
        
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法查看系統統計</p>
                </div>
            `;
            return;
        }
        
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
            let query = db.collection('units');
            const unitSelect = document.getElementById('unitFilter');
            
            // ✅ 權限過濾 - 使用當前有效角色和單位
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
                }
            }
            
            const snapshot = await query.get();
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name || doc.id;
                unitSelect.appendChild(option);
            });
            
            // ✅ 如果只有一個單位，自動選取並限制
            if (snapshot.size === 1 && (activeRole === 'unit_manager' || activeRole === 'unit_scheduler')) {
                unitSelect.selectedIndex = 1;
                unitSelect.disabled = true;
                unitSelect.style.backgroundColor = '#f5f5f5';
            }
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
            
            // ✅ 權限檢查：單位管理者必須選擇單位 - 使用當前有效角色和單位
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (!unitId && (activeRole === 'unit_manager' || activeRole === 'unit_scheduler')) {
                alert('請選擇單位');
                return;
            }
            
            let scheduleQuery = db.collection('schedules');
            
            if (unitId) {
                scheduleQuery = scheduleQuery.where('unitId', '==', unitId);
            } else if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                // ✅ 如果是單位管理者但沒選單位，使用其單位ID
                if (activeUnitId) {
                    scheduleQuery = scheduleQuery.where('unitId', '==', activeUnitId);
                }
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
            const statistics = await this.calculateStatistics(
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
        
        // 使用 systemStatisticsCalculator 計算統計
        const statistics = await systemStatisticsCalculator.aggregateStatistics(
            scheduleData,
            staffList,
            exchanges,
            year,
            month
        );
        
        return statistics;
    },
    
    // --- 6. 顯示統計資料 ---
    displayStatistics: function(statistics, report) {
        const container = document.getElementById('statisticsDisplay');
        if (!container) return;
        
        // 根據顯示模式渲染
        if (this.currentDisplayMode === 'cards') {
            this.renderCardsView(statistics, container);
        } else {
            this.renderTableView(statistics, container);
        }
        
        // 顯示分析報告
        if (report) {
            this.displayReport(report);
        }
    },
    
    // --- 7. 卡片視圖 ---
    renderCardsView: function(statistics, container) {
        const formatted = systemStatisticsCalculator.formatStatisticsForDisplay(statistics);
        if (!formatted) return;
        
        container.innerHTML = `
            <div class="statistics-cards">
                <!-- 基本資訊卡 -->
                <div class="stat-card">
                    <div class="stat-card-header">
                        <i class="fas fa-calendar"></i>
                        <h3>基本資訊</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item">
                            <span class="stat-label">統計期間</span>
                            <span class="stat-value">${formatted.period}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">排班嘗試次數</span>
                            <span class="stat-value">${formatted.schedulingAttempts}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">排班耗時</span>
                            <span class="stat-value">${formatted.schedulingTime}</span>
                        </div>
                    </div>
                </div>
                
                <!-- 評分卡 -->
                <div class="stat-card">
                    <div class="stat-card-header">
                        <i class="fas fa-star"></i>
                        <h3>班表評分</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item">
                            <span class="stat-label">原始分數</span>
                            <span class="stat-value">${formatted.originalScore}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">當前分數</span>
                            <span class="stat-value">${formatted.currentScore}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">分數改善</span>
                            <span class="stat-value ${statistics.scoreImprovement >= 0 ? 'positive' : 'negative'}">
                                ${formatted.scoreImprovement}
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- 缺班統計卡 -->
                <div class="stat-card">
                    <div class="stat-card-header">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>缺班統計</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item">
                            <span class="stat-label">整體缺班率</span>
                            <span class="stat-value ${statistics.vacancyStats.overall > 5 ? 'warning' : 'success'}">
                                ${formatted.overallVacancyRate}
                            </span>
                        </div>
                        <div class="stat-detail">
                            <h4>各班別缺班率</h4>
                            ${Object.keys(formatted.vacancyByShift).map(shift => `
                                <div class="shift-vacancy">
                                    <span>${shift}</span>
                                    <span class="${formatted.vacancyByShift[shift].rate > 5 ? 'warning' : 'success'}">
                                        ${formatted.vacancyByShift[shift].rate}%
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- 調整統計卡 -->
                <div class="stat-card">
                    <div class="stat-card-header">
                        <i class="fas fa-edit"></i>
                        <h3>調整統計</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item">
                            <span class="stat-label">總調整次數</span>
                            <span class="stat-value">${formatted.totalAdjustments}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">調整率</span>
                            <span class="stat-value ${statistics.adjustmentStats.adjustmentRate > 10 ? 'warning' : 'info'}">
                                ${formatted.adjustmentRate}
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- 換班統計卡 -->
                <div class="stat-card">
                    <div class="stat-card-header">
                        <i class="fas fa-exchange-alt"></i>
                        <h3>換班統計</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item">
                            <span class="stat-label">總換班次數</span>
                            <span class="stat-value">${formatted.totalExchanges}</span>
                        </div>
                        <div class="stat-detail">
                            <h4>換班原因分布</h4>
                            ${Object.keys(formatted.exchangeByReason).map(reason => `
                                <div class="reason-item">
                                    <span>${this.getReasonLabel(reason)}</span>
                                    <span>${formatted.exchangeByReason[reason].count} (${formatted.exchangeByReason[reason].percentage}%)</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },
    
    // --- 8. 表格視圖 ---
    renderTableView: function(statistics, container) {
        // 實現表格視圖
        container.innerHTML = '<p>表格視圖開發中...</p>';
    },
    
    // --- 9. 顯示分析報告 ---
    displayReport: function(report) {
        const reportContainer = document.getElementById('analysisReport');
        if (!reportContainer) return;
        
        reportContainer.innerHTML = `
            <div class="report-section">
                <h3>${report.title}</h3>
                <div class="report-summary">
                    ${report.summary}
                </div>
                <div class="report-recommendations">
                    <h4>建議事項</h4>
                    <ul>
                        ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    },
    
    // --- 10. 切換顯示模式 ---
    toggleDisplayMode: function(mode) {
        this.currentDisplayMode = mode;
        
        // 更新按鈕狀態
        document.querySelectorAll('.display-mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');
        
        // 重新渲染
        if (this.currentStatistics) {
            this.displayStatistics(this.currentStatistics, this.currentReport);
        }
    },
    
    // --- 11. 匯出報告 ---
    exportReport: function(format) {
        if (!this.currentStatistics) {
            alert('請先載入統計資料');
            return;
        }
        
        if (format === 'pdf') {
            this.exportToPDF();
        } else if (format === 'excel') {
            this.exportToExcel();
        } else if (format === 'csv') {
            this.exportToCSV();
        }
    },
    
    exportToPDF: function() {
        alert('PDF 匯出功能開發中');
    },
    
    exportToExcel: function() {
        alert('Excel 匯出功能開發中');
    },
    
    exportToCSV: function() {
        alert('CSV 匯出功能開發中');
    },
    
    // --- 12. 工具函數 ---
    getReasonLabel: function(reason) {
        const labels = {
            'unit_staffing_adjustment': '單位人力調整',
            'public_holiday': '國定假日',
            'sick_leave': '病假',
            'bereavement': '喪假',
            'support': '支援',
            'personal_factors': '個人因素',
            'other': '其他'
        };
        return labels[reason] || reason;
    }
};
