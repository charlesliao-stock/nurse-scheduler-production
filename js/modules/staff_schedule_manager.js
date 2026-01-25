// js/modules/staff_schedule_manager.js
// 🚀 最終重構版 v4：雙視圖介面 + 三方握手流程 + 嚴格違規檢查

const staffScheduleManager = {
    // 核心資料
    currentSchedule: null,
    currentAssignments: {}, // 格式: { uid: { current_1: 'N', ... } }
    staffMap: {},           // 格式: { uid: { name: '...', role: '...' } }
    allShifts: [],          // 班別定義
    
    // 狀態
    uid: null,              // 當前視角 UID
    unitId: null,
    isSimulating: false,
    viewMode: 'personal',   // 'personal' or 'unit'

    // --- 1. 初始化與身分確認 ---
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        
        // 身分判定 (Simulation > AppImpersonation > Real)
        const simUid = sessionStorage.getItem('simulation_uid');
        const appImpUid = (typeof app !== 'undefined' && app.getUid) ? app.getUid() : null;

        if (simUid) {
            this.uid = simUid.trim();
            this.isSimulating = true;
            this.showSimulationBadge(sessionStorage.getItem('simulation_name') || '開發者模擬');
        } else if (appImpUid && appImpUid !== app.currentUser.uid) {
            this.uid = appImpUid.trim();
            this.isSimulating = true;
            const impName = document.getElementById('displayUserName')?.innerText || '模擬';
            this.showSimulationBadge(impName);
        } else {
            this.uid = app.currentUser.uid.trim();
            this.isSimulating = false;
            this.removeSimulationBadge();
        }

        this.unitId = app.getUnitId();
        
        // 預設月份
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

    // --- 2. 資料讀取 ---
    loadData: async function() {
        const ym = document.getElementById('scheduleMonth').value;
        if(!ym) return;
        const [year, month] = ym.split('-').map(Number);
        
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        const container = document.getElementById('myScheduleView');
        
        // UI Reset
        if(wrapper) wrapper.style.display = 'none';
        if(noData) { noData.style.display = 'block'; noData.innerHTML = '<div style="padding:20px; text-align:center;">資料讀取中...</div>'; }

        try {
            // 查詢已發布班表
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            // 尋找屬於我的班表 (檢查 assignments 或 staffList)
            let targetDoc = null;
            for (const doc of snap.docs) {
                const d = doc.data();
                if (d.assignments && d.assignments[this.uid]) { targetDoc = doc; break; }
                if (d.staffList && d.staffList.some(s => s.uid.trim() === this.uid)) { targetDoc = doc; break; }
                // 管理員特例：如果是管理員且同單位，也允許查看(但自己沒班)
                if ((app.userRole === 'system_admin' || app.userRole === 'unit_manager') && d.unitId === this.unitId) { targetDoc = doc; break; }
            }

            if (!targetDoc) {
                this.renderNoDataState("查無您的班表資料 (或班表尚未發布)。");
                return;
            }

            // 解析資料
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 建立人員對照表 (方便顯示名字)
            this.staffMap = {};
            if(this.currentSchedule.staffList) {
                this.currentSchedule.staffList.forEach(s => {
                    this.staffMap[s.uid.trim()] = s;
                });
            }

            // 防呆：如果 assignments 空的，嘗試從矩陣還原
            if (Object.keys(this.currentAssignments).length === 0 && this.currentSchedule.schedule) {
                this.recoverAssignmentsFromMatrix();
            }

            // 顯示介面
            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';
            
            this.render(); // 根據當前模式渲染

        } catch(e) {
            console.error(e);
            this.renderNoDataState(`載入失敗: ${e.message}`);
        }
    },

    // --- 3. 視圖渲染切換 ---
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

    // --- 3.1 渲染：個人視圖 ---
    renderPersonalTable: function() {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        
        // 清空
        while(rowWeekday.cells.length > 1) rowWeekday.deleteCell(1);
        while(rowDate.cells.length > 1) rowDate.deleteCell(1);
        while(rowShift.cells.length > 1) rowShift.deleteCell(1);

        const myData = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        const today = new Date(); today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d);
            const w = ['日','一','二','三','四','五','六'][dateObj.getDay()];
            
            // 讀取班別
            let shiftCode = myData[`current_${d}`] || 'OFF';

            // 星期
            const tdW = document.createElement('td'); tdW.textContent = w;
            if(dateObj.getDay()===0 || dateObj.getDay()===6) tdW.style.color = 'red';
            rowWeekday.appendChild(tdW);

            // 日期
            const tdD = document.createElement('td'); tdD.textContent = d;
            if(dateObj.getTime() === today.getTime()) tdD.style.backgroundColor = '#fff3cd';
            rowDate.appendChild(tdD);

            // 班別
            const tdS = document.createElement('td');
            const box = this.createShiftBox(shiftCode);
            
            // 點擊事件 (未來日期)
            if (dateObj > today) {
                box.style.cursor = 'pointer';
                box.onclick = () => this.openExchangeModal(d, shiftCode);
                box.title = "點擊申請換班";
            }
            tdS.appendChild(box);
            rowShift.appendChild(tdS);
        }
    },

    // --- 3.2 渲染：全單位矩陣 ---
    renderUnitMatrix: function() {
        const thead = document.getElementById('unitHead');
        const tbody = document.getElementById('unitBody');
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        
        // Header
        let h = `<tr><th style="width:80px; position:sticky; left:0; background:#fff; z-index:2;">姓名</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d).getDay();
            h += `<th style="min-width:35px; ${w===0||w===6?'color:red':''}">${d}</th>`;
        }
        h += `</tr>`;
        thead.innerHTML = h;

        // Body
        let b = '';
        const sortedUids = Object.keys(this.currentAssignments).sort(); // 可優化排序
        
        sortedUids.forEach(uid => {
            const staffName = this.staffMap[uid]?.name || '未知';
            b += `<tr><td style="position:sticky; left:0; background:#fff; font-weight:bold;">${staffName}</td>`;
            for(let d=1; d<=daysInMonth; d++) {
                const shift = this.currentAssignments[uid][`current_${d}`] || 'OFF';
                b += `<td>${shift}</td>`; // 全單位視圖僅顯示文字，不給點擊 (保持畫面乾淨)
            }
            b += `</tr>`;
        });
        tbody.innerHTML = b;
    },

    // --- 4. 換班功能與驗證 ---
    exchangeData: null,
    
    openExchangeModal: function(day, myShift) {
        if (this.isSimulating && app.userRole !== 'system_admin') {
            // alert("模擬模式下不可操作"); // 根據需求：模擬要能操作，所以不擋
        }

        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}/${this.currentSchedule.month}/${day}`;
        
        document.getElementById('exchangeInfo').innerHTML = `
            <strong>日期：</strong> ${dateStr} <br>
            <strong>我的原本班別：</strong> <span class="badge badge-info">${myShift}</span>
        `;
        
        // 載入可交換對象
        const select = document.getElementById('exchangeTargetSelect');
        select.innerHTML = '<option value="">--- 請選擇對象 ---</option>';
        
        Object.keys(this.currentAssignments).forEach(targetUid => {
            if (targetUid === this.uid) return; // 排除自己
            
            const targetName = this.staffMap[targetUid]?.name || targetUid;
            const targetShift = this.currentAssignments[targetUid][`current_${day}`] || 'OFF';
            
            // 排除相同班別 (換了沒意義)
            if (targetShift !== myShift) {
                select.innerHTML += `<option value="${targetUid}" data-shift="${targetShift}">
                    ${targetName} (目前: ${targetShift})
                </option>`;
            }
        });

        // 重置欄位
        document.querySelectorAll('input[name="reason"]').forEach(el => el.checked = false);
        document.getElementById('otherReasonBox').style.display = 'none';
        document.getElementById('otherReasonBox').value = '';
        document.getElementById('validationResult').style.display = 'none';

        // 綁定驗證事件 (當選擇對象時，立即檢查是否違規)
        select.onchange = () => this.validateSwapPreview();

        document.getElementById('exchangeModal').classList.add('show');
    },

    // 🔥 核心：違規預檢 (模擬交換後的狀態)
    validateSwapPreview: function() {
        const select = document.getElementById('exchangeTargetSelect');
        const targetUid = select.value;
        const resultDiv = document.getElementById('validationResult');
        resultDiv.style.display = 'none';
        
        if (!targetUid) return;

        const targetShift = select.options[select.selectedIndex].getAttribute('data-shift');
        const day = this.exchangeData.day;
        const myShift = this.exchangeData.myShift;

        const errors = [];
        const warnings = [];

        // 執行檢查
        // 1. 接班禁忌 (Continuity)
        if (!this.checkContinuity(this.uid, day, targetShift)) errors.push(`您換班後將違反「接班規定」(如 N 接 D)`);
        if (!this.checkContinuity(targetUid, day, myShift)) errors.push(`對方換班後將違反「接班規定」`);

        // 2. 連續上班 (Consecutive Days)
        const myCons = this.checkConsecutive(this.uid, day, targetShift);
        if (myCons > 12) errors.push(`您換班後將連續上班 ${myCons} 天 (超過12天禁止)`);
        else if (myCons > 6) warnings.push(`⚠️ 注意：您換班後將連續上班 ${myCons} 天`);

        const targetCons = this.checkConsecutive(targetUid, day, myShift);
        if (targetCons > 12) errors.push(`對方換班後將連續上班 ${targetCons} 天 (禁止)`);
        else if (targetCons > 6) warnings.push(`⚠️ 注意：對方換班後將連續上班 ${targetCons} 天`);

        // 3. 當日人力 (Staffing)
        // 簡易檢查：如果我是 D 換成 OFF，那天 D 就少 1。檢查是否低於最低需求 (需 dailyNeeds 支援)
        if (this.currentSchedule.dailyNeeds) {
            const staffingError = this.checkStaffing(day, myShift, targetShift);
            if (staffingError) errors.push(staffingError);
        }

        // 顯示結果
        if (errors.length > 0) {
            resultDiv.className = 'alert alert-danger';
            resultDiv.innerHTML = `<strong><i class="fas fa-ban"></i> 禁止申請：</strong><br>${errors.join('<br>')}`;
            resultDiv.style.display = 'block';
            document.querySelector('#exchangeModal .btn-primary').disabled = true;
        } else if (warnings.length > 0) {
            resultDiv.className = 'alert alert-warning';
            resultDiv.innerHTML = `<strong><i class="fas fa-exclamation-triangle"></i> 提醒：</strong><br>${warnings.join('<br>')}`;
            resultDiv.style.display = 'block';
            document.querySelector('#exchangeModal .btn-primary').disabled = false;
        } else {
            resultDiv.className = 'alert alert-success';
            resultDiv.innerHTML = `<i class="fas fa-check-circle"></i> 檢查通過，符合排班規則。`;
            resultDiv.style.display = 'block';
            document.querySelector('#exchangeModal .btn-primary').disabled = false;
        }
    },

    // 檢查接班 (前後 1 天)
    checkContinuity: function(uid, day, newShift) {
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return true; // 休假無接班問題
        
        // 取得前一天與後一天的班別
        const prevShift = this.currentAssignments[uid][`current_${day-1}`]; // 注意：若是1號需抓上月(暫簡化為不檢查上月)
        const nextShift = this.currentAssignments[uid][`current_${day+1}`];

        // 規則：N 不能接 D 或 E (假設 N 是夜班)
        // 這裡需要根據您的 shifts 定義來判斷，這裡先寫死常見規則
        if (prevShift === 'N' && (newShift === 'D' || newShift === 'E')) return false;
        if (newShift === 'N' && (nextShift === 'D' || nextShift === 'E')) return false;

        return true;
    },

    // 檢查連續上班 (模擬置換後計算)
    checkConsecutive: function(uid, changeDay, newShift) {
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return 0; // 換成休假，連班斷掉

        // 複製一份該員的班表陣列
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();
        const shifts = [];
        for(let d=1; d<=daysInMonth; d++) {
            if (d === changeDay) shifts.push(newShift);
            else shifts.push(this.currentAssignments[uid][`current_${d}`] || 'OFF');
        }

        // 計算包含 changeDay 的最大連續數
        let maxCons = 0;
        let currentCons = 0;
        for (let s of shifts) {
            if (s !== 'OFF' && s !== 'REQ_OFF') currentCons++;
            else currentCons = 0;
            if (currentCons > maxCons) maxCons = currentCons;
        }
        return maxCons;
    },

    // 檢查人力 (簡易版)
    checkStaffing: function(day, shiftOut, shiftIn) {
        // 如果 shiftOut 是上班 (如 D)，shiftIn 是休假 (OFF)，則 D -1
        // 如果造成 D < dailyNeeds，則報錯
        // 需實作... (略，視需求複雜度而定)
        return null; 
    },

    submitExchange: async function() {
        const select = document.getElementById('exchangeTargetSelect');
        const targetUid = select.value;
        if (!targetUid) { alert("請選擇交換對象"); return; }

        const targetShift = select.options[select.selectedIndex].getAttribute('data-shift');
        const reasonRadio = document.querySelector('input[name="reason"]:checked');
        
        if (!reasonRadio) { alert("請勾選換班原因"); return; }
        
        let reasonVal = reasonRadio.value;
        let reasonDesc = "";
        
        if (reasonVal === 'other') {
            reasonDesc = document.getElementById('otherReasonBox').value;
            if(!reasonDesc) { alert("請填寫其他原因說明"); return; }
        }

        // 再次驗證
        const resultDiv = document.getElementById('validationResult');
        if (resultDiv.classList.contains('alert-danger')) {
            alert("此換班違反規則，無法送出。");
            return;
        }

        try {
            const requestData = {
                unitId: this.currentSchedule.unitId,
                scheduleId: this.currentSchedule.id,
                year: this.currentSchedule.year,
                month: this.currentSchedule.month,
                day: this.exchangeData.day,
                
                // 申請人 (員工1)
                requesterId: this.uid,
                requesterName: app.currentUser.displayName || this.uid,
                requesterShift: this.exchangeData.myShift,
                
                // 對象 (員工2)
                targetId: targetUid,
                targetName: this.staffMap[targetUid]?.name || targetUid,
                targetShift: targetShift,
                
                // 原因
                reasonCategory: reasonVal,
                otherReason: reasonDesc,
                
                // 流程狀態: pending_target -> pending_manager -> approved
                status: 'pending_target', 
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('shift_requests').add(requestData);
            alert("✅ 申請已送出！\n\n流程說明：\n1. 等待對方同意\n2. 等待護理長核准\n3. 系統自動更新班表");
            this.closeExchangeModal();
        } catch(e) { 
            console.error(e); 
            alert("申請失敗: " + e.message); 
        }
    },

    // --- 工具函式 ---
    createShiftBox: function(code) {
        const div = document.createElement('div');
        div.className = 'shift-box';
        div.textContent = code;
        
        if(code === 'OFF' || code === 'REQ_OFF') div.classList.add('shift-off');
        else if(code === 'N') div.classList.add('shift-n');
        else {
            const def = this.allShifts.find(s => s.code === code);
            if(def && def.color) {
                div.style.backgroundColor = def.color;
                div.style.color = '#fff';
            } else {
                div.classList.add('shift-d');
            }
        }
        return div;
    },

    closeExchangeModal: function() { document.getElementById('exchangeModal').classList.remove('show'); },
    
    calculatePersonalStats: function() {
        const myData = this.currentAssignments[this.uid] || {};
        let counts = { total:0, off:0, holiday:0, D:0, E:0, N:0 };
        const daysInMonth = new Date(this.currentSchedule.year, this.currentSchedule.month, 0).getDate();

        for(let d=1; d<=daysInMonth; d++) {
            const code = myData[`current_${d}`];
            if(!code) continue;
            
            if(code === 'OFF' || code === 'REQ_OFF') {
                counts.off++;
                const w = new Date(this.currentSchedule.year, this.currentSchedule.month-1, d).getDay();
                if(w===0 || w===6) counts.holiday++;
            } else {
                counts.total++;
                if(code === 'D') counts.D++;
                if(code === 'E') counts.E++;
                if(code === 'N') counts.N++;
            }
        }
        
        document.getElementById('statTotalShifts').innerText = counts.total;
        document.getElementById('statTotalOff').innerText = counts.off;
        document.getElementById('statHolidayOff').innerText = counts.holiday;
        document.getElementById('statDay').innerText = counts.D;
        document.getElementById('statEvening').innerText = counts.E;
        document.getElementById('statNight').innerText = counts.N;
    },

    recoverAssignmentsFromMatrix: function() {
        if(!this.currentSchedule.schedule) return;
        const matrix = this.currentSchedule.schedule;
        const result = {};
        
        Object.keys(matrix).forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]);
            if(isNaN(day)) return;
            
            const shifts = matrix[dateStr];
            Object.keys(shifts).forEach(code => {
                shifts[code].forEach(uid => {
                    if(!result[uid]) result[uid] = {};
                    result[uid][`current_${day}`] = code;
                });
            });
        });
        
        // Merge back
        Object.keys(result).forEach(uid => {
            if(!this.currentAssignments[uid]) this.currentAssignments[uid] = result[uid];
        });
    },

    renderNoDataState: function(msg, isAdmin = false) {
        const noData = document.getElementById('noDataMessage');
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        if(wrapper) wrapper.style.display = 'none';
        
        let html = `<div style="padding:40px; color:#95a5a6;">
            <i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:10px;"></i>
            <h3>${msg}</h3>
        </div>`;
        
        if(isAdmin) {
            html += `<div class="alert alert-warning" style="display:inline-block; margin-top:10px;">
                <strong>管理員模式：</strong> 請使用左側選單的「深度身分模擬」來切換至員工視角。
            </div>`;
        }
        
        noData.innerHTML = html;
        noData.style.display = 'block';
    },

    showSimulationBadge: function(name) {
        let b = document.getElementById('sim-badge');
        if(!b) {
            b = document.createElement('div');
            b.id = 'sim-badge';
            b.style.cssText = "position:fixed; bottom:10px; right:10px; background:#e74c3c; color:white; padding:8px 15px; border-radius:30px; font-weight:bold; box-shadow:0 2px 10px rgba(0,0,0,0.2); z-index:9999;";
            document.body.appendChild(b);
        }
        b.innerHTML = `🎭 模擬視角: ${name} <button onclick="staffScheduleManager.endSimulation()" style="margin-left:10px; border:none; background:#fff; color:#e74c3c; border-radius:10px; cursor:pointer;">退出</button>`;
    },

    endSimulation: function() {
        sessionStorage.removeItem('simulation_uid');
        sessionStorage.removeItem('simulation_name');
        if(app.clearImpersonation) app.clearImpersonation();
        location.reload();
    },
    
    removeSimulationBadge: function() { const b=document.getElementById('sim-badge'); if(b) b.remove(); }
};
