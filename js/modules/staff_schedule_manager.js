// js/modules/staff_schedule_manager.js
// 完整版：配合現有 HTML 結構，支援模擬、換班選擇

const staffScheduleManager = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    scheduleData: null,
    currentUid: null,
    viewMode: 'personal', // 'personal' 或 'unit'
    
    // 換班選擇
    selectedCell: null,
    selectedDay: null,
    selectedShift: null,

    init: async function() {
        this.currentUid = app.getUid();
        
        if (!this.currentUid) {
            this.showError('無法取得使用者資訊');
            return;
        }

        console.log(`📋 初始化個人班表查詢 - UID: ${this.currentUid}`);
        console.log(`📍 使用單位: ${app.getUnitId()}`);
        console.log(`👤 使用角色: ${app.impersonatedRole || app.userRole}`);
        
        this.setupMonthPicker();
        await this.loadData();
    },

    setupMonthPicker: function() {
        const input = document.getElementById('scheduleMonth');
        if (!input) {
            console.warn('⚠️ 找不到 scheduleMonth 元素');
            return;
        }

        // 設定預設值
        input.value = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
        
        // 監聽變更
        input.addEventListener('change', (e) => {
            const [year, month] = e.target.value.split('-');
            this.currentYear = parseInt(year);
            this.currentMonth = parseInt(month);
        });
    },

    loadData: async function() {
        // 從輸入框取得年月
        const input = document.getElementById('scheduleMonth');
        if (input && input.value) {
            const [year, month] = input.value.split('-');
            this.currentYear = parseInt(year);
            this.currentMonth = parseInt(month);
        }
        
        await this.loadSchedule();
    },

    loadSchedule: async function() {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (!wrapper) {
            console.error('❌ 找不到 horizontalScheduleWrapper');
            return;
        }

        wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><p>載入中...</p>';
        }

        try {
            console.log(`🔍 查詢 ${this.currentYear}/${this.currentMonth} 的班表`);
            
            const unitId = app.getUnitId();
            if (!unitId) {
                this.showError('無法取得單位資訊');
                return;
            }

            console.log(`   單位: ${unitId}, UID: ${this.currentUid}`);

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
            console.log(`📋 班表人員: ${this.scheduleData.staffList?.length || 0} 位`);

            if (!this.scheduleData.assignments || !this.scheduleData.assignments[this.currentUid]) {
                console.warn(`⚠️ UID ${this.currentUid} 不在班表中`);
                this.showError('您不在本月班表中');
                return;
            }

            console.log(`✅ 找到 UID ${this.currentUid} 的班表資料`);
            
            // 根據檢視模式渲染
            wrapper.style.display = 'block';
            if (noDataMsg) noDataMsg.style.display = 'none';
            
            if (this.viewMode === 'unit') {
                this.renderUnitSchedule();
            } else {
                this.renderPersonalSchedule();
            }
            
            this.updateStatistics();

        } catch (error) {
            console.error('❌ 載入班表失敗:', error);
            this.showError('載入失敗: ' + error.message);
        }
    },

    renderPersonalSchedule: function() {
        const myView = document.getElementById('myScheduleView');
        const unitView = document.getElementById('unitScheduleView');
        
        if (myView) myView.style.display = 'block';
        if (unitView) unitView.style.display = 'none';

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        
        console.log(`📅 渲染個人班表 - ${daysInMonth} 天`);

        // 渲染表頭
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        
        if (!rowWeekday || !rowDate || !rowShift) return;

        // 清空後重新填充
        rowWeekday.innerHTML = '<th style="width:100px; background:#fff;">星期</th>';
        rowDate.innerHTML = '<th style="width:100px; background:#fff;">日期</th>';
        rowShift.innerHTML = '<th style="width:100px; background:#eef2f3; vertical-align: middle;">我的班別</th>';

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            const bgColor = isWeekend ? '#ffebee' : '#fff';
            const textColor = isWeekend ? '#d32f2f' : '#333';

            rowWeekday.innerHTML += `<th style="background:${bgColor}; color:${textColor}; min-width:50px;">${weekdayName}</th>`;
            rowDate.innerHTML += `<th style="background:${bgColor}; color:${textColor}; min-width:50px;">${d}</th>`;
            
            const shift = assignments[`current_${d}`] || 'OFF';
            const isOff = shift === 'OFF' || shift === 'REQ_OFF';
            const cellBg = isOff ? '#e8f5e9' : '#e3f2fd';
            const cellColor = isOff ? '#2e7d32' : '#1565c0';
            
            rowShift.innerHTML += `<td style="background:${cellBg}; color:${cellColor}; font-weight:bold;">${shift}</td>`;
        }
    },

    renderUnitSchedule: function() {
        const myView = document.getElementById('myScheduleView');
        const unitView = document.getElementById('unitScheduleView');
        const unitHead = document.getElementById('unitHead');
        const unitBody = document.getElementById('unitBody');
        
        if (myView) myView.style.display = 'none';
        if (unitView) unitView.style.display = 'block';
        if (!unitHead || !unitBody) return;

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const staffList = this.scheduleData.staffList || [];
        
        console.log(`📋 渲染全單位班表 - ${staffList.length} 位人員`);

        // 表頭
        let headHtml = '<tr><th style="position:sticky; left:0; z-index:20; background:#f8f9fa; min-width:100px;">姓名</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            const bgColor = isWeekend ? '#ffebee' : '#fff';
            const textColor = isWeekend ? '#d32f2f' : '#333';
            
            headHtml += `<th style="background:${bgColor}; color:${textColor}; min-width:50px; font-size:0.85rem;">
                ${d}<br><small>${weekdayName}</small>
            </th>`;
        }
        headHtml += '</tr>';
        unitHead.innerHTML = headHtml;

        // 表身
        let bodyHtml = '';
        staffList.forEach(staff => {
            const assignments = this.scheduleData.assignments[staff.uid] || {};
            const isCurrent = staff.uid === this.currentUid;
            
            bodyHtml += `<tr ${isCurrent ? 'style="background:#fff9c4;"' : ''}>`;
            bodyHtml += `<td style="position:sticky; left:0; z-index:10; background:${isCurrent ? '#fff9c4' : '#f5f5f5'}; font-weight:${isCurrent ? 'bold' : 'normal'};">
                ${staff.name || staff.displayName || '未命名'}
                ${isCurrent ? ' ⭐' : ''}
            </td>`;
            
            for (let d = 1; d <= daysInMonth; d++) {
                const shift = assignments[`current_${d}`] || 'OFF';
                const isOff = shift === 'OFF' || shift === 'REQ_OFF';
                const cellBg = isOff ? '#e8f5e9' : '#e3f2fd';
                const cellColor = isOff ? '#2e7d32' : '#1565c0';
                
                // 🔥 可點擊的儲存格（用於換班）
                bodyHtml += `<td class="shift-cell" 
                    data-uid="${staff.uid}" 
                    data-day="${d}" 
                    data-shift="${shift}"
                    data-name="${staff.name || staff.displayName}"
                    style="background:${cellBg}; color:${cellColor}; cursor:pointer; padding:8px; font-size:0.9rem;"
                    onclick="staffScheduleManager.handleCellClick(this, event)">${shift}</td>`;
            }
            
            bodyHtml += '</tr>';
        });
        
        unitBody.innerHTML = bodyHtml;
    },

    // 🔥 處理儲存格點擊（換班）
    handleCellClick: function(cell, event) {
        if (event) event.stopPropagation();
        
        const uid = cell.dataset.uid;
        const day = parseInt(cell.dataset.day);
        const shift = cell.dataset.shift;
        const name = cell.dataset.name;
        
        // 不能換 OFF
        if (shift === 'OFF' || shift === 'REQ_OFF') {
            alert('休假日無法換班');
            return;
        }
        
        // 只能點自己的班
        if (uid !== this.currentUid) {
            alert('請點擊自己的班別以發起換班申請');
            return;
        }
        
        // 開啟換班對話框
        this.openExchangeModal(day, shift);
    },

    openExchangeModal: function(day, myShift) {
        this.selectedDay = day;
        this.selectedShift = myShift;
        
        const modal = document.getElementById('exchangeModal');
        const info = document.getElementById('exchangeInfo');
        const select = document.getElementById('exchangeTargetSelect');
        
        if (!modal || !info || !select) {
            console.error('找不到 Modal 元素');
            return;
        }

        // 顯示資訊
        info.innerHTML = `
            <strong>您的班別：</strong> ${this.currentYear}/${this.currentMonth}/${day} - ${myShift} 班
        `;
        
        // 填充對象選單（只列出當日班別與我不同的人）
        select.innerHTML = '<option value="">請選擇交換對象</option>';
        
        const staffList = this.scheduleData.staffList || [];
        staffList.forEach(staff => {
            if (staff.uid === this.currentUid) return; // 跳過自己
            
            const assignments = this.scheduleData.assignments[staff.uid] || {};
            const theirShift = assignments[`current_${day}`] || 'OFF';
            
            // 只列出非 OFF 且與我班別不同的人
            if (theirShift !== 'OFF' && theirShift !== 'REQ_OFF' && theirShift !== myShift) {
                const name = staff.name || staff.displayName || '未命名';
                select.innerHTML += `<option value="${staff.uid}" data-shift="${theirShift}">${name} (${theirShift} 班)</option>`;
            }
        });
        
        if (select.options.length === 1) {
            select.innerHTML = '<option value="">當日無可交換對象</option>';
        }
        
        // 清空表單
        document.querySelectorAll('input[name="reason"]').forEach(r => r.checked = false);
        document.getElementById('otherReasonBox').style.display = 'none';
        document.getElementById('otherReasonBox').value = '';
        
        const validResult = document.getElementById('validationResult');
        if (validResult) validResult.style.display = 'none';
        
        modal.classList.add('show');
    },

    closeExchangeModal: function() {
        const modal = document.getElementById('exchangeModal');
        if (modal) modal.classList.remove('show');
    },

    submitExchange: async function() {
        const select = document.getElementById('exchangeTargetSelect');
        const targetUid = select.value;
        
        if (!targetUid) {
            alert('請選擇交換對象');
            return;
        }
        
        const targetOption = select.options[select.selectedIndex];
        const targetShift = targetOption.dataset.shift;
        const targetName = targetOption.text.split(' (')[0];
        
        // 檢查原因
        const reasonRadio = document.querySelector('input[name="reason"]:checked');
        if (!reasonRadio) {
            alert('請選擇換班原因');
            return;
        }
        
        let reason = '';
        const reasonMap = {
            'personal': '個人因素',
            'sick': '身體不適',
            'family': '家庭照顧',
            'course': '進修/上課',
            'official': '公務/會議',
            'other': '其他'
        };
        
        reason = reasonMap[reasonRadio.value];
        
        if (reasonRadio.value === 'other') {
            const otherReason = document.getElementById('otherReasonBox').value.trim();
            if (!otherReason) {
                alert('請填寫具體原因');
                return;
            }
            reason += ': ' + otherReason;
        }
        
        // 取得我的姓名
        const myData = await db.collection('users').doc(this.currentUid).get();
        const myName = myData.data().displayName || myData.data().name || '未命名';
        
        // 確認
        const confirmMsg = `確定要申請換班嗎？\n\n您 (${myName}) 的 ${this.selectedShift} 班 ⇄ ${targetName} 的 ${targetShift} 班\n日期: ${this.currentYear}/${this.currentMonth}/${this.selectedDay}\n原因: ${reason}`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            // 使用當前模組實例中的 UID (支援管理員模擬使用者 ID)
            const targetRequesterId = this.currentUid;
            
            const reqData = {
                scheduleId: this.scheduleData.id || null,
                unitId: this.scheduleData.unitId || null, 
                year: this.currentYear,
                month: this.currentMonth,
                day: this.selectedDay,
                requesterId: targetRequesterId,
                requesterName: myName || 'Unknown',
                requesterShift: this.selectedShift || '',
                targetId: targetUid,
                targetName: targetName || 'Unknown',
                targetShift: targetShift || '',
                status: 'pending_target',
                reasonCategory: reasonRadio.value,
                reason: reason || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            // 提交申請
            await db.collection('shift_requests').add(reqData);
            
            alert('✅ 換班申請已送出！\n請等待對方同意及護理長核准。');
            this.closeExchangeModal();
            
        } catch (error) {
            console.error('提交換班申請失敗:', error);
            alert('提交失敗: ' + error.message);
        }
    },

    updateStatistics: function() {
        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        
        let totalShifts = 0, totalOff = 0, holidayOff = 0;
        let countD = 0, countE = 0, countN = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                totalOff++;
                if (isWeekend) holidayOff++;
            } else {
                totalShifts++;
                if (shift === 'D') countD++;
                else if (shift === 'E') countE++;
                else if (shift === 'N') countN++;
            }
        }
        
        document.getElementById('statTotalShifts').textContent = totalShifts;
        document.getElementById('statTotalOff').textContent = totalOff;
        document.getElementById('statHolidayOff').textContent = holidayOff;
        document.getElementById('statDay').textContent = countD;
        document.getElementById('statEvening').textContent = countE;
        document.getElementById('statNight').textContent = countN;
    },

    toggleViewMode: function() {
        const checkbox = document.getElementById('checkShowAllStaff');
        if (!checkbox) return;
        
        const isChecked = checkbox.checked;
        
        console.log(`🔄 切換檢視模式: ${isChecked ? '全單位' : '個人'}`);
        
        this.viewMode = isChecked ? 'unit' : 'personal';
        
        if (this.scheduleData) {
            if (this.viewMode === 'unit') {
                this.renderUnitSchedule();
            } else {
                this.renderPersonalSchedule();
            }
        }
    },

    showNoSchedule: function() {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (wrapper) wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = `
                <i class="fas fa-calendar-times" style="font-size:4rem; color:#bbb; margin-bottom:15px;"></i>
                <h3 style="color:#666;">本月尚無已發布班表</h3>
                <p>請聯繫排班人員或護理長</p>
            `;
        }
    },

    showError: function(message) {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (wrapper) wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = `
                <i class="fas fa-exclamation-triangle" style="font-size:4rem; color:#f44336; margin-bottom:15px;"></i>
                <h3 style="color:#666;">${message}</h3>
            `;
        }
    }
};
