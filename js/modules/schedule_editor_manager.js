// js/modules/schedule_editor_manager.js
// Fix: 顯示完整資訊、加入重置/發布功能、計算人力缺口

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {}, // 存放人員快照
    assignments: {},
    tempOptions: [], 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) return;
        
        await this.loadContext();
        // 初始化 AI 引擎 (傳入 'schedules' 以便讀取快照規則)
        await scheduleManager.loadContext(id, 'schedules'); 

        this.renderMatrix();
        this.updateRealTimeStats();
        this.setupEvents();
    },

    loadContext: async function() {
        try {
            const doc = await db.collection('schedules').doc(this.scheduleId).get();
            if (!doc.exists) throw new Error("班表不存在");
            this.data = doc.data();
            this.assignments = this.data.assignments || {};

            const shiftsSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            // 建立人員快照索引 (從 staffList 讀取執行排班時的狀態)
            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            this.updateStatusUI();
            
        } catch(e) { console.error(e); alert("載入失敗: " + e.message); }
    },

    updateStatusUI: function() {
        const st = this.data.status;
        const badge = document.getElementById('schStatus');
        const btnPublish = document.getElementById('btnPublish');
        const btnSave = document.getElementById('btnSave');
        const btnAI = document.getElementById('btnAI');
        const btnReset = document.getElementById('btnReset'); // HTML 需有此按鈕

        if(badge) {
            badge.textContent = st === 'published' ? '已發布' : '草稿';
            badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;
        }

        const isLocked = (st === 'published');
        if(btnSave) btnSave.disabled = isLocked;
        if(btnAI) btnAI.disabled = isLocked;
        if(btnReset) btnReset.disabled = isLocked;
        
        if(btnPublish) {
            btnPublish.textContent = isLocked ? '撤回發布' : '發布班表';
            btnPublish.className = isLocked ? 'btn btn-secondary' : 'btn btn-success';
            btnPublish.onclick = () => this.togglePublish();
        }
    },

    // --- [功能] 重置排班 ---
    resetSchedule: async function() {
        // 呼叫後端 scheduleManager.resetToSource
        const newAssignments = await scheduleManager.resetToSource();
        if (newAssignments) {
            this.assignments = newAssignments;
            this.renderMatrix();
            this.updateRealTimeStats();
            this.saveDraft(true); // 自動存檔
        }
    },

    // --- [功能] 發布與撤回 ---
    togglePublish: async function() {
        const isPublished = (this.data.status === 'published');
        const action = isPublished ? '撤回' : '發布';
        if(!confirm(`確定要${action}此班表嗎？\n${isPublished ? '撤回後可重新編輯。' : '發布後同仁將可查看。'}`)) return;

        try {
            const newStatus = isPublished ? 'draft' : 'published';
            await db.collection('schedules').doc(this.scheduleId).update({
                status: newStatus,
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = newStatus;
            this.updateStatusUI();
            alert(`已${action}！`);
        } catch(e) { alert("操作失敗: " + e.message); }
    },

    // --- [功能] 渲染矩陣 (含上月、偏好、特註、缺口) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();

        // 1. 表頭
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; z-index:30;">姓名</th>
            <th rowspan="2" style="width:40px; z-index:30;">職級</th>
            <th rowspan="2" style="width:30px; z-index:30;">註</th>
            <th rowspan="2" style="width:80px; z-index:30; font-size:0.8rem;">偏好</th>
            <th colspan="6" style="background:#eee;">上月</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            const c = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${c}">${d}</th>`;
        }
        h1 += `<th colspan="4">統計</th></tr>`;
        
        let h2 = `<tr>`;
        for(let i=5; i>=0; i--) h2 += `<th class="cell-last-month cell-narrow">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) h2 += `<th></th>`;
        h2 += `<th>OFF</th><th>假</th><th>N</th><th>E</th></tr>`;

        thead.innerHTML = h1 + h2;

        // 2. 內容
        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            // 從快照讀取屬性
            const params = u.schedulingParams || {};
            const note = u.note || ""; 
            const assign = this.assignments[u.uid] || {};
            const pref = assign.preferences || {};

            // 圖示
            let icons = '';
            if (params.isPregnant) icons += '<span title="孕">🤰</span>';
            if (params.canBundleShifts) icons += '<span title="包班" style="color:blue;font-size:0.8em;">包</span>';
            if (note) icons += `<i class="fas fa-info-circle" title="${note}" style="color:#555;"></i>`;

            // 偏好顯示
            let prefStr = [];
            if (pref.bundleShift) prefStr.push(`包${pref.bundleShift}`);
            if (pref.priority_1) prefStr.push(`1.${pref.priority_1}`);
            if (pref.priority_2) prefStr.push(`2.${pref.priority_2}`);
            const prefDisplay = prefStr.join(' ') || '-';

            bodyHtml += `<tr data-uid="${u.uid}">
                <td style="font-weight:bold; position:sticky; left:0; background:#fff; z-index:10;">${u.name}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10;">${u.level}</td>
                <td style="position:sticky; left:100px; background:#fff; z-index:10; text-align:center;">${icons}</td>
                <td style="font-size:0.75rem; color:#666; overflow:hidden; white-space:nowrap;" title="${prefDisplay}">${prefDisplay}</td>`;

            // 上月班表 (從 assignments 讀取)
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const val = assign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-last-month cell-narrow">${val}</td>`;
            }

            // 本月班表
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                let style = "";
                let content = "";
                
                if (val === 'REQ_OFF') { style = "background:#e8f8f5; color:#27ae60; font-weight:bold;"; content = "休"; }
                else if (val && val.startsWith('!')) { style = "background:#fdedec; color:#c0392b;"; content = "🚫"; }
                else if (val === 'OFF') { content = "OFF"; }
                else if (val) {
                    const shift = this.shiftMap[val];
                    style = `color:${shift?.color || '#333'}; font-weight:bold;`;
                    content = val;
                }
                bodyHtml += `<td class="cell-clickable cell-narrow" style="${style}" 
                    onclick="scheduleEditorManager.handleCellClick('${u.uid}', ${d})" 
                    oncontextmenu="scheduleEditorManager.handleRightClick(event, '${u.uid}', ${d})">${content}</td>`;
            }

            // 統計
            bodyHtml += `<td id="stat_off_${u.uid}" class="text-center font-bold">0</td>
                         <td id="stat_hol_${u.uid}" class="text-center">0</td>
                         <td id="stat_n_${u.uid}" class="text-center">0</td>
                         <td id="stat_e_${u.uid}" class="text-center">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部缺口計算
        this.renderFooter(daysInMonth);
    },

    renderFooter: function(daysInMonth) {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        
        let footHtml = `<tr><td colspan="10" style="text-align:right; font-weight:bold;">人力缺口 (需求 - 現有):</td>`;
        const dailyNeeds = this.data.dailyNeeds || {};

        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(this.data.year, this.data.month - 1, d);
            const dayIdx = date.getDay() === 0 ? 6 : date.getDay() - 1; 
            
            let gaps = [];
            // 針對該單位所有班別計算缺口
            this.shifts.forEach(s => {
                const code = s.code;
                const need = dailyNeeds[`${code}_${dayIdx}`] || 0;
                let have = 0;
                Object.values(this.assignments).forEach(a => { if (a[`current_${d}`] === code) have++; });
                
                if (need > 0 && have < need) {
                    gaps.push(`${code}:${need-have}`);
                }
            });

            const style = gaps.length > 0 ? "background:#fff3cd; color:#c0392b; font-weight:bold; font-size:0.7rem;" : "";
            footHtml += `<td class="cell-narrow" style="${style}">${gaps.join('<br>') || '-'}</td>`;
        }
        footHtml += `<td colspan="4"></td></tr>`;
        tfoot.innerHTML = footHtml;
    },

    // ... (保留 runAI, saveDraft 等其他函式) ...
    runAI: async function() {
        if(!confirm("確定執行 AI 排班？建議先重置。")) return;
        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        modal.classList.add('show');
        container.innerHTML = '運算中...';
        try {
            scheduleManager.matrix = JSON.parse(JSON.stringify(this.assignments));
            this.tempOptions = await scheduleManager.generateOptions();
            this.renderAiOptions();
        } catch(e) { container.innerHTML = '失敗:' + e.message; }
    },
    renderAiOptions: function() {
        const c = document.getElementById('aiOptionsContainer'); c.innerHTML = '';
        this.tempOptions.forEach((o, i) => {
            c.innerHTML += `<div class="ai-option-card"><b>${o.name}</b><br>Avg OFF: ${o.metrics.avgOff}<br><button onclick="scheduleEditorManager.applyAiOption(${i})">套用</button></div>`;
        });
    },
    applyAiOption: function(i) {
        if(this.tempOptions[i]) {
            this.assignments = this.tempOptions[i].assignments;
            document.getElementById('aiResultModal').classList.remove('show');
            this.renderMatrix(); this.updateRealTimeStats();
        }
    },
    saveDraft: async function(silent) {
        await db.collection('schedules').doc(this.scheduleId).update({
            assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if(!silent) alert("已儲存");
    },
    updateRealTimeStats: function() { /* 保留原邏輯，計算 Off/N/E */ 
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(u => {
            let off=0, n=0, e=0;
            for(let d=1; d<=dim; d++) {
                const v = this.assignments[u.uid]?.[`current_${d}`];
                if(v==='OFF'||v==='REQ_OFF') off++;
                else if(v==='N') n++;
                else if(v==='E') e++;
            }
            const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            set(`stat_off_${u.uid}`, off); set(`stat_n_${u.uid}`, n); set(`stat_e_${u.uid}`, e);
        });
    },
    handleCellClick: function(uid, d) { /* 保留 */ },
    handleRightClick: function(e, uid, d) { 
        e.preventDefault(); 
        const menu = document.getElementById('schContextMenu'); 
        // 需自行實作右鍵選單顯示邏輯，或沿用舊版
        if(menu) { menu.style.display='block'; menu.style.left=e.pageX+'px'; menu.style.top=e.pageY+'px'; }
        // 暫存 target
        this.targetCell = { uid, d };
    },
    setShift: function(code) { // 供選單呼叫
        if(this.targetCell) {
            const { uid, d } = this.targetCell;
            if(!this.assignments[uid]) this.assignments[uid]={};
            if(code===null) delete this.assignments[uid][`current_${d}`];
            else this.assignments[uid][`current_${d}`] = code;
            this.renderMatrix(); this.updateRealTimeStats();
            document.getElementById('schContextMenu').style.display='none';
        }
    },
    setupEvents: function() {
        document.addEventListener('click', e => {
            const m = document.getElementById('schContextMenu');
            if(m && !m.contains(e.target)) m.style.display='none';
        });
    }
};
