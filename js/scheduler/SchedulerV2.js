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
        
        console.log(`🔍 Loading schedule for ${year}/${month}, UID: '${this.uid}'`);
        
        try {
            // 讀取已發布的班表
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            console.log(`📂 Found ${snap.size} published schedules.`);

            // 過濾出與我相關的班表 (含矩陣掃描)
            const mySchedules = snap.docs.filter(doc => {
                const d = doc.data();
                
                // 1. 檢查單位
                const isMyUnit = (d.unitId === this.unitId);
                
                // 2. 檢查名單
                const isParticipant = (d.staffList || []).some(s => s.uid === this.uid);
                
                // 3. 檢查 assignments (舊方法)
                const assignments = d.assignments || {};
                const hasAssign = Object.keys(assignments).some(k => k.trim() === this.uid.trim());

                // 4. 🔥 檢查矩陣 (新方法 - 掃描全表)
                // 只要這張表裡有任何一天出現我的 UID，就算相關
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

            // 優先取有資料的班表
            // (這次優先找矩陣裡有我資料的)
            let targetDoc = mySchedules.find(doc => this.checkMatrixForUid(doc.data().schedule || {}, this.uid));

            if (!targetDoc) {
                targetDoc = mySchedules.find(doc => doc.data().unitId === this.unitId) || mySchedules[0];
            }
            
            console.log(`✅ Selected target: ${targetDoc.id} (Unit: ${targetDoc.data().unitId})`);
            
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 🔥 關鍵修復：如果 assignments 裡沒資料，直接從矩陣撈出來！
            // 這是您目前狀況的救星
            let myData = this.currentAssignments[this.uid];
            const hasValidShifts = myData && Object.keys(myData).some(k => k.startsWith('current_') || k.startsWith('20'));

            if (!hasValidShifts) {
                console.warn("⚠️ Assignments empty/broken. Switching to Matrix Extraction Mode...");
                // 呼叫矩陣提取器，現場重建資料
                myData = this.extractShiftsFromMatrix(this.currentSchedule.schedule, this.uid);
                this.currentAssignments[this.uid] = myData; // 存回去方便後續使用
            }

            console.log("🛠️ Effective Data Keys:", Object.keys(myData || {}));
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            alert("載入錯誤: " + e.message);
        }
    },

    // 🔥 新增：從矩陣中檢查是否有我的資料
    checkMatrixForUid: function(matrix, uid) {
        if (!matrix) return false;
        // matrix 結構: { "2025-12-01": { "N": ["uid1", "uid2"] } }
        return Object.values(matrix).some(dayShifts => {
            return Object.values(dayShifts).some(uids => {
                return Array.isArray(uids) && uids.includes(uid);
            });
        });
    },

    // 🔥 新增：從矩陣中提取我的班表 (救星函式)
    extractShiftsFromMatrix: function(matrix, uid) {
        if (!matrix) return {};
        const result = {};
        
        // 遍歷每一天
        Object.entries(matrix).forEach(([dateStr, dayShifts]) => {
            // dateStr 例如 "2025-12-01"
            
            // 遍歷每個班別 (D, N, E...)
            Object.entries(dayShifts).forEach(([shiftCode, uids]) => {
                if (Array.isArray(uids) && uids.includes(uid)) {
                    // 找到我了！記錄下來
                    
                    // 1. 存完整日期格式
                    result[dateStr] = shiftCode;
                    
                    // 2. 存 current_d 格式 (相容舊版)
                    const dayPart = parseInt(dateStr.split('-')[2]);
                    if (!isNaN(dayPart)) {
                        result[`current_${dayPart}`] = shiftCode;
                    }
                }
            });
        });
        
        // 補上偏好設定 (如果不影響運作可忽略)
        result.preferences = {}; 
        
        console.log(`🔧 Extracted ${Object.keys(result).length} shifts from matrix for ${uid}`);
        return result;
    },

    // --- 核心：橫式班表渲染 ---
    renderHorizontalTable: function(year, month) {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        
        if(!rowWeekday || !rowDate || !rowShift) return;

        // 清除舊資料
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
            
            // 萬能讀取邏輯
            let shiftCode = myAssign[`current_${d}`];
            if (!shiftCode) shiftCode = myAssign[`current_${String(d).padStart(2, '0')}`];
            if (!shiftCode) {
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                shiftCode = myAssign[dateKey];
            }
            
            shiftCode = shiftCode || 'OFF';
            
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
            exchangeCount = exchanges.filter(ex => 
                (ex.requester === this.uid || ex.target === this.uid) && 
                ex.status === 'approved'
            ).length;
        }

        const safeSet = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.innerText = val;
        };

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
            if (staff.uid.trim() === this.uid.trim()) return;

            // 模糊取得對方班表 (如果是矩陣模式，這裡也要支援)
            let targetAssign = this.currentAssignments[staff.uid];
            
            // 如果對方也沒 assign 資料，試著現場撈
            if (!targetAssign || Object.keys(targetAssign).length < 2) {
                 targetAssign = this.extractShiftsFromMatrix(this.currentSchedule.schedule, staff.uid);
            }
            
            targetAssign = targetAssign || {};

            let targetShift = targetAssign[`current_${day}`];
            if (!targetShift) targetShift = targetAssign[`current_${String(day).padStart(2, '0')}`];
            if (!targetShift) {
                const dateKey = `${this.currentSchedule.year}-${String(this.currentSchedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                targetShift = targetAssign[dateKey];
            }
            targetShift = targetShift || 'OFF';
            
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
