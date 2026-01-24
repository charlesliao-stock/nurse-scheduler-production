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
        
        console.log(`🔍 Loading schedule for ${year}/${month}, UID: '${this.uid}', Unit: ${this.unitId}`);
        
        try {
            // 讀取已發布的班表 (跨單位查詢)
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules in total.`);

            // 過濾出與我相關的班表 (加入容錯比對)
            const mySchedules = snap.docs.filter(doc => {
                const d = doc.data();
                const isMyUnit = (d.unitId === this.unitId);
                const isParticipant = (d.staffList || []).some(s => s.uid === this.uid);
                
                // --- 修正：模糊比對 Assignment Key ---
                const assignments = d.assignments || {};
                const assignKeys = Object.keys(assignments);
                // 檢查是否有 Key 去除空白後等於我的 UID
                const hasMyAssign = assignKeys.some(key => key.trim() === this.uid.trim());
                // ------------------------------------
                
                console.log(`📄 Checking Schedule ${doc.id}: Unit=${d.unitId}, Match=${isMyUnit || isParticipant || hasMyAssign}`);
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
            // (這裡同樣需要模糊比對來尋找)
            let targetDoc = mySchedules.find(doc => {
                const assigns = doc.data().assignments || {};
                return Object.keys(assigns).some(k => k.trim() === this.uid.trim());
            });

            // 如果沒找到有資料的，就退而求其次找單位符合的
            if (!targetDoc) {
                targetDoc = mySchedules.find(doc => doc.data().unitId === this.unitId) || mySchedules[0];
            }
            
            console.log(`✅ Selected target schedule: ${targetDoc.id} (Unit: ${targetDoc.data().unitId})`);
            
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // --- 修正：確保 currentAssignments[this.uid] 有資料 ---
            // 如果直接用 this.uid 取不到，嘗試找出那個「長得像」的 Key
            if (!this.currentAssignments[this.uid]) {
                const fuzzyKey = Object.keys(this.currentAssignments).find(k => k.trim() === this.uid.trim());
                if (fuzzyKey) {
                    console.log(`🔧 Mapping fuzzy key '${fuzzyKey}' to '${this.uid}'`);
                    this.currentAssignments[this.uid] = this.currentAssignments[fuzzyKey];
                } else {
                    console.warn(`⚠️ UID ${this.uid} data matches nothing in assignments. Keys:`, Object.keys(this.currentAssignments));
                }
            }
            // ---------------------------------------------------
            
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
            
            // 修正：確保讀取 logic 與存檔一致 (current_1 vs current_01)
            // 通常是 current_1, current_2...
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
            
            // 樣式處理 (可選)
            if (shiftCode === 'N') shiftBox.classList.add('shift-n'); // 若 CSS 有定義
            if (shiftCode === 'OFF') shiftBox.classList.add('shift-off');

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

        const safeSetText = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.innerText = val;
        };

        safeSetText('statTotalShifts', totalShifts);
        safeSetText('statTotalOff', totalOff);
        safeSetText('statHolidayOff', holidayOff);
        safeSetText('statEvening', evening);
        safeSetText('statNight', night);
        safeSetText('statExchangeCount', exchangeCount);
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
        
        const infoEl = document.getElementById('exchangeInfo');
        if(infoEl) {
            infoEl.innerHTML = `
                <strong>申請日期：</strong> ${dateStr} <br>
                <strong>您的班別：</strong> <span class="badge badge-warning">${myShift}</span>
            `;
        }
        
        const select = document.getElementById('exchangeTargetSelect');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        
        const staffList = this.currentSchedule.staffList || [];
        const options = [];

        staffList.forEach(staff => {
            // 排除自己
            // 這裡也要做 trim 比較比較安全
            if (staff.uid.trim() === this.uid.trim()) return;

            // 取得對方的 Assignment (同樣需要模糊比對)
            let targetAssign = this.currentAssignments[staff.uid];
            if (!targetAssign) {
                const fuzzyKey = Object.keys(this.currentAssignments).find(k => k.trim() === staff.uid.trim());
                if (fuzzyKey) targetAssign = this.currentAssignments[fuzzyKey];
            }
            targetAssign = targetAssign || {};

            const targetShift = targetAssign[`current_${day}`] || 'OFF';
            
            // 只能跟不同班別的人換 (或者根據需求調整)
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

        const modal = document.getElementById('exchangeModal');
        if(modal) modal.classList.add('show');
        // 如果是 Bootstrap 模態框，可能需要 $(modal).modal('show')
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
        } catch(e) {
            console.error(e);
            alert("申請失敗: " + e.message);
        }
    }
};
