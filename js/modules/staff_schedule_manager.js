// js/modules/staff_schedule_manager.js
// 🚀 最終完整版：強化 UID 處理與 Fallback 機制 (解決全 OFF 問題)

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null,
    
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        // 🔥 Fix: 這裡強制 trim()，確保與資料庫的一致性
        this.uid = app.getUid().trim();
        this.unitId = app.getUnitId();
        
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
        
        console.log(`🔍 Loading schedule for ${year}/${month}, UID: '${this.uid}'`);
        
        try {
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules.`);

            const mySchedules = snap.docs.filter(doc => {
                const d = doc.data();
                const isMyUnit = (d.unitId === this.unitId);
                // 🔥 Fix: 使用 trim() 進行比較
                const isParticipant = (d.staffList || []).some(s => s.uid.trim() === this.uid);
                const assignments = d.assignments || {};
                const hasAssign = Object.keys(assignments).some(k => k.trim() === this.uid);
                const hasMatrixRecord = this.checkMatrixForUid(d.schedule || {}, this.uid);

                return isMyUnit || isParticipant || hasAssign || hasMatrixRecord;
            });

            if (mySchedules.length === 0) {
                console.warn("❌ No matching schedules found.");
                if(wrapper) wrapper.style.display = 'none';
                if(noData) noData.style.display = 'block';
                this.resetStats();
                return;
            }

            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';

            // 優先取矩陣裡有資料的，或單位符合的
            let targetDoc = mySchedules.find(doc => this.checkMatrixForUid(doc.data().schedule || {}, this.uid));
            if (!targetDoc) targetDoc = mySchedules.find(doc => doc.data().unitId === this.unitId) || mySchedules[0];
            
            console.log(`✅ Selected target: ${targetDoc.id} (Unit: ${targetDoc.data().unitId})`);
            
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 🔥 關鍵修復：正確判定 Assignments 是否有效
            // 有時候 Assignments 裡只有 { preferences: {} }，這時候必須強制用 Matrix Fallback
            let myData = this.currentAssignments[this.uid];
            
            const hasShiftKeys = myData && Object.keys(myData).some(k => k.startsWith('current_') || k.match(/^\d{4}-\d{2}-\d{2}$/));

            if (!hasShiftKeys) {
                console.warn("⚠️ Assignments empty or only has prefs. Switching to Matrix Extraction Mode...");
                // 檢查是否真的有矩陣資料
                if (this.currentSchedule.schedule) {
                    myData = this.extractShiftsFromMatrix(this.currentSchedule.schedule, this.uid);
                    this.currentAssignments[this.uid] = myData; 
                } else {
                    console.error("🔥 'schedule' matrix field is missing!");
                }
            }

            console.log("🛠️ Effective Data Keys:", Object.keys(myData || {}));
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            alert("載入錯誤: " + e.message);
        }
    },

    checkMatrixForUid: function(matrix, uid) {
        if (!matrix) return false;
        // 🔥 Fix: Trim UID
        return Object.values(matrix).some(dayShifts => {
            return Object.values(dayShifts).some(uids => Array.isArray(uids) && uids.some(u => u.trim() === uid));
        });
    },

    extractShiftsFromMatrix: function(matrix, uid) {
        if (!matrix) return {};
        const result = {};
        Object.entries(matrix).forEach(([dateStr, dayShifts]) => {
            Object.entries(dayShifts).forEach(([shiftCode, uids]) => {
                // 🔥 Fix: Trim UID
                if (Array.isArray(uids) && uids.some(u => u.trim() === uid)) {
                    result[dateStr] = shiftCode;
                    const dayPart = parseInt(dateStr.split('-')[2]);
                    if (!isNaN(dayPart)) result[`current_${dayPart}`] = shiftCode;
                }
            });
        });
        result.preferences = {}; 
        console.log(`🔧 Extracted ${Object.keys(result).length} shifts from matrix for ${uid}`);
        return result;
    },

    renderHorizontalTable: function(year, month) {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        if(!rowWeekday || !rowDate || !rowShift) return;

        while(rowWeekday.cells.length > 1) rowWeekday.deleteCell(1);
        while(rowDate.cells.length > 1) rowDate.deleteCell(1);
        while(rowShift.cells.length > 1) rowShift.deleteCell(1);

        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date();
        today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const weekStr = ['日','一','二','三','四','五','六'][dayOfWeek];
            
            let shiftCode = myAssign[`current_${d}`];
            if (!shiftCode) shiftCode = myAssign[`current_${String(d).padStart(2, '0')}`];
            if (!shiftCode) {
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                shiftCode = myAssign[dateKey];
            }
            
            shiftCode = shiftCode || 'OFF';
            
            const tdW = document.createElement('td');
            tdW.textContent = weekStr;
            tdW.className = 'weekday-cell';
            if(dayOfWeek === 0) tdW.classList.add('weekend-sun');
            else if(dayOfWeek === 6) tdW.classList.add('weekend-sat');
            else tdW.classList.add('weekday-normal');
            rowWeekday.appendChild(tdW);

            const tdD = document.createElement('td');
            tdD.textContent = String(d).padStart(2, '0');
            tdD.className = 'date-cell';
            rowDate.appendChild(tdD);

            const tdS = document.createElement('td');
            tdS.className = 'shift-cell';
            
            const shiftBox = document.createElement('div');
            shiftBox.className = 'shift-box';
            shiftBox.textContent = shiftCode;
            
            if (shiftCode === 'N') shiftBox.classList.add('shift-n');
            if (shiftCode === 'OFF') shiftBox.classList.add('shift-off');

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
            let code = myAssign[`current_${d}`];
            if (!code) code = myAssign[`current_${String(d).padStart(2, '0')}`];
            if (!code) {
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                code = myAssign[dateKey];
            }
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
            exchangeCount = exchanges.filter(ex => (ex.requester === this.uid || ex.target === this.uid) && ex.status === 'approved').length;
        }

        const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
        safeSet('statTotalShifts', totalShifts);
        safeSet('statTotalOff', totalOff);
        safeSet('statHolidayOff', holidayOff);
        safeSet('statEvening', evening);
        safeSet('statNight', night);
        safeSet('statExchangeCount', exchangeCount);
    },

    resetStats: function() {
        ['statTotalShifts','statTotalOff','statHolidayOff','statEvening','statNight','statExchangeCount'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerText = '0';
        });
    },

    exchangeData: null,
    openExchangeModal: function(day, myShift) {
        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}/${this.currentSchedule.month}/${day}`;
        const infoEl = document.getElementById('exchangeInfo');
        if(infoEl) infoEl.innerHTML = `<strong>申請日期：</strong> ${dateStr} <br><strong>您的班別：</strong> <span class="badge badge-warning">${myShift}</span>`;
        const select = document.getElementById('exchangeTargetSelect');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        const staffList = this.currentSchedule.staffList || [];
        const options = [];
        staffList.forEach(staff => {
            if (staff.uid.trim() === this.uid.trim()) return;
            let targetAssign = this.currentAssignments[staff.uid];
            if (!targetAssign || Object.keys(targetAssign).length < 2) targetAssign = this.extractShiftsFromMatrix(this.currentSchedule.schedule, staff.uid);
            targetAssign = targetAssign || {};
            let targetShift = targetAssign[`current_${day}`];
            if (!targetShift) targetShift = targetAssign[`current_${String(day).padStart(2, '0')}`];
            if (!targetShift) {
                const dateKey = `${this.currentSchedule.year}-${String(this.currentSchedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                targetShift = targetAssign[dateKey];
            }
            targetShift = targetShift || 'OFF';
            if (targetShift !== myShift) options.push(`<option value="${staff.uid}" data-shift="${targetShift}">${staff.name} (班別: ${targetShift})</option>`);
        });
        if (options.length === 0) select.innerHTML = '<option value="">無可交換對象</option>';
        else select.innerHTML = '<option value="">請選擇對象</option>' + options.join('');
        const modal = document.getElementById('exchangeModal');
        if(modal) modal.classList.add('show');
    },

    closeExchangeModal: function() {
        const modal = document.getElementById('exchangeModal');
        if(modal) modal.classList.remove('show');
        this.exchangeData = null;
    },

    toggleOtherReason: function() {
        const val = document.getElementById('exchangeReasonCategory').value;
        const group = document.getElementById('otherReasonGroup');
        if(group) group.style.display = (val === 'other') ? 'block' : 'none';
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
        } catch(e) { console.error(e); alert("申請失敗: " + e.message); }
    }
};
