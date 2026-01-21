// js/modules/staff_schedule_manager.js

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null,
    
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        this.uid = app.currentUser.uid;
        
        // 預設本月
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        document.getElementById('scheduleMonth').value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').get();
        this.allShifts = snap.docs.map(d => d.data());
    },

    loadData: async function() {
        const ym = document.getElementById('scheduleMonth').value;
        if(!ym) return;
        const [year, month] = ym.split('-').map(Number);
        
        const tbody = document.getElementById('myScheduleBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';

        try {
            // 讀取已發布的班表
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published') // 只能查已發布
                .limit(1)
                .get();

            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">本月尚無已發布的班表</td></tr>';
                this.resetStats();
                return;
            }

            const doc = snap.docs[0];
            this.currentSchedule = { id: doc.id, ...doc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            this.renderTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="5" style="color:red;">載入錯誤: ${e.message}</td></tr>`;
        }
    },

    // --- 功能 1 & 2: 班表顯示與換班入口 ---
    renderTable: function(year, month) {
        const tbody = document.getElementById('myScheduleBody');
        tbody.innerHTML = '';

        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date();
        today.setHours(0,0,0,0);

        // 區間篩選
        const filterStart = document.getElementById('filterStartDate').value;
        const filterEnd = document.getElementById('filterEndDate').value;
        const startDate = filterStart ? new Date(filterStart) : new Date(year, month-1, 1);
        const endDate = filterEnd ? new Date(filterEnd) : new Date(year, month-1, daysInMonth);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            if (dateObj < startDate || dateObj > endDate) continue;

            const shiftCode = myAssign[`current_${d}`] || 'OFF';
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            const weekStr = ['日','一','二','三','四','五','六'][dateObj.getDay()];
            
            // 換班按鈕邏輯：必須是「未來日期」
            let actionBtn = '';
            if (dateObj > today) {
                actionBtn = `<button class="btn btn-sm btn-warning" onclick="staffScheduleManager.openExchangeModal(${d}, '${shiftCode}')">
                                <i class="fas fa-exchange-alt"></i> 換班
                             </button>`;
            }

            // 檢查是否有換班備註
            let remark = '';
            // 這裡可以擴充讀取備註的邏輯，目前先留空

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${month}/${d}</td>
                <td style="${isWeekend?'color:red; font-weight:bold;':''}">${weekStr}</td>
                <td><span class="badge badge-primary">${shiftCode}</span></td>
                <td>${remark}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        }
    },

    // --- 功能 3: 統計 ---
    calculateStats: function(year, month) {
        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let totalShifts = 0, totalOff = 0, holidayOff = 0, evening = 0, night = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            const code = myAssign[`current_${d}`];
            
            if (!code || code === 'OFF' || code === 'REQ_OFF') {
                totalOff++;
                const date = new Date(year, month-1, d);
                if (date.getDay() === 0 || date.getDay() === 6) holidayOff++;
            } else {
                totalShifts++;
                if (code === 'E' || code === 'EN') evening++;
                if (code === 'N') night++;
            }
        }

        document.getElementById('statTotalShifts').innerText = totalShifts;
        document.getElementById('statTotalOff').innerText = totalOff;
        document.getElementById('statHolidayOff').innerText = holidayOff;
        document.getElementById('statEvening').innerText = evening;
        document.getElementById('statNight').innerText = night;
    },

    resetStats: function() {
        ['statTotalShifts','statTotalOff','statHolidayOff','statEvening','statNight'].forEach(id => {
            document.getElementById(id).innerText = '0';
        });
    },

    // --- 功能 2: 換班申請 UI ---
    exchangeData: null,

    openExchangeModal: function(day, myShift) {
        if(myShift === 'OFF' || myShift === 'REQ_OFF') {
            // alert("休假目前不開放換班 (需實作進階邏輯)"); // 視需求開放
            // 暫時允許休假換班，只要邏輯通即可
        }

        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}-${String(this.currentSchedule.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        
        document.getElementById('exchangeInfo').innerHTML = `
            <strong>申請日期：</strong> ${dateStr} <br>
            <strong>您的班別：</strong> ${myShift}
        `;
        
        // 載入當天其他人的班表
        const select = document.getElementById('exchangeTargetSelect');
        select.innerHTML = '<option value="">載入可交換對象...</option>';
        
        const staffList = this.currentSchedule.staffList || [];
        const options = [];

        staffList.forEach(staff => {
            if (staff.uid === this.uid) return; // 排除自己
            
            const targetAssign = this.currentAssignments[staff.uid] || {};
            const targetShift = targetAssign[`current_${day}`] || 'OFF';
            
            // 排除相同班別 (沒必要換)
            if (targetShift !== myShift) {
                options.push(`<option value="${staff.uid}" data-shift="${targetShift}">
                    ${staff.name} (班別: ${targetShift})
                </option>`);
            }
        });

        if (options.length === 0) {
            select.innerHTML = '<option value="">無可交換對象</option>';
        } else {
            select.innerHTML = '<option value="">請選擇對象</option>' + options.join('');
        }

        document.getElementById('exchangeModal').classList.add('show');
    },

    closeExchangeModal: function() {
        document.getElementById('exchangeModal').classList.remove('show');
        this.exchangeData = null;
    },

    // --- 功能 2.1 & 2.2: 提交與驗證 ---
    submitExchange: async function() {
        const targetSelect = document.getElementById('exchangeTargetSelect');
        const targetUid = targetSelect.value;
        const targetName = targetSelect.options[targetSelect.selectedIndex].text.split(' ')[0];
        const targetShift = targetSelect.options[targetSelect.selectedIndex].getAttribute('data-shift');
        const reason = document.getElementById('exchangeReason').value;

        if (!targetUid) { alert("請選擇交換對象"); return; }
        if (!reason) { alert("請填寫換班事由"); return; }

        // 2.1 系統執行排班原則驗證
        const isValid = await shiftExchangeManager.validateSwap(
            this.currentSchedule, 
            this.exchangeData.day, 
            this.uid, this.exchangeData.myShift, 
            targetUid, targetShift
        );

        if (!isValid.pass) {
            alert(`❌ 無法申請換班，違反排班原則：\n${isValid.reason}`);
            return;
        }

        // 2.2 建立申請單
        try {
            await db.collection('shift_requests').add({
                unitId: this.currentSchedule.unitId,
                scheduleId: this.currentSchedule.id,
                year: this.currentSchedule.year,
                month: this.currentSchedule.month,
                day: this.exchangeData.day,
                requesterId: this.uid,
                requesterName: app.currentUser.displayName || '我',
                requesterShift: this.exchangeData.myShift,
                targetId: targetUid,
                targetName: targetName,
                targetShift: targetShift,
                reason: reason,
                status: 'pending_target', // 狀態：等待對方同意
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            alert("✅ 申請已送出！\n請通知對方進行確認。");
            this.closeExchangeModal();
        } catch(e) {
            console.error(e);
            alert("申請失敗: " + e.message);
        }
    }
};
