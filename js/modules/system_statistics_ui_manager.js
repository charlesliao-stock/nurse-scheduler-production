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
        const monthInput = document.getElementById('statisticsMonth');
        if (monthInput) monthInput.value = `${year}-${month}`;
        
        // 載入單位列表
        await this.loadUnits();
    },
    
    // --- 2. 載入單位列表 ---
    loadUnits: async function() {
        try {
            let query = db.collection('units');
            const unitSelect = document.getElementById('unitFilter');
            if (!unitSelect) return;
            
            // ✅ 權限過濾 - 使用當前有效角色和單位
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
                }
            }
            
            const snapshot = await query.get();
            unitSelect.innerHTML = '<option value="">所有單位</option>';
            
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
            if (monthGroup) monthGroup.style.display = 'block';
            if (rangeGroup) rangeGroup.style.display = 'none';
        } else {
            if (monthGroup) monthGroup.style.display = 'none';
            if (rangeGroup) rangeGroup.style.display = 'flex';
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
                if (!activeUnitId) {
                    alert('請選擇單位');
                    return;
                }
            }
            
            let scheduleQuery = db.collection('schedules');
            
            // 優先使用選擇的單位，若無則使用當前單位
            const targetUnitId = unitId || activeUnitId;
            if (targetUnitId) {
                scheduleQuery = scheduleQuery.where('unitId', '==', targetUnitId);
            }
            
            // 根據查詢方式篩選
            if (queryType === 'month') {
                const monthStr = document.getElementById('statisticsMonth').value;
                if (!monthStr) {
                    alert('請選擇月份');
                    return;
                }
                
                const [year, month] = monthStr.split('-').map(Number);
                // 🔥 修正：改用 year 和 month 欄位查詢，而非 createdAt
                scheduleQuery = scheduleQuery
                    .where('year', '==', year)
                    .where('month', '==', month);
            } else {
                const startMonthStr = document.getElementById('startMonth').value;
                const endMonthStr = document.getElementById('endMonth').value;
                
                if (!startMonthStr || !endMonthStr) {
                    alert('請選擇開始和結束月份');
                    return;
                }
                
                const [startYear, startMonth] = startMonthStr.split('-').map(Number);
                const [endYear, endMonth] = endMonthStr.split('-').map(Number);
                
                // 範圍查詢在 Firestore 較複雜，此處先以單月邏輯為主，或改用 createdAt 輔助
                // 為了簡化且精確，建議統計以單月為主，或在此處進行前端過濾
                const startDate = new Date(startYear, startMonth - 1, 1);
                const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
                
                scheduleQuery = scheduleQuery
                    .where('updatedAt', '>=', startDate)
                    .where('updatedAt', '<=', endDate);
            }
            
            const snapshot = await scheduleQuery.get();
            
            if (snapshot.empty) {
                alert('找不到符合條件的班表資料');
                return;
            }
            
            // 篩選出已發布或最新的班表
            let scheduleDoc = snapshot.docs.find(doc => doc.data().status === 'published');
            if (!scheduleDoc) scheduleDoc = snapshot.docs[0]; // 若無已發布，取第一個
            
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
            const report = typeof analysisReportGenerator !== 'undefined' ? 
                analysisReportGenerator.generateReport(statistics) : null;
            
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
            <div class="statistics-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px;">
                <!-- 基本資訊卡 -->
                <div class="stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                    <div class="stat-card-header" style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-calendar" style="color: #3498db;"></i>
                        <h3 style="margin: 0; font-size: 1.1rem;">基本資訊</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">統計期間</span>
                            <span class="stat-value" style="font-weight: bold;">${formatted.period}</span>
                        </div>
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">排班人數</span>
                            <span class="stat-value" style="font-weight: bold;">${statistics.staffCount || 0} 人</span>
                        </div>
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">班表狀態</span>
                            <span class="stat-value" style="font-weight: bold; color: #27ae60;">${statistics.status === 'published' ? '已發布' : '草稿'}</span>
                        </div>
                    </div>
                </div>
                
                <!-- 評分卡 -->
                <div class="stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                    <div class="stat-card-header" style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-star" style="color: #f1c40f;"></i>
                        <h3 style="margin: 0; font-size: 1.1rem;">班表評分</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">當前分數</span>
                            <span class="stat-value" style="font-weight: bold; font-size: 1.2rem; color: #2c3e50;">${formatted.currentScore}</span>
                        </div>
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">規則達成率</span>
                            <span class="stat-value" style="font-weight: bold;">${statistics.ruleCompliance || 0}%</span>
                        </div>
                    </div>
                </div>
                
                <!-- 換班統計卡 -->
                <div class="stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                    <div class="stat-card-header" style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-exchange-alt" style="color: #e67e22;"></i>
                        <h3 style="margin: 0; font-size: 1.1rem;">換班統計</h3>
                    </div>
                    <div class="stat-card-body">
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">總換班次數</span>
                            <span class="stat-value" style="font-weight: bold;">${statistics.exchangeCount || 0} 次</span>
                        </div>
                        <div class="stat-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span class="stat-label" style="color: #7f8c8d;">成功換班</span>
                            <span class="stat-value" style="font-weight: bold; color: #27ae60;">${statistics.successfulExchanges || 0} 次</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },
    
    // --- 8. 表格視圖 ---
    renderTableView: function(statistics, container) {
        // 實作表格視圖渲染
        container.innerHTML = '<div style="padding: 20px; background: white; border-radius: 8px;">表格視圖開發中...</div>';
    },
    
    // --- 9. 顯示報告 ---
    displayReport: function(report) {
        const reportContainer = document.getElementById('reportDisplay');
        if (reportContainer) {
            reportContainer.innerHTML = report;
            reportContainer.style.display = 'block';
        }
    }
};
