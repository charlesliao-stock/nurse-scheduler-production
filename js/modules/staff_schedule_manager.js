// js/modules/staff_schedule_manager.js

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null,
    
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        this.uid = app.getUid();
        this.unitId = app.getUnitId();
        
        // 預設本月
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthInput = document.getElementById('scheduleMonth');
        if(monthInput) monthInput.value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    loadShifts: async function() {
        try {
            const snap = await db.collection('shifts').get();
            this.allShifts = snap.docs.map(d => d.data());
        } catch(e) { console.error("Load Shifts Error:", e); }
    },

    loadData: async function() {
        const ym = document.getElementById('scheduleMonth').value;
        if(!ym) return;
        const [year, month] = ym.split('-').map(Number);
        
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        
        console.log(`🔍 Loading schedule for ${year}/${month}, UID: ${this.uid}, Unit: ${this.unitId}`);
        
        try {
            // 讀取已發布的班表 (跨單位查詢)
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules in total.`);

            // 過濾出與我相關的班表
            const mySchedules = snap.docs.filter(doc => {
                const d = doc.data();
                const isMyUnit = (d.unitId === this.unitId);
                const isParticipant = (d.staffList || []).some(s => s.uid === this.uid);
                const hasMyAssign = d.assignments && d.assignments[this.uid];
                
                console.log(`📄 Checking Schedule ${doc.id}: Unit=${d.unitId}, isMyUnit=${isMyUnit}, isParticipant=${isParticipant}, hasMyAssign=${!!hasMyAssign}`);
                return isMyUnit || isParticipant || hasMyAssign;
            });

            if (mySchedules.length === 0) {
                console.warn("❌ No matching schedules found for this user.");
                if(wrapper) wrapper.style.display = 'none';
                if(noData) noData.style.display = 'block';
                this.resetStats();
                return;
            }

            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';

            // 優先取包含我排班資料的班表
            const targetDoc = mySchedules.find(doc => doc.data().assignments && doc.data().assignments[this.uid]) || 
                              mySchedules.find(doc => doc.data().unitId === this.unitId) || 
                              mySchedules[0];
            
            console.log(`✅ Selected target schedule: ${targetDoc.id} (Unit: ${targetDoc.data().unitId})`);
            
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            if (!this.currentAssignments[this.uid]) {
                console.warn(`⚠️ UID ${this.uid} not found in assignments of schedule ${targetDoc.id}`);
            }
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            alert("載入錯誤: " + e.message);
        }
    },

    // --- 核心：橫式班表渲染 ---
    renderHorizontalTable: function(year, month) {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        
        if(!rowWeekday || !rowDate || !rowShift) return;

        // 清除舊資料 (保留第一個標題欄位)
        while(rowWeekday.cells.length > 1) rowWeekday.deleteCell(1);
        while(rowDate.cells.length > 1) rowDate.deleteCell(1);
        while(rowShift.cells.length > 1) rowShift.deleteCell(1);

        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date();
        today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); // 0=日, 6=六
            const weekStr = ['日','一','二','三','四','五','六'][dayOfWeek];
            const shiftCode = myAssign[`current_${d}`] || 'OFF';
            
            // 1. 星期列
            const tdW = document.createElement('td');
            tdW.textContent = weekStr;
            tdW.className = 'weekday-cell';
            if(dayOfWeek === 0) tdW.classList.add('weekend-sun');
            else if(dayOfWeek === 6) tdW.classList.add('weekend-sat');
            else tdW.classList.add('weekday-normal');
            rowWeekday.appendChild(tdW);

            // 2. 日期列
            const tdD = document.createElement('td');
            tdD.textContent = String(d).padStart(2, '0');
            tdD.className = 'date-cell';
            rowDate.appendChild(tdD);

            // 3. 班別列
            const tdS = document.createElement('td');
            tdS.className = 'shift-cell';
            
            const shiftBox = document.createElement('div');
            shiftBox.className = 'shift-box';
            shiftBox.textContent = shiftCode;
            
            // 只有未來日期可以點擊換班
            if (dateObj > today) {
                shiftBox.onclick = () => this.openExchangeModal(d, shiftCode);
            } else {
                shiftBox.style.cursor = 'default';
                shiftBox.style.opacity = '0.8';
            }
            
            tdS.appendChild(shiftBox);
            rowShift.appendChild(tdS);
        }
    },

    calculateStats: function(year, month) {
        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let totalShifts = 0, totalOff = 0, holidayOff = 0, evening = 0, night = 0, exchangeCount = 0;

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

        if (this.currentSchedule && this.currentSchedule.exchanges) {
            const exchanges = this.currentSchedule.exchanges || [];
            exchangeCount = exchanges.filter(ex => 
                (ex.requester === this.uid || ex.target === this.uid) && 
                ex.status === 'approved'
            ).length;
        }

        document.getElementById('statTotalShifts').innerText = totalShifts;
        document.getElementById('statTotalOff').innerText = totalOff;
        document.getElementById('statHolidayOff').innerText = holidayOff;
        document.getElementById('statEvening').innerText = evening;
        document.getElementById('statNight').innerText = night;
        document.getElementById('statExchangeCount').innerText = exchangeCount;
    },

    resetStats: function() {
        ['statTotalShifts','statTotalOff','statHolidayOff','statEvening','statNight','statExchangeCount'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerText = '0';
        });
    },

    // --- 換班邏輯 ---
    exchangeData: null,

    openExchangeModal: function(day, myShift) {
        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}/${this.currentSchedule.month}/${day}`;
        
        document.getElementById('exchangeInfo').innerHTML = `
            <strong>申請日期：</strong> ${dateStr} <br>
            <strong>您的班別：</strong> <span class="badge badge-warning">${myShift}</span>
        `;
        
        const select = document.getElementById('exchangeTargetSelect');
        select.innerHTML = '<option value="">載入中...</option>';
        
        const staffList = this.currentSchedule.staffList || [];
        const options = [];

        staffList.forEach(staff => {
            if (staff.uid === this.uid) return;
            const targetAssign = this.currentAssignments[staff.uid] || {};
            const targetShift = targetAssign[`current_${day}`] || 'OFF';
            
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

    toggleOtherReason: function() {
        const val = document.getElementById('exchangeReasonCategory').value;
        document.getElementById('otherReasonGroup').style.display = (val === 'other') ? 'block' : 'none';
    },

    submitExchange: async function() {
        const targetSelect = document.getElementById('exchangeTargetSelect');
        const targetUid = targetSelect.value;
        if (!targetUid) { alert("請選擇交換對象"); return; }

        const targetName = targetSelect.options[targetSelect.selectedIndex].text.split(' ')[0];
        const targetShift = targetSelect.options[targetSelect.selectedIndex].getAttribute('data-shift');
        const reasonCategory = document.getElementById('exchangeReasonCategory').value;
        const otherReasonText = document.getElementById('otherReasonText').value;
        const reason = document.getElementById('exchangeReason').value;

        if (!reasonCategory) { alert("請選擇換班事由分類"); return; }
        if (reasonCategory === 'other' && !otherReasonText) { alert("請填寫其他原因說明"); return; }

        try {
            const requestData = {
                unitId: this.currentSchedule.unitId,
                scheduleId: this.currentSchedule.id,
                year: this.currentSchedule.year,
                month: this.currentSchedule.month,
                day: this.exchangeData.day,
                requesterId: this.uid,
                requesterName: document.getElementById('displayUserName')?.textContent || '我',
                requesterShift: this.exchangeData.myShift,
                targetId: targetUid,
                targetName: targetName,
                targetShift: targetShift,
                reasonCategory: reasonCategory,
                otherReason: reasonCategory === 'other' ? otherReasonText : null,
                reason: reason,
                status: 'pending_target',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            await db.collection('shift_requests').add(requestData);
            alert("✅ 申請已送出！\n請通知對方進行確認。");
            this.closeExchangeModal();
        } catch(e) {
            console.error(e);
            alert("申請失敗: " + e.message);
        }
    }
};
