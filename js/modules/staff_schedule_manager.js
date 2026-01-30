// js/modules/staff_schedule_manager.js
// 最終完整版：支援模擬、修正所有函數

const staffScheduleManager = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    scheduleData: null,
    currentUid: null,
    viewMode: 'personal', // 'personal' 或 'unit'

    init: async function() {
        this.currentUid = app.getUid();
        
        if (!this.currentUid) {
            this.showError('無法取得使用者資訊');
            return;
        }

        console.log(`📋 初始化個人班表查詢 - UID: ${this.currentUid}`);
        console.log(`📍 使用單位: ${app.getUnitId()}`);
        console.log(`👤 使用角色: ${app.impersonatedRole || app.userRole}`);
        
        await this.displayCurrentUser();
        this.setupMonthPicker();
        await this.loadSchedule();
    },

    displayCurrentUser: async function() {
        try {
            const userDoc = await db.collection('users').doc(this.currentUid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const userName = userData.displayName || userData.name || '未命名';
                const userUnit = userData.unitId || '未設定';
                
                const infoDiv = document.createElement('div');
                infoDiv.id = 'currentUserInfo';
                infoDiv.style.cssText = 'background: #e3f2fd; padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #2196f3;';
                infoDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-user-circle" style="font-size: 24px; color: #2196f3;"></i>
                        <div>
                            <strong style="font-size: 1.1rem; color: #1976d2;">${userName}</strong>
                            <span style="margin-left: 10px; color: #666; font-size: 0.9rem;">單位: ${userUnit}</span>
                        </div>
                    </div>
                `;
                
                // 移除舊的資訊框（如果存在）
                const oldInfo = document.getElementById('currentUserInfo');
                if (oldInfo) oldInfo.remove();
                
                const monthPicker = document.querySelector('.month-picker');
                if (monthPicker && monthPicker.parentNode) {
                    monthPicker.parentNode.insertBefore(infoDiv, monthPicker);
                }
                
                console.log(`✅ 當前查詢人員: ${userName} (${this.currentUid})`);
            }
        } catch (error) {
            console.error('顯示使用者資訊失敗:', error);
        }
    },

    setupMonthPicker: function() {
        const input = document.getElementById('monthPicker');
        if (!input) {
            console.warn('找不到 monthPicker 元素');
            return;
        }

        input.value = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
        
        input.addEventListener('change', (e) => {
            const [year, month] = e.target.value.split('-');
            this.currentYear = parseInt(year);
            this.currentMonth = parseInt(month);
            this.loadSchedule();
        });
    },

    // 按鈕會呼叫的函數
    loadData: async function() {
        await this.loadSchedule();
    },

    loadSchedule: async function() {
        const container = document.getElementById('scheduleTableContainer');
        if (!container) {
            console.error('找不到 scheduleTableContainer 元素');
            return;
        }

        container.innerHTML = '<div style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><p>載入中...</p></div>';

        try {
            console.log(`🔍 查詢 ${this.currentYear}/${this.currentMonth} 的班表`);
            console.log(`   UID: ${this.currentUid}`);
            
            const unitId = app.getUnitId();
            if (!unitId) {
                this.showError('無法取得單位資訊');
                return;
            }

            console.log(`   單位: ${unitId}`);

            const snapshot = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .where('year', '==', this.currentYear)
                .where('month', '==', this.currentMonth)
                .where('status', '==', 'published')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('❌ 查無已發布班表');
                this.showNoSchedule();
                return;
            }

            const doc = snapshot.docs[0];
            this.scheduleData = { id: doc.id, ...doc.data() };
            
            console.log(`✅ 找到班表: ${doc.id}`);
            console.log(`📋 班表人員數: ${this.scheduleData.staffList?.length || 0}`);
            console.log(`📋 Assignments 包含 UID: ${Object.keys(this.scheduleData.assignments || {}).length} 位`);

            if (this.scheduleData.assignments && this.scheduleData.assignments[this.currentUid]) {
                console.log(`✅ 找到 UID ${this.currentUid} 的班表資料`);
                
                // 根據當前檢視模式渲染
                if (this.viewMode === 'unit') {
                    this.renderAllStaff();
                } else {
                    this.renderSchedule();
                }
                
                this.renderStatistics();
            } else {
                console.warn(`⚠️ UID ${this.currentUid} 不在班表中`);
                console.log('📋 班表中的前 5 個 UID:', Object.keys(this.scheduleData.assignments || {}).slice(0, 5));
                this.showError('您不在本月班表中');
            }

        } catch (error) {
            console.error('❌ 載入班表失敗:', error);
            this.showError('載入失敗: ' + error.message);
        }
    },

    renderSchedule: function() {
        const container = document.getElementById('scheduleTableContainer');
        if (!container) return;

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        
        console.log(`📅 渲染個人班表 - ${this.currentYear}/${this.currentMonth} (${daysInMonth} 天)`);

        let html = '<div style="overflow-x: auto;"><table class="schedule-table"><thead><tr><th style="min-width: 100px;">姓名</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            html += `<th style="background:${isWeekend ? '#ffebee' : '#fff'}; color:${isWeekend ? '#d32f2f' : '#333'}; min-width: 50px;">
                ${d}<br><small>${weekdayName}</small>
            </th>`;
        }
        
        html += '<th style="min-width: 120px;">統計</th></tr></thead><tbody><tr>';
        
        const userName = this.getUserName();
        html += `<td style="position:sticky; left:0; background:#f5f5f5; font-weight:bold; z-index:10;">${userName}</td>`;
        
        const shiftCounts = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
            
            const isOff = shift === 'OFF' || shift === 'REQ_OFF';
            const cellStyle = isOff ? 
                'background:#e8f5e9; color:#2e7d32;' : 
                'background:#e3f2fd; color:#1565c0;';
            
            html += `<td style="${cellStyle} text-align:center; font-weight:bold; padding: 8px;">${shift}</td>`;
        }
        
        const statsHtml = Object.entries(shiftCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([shift, count]) => `<div style="padding: 2px 0;">${shift}: ${count}</div>`)
            .join('');
        
        html += `<td style="font-size:0.85rem; line-height:1.5;">${statsHtml}</td>`;
        html += '</tr></tbody></table></div>';
        
        container.innerHTML = html;
        
        // 更新檢視模式切換按鈕狀態
        const showAllCheckbox = document.getElementById('showAllStaff');
        if (showAllCheckbox) {
            showAllCheckbox.checked = false;
            const currentRole = app.impersonatedRole || app.userRole;
            if (currentRole === 'unit_manager' || currentRole === 'unit_scheduler' || currentRole === 'system_admin') {
                showAllCheckbox.parentElement.style.display = 'inline-block';
            } else {
                showAllCheckbox.parentElement.style.display = 'none';
            }
        }
    },

    renderStatistics: function() {
        const statsDiv = document.getElementById('scheduleStats');
        if (!statsDiv) return;

        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        
        let workDays = 0;
        let offDays = 0;
        let nightShifts = 0;
        const shiftCounts = {};
        
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                offDays++;
            } else {
                workDays++;
                if (shift === 'N' || shift.includes('夜')) {
                    nightShifts++;
                }
            }
            
            shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
        }
        
        let maxConsecutive = 0;
        let currentConsecutive = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            if (shift !== 'OFF' && shift !== 'REQ_OFF') {
                currentConsecutive++;
                maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
            } else {
                currentConsecutive = 0;
            }
        }
        
        let html = '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-top:20px;">';
        
        html += `
            <div class="stat-card">
                <div class="stat-icon" style="background:#4caf50;"><i class="fas fa-briefcase"></i></div>
                <div class="stat-value">${workDays}</div>
                <div class="stat-label">工作天數</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background:#2196f3;"><i class="fas fa-umbrella-beach"></i></div>
                <div class="stat-value">${offDays}</div>
                <div class="stat-label">休假天數</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background:#9c27b0;"><i class="fas fa-moon"></i></div>
                <div class="stat-value">${nightShifts}</div>
                <div class="stat-label">夜班天數</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background:#ff9800;"><i class="fas fa-chart-line"></i></div>
                <div class="stat-value">${maxConsecutive}</div>
                <div class="stat-label">最長連上</div>
            </div>
        `;
        
        html += '</div>';
        
        html += '<div style="margin-top:20px; padding:15px; background:#f5f5f5; border-radius:8px;">';
        html += '<h4 style="margin:0 0 10px 0;"><i class="fas fa-chart-pie"></i> 班別分佈</h4>';
        html += '<div style="display:flex; flex-wrap:wrap; gap:10px;">';
        
        Object.entries(shiftCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([shift, count]) => {
                const percent = ((count / daysInMonth) * 100).toFixed(1);
                html += `<div style="padding:8px 12px; background:white; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                    <strong>${shift}</strong>: ${count} 天 (${percent}%)
                </div>`;
            });
        
        html += '</div></div>';
        
        statsDiv.innerHTML = html;
    },

    getUserName: function() {
        if (!this.scheduleData || !this.scheduleData.staffList) {
            return '查無姓名';
        }
        
        const staff = this.scheduleData.staffList.find(s => s.uid === this.currentUid);
        return staff ? (staff.name || staff.displayName || '未命名') : '查無姓名';
    },

    showNoSchedule: function() {
        const container = document.getElementById('scheduleTableContainer');
        if (!container) return;
        
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px;">
                <i class="fas fa-calendar-times" style="font-size:4rem; color:#bbb; margin-bottom:15px;"></i>
                <h3 style="color:#666;">本月尚無已發布班表</h3>
                <p style="color:#999;">請聯繫排班人員或護理長</p>
            </div>
        `;
        
        const statsDiv = document.getElementById('scheduleStats');
        if (statsDiv) statsDiv.innerHTML = '';
    },

    showError: function(message) {
        const container = document.getElementById('scheduleTableContainer');
        if (!container) return;
        
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px;">
                <i class="fas fa-exclamation-triangle" style="font-size:4rem; color:#f44336; margin-bottom:15px;"></i>
                <h3 style="color:#666;">${message}</h3>
            </div>
        `;
        
        const statsDiv = document.getElementById('scheduleStats');
        if (statsDiv) statsDiv.innerHTML = '';
    },

    // 🔥 新增：檢視模式切換（HTML 會呼叫）
    toggleViewMode: function(checkbox) {
        if (!checkbox) {
            checkbox = document.getElementById('showAllStaff');
        }
        
        const isChecked = checkbox ? checkbox.checked : false;
        
        console.log(`🔄 切換檢視模式: ${isChecked ? '全單位' : '個人'}`);
        
        if (isChecked) {
            this.viewMode = 'unit';
            this.renderAllStaff();
        } else {
            this.viewMode = 'personal';
            this.renderSchedule();
        }
    },

    // 🔥 舊版相容：toggleAllStaff
    toggleAllStaff: function(checked) {
        this.toggleViewMode({ checked: checked });
    },

    renderAllStaff: function() {
        const container = document.getElementById('scheduleTableContainer');
        if (!container || !this.scheduleData) return;

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const staffList = this.scheduleData.staffList || [];
        
        console.log(`📋 渲染全單位班表 - ${staffList.length} 位人員`);

        let html = '<div style="overflow-x: auto;"><table class="schedule-table"><thead><tr><th style="min-width: 100px;">姓名</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            html += `<th style="background:${isWeekend ? '#ffebee' : '#fff'}; color:${isWeekend ? '#d32f2f' : '#333'}; min-width: 50px;">
                ${d}<br><small>${weekdayName}</small>
            </th>`;
        }
        
        html += '</tr></thead><tbody>';
        
        staffList.forEach(staff => {
            const assignments = this.scheduleData.assignments[staff.uid] || {};
            const isCurrent = staff.uid === this.currentUid;
            
            html += `<tr ${isCurrent ? 'style="background:#fff9c4;"' : ''}>`;
            html += `<td style="position:sticky; left:0; background:${isCurrent ? '#fff9c4' : '#f5f5f5'}; font-weight:${isCurrent ? 'bold' : 'normal'}; z-index:10;">
                ${staff.name || staff.displayName || '未命名'}
                ${isCurrent ? ' <i class="fas fa-star" style="color:#ff9800;"></i>' : ''}
            </td>`;
            
            for (let d = 1; d <= daysInMonth; d++) {
                const shift = assignments[`current_${d}`] || 'OFF';
                const isOff = shift === 'OFF' || shift === 'REQ_OFF';
                const cellStyle = isOff ? 
                    'background:#e8f5e9; color:#2e7d32;' : 
                    'background:#e3f2fd; color:#1565c0;';
                
                html += `<td style="${cellStyle} text-align:center; padding: 8px;">${shift}</td>`;
            }
            
            html += '</tr>';
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
        
        // 更新檢視模式切換按鈕狀態
        const showAllCheckbox = document.getElementById('showAllStaff');
        if (showAllCheckbox) {
            showAllCheckbox.checked = true;
        }
    }
};
