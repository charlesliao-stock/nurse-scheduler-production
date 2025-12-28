// js/modules/schedule_editor_manager.js

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {},
    assignments: {},
    tempOptions: [], // 暫存 AI 的 3 個方案

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

    // --- [修改] AI 排班與選擇 ---
    runAI: async function() {
        if(!confirm("確定要執行 AI 排班？\n系統將生成 3 種方案供您選擇。")) return;

        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        modal.classList.add('show');
        container.innerHTML = '<div style="text-align:center; width:100%; padding:30px;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI 正在努力運算 3 種最佳方案...<br>請稍候約 3-5 秒</div>';

        try {
            // 1. 載入 AI Context
            const loaded = await scheduleManager.loadContext(this.scheduleId, 'schedules');
            if(!loaded) throw new Error("AI 初始化失敗");

            // 2. 生成多方案
            this.tempOptions = await scheduleManager.generateOptions();

            // 3. 顯示卡片
            this.renderAiOptions();

        } catch(e) {
            console.error("AI Run Error:", e);
            container.innerHTML = `<div style="color:red;">運算失敗: ${e.message}</div>`;
        }
    },

    renderAiOptions: function() {
        const container = document.getElementById('aiOptionsContainer');
        container.innerHTML = '';

        this.tempOptions.forEach((opt, index) => {
            const m = opt.metrics;
            const html = `
                <div class="ai-option-card">
                    <div class="ai-option-title">${opt.name}</div>
                    <div class="ai-metric"><span>平均休假:</span><span>${m.avgOff} 天</span></div>
                    <div class="ai-metric"><span>休假不均度:</span><span>${m.offStdDev}</span></div>
                    <div class="ai-metric"><span>夜班不均度:</span><span>${m.nightStdDev}</span></div>
                    <hr style="border:0; border-top:1px dashed #ddd; margin:10px 0;">
                    <div style="font-size:0.85rem; color:#888; margin-bottom:10px;">
                        (數值越低代表越公平)
                    </div>
                    <button class="btn-apply-ai" onclick="scheduleEditorManager.applyAiOption(${index})">
                        <i class="fas fa-check"></i> 套用此方案
                    </button>
                </div>
            `;
            container.innerHTML += html;
        });
    },

    applyAiOption: function(index) {
        if (!this.tempOptions[index]) return;
        this.assignments = this.tempOptions[index].assignments;
        
        document.getElementById('aiResultModal').classList.remove('show');
        this.renderMatrix();
        this.updateRealTimeStats();
        alert("已套用方案，請記得按下「儲存」！");
    },

    // --- [修改] 發布功能 ---
    publishSchedule: async function() {
        if(!confirm("確定要發布此班表嗎？\n發布後同仁將可看到正式班表。")) return;
        
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                status: 'published',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("🎉 班表已成功發布！");
            
            // 更新 UI 狀態
            const badge = document.getElementById('schStatus');
            badge.textContent = '已發布';
            badge.className = 'badge bg-success';
            
            // 可選：跳轉回列表
            window.location.hash = '/admin/schedule_list';

        } catch(e) {
            console.error(e);
            alert("發布失敗: " + e.message);
        }
    },

    saveDraft: async function() {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("草稿已儲存");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },

    // --- [修改] 矩陣渲染 (整合統計欄位) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();

        // 表頭：增加統計欄位
        let h1 = `<tr><th rowspan="2" style="width:60px; z-index:30;">姓名</th><th rowspan="2" style="width:40px; z-index:30;">職級</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const weekDay = date.getDay(); 
            const color = (weekDay===0 || weekDay===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        // [新增] 統計表頭
        h1 += `<th rowspan="2" style="width:40px; background:#fff3cd; border-left:2px solid #ccc;">OFF</th>`;
        h1 += `<th rowspan="2" style="width:40px; background:#e8f8f5;">假</th>`;
        h1 += `<th rowspan="2" style="width:40px; background:#eaf2f8;">N</th>`;
        h1 += `<th rowspan="2" style="width:40px; background:#fdedec;">E</th>`;
        h1 += `</tr>`;
        thead.innerHTML = h1;

        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            bodyHtml += `<tr data-uid="${u.uid}">
                <td style="font-weight:bold; position:sticky; left:0; background:#fff; z-index:10;">${u.name}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10;">${u.level}</td>`;
            
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
                bodyHtml += `<td class="cell-clickable cell-narrow" style="${style}" 
                    onclick="scheduleEditorManager.handleCellClick('${u.uid}', ${d})" 
                    oncontextmenu="scheduleEditorManager.handleRightClick(event, '${u.uid}', ${d})">
                    ${content}
                </td>`;
            }

            // [新增] 統計欄位 (ID 方便更新)
            bodyHtml += `<td id="stat_off_${u.uid}" style="font-weight:bold; border-left:2px solid #ccc; text-align:center;">0</td>`;
            bodyHtml += `<td id="stat_hol_${u.uid}" style="text-align:center;">0</td>`;
            bodyHtml += `<td id="stat_n_${u.uid}" style="text-align:center;">0</td>`;
            bodyHtml += `<td id="stat_e_${u.uid}" style="text-align:center;">0</td>`;

            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    // --- [修改] 即時統計 (更新表格內欄位) ---
    updateRealTimeStats: function() {
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

            // 更新 DOM
            const elOff = document.getElementById(`stat_off_${u.uid}`);
            const elHol = document.getElementById(`stat_hol_${u.uid}`);
            const elN = document.getElementById(`stat_n_${u.uid}`);
            const elE = document.getElementById(`stat_e_${u.uid}`);

            if(elOff) elOff.textContent = off;
            if(elHol) elHol.textContent = holidayOff;
            if(elN) elN.textContent = n;
            if(elE) elE.textContent = e;
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
    }
};
