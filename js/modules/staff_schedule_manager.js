// js/modules/staff_schedule_manager.js
// 🚀 最終修正版 v3：嚴格身分驗證 (不顯示隨機資料) + 明確的狀態提示

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null, 
    isSimulating: false, 
    
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        
        // ==========================================
        // 1. 決定當前視角 (模擬 vs 真實)
        // ==========================================
        const simUid = sessionStorage.getItem('simulation_uid');
        const simName = sessionStorage.getItem('simulation_name');

        if (simUid) {
            // A. 模擬模式
            this.uid = simUid.trim();
            this.isSimulating = true;
            console.warn(`🎭 深度模擬模式啟動！正在模擬: ${simName || simUid}`);
            this.showSimulationBadge(simName || simUid);
        } else {
            // B. 真實模式
            // 檢查是否有 app 層級的模擬 (例如從左側選單切換)
            const appImpUid = (typeof app !== 'undefined') ? app.getUid() : null;
            if (appImpUid && appImpUid !== app.currentUser.uid) {
                 this.uid = appImpUid.trim();
                 this.isSimulating = true;
                 this.showSimulationBadge('管理員預覽');
            } else {
                 this.uid = app.currentUser.uid.trim();
                 this.isSimulating = false;
                 this.removeSimulationBadge();
            }
        }

        this.unitId = app.getUnitId();
        
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthInput = document.getElementById('scheduleMonth');
        if(monthInput) monthInput.value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    // 🛠️ 開發者工具
    startSimulation: function(targetUid, targetName = '模擬員工') {
        sessionStorage.setItem('simulation_uid', targetUid);
        sessionStorage.setItem('simulation_name', targetName);
        alert(`已切換為模擬視角：${targetName}\n網頁將重新整理...`);
        location.reload();
    },

    endSimulation: function() {
        sessionStorage.removeItem('simulation_uid');
        sessionStorage.removeItem('simulation_name');
        if (typeof app !== 'undefined' && app.clearImpersonation) app.clearImpersonation(); 
        alert("已結束模擬，恢復為原始身分。\n網頁將重新整理...");
        location.reload();
    },

    showSimulationBadge: function(name) {
        let badge = document.getElementById('sim-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'sim-badge';
            badge.style.cssText = "position:fixed; bottom:10px; right:10px; background:#e74c3c; color:white; padding:8px 12px; z-index:9999; border-radius:30px; font-weight:bold; box-shadow:0 2px 10px rgba(0,0,0,0.3); font-size:14px; display:flex; align-items:center; gap:10px;";
            badge.innerHTML = `<span>🎭 模擬視角: ${name}</span> <button onclick="staffScheduleManager.endSimulation()" style="background:white; color:#e74c3c; border:none; padding:2px 8px; border-radius:10px; cursor:pointer; font-weight:bold;">退出</button>`;
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
        const infoAlert = document.getElementById('scheduleInfoAlert');
        if(infoAlert) infoAlert.remove(); // 清除舊提示
        
        console.log(`🔍 Loading schedule for ${year}/${month}. Target UID: '${this.uid}'`);
        
        try {
            // 1. 撈取班表
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules.`);

            // 2. 精確匹配：該班表中必須包含此 UID
            // 我們不再隨便抓一個，而是檢查 staffList 或 assignments 是否真的有這個人
            let targetDoc = snap.docs.find(doc => {
                const data = doc.data();
                // A. 檢查 assignments (最準)
                if (data.assignments && data.assignments[this.uid]) return true;
                // B. 檢查 staffList
                if (data.staffList && data.staffList.some(s => s.uid.trim() === this.uid)) return true;
                // C. 檢查矩陣
                if (this.checkMatrixForUid(data.schedule, this.uid)) return true;
                return false;
            });

            // 如果找不到「包含我」的班表，但我是管理員，可能我想看的是單位的班表？
            // 這裡做一個妥協：如果是管理員且沒在排班內，我們暫時不載入任何資料，並顯示特定訊息
            
            if (!targetDoc) {
                // 如果是管理員，提示他去模擬
                if (app.userRole === 'system_admin' || app.userRole === 'unit_manager') {
                     console.warn("User is Admin/Manager but not in schedule.");
                     this.renderNoDataState("您不在本月排班名單中。", true); // true = 顯示管理員提示
                } else {
                     console.warn("User not found in any schedule.");
                     this.renderNoDataState("尚無您的班表資料 (未發布或未排入)。");
                }
                return;
            }

            console.log(`✅ Schedule Match Found: ${targetDoc.id}`);
            
            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';

            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 3. 提取資料
            // 此時我們確定 assignments[this.uid] 應該要存在，或者矩陣裡有資料
            let myData = this.currentAssignments[this.uid];
            
            // 再次檢查資料完整性
            const hasShiftKeys = myData && Object.keys(myData).some(k => k.startsWith('current_') || k.match(/^\d{4}-\d{2}-\d{2}$/));

            if (!hasShiftKeys) {
                console.warn(`⚠️ Assignments empty. Attempting Matrix Extraction for ${this.uid}...`);
                if (this.currentSchedule.schedule) {
                    myData = this.extractShiftsFromMatrix(this.currentSchedule.schedule, this.uid);
                    // 回填，方便渲染
                    this.currentAssignments[this.uid] = myData;
                    
                    // 如果連矩陣都沒有，那就是真的沒班
                    if (Object.keys(myData).length === 0) {
                         this.renderNoDataState("本月您沒有被安排任何班別 (全空)。");
                         return; // 雖然有表，但沒班，顯示狀態
                    }
                }
            }
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            alert("載入錯誤: " + e.message);
        }
    },

    renderNoDataState: function(msg, isAdminHint = false) {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        
        if(wrapper) wrapper.style.display = 'none';
        if(noData) {
            noData.style.display = 'block';
            let html = `<h3><i class="fas fa-info-circle"></i> ${msg}</h3>`;
            
            if (isAdminHint) {
                html += `
                <div style="margin-top:10px; color:#666; font-size:0.9rem;">
                    <p>您是管理員，通常不參與排班。</p>
                    <p>若要測試員工視角，請使用 <strong>「深度身分模擬」</strong> 功能。</p>
                </div>`;
            }
            noData.innerHTML = html;
        }
        this.resetStats();
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
        // ... (保持原本的渲染邏輯) ...
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
         // ... (保持原本的統計邏輯) ...
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

    // ... (保留 Exchange 相關功能，不變) ...
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
