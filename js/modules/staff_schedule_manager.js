// js/modules/staff_schedule_manager.js
// 🚀 最終完整版：含換班違規預判引擎 (Validation Engine)

const staffScheduleManager = {
    // 資料暫存
    currentSchedule: null,
    currentAssignments: {},
    staffMap: {},
    allShifts: [],
    
    // 狀態
    uid: null,
    unitId: null,
    isSimulating: false,
    viewMode: 'personal',

    // --- 1. 初始化 ---
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        
        // 身分判斷 (模擬優先)
        const simUid = sessionStorage.getItem('simulation_uid');
        const appImpUid = (typeof app !== 'undefined') ? app.impersonatedUid : null;

        if (simUid) {
            this.uid = simUid.trim();
            this.isSimulating = true;
            this.showSimulationBadge(sessionStorage.getItem('simulation_name') || '開發者模擬');
        } else if (appImpUid) {
            this.uid = appImpUid.trim();
            this.isSimulating = true;
            const impName = document.getElementById('displayUserName')?.innerText.split('(')[0] || '模擬';
            this.showSimulationBadge(impName);
        } else {
            this.uid = app.currentUser.uid.trim();
            this.isSimulating = false;
            this.removeSimulationBadge();
        }

        this.unitId = app.getUnitId();
        
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const input = document.getElementById('scheduleMonth');
        if(input && !input.value) input.value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    loadShifts: async function() {
        try {
            const snap = await db.collection('shifts').get();
            this.allShifts = snap.docs.map(d => d.data());
        } catch(e) { console.error("Load Shifts Error:", e); }
    },

    // --- 2. 載入資料 ---
    loadData: async function() {
        const ym = document.getElementById('scheduleMonth').value;
        if(!ym) return;
        const [year, month] = ym.split('-').map(Number);
        
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        
        if(wrapper) wrapper.style.display = 'none';
        if(noData) { noData.style.display = 'block'; noData.innerHTML = '<div style="padding:20px; text-align:center;">資料讀取中...</div>'; }

        try {
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            let targetDoc = null;
            // 尋找包含我的班表
            for (const doc of snap.docs) {
                const d = doc.data();
                if (d.assignments && d.assignments[this.uid]) { targetDoc = doc; break; }
                if ((app.userRole === 'system_admin' || app.userRole === 'unit_manager') && d.unitId === this.unitId) { targetDoc = doc; break; }
            }

            if (!targetDoc) {
                this.renderNoDataState("查無您的班表資料 (或班表尚未發布)。");
                return;
            }

            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 建立人員名單對照
            this.staffMap = {};
            if(this.currentSchedule.staffList) {
                this.currentSchedule.staffList.forEach(s => this.staffMap[s.uid.trim()] = s);
            }

            // 防呆：assignments 遺失補救
            if (!this.currentAssignments[this.uid] && this.currentSchedule.schedule) {
                this.currentAssignments[this.uid] = this.extractShiftsFromMatrix(this.currentSchedule.schedule, this.uid);
            }

            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';
            
            this.render(); 

        } catch(e) {
            console.error(e);
            this.renderNoDataState(`載入失敗: ${e.message}`);
        }
    },

    // --- 3. 視圖切換與渲染 ---
    toggleViewMode: function() {
        const isChecked = document.getElementById('checkShowAllStaff').checked;
        this.viewMode = isChecked ? 'unit' : 'personal';
        this.render();
    },

    render: function() {
        if (this.viewMode === 'unit') {
            document.getElementById('myScheduleView').style.display = 'none';
            document.getElementById('unitScheduleView').style.display = 'block';
            document.getElementById('personalStatsContainer').style.display = 'none';
            this.renderUnitMatrix();
        } else {
            document.getElementById('myScheduleView').style.display = 'block';
            document.getElementById('unitScheduleView').style.display = 'none';
            document.getElementById('personalStatsContainer').style.display = 'grid';
            this.renderPersonalTable();
            this.calculatePersonalStats();
        }
    },

    // --- 3.1 個人班表 (可點擊換班) ---
    renderPersonalTable: function() {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        
        while(rowWeekday.cells.length > 1) rowWeekday.deleteCell(1);
        while(rowDate.cells.length > 1) rowDate.deleteCell(1);
        while(rowShift.cells.length > 1) rowShift.deleteCell(1);

        const myData = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        const today = new Date(); today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d);
            const w = ['日','一','二','三','四','五','六'][dateObj.getDay()];
            let shiftCode = myData[`current_${d}`] || 'OFF';

            const tdW = document.createElement('td'); tdW.textContent = w;
            if(dateObj.getDay()===0 || dateObj.getDay()===6) tdW.style.color = 'red';
            rowWeekday.appendChild(tdW);

            const tdD = document.createElement('td'); tdD.textContent = d;
            if(dateObj.getTime() === today.getTime()) tdD.style.backgroundColor = '#fff3cd';
            rowDate.appendChild(tdD);

            const tdS = document.createElement('td');
            const box = this.createShiftBox(shiftCode);
            
            // 只有未來日期可換班
            if (dateObj > today) {
                box.style.cursor = 'pointer';
                box.onclick = () => this.openExchangeModal(d, shiftCode);
                box.title = "點擊申請換班";
            } else {
                box.style.opacity = '0.6';
                box.title = "過去日期不可換班";
            }
            tdS.appendChild(box);
            rowShift.appendChild(tdS);
        }
    },

    // --- 3.2 全單位矩陣 (唯讀參考) ---
    renderUnitMatrix: function() {
        const thead = document.getElementById('unitHead');
        const tbody = document.getElementById('unitBody');
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        
        let h = `<tr><th style="width:100px; position:sticky; left:0; background:#fff; z-index:2;">姓名</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d).getDay();
            h += `<th style="min-width:35px; ${w===0||w===6?'color:red':''}">${d}</th>`;
        }
        h += `</tr>`;
        thead.innerHTML = h;

        let b = '';
        let sortedUids = Object.keys(this.currentAssignments);
        // 簡單排序
        if (this.currentSchedule.staffList) {
            const orderMap = {};
            this.currentSchedule.staffList.forEach((s, idx) => orderMap[s.uid.trim()] = idx);
            sortedUids.sort((a, b) => (orderMap[a.trim()]||999) - (orderMap[b.trim()]||999));
        }

        sortedUids.forEach(rawUid => {
            const uid = rawUid.trim();
            const name = this.staffMap[uid]?.name || uid;
            const style = (uid === this.uid) ? 'background:#e8f4fd; color:#2980b9; font-weight:bold;' : '';
            
            b += `<tr><td style="position:sticky; left:0; background:#fff; ${style}">${name}</td>`;
            for(let d=1; d<=daysInMonth; d++) {
                const shift = this.currentAssignments[uid][`current_${d}`] || 'OFF';
                b += `<td style="${style}">${shift}</td>`;
            }
            b += `</tr>`;
        });
        tbody.innerHTML = b;
    },

    // ==========================================
    // 🔥 4. 換班核心功能與驗證引擎
    // ==========================================
    exchangeData: null,

    openExchangeModal: function(day, myShift) {
        // 模擬模式下允許操作，方便管理者測試
        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}/${this.currentSchedule.month}/${day}`;
        
        document.getElementById('exchangeInfo').innerHTML = `
            <div><strong>日期：</strong> ${dateStr}</div>
            <div><strong>我的班別：</strong> <span class="badge badge-info">${myShift}</span></div>
        `;
        
        const select = document.getElementById('exchangeTargetSelect');
        select.innerHTML = '<option value="">--- 請選擇對象 ---</option>';
        
        // 列出當日班別不同的人
        Object.keys(this.currentAssignments).forEach(rawUid => {
            const targetUid = rawUid.trim();
            if (targetUid === this.uid) return;
            
            const targetName = this.staffMap[targetUid]?.name || '未知同仁';
            const targetShift = this.currentAssignments[rawUid][`current_${day}`] || 'OFF';
            
            if (targetShift !== myShift) {
                // 顯示：王小明 (N)
                select.innerHTML += `<option value="${targetUid}" data-shift="${targetShift}">
                    ${targetName} (${targetShift})
                </option>`;
            }
        });

        // 重置表單
        document.querySelectorAll('input[name="reason"]').forEach(el => el.checked = false);
        document.getElementById('otherReasonBox').style.display = 'none';
        document.getElementById('otherReasonBox').value = '';
        document.getElementById('validationResult').style.display = 'none';
        
        // 綁定動態檢查
        select.onchange = () => this.validateSwapPreview();

        document.getElementById('exchangeModal').classList.add('show');
    },

    // 🔍 換班模擬檢查器
    validateSwapPreview: function() {
        const select = document.getElementById('exchangeTargetSelect');
        const targetUid = select.value;
        const resultDiv = document.getElementById('validationResult');
        const btnSubmit = document.getElementById('btnSubmitExchange');
        
        resultDiv.style.display = 'none';
        btnSubmit.disabled = true; // 預設先鎖住，通過才開啟
        
        if (!targetUid) return;

        const targetShift = select.options[select.selectedIndex].getAttribute('data-shift');
        const day = this.exchangeData.day;
        const myShift = this.exchangeData.myShift;

        // 收集錯誤與警告
        const errors = [];
        const warnings = [];

        // ---------------------------------------------
        // 檢查 1: 接班禁忌 (Continuity) - N 接 D/E
        // ---------------------------------------------
        // 模擬：我變成 targetShift
        if (!this.checkContinuity(this.uid, day, targetShift)) {
            errors.push(`您的班表違反接班規定 (例如 N 接 D/E)`);
        }
        // 模擬：對方變成 myShift
        if (!this.checkContinuity(targetUid, day, myShift)) {
            errors.push(`對方班表違反接班規定 (例如 N 接 D/E)`);
        }

        // ---------------------------------------------
        // 檢查 2: 連續上班天數 (Consecutive Days)
        // ---------------------------------------------
        const myCons = this.checkConsecutive(this.uid, day, targetShift);
        if (myCons > 12) errors.push(`您將連續上班 ${myCons} 天 (超過12天禁止)`);
        else if (myCons > 6) warnings.push(`您將連續上班 ${myCons} 天 (超過6天)`);

        const targetCons = this.checkConsecutive(targetUid, day, myShift);
        if (targetCons > 12) errors.push(`對方將連續上班 ${targetCons} 天 (超過12天禁止)`);
        else if (targetCons > 6) warnings.push(`對方將連續上班 ${targetCons} 天 (超過6天)`);

        // ---------------------------------------------
        // 檢查 3: 人力需求 (簡單檢查)
        // ---------------------------------------------
        // 如果是用 OFF 來換上班，導致該班別少人
        if (myShift !== 'OFF' && targetShift === 'OFF') {
            // 我原本上班，換成休假 -> 該班別少 1 人
            // 這裡可以加上 dailyNeeds 的檢查，目前先給警告
            // warnings.push(`注意：換班後 ${myShift} 班人力將減少 1 人`);
        }

        // --- 顯示結果 ---
        if (errors.length > 0) {
            resultDiv.className = 'valid-error';
            resultDiv.innerHTML = `<strong><i class="fas fa-ban"></i> 禁止申請 (違反硬性規則)：</strong><br>${errors.join('<br>')}`;
            resultDiv.style.display = 'block';
            btnSubmit.disabled = true;
        } else if (warnings.length > 0) {
            resultDiv.className = 'valid-warning';
            resultDiv.innerHTML = `<strong><i class="fas fa-exclamation-triangle"></i> 注意 (違反軟性規則)：</strong><br>${warnings.join('<br>')}`;
            resultDiv.style.display = 'block';
            btnSubmit.disabled = false; // 警告可送出，由管理者裁決
        } else {
            resultDiv.className = 'valid-success';
            resultDiv.innerHTML = `<strong><i class="fas fa-check-circle"></i> 檢查通過</strong>：符合排班規則。`;
            resultDiv.style.display = 'block';
            btnSubmit.disabled = false;
        }
    },

    // 輔助檢查：接班禁忌
    checkContinuity: function(uid, day, newShift) {
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return true;
        const myKey = Object.keys(this.currentAssignments).find(k => k.trim() === uid);
        if(!myKey) return true;

        // 取得前後一天的班別
        const prevShift = this.currentAssignments[myKey][`current_${day-1}`];
        const nextShift = this.currentAssignments[myKey][`current_${day+1}`];

        // 規則：前一天是 N，今天不能是 D 或 E
        if (prevShift === 'N' && (newShift === 'D' || newShift === 'E')) return false;
        // 規則：今天是 N，明天不能是 D 或 E
        if (newShift === 'N' && (nextShift === 'D' || nextShift === 'E')) return false;

        return true;
    },

    // 輔助檢查：最大連續上班天數
    checkConsecutive: function(uid, changeDay, newShift) {
        const myKey = Object.keys(this.currentAssignments).find(k => k.trim() === uid);
        if(!myKey) return 0;

        // 1. 建立該員當月的「虛擬班表陣列」
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        const shifts = [];
        for(let d=1; d<=daysInMonth; d++) {
            if (d === changeDay) shifts.push(newShift); // 替換當天
            else shifts.push(this.currentAssignments[myKey][`current_${d}`] || 'OFF');
        }

        // 2. 計算最大連續數
        let maxCons = 0;
        let currentCons = 0;
        for (let s of shifts) {
            if (s !== 'OFF' && s !== 'REQ_OFF') currentCons++;
            else currentCons = 0;
            if (currentCons > maxCons) maxCons = currentCons;
        }
        
        // 這裡暫不考慮跨月連續 (需要上個月資料)，目前僅計算本月內
        return maxCons;
    },

    // 送出申請
    submitExchange: async function() {
        const select = document.getElementById('exchangeTargetSelect');
        const targetUid = select.value;
        if (!targetUid) return;

        const targetShift = select.options[select.selectedIndex].getAttribute('data-shift');
        const reasonRadio = document.querySelector('input[name="reason"]:checked');
        
        if (!reasonRadio) { alert("請勾選換班原因"); return; }
        
        let reasonVal = reasonRadio.value;
        let reasonDesc = "";
        
        if (reasonVal === 'other') {
            reasonDesc = document.getElementById('otherReasonBox').value;
            if(!reasonDesc) { alert("請填寫其他原因說明"); return; }
        }

        try {
            // 建立申請單
            const requestData = {
                unitId: this.currentSchedule.unitId,
                scheduleId: this.currentSchedule.id,
                year: this.currentSchedule.year,
                month: this.currentSchedule.month,
                day: this.exchangeData.day,
                
                // 申請方
                requesterId: this.uid,
                requesterName: app.currentUser.displayName || this.uid,
                requesterShift: this.exchangeData.myShift,
                
                // 對方
                targetId: targetUid,
                targetName: this.staffMap[targetUid]?.name || targetUid,
                targetShift: targetShift,
                
                // 理由
                reasonCategory: reasonVal,
                otherReason: reasonDesc,
                
                // 狀態流程：等待對方同意 -> 等待管理者同意 -> 完成
                status: 'pending_target', 
                
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('shift_requests').add(requestData);
            alert("✅ 申請已送出！請等待對方及主管簽核。");
            this.closeExchangeModal();
        } catch(e) { console.error(e); alert("申請失敗: " + e.message); }
    },

    // --- 其他工具 ---
    createShiftBox: function(code) {
        const div = document.createElement('div');
        div.className = 'shift-box';
        div.textContent = code;
        if(code === 'OFF' || code === 'REQ_OFF') div.classList.add('shift-off');
        else if(code === 'N') div.classList.add('shift-n');
        else {
            const def = this.allShifts.find(s => s.code === code);
            if(def && def.color) { div.style.backgroundColor = def.color; div.style.color = '#fff'; div.style.border = 'none'; }
            else div.classList.add('shift-d');
        }
        return div;
    },
    
    extractShiftsFromMatrix: function(matrix, targetUid) {
        const result = {};
        Object.entries(matrix).forEach(([dateStr, dayShifts]) => {
            Object.entries(dayShifts).forEach(([shiftCode, uids]) => {
                if (Array.isArray(uids) && uids.some(u => u.trim() === targetUid)) {
                    const dayPart = parseInt(dateStr.split('-')[2]);
                    if (!isNaN(dayPart)) result[`current_${dayPart}`] = shiftCode;
                }
            });
        });
        return result;
    },

    calculatePersonalStats: function() {
        const myKey = Object.keys(this.currentAssignments).find(k => k.trim() === this.uid);
        const myData = myKey ? this.currentAssignments[myKey] : {};
        let c = { total:0, off:0, holiday:0, D:0, E:0, N:0 };
        const days = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();

        for(let d=1; d<=days; d++) {
            const code = myData[`current_${d}`];
            if(!code) continue;
            if(code === 'OFF' || code === 'REQ_OFF') {
                c.off++;
                const w = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d).getDay();
                if(w===0||w===6) c.holiday++;
            } else {
                c.total++;
                if(code==='D') c.D++; if(code==='E') c.E++; if(code==='N') c.N++;
            }
        }
        const set = (id, v) => { const el = document.getElementById(id); if(el) el.innerText = v; };
        set('statTotalShifts', c.total); set('statTotalOff', c.off); set('statHolidayOff', c.holiday);
        set('statDay', c.D); set('statEvening', c.E); set('statNight', c.N);
    },

    closeExchangeModal: function() { document.getElementById('exchangeModal').classList.remove('show'); },
    renderNoDataState: function(msg, isAdmin=false) {
        const noData = document.getElementById('noDataMessage');
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        if(wrapper) wrapper.style.display = 'none';
        if(noData) {
            noData.innerHTML = `<div style="padding:40px; color:#95a5a6; text-align:center;"><i class="fas fa-info-circle" style="font-size:3rem; margin-bottom:10px;"></i><h3>${msg}</h3></div>`;
            noData.style.display = 'block';
        }
    },
    showSimulationBadge: function(name) {
        let b = document.getElementById('sim-badge');
        if(!b) { b = document.createElement('div'); b.id='sim-badge'; b.style.cssText="position:fixed;bottom:10px;right:10px;background:#e74c3c;color:white;padding:8px 15px;border-radius:30px;font-weight:bold;z-index:9999;"; document.body.appendChild(b); }
        b.innerHTML = `🎭 模擬: ${name} <button onclick="staffScheduleManager.endSimulation()" style="margin-left:10px;border:none;background:#fff;color:#e74c3c;border-radius:10px;cursor:pointer;">退出</button>`;
    },
    endSimulation: function() {
        sessionStorage.removeItem('simulation_uid'); sessionStorage.removeItem('simulation_name');
        if(app.clearImpersonation) app.clearImpersonation();
        location.reload();
    },
    removeSimulationBadge: function() { const b=document.getElementById('sim-badge'); if(b) b.remove(); }
};
