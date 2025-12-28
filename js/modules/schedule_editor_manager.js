// js/modules/schedule_editor_manager.js

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {},
    assignments: {},
    
    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) return;
        await this.loadContext();
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

            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            const st = this.data.status;
            const badge = document.getElementById('schStatus');
            if(badge) {
                badge.textContent = st === 'published' ? '已發布' : '草稿';
                badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;
            }
        } catch(e) { console.error(e); alert("載入失敗: " + e.message); }
    },

    // [核心修改] 呼叫 AI 排班
    runAI: async function() {
        if(!confirm("確定要執行 AI 排班？\n系統將依照規則自動填補所有空白欄位。")) return;

        // 顯示遮罩 (如果有的話)
        // const overlay = document.getElementById('aiLoadingOverlay');
        // if(overlay) overlay.style.display = 'flex';
        
        // 簡單的 Loading 指示
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 運算中...';

        try {
            // 1. 載入 AI Context (傳入 'schedules' 告訴 AI 這是草稿)
            const loaded = await scheduleManager.loadContext(this.scheduleId, 'schedules');
            if(!loaded) throw new Error("AI 初始化失敗");

            // 2. 執行運算
            const newAssignments = await scheduleManager.runAutoSchedule();

            // 3. 更新介面
            if(newAssignments) {
                this.assignments = newAssignments;
                this.renderMatrix();
                this.updateRealTimeStats();
                alert("✨ AI 排班完成！請檢查結果並儲存。");
            }

        } catch(e) {
            console.error("AI Run Error:", e);
            alert("排班失敗: " + e.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
            // if(overlay) overlay.style.display = 'none';
        }
    },

    // ... (以下 renderMatrix, updateRealTimeStats, saveDraft 等保持不變，請保留原有力碼) ...
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();

        let h1 = `<tr><th rowspan="2" style="width:60px;">姓名</th><th rowspan="2" style="width:40px;">職級</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const weekDay = date.getDay(); 
            const color = (weekDay===0 || weekDay===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        h1 += `</tr>`;
        thead.innerHTML = h1;

        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            bodyHtml += `<tr data-uid="${u.uid}"><td style="font-weight:bold;">${u.name}</td><td>${u.level}</td>`;
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = this.assignments[u.uid]?.[key] || '';
                let style = "";
                let content = "";
                
                if (val === 'REQ_OFF') { style = "background:#e8f8f5; color:#27ae60; font-weight:bold;"; content = "休"; }
                else if (val && val.startsWith('!')) { style = "background:#fdedec; color:#c0392b; font-size:0.8rem;"; content = `<i class="fas fa-ban"></i>`; }
                else if (val === 'OFF') { content = "OFF"; }
                else if (val) {
                    const shift = this.shiftMap[val];
                    const color = shift ? shift.color : '#333';
                    style = `color:${color}; font-weight:bold;`;
                    content = val;
                }
                bodyHtml += `<td class="cell-clickable cell-narrow" style="${style}" onclick="scheduleEditorManager.handleCellClick('${u.uid}', ${d})" oncontextmenu="scheduleEditorManager.handleRightClick(event, '${u.uid}', ${d})">${content}</td>`;
            }
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    updateRealTimeStats: function() {
        const tbody = document.getElementById('sideStatsBody');
        tbody.innerHTML = '';
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(u => {
            let off = 0, holidayOff = 0, n = 0, e = 0;
            const assign = this.assignments[u.uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                const date = new Date(this.data.year, this.data.month - 1, d);
                const isWeekend = (date.getDay()===0 || date.getDay()===6);
                if(val === 'OFF' || val === 'REQ_OFF') {
                    off++;
                    if(isWeekend) holidayOff++;
                } else if (val === 'N') n++;
                else if (val === 'E') e++;
            }
            tbody.innerHTML += `<tr><td>${u.name}</td><td>${off}</td><td>${holidayOff}</td><td>${n}</td><td>${e}</td></tr>`;
        });
    },

    handleCellClick: function(uid, day) { console.log("Click:", uid, day); },
    handleRightClick: function(e, uid, day) {
        e.preventDefault();
        const menu = document.getElementById('schContextMenu');
        const options = document.getElementById('schMenuOptions');
        let html = `<div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, 'OFF')">OFF (休)</div>`;
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, '${s.code}')" style="color:${s.color}">${s.name} (${s.code})</div>`;
        });
        html += `<div class="menu-separator"></div><div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="color:red;">清除</div>`;
        options.innerHTML = html;
        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    },
    setShift: function(uid, day, code) {
        if(!this.assignments[uid]) this.assignments[uid] = {};
        const key = `current_${day}`;
        if(code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;
        document.getElementById('schContextMenu').style.display = 'none';
        this.renderMatrix();
        this.updateRealTimeStats();
    },
    setupEvents: function() {
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('schContextMenu');
            if(menu && !menu.contains(e.target)) menu.style.display = 'none';
        });
    },
    saveDraft: async function() {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("草稿已儲存");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    }
};
