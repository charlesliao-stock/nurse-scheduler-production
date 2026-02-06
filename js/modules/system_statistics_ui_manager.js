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
        console.log("🔍 開始執行 loadStatistics...");
        try {
            const unitId = document.getElementById('unitFilter').value;
            const queryType = document.getElementById('queryType').value;
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (!unitId && (activeRole === 'unit_manager' || activeRole === 'unit_scheduler')) {
                if (!activeUnitId) {
                    alert('請選擇單位');
                    return;
                }
            }
            
            let scheduleQuery = db.collection('schedules');
            const targetUnitId = unitId || activeUnitId;
            if (targetUnitId) {
                scheduleQuery = scheduleQuery.where('unitId', '==', targetUnitId);
            }
            
            if (queryType === 'month') {
                const monthStr = document.getElementById('statisticsMonth').value;
                if (!monthStr) { alert('請選擇月份'); return; }
                const [year, month] = monthStr.split('-').map(Number);
                scheduleQuery = scheduleQuery.where('year', '==', year).where('month', '==', month);
            } else {
                const startMonthStr = document.getElementById('startMonth').value;
                const endMonthStr = document.getElementById('endMonth').value;
                if (!startMonthStr || !endMonthStr) { alert('請選擇開始和結束月份'); return; }
                const [startYear, startMonth] = startMonthStr.split('-').map(Number);
                const [endYear, endMonth] = endMonthStr.split('-').map(Number);
                const startDate = new Date(startYear, startMonth - 1, 1);
                const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
                scheduleQuery = scheduleQuery.where('updatedAt', '>=', startDate).where('updatedAt', '<=', endDate);
            }
            
            console.log("📡 正在從 Firestore 抓取資料...");
            const snapshot = await scheduleQuery.get();
            
            if (snapshot.empty) {
                console.log("⚠️ 找不到符合條件的班表資料");
                alert('找不到符合條件的班表資料');
                return;
            }
            
            console.log(`✅ 找到 ${snapshot.size} 份班表資料`);
            let scheduleDoc = snapshot.docs.find(doc => doc.data().status === 'published');
            if (!scheduleDoc) scheduleDoc = snapshot.docs[0]; 
            
            const scheduleData = scheduleDoc.data();
            console.log("📊 正在載入換班申請...");
            const exchangeSnapshot = await db.collection('shift_requests').where('scheduleId', '==', scheduleDoc.id).get();
            const exchanges = exchangeSnapshot.docs.map(doc => doc.data());
            
            console.log("🧮 正在計算統計數據...");
            const statistics = await this.calculateStatistics(scheduleData, exchanges);
            
            this.currentStatistics = statistics;
            console.log("📈 統計數據計算完成:", statistics);
            
            this.displayStatistics(statistics);
            
        } catch (e) {
            console.error('❌ 載入統計資料失敗:', e);
            alert('載入失敗: ' + e.message);
        }
    },
    
    // --- 5. 計算統計資料 ---
    calculateStatistics: async function(scheduleData, exchanges) {
        const year = scheduleData.year || new Date().getFullYear();
        const month = scheduleData.month || new Date().getMonth() + 1;
        const staffList = scheduleData.staffList || [];
        
        if (typeof systemStatisticsCalculator === 'undefined') {
            throw new Error("找不到統計計算模組 (systemStatisticsCalculator)");
        }

        const statistics = await systemStatisticsCalculator.aggregateStatistics(
            scheduleData,
            staffList,
            exchanges,
            year,
            month
        );
        
        statistics.status = scheduleData.status;
        statistics.staffCount = staffList.length;
        
        return statistics;
    },
    
    // --- 6. 顯示統計資料 ---
    displayStatistics: function(statistics) {
        console.log("🖥️ 正在渲染 UI...");
        const formatted = systemStatisticsCalculator.formatStatisticsForDisplay(statistics);
        if (!formatted) return;

        // 1. 更新卡片數值 (對應 HTML 中的 ID)
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('schedulingAttempts', statistics.schedulingAttempts || 1);
        setVal('schedulingTime', formatted.schedulingTime);
        setVal('originalScore', formatted.originalScore);
        setVal('currentScore', formatted.currentScore);
        setVal('scoreImprovement', formatted.scoreImprovement);
        setVal('overallVacancyRate', formatted.overallVacancyRate);
        setVal('totalAdjustments', statistics.adjustmentStats?.totalAdjustments || 0);
        setVal('adjustmentRate', formatted.adjustmentRate);
        setVal('totalExchanges', statistics.exchangeStats?.totalExchanges || 0);

        // 2. 渲染班別缺班率表格
        const vacancyBody = document.getElementById('vacancyByShiftBody');
        if (vacancyBody) {
            vacancyBody.innerHTML = '';
            const byShift = statistics.vacancyStats?.byShift || {};
            Object.keys(byShift).forEach(shift => {
                const s = byShift[shift];
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${shift}</td><td>${s.rate}%</td><td>${s.vacancies}</td><td>${s.required}</td>`;
                vacancyBody.appendChild(tr);
            });
        }

        // 3. 渲染調整原因表格
        const adjBody = document.getElementById('adjustmentReasonBody');
        if (adjBody) {
            adjBody.innerHTML = '';
            const byReason = statistics.adjustmentStats?.byReason || {};
            Object.keys(byReason).forEach(reason => {
                const r = byReason[reason];
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${this.translateAdjReason(reason)}</td><td>${r.count}</td><td>-</td>`;
                adjBody.appendChild(tr);
            });
        }

        // 4. 渲染換班原因表格
        const exBody = document.getElementById('exchangeReasonBody');
        if (exBody) {
            exBody.innerHTML = '';
            const byReason = statistics.exchangeStats?.byReason || {};
            Object.keys(byReason).forEach(reason => {
                const r = byReason[reason];
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${this.translateExReason(reason)}</td><td>${r.count}</td><td>${r.percentage}%</td>`;
                exBody.appendChild(tr);
            });
        }

        console.log("✨ UI 渲染完成");
    },

    translateAdjReason: function(reason) {
        const map = { 'vacancy': '缺額調整', 'scheduling': '排班優化', 'staffing': '人力調度' };
        return map[reason] || reason;
    },

    translateExReason: function(reason) {
        const map = { 
            'unit_staffing_adjustment': '單位人力調整', 
            'public_holiday': '國定假日', 
            'sick_leave': '病假', 
            'bereavement': '喪假', 
            'support': '支援', 
            'personal_factors': '個人因素', 
            'other': '其他' 
        };
        return map[reason] || reason;
    },

    switchDisplayMode: function() {
        this.currentDisplayMode = document.getElementById('displayMode').value;
        if (this.currentStatistics) this.displayStatistics(this.currentStatistics);
    },

    // --- 10. 匯出 CSV ---
    exportToCSV: function() {
        if (!this.currentStatistics) {
            alert("請先查詢統計資料");
            return;
        }

        const stats = this.currentStatistics;
        const formatted = systemStatisticsCalculator.formatStatisticsForDisplay(stats);
        
        let csvContent = "\uFEFF"; // UTF-8 BOM
        csvContent += "統計項目,數值\n";
        csvContent += `統計期間,${formatted.period}\n`;
        csvContent += `排班人數,${stats.staffCount} 人\n`;
        csvContent += `班表狀態,${stats.status === 'published' ? '已發布' : '草稿'}\n`;
        csvContent += `排班嘗試次數,${stats.schedulingAttempts}\n`;
        csvContent += `排班耗時,${formatted.schedulingTime}\n`;
        csvContent += `原始分數,${formatted.originalScore}\n`;
        csvContent += `當前分數,${formatted.currentScore}\n`;
        csvContent += `分數改善,${formatted.scoreImprovement}\n`;
        csvContent += `整體缺班率,${formatted.overallVacancyRate}\n`;
        csvContent += `總換班次數,${stats.exchangeStats?.totalExchanges || 0}\n`;
        csvContent += `總調整次數,${stats.adjustmentStats?.totalAdjustments || 0}\n`;

        csvContent += "\n班別,缺班率,缺班數,需求數\n";
        if (stats.vacancyStats?.byShift) {
            Object.keys(stats.vacancyStats.byShift).forEach(shift => {
                const s = stats.vacancyStats.byShift[shift];
                csvContent += `${shift},${s.rate}%,${s.vacancies},${s.required}\n`;
            });
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `系統統計_${stats.period}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
