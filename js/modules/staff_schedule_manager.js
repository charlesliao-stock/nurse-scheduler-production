// js/modules/staff_schedule_manager.js
// 🚀 最終開發版：支援「深度模擬」+「ID 自動癒合」
// 使用方式：在 Console 輸入 staffScheduleManager.startSimulation('目標UID') 即可切換視角

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null, // 這裡會儲存「當下視角」的 ID (可能是本人，也可能是模擬對象)
    isSimulating: false, // 標記是否正在模擬
    
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        
        // ==========================================
        // 🎭 深度模擬邏輯 (Deep Simulation Check)
        // ==========================================
        const simUid = sessionStorage.getItem('simulation_uid');
        const simName = sessionStorage.getItem('simulation_name');

        if (simUid) {
            this.uid = simUid.trim();
            this.isSimulating = true;
            console.warn(`🎭 深度模擬模式啟動！正在模擬視角: ${simName || simUid}`);
            
            // 在畫面上增加一個明顯的標示，提醒開發者正在模擬
            this.showSimulationBadge(simName || simUid);
        } else {
            this.uid = app.getUid().trim();
            this.isSimulating = false;
            this.removeSimulationBadge();
        }

        this.unitId = app.getUnitId();
        
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthInput = document.getElementById('scheduleMonth');
        if(monthInput) monthInput.value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    // 🛠️ 開發者工具：啟動模擬
    startSimulation: function(targetUid, targetName = '模擬員工') {
        sessionStorage.setItem('simulation_uid', targetUid);
        sessionStorage.setItem('simulation_name', targetName);
        alert(`已切換為模擬視角：${targetName}\n網頁將重新整理...`);
        location.reload();
    },

    // 🛠️ 開發者工具：結束模擬
    endSimulation: function() {
        sessionStorage.removeItem('simulation_uid');
        sessionStorage.removeItem('simulation_name');
        alert("已結束模擬，恢復為管理員視角。\n網頁將重新整理...");
        location.reload();
    },

    showSimulationBadge: function(name) {
        let badge = document.getElementById('sim-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'sim-badge';
            badge.style.cssText = "position:fixed; bottom:10px; right:10px; background:red; color:white; padding:10px; z-index:9999; border-radius:5px; font-weight:bold; box-shadow:0 0 10px rgba(0,0,0,0.5);";
            badge.innerHTML = `🎭 模擬中: ${name} <button onclick="staffScheduleManager.endSimulation()" style="margin-left:10px; color:black;">退出</button>`;
            document.body.appendChild(badge);
        }
    },

    removeSimulationBadge: function() {
        const badge = document.getElementById('sim-badge');
        if (badge) badge.remove();
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
        
        // Log 顯示當前使用的 ID 是誰
        console.log(`🔍 Loading schedule for ${year}/${month}. View Mode: ${this.isSimulating ? '🎭 SIMULATION' : '👤 REAL'}, UID: '${this.uid}'`);
        
        try {
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules.`);

            // 1. 嘗試找出目標班表 (優先匹配 Matrix 中的 UID，其次匹配 Unit)
            let targetDoc = snap.docs.find(doc => this.checkMatrixForUid(doc.data().schedule || {}, this.uid));
            
            if (!targetDoc) {
                targetDoc = snap.docs.find(doc => doc.data().unitId === this.unitId);
            }

            if (!targetDoc) {
                console.warn("❌ No matching schedules found.");
                if(wrapper) wrapper.style.display = 'none';
                if(noData) noData.style.display = 'block';
                this.resetStats();
                return;
            }

            console.log(`✅ Selected target: ${targetDoc.id} (Unit: ${targetDoc.data().unitId})`);
            
            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';

            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            
            // ==========================================
            // 🔥 ID 自動癒合 (Self-Healing) - 即使在模擬模式下也運作
            // ==========================================
            let effectiveUid = this.uid;
            
            // 只有在「非模擬」且「找不到人」的情況下，才嘗試用登入者名字去反推
            // 如果是模擬模式，我們假設開發者給的 UID 是準確的，或者我們用模擬的名字去反推
            let matchName = this.isSimulating ? sessionStorage.getItem('simulation_name') : (app.currentUser.displayName || app.currentUser.name);
            if (!matchName) matchName = '';

            const staffList = this.currentSchedule.staffList || [];
            const userInList = staffList.find(s => s.uid.trim() === this.uid);

            if (!userInList) {
                console.warn(`⚠️ Target UID (${this.uid}) not found in schedule staff list! Trying Name Match: '${matchName}'...`);
                
                // 嘗試用姓名反查
                const nameMatch = staffList.find(s => s.name.trim() === matchName.trim());
                if (nameMatch) {
                    console.warn(`✅ Name Match Found! Switching Effective UID to: ${nameMatch.uid} (was ${this.uid})`);
                    effectiveUid = nameMatch.uid.trim();
                    // 如果是在模擬模式，我們可以順便更新一下 session 裡的 ID，讓下次更準確
                    if (this.isSimulating) {
                         sessionStorage.setItem('simulation_uid', effectiveUid);
                         this.uid = effectiveUid;
                    }
                } else {
                    console.error("❌ Fatal: User not found in schedule by UID or Name.");
                }
            }

            // ==========================================
            // 2. 提取資料
            // ==========================================
            this.currentAssignments = this.currentSchedule.assignments || {};
            let myData = this.currentAssignments[effectiveUid];
            
            const hasShiftKeys = myData && Object.keys(myData).some(k => k.startsWith('current_') || k.match(/^\d{4}-\d{2}-\d{2}$/));

            if (!hasShiftKeys) {
                console.warn(`⚠️ Assignments empty for ${effectiveUid}. Switching to Matrix Extraction...`);
                if (this.currentSchedule.schedule) {
                    myData = this.extractShiftsFromMatrix(this.currentSchedule.schedule, effectiveUid);
                    this.currentAssignments[this.uid] = myData; 
                }
            } else {
                if (effectiveUid !== this.uid) {
                     this.currentAssignments[this.uid] = myData;
                }
            }
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            alert("載入錯誤: " + e.message);
        }
    },

    checkMatrixForUid: function(matrix, uid) {
        if (!matrix) return false;
        return Object.values(matrix).some(dayShifts => {
            return Object.values(dayShifts).some(uids => Array.isArray(uids) && uids.some(u => u.trim() === uid));
        });
    },

    extractShiftsFromMatrix: function(matrix, targetUid) {
        if (!matrix) return {};
        const result = {};
        Object.entries(matrix).forEach(([dateStr, dayShifts]) => {
            Object.entries(dayShifts).forEach(([shiftCode, uids]) => {
                if (Array.isArray(uids) && uids.some(u => u.trim() === targetUid)) {
                    result[dateStr] = shiftCode;
                    const dayPart = parseInt(dateStr.split('-')[2]);
                    if (!isNaN(dayPart)) result[`current_${dayPart}`] = shiftCode;
                }
            });
        });
        result.preferences = {}; 
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
        // 模擬模式下禁止提交，以免搞混資料
        if (this.isSimulating) {
            alert("⚠️ 模擬模式下無法提交換班申請，請切回本人帳號操作。");
            return;
        }

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
