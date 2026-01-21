// js/modules/schedule_editor_manager.js
// 🚀 旗艦修正版：修復 AI 資料傳遞、CSS對齊、統計邏輯

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    lastMonthAssignments: {}, 
    shifts: [], 
    assignments: {}, 
    unitRules: {}, 
    staffMap: {}, 
    usersMap: {}, 
    isLoading: false,
    dragSrcUid: null, 
    dragSrcDay: null,
    currentScoreData: null,

    // --- 1. 初始化 ---
    init: async function(id) { 
        console.log("Schedule Editor Init (Fixed):", id);
        this.scheduleId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.showLoading();
        try {
            await this.loadContext(); 
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthData()
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
                if (this.data.aiBaseScore) scoringManager.setBase(this.data.aiBaseScore);
            }
            
            this.assignments = this.data.assignments || {};
            if (!this.data.staffList) throw new Error("人員名單資料損毀");

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore();
            this.setupDragDrop();

        } catch(e) { console.error(e); alert("載入失敗: " + e.message); } 
        finally { this.isLoading = false; }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if(!doc.exists) throw new Error("找不到排班表");
        this.data = doc.data();
    },
    loadLastMonthData: async function() {
        try {
            let prevYear = this.data.year;
            let prevMonth = this.data.month - 1;
            if (prevMonth === 0) { prevMonth = 12; prevYear--; }
            const snapshot = await db.collection('schedules').where('unitId', '==', this.data.unitId).where('year', '==', prevYear).where('month', '==', prevMonth).limit(1).get();
            this.lastMonthAssignments = snapshot.empty ? {} : snapshot.docs[0].data().assignments || {};
        } catch(e) { console.error(e); }
    },
    loadShifts: async function() {
        const snap = await db.collection('shifts').where('unitId', '==', this.data.unitId).orderBy('startTime').get();
        this.shifts = snap.docs.map(d => d.data());
    },
    loadUsers: async function() {
        const snap = await db.collection('users').where('unitId', '==', this.data.unitId).get();
        this.usersMap = {};
        snap.forEach(d => { this.usersMap[d.id] = d.data().displayName || d.data().name; });
    },
    loadUnitRules: async function() {
        const doc = await db.collection('units').doc(this.data.unitId).get();
        if(doc.exists) this.unitRules = doc.data().schedulingRules || {};
    },
    showLoading: function() {
        const grid = document.getElementById('schBody');
        if(grid) grid.innerHTML = '<tr><td colspan="40" style="padding:50px; text-align:center;">資料載入中...</td></tr>';
    },

    // --- 2. 工具列 ---
    renderToolbar: function() {
        const title = document.getElementById('schTitle');
        const badge = document.getElementById('schStatus');
        const toolbarRight = document.getElementById('toolbarRight');
        if(title) title.innerText = `${this.data.year}年 ${this.data.month}月 排班表`;
        
        let statusText = '草稿';
        let statusColor = 'secondary';
        if(this.data.status === 'published') { statusText = '已發布'; statusColor = 'success'; }
        if(badge) { badge.innerText = statusText; badge.className = `badge badge-${statusColor}`; }

        if(toolbarRight) {
            let html = '';
            if(this.data.status === 'draft') {
                html += `<button class="btn btn-primary btn-action-lg" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
                html += `<button class="btn btn-success btn-action-lg" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-bullhorn"></i> 發布</button>`;
                html += `<button class="btn btn-danger btn-action-lg" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-trash-restore"></i> 重置</button>`;
                // AI 按鈕
                html += `<button id="btnRunAI" class="btn" style="background:#8e44ad; color:white; padding:8px 20px; border-radius:50px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 排班</button>`;
            } else {
                html += `<button class="btn btn-warning btn-action-lg" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-undo"></i> 取消發布</button>`;
            }
            toolbarRight.innerHTML = html;
        }
    },

    // --- 3. 渲染 Matrix (含 CSS Class 對齊) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if(!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['日','一','二','三','四','五','六'];
        const prevMonthDaysToShow = 6;
        const prevMonthLastDate = new Date(year, month-1, 0).getDate(); 

        // Header
        let headHtml = `<tr><th class="col-name">人員 / 日期</th>`;
        for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
            const d = prevMonthLastDate - i;
            headHtml += `<th class="col-date prev-month-header">${d}<br><small style="font-size:0.7em">上月</small></th>`;
        }
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay();
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:#e74c3c;' : '';
            headHtml += `<th class="col-date" style="${color}">${d}<br><small>${weekDays[dayOfWeek]}</small></th>`;
        }
        headHtml += `<th class="col-stat">總OFF</th><th class="col-stat">假OFF</th><th class="col-stat">小夜</th><th class="col-stat">大夜</th></tr>`;
        thead.innerHTML = headHtml;

        // Body
        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const staffName = this.usersMap[uid] || staff.name || '未知';
            
            bodyHtml += `<tr>`;
            bodyHtml += `<td class="col-name" title="${staffName}">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="overflow:hidden; text-overflow:ellipsis;">${staffName}</span>
                                <i class="fas fa-info-circle text-muted" style="font-size:0.8rem;" onclick="scheduleEditorManager.showStaffStats('${uid}')"></i>
                            </div>
                         </td>`;
            
            for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
                const d = prevMonthLastDate - i;
                const prevCode = this.lastMonthAssignments[uid]?.[`current_${d}`] || '';
                bodyHtml += `<td class="col-date prev-month-cell">${prevCode}</td>`;
            }

            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                let shiftCode = this.assignments[uid]?.[key];
                const isReq = (this.data.preRequests?.[uid]?.[key] === 'REQ_OFF');
                
                let displayCode = shiftCode;
                let style = '';
                let className = 'cell-clickable col-date'; 

                if (!shiftCode || shiftCode === 'OFF') {
                    displayCode = 'OFF'; className += ' shift-off';
                } else if (shiftCode === 'REQ_OFF') {
                    displayCode = '休'; className += ' shift-req-off';
                } else {
                    const shiftInfo = this.shifts.find(s => s.code === shiftCode);
                    const bgColor = shiftInfo ? shiftInfo.color : '#fff';
                    const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
                    style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
                }

                if (isReq && shiftCode && shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF') style += 'border:2px solid red;';

                bodyHtml += `<td id="cell_${uid}_${d}" class="${className}" style="${style}"
                                draggable="true"
                                ondragstart="scheduleEditorManager.handleDragStart(event, '${uid}', ${d})"
                                ondrop="scheduleEditorManager.handleDrop(event, '${uid}', ${d})"
                                ondragover="event.preventDefault()"
                                onclick="scheduleEditorManager.handleCellClick('${uid}', ${d})"
                                oncontextmenu="scheduleEditorManager.handleRightClick(event, '${uid}', ${d})">
                                ${displayCode}
                             </td>`;
            }
            
            bodyHtml += `<td class="col-stat stats-cell" id="stat_totalOff_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_holidayOff_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_E_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_N_${uid}">-</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // Footer (分列顯示)
        if(tfoot) {
            let footHtml = '';
            this.shifts.forEach(s => {
                const code = s.code;
                footHtml += `<tr id="footer_row_${code}">`;
                footHtml += `<td class="col-name" style="color:${s.color}; border-right:2px solid #ddd;">需求 ${code}</td>`;
                for(let i=0; i<prevMonthDaysToShow; i++) footHtml += `<td class="col-date" style="background:#f0f0f0;"></td>`;
                for(let d=1; d<=daysInMonth; d++) footHtml += `<td class="col-date" id="footer_${code}_${d}">-</td>`;
                footHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
                footHtml += `</tr>`;
            });
            tfoot.innerHTML = footHtml;
        }
    },

    // --- 4. 統計計算 ---
    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {}; 
        const dailyCounts = {}; 
        for(let d=1; d<=daysInMonth; d++) dailyCounts[d] = {};

        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.assignments[uid] || {};
            let totalOff=0, holidayOff=0, countE=0, countN=0;

            for(let d=1; d<=daysInMonth; d++) {
                const dateObj = new Date(this.data.year, this.data.month-1, d);
                const dayOfWeek = dateObj.getDay(); 
                let code = assign[`current_${d}`] || 'OFF';

                if (code === 'OFF' || code === 'REQ_OFF') {
                    totalOff++;
                    if (dayOfWeek === 0 || dayOfWeek === 6) holidayOff++;
                } else {
                    if (!dailyCounts[d][code]) dailyCounts[d][code] = 0;
                    dailyCounts[d][code]++;
                    if (['E', 'EN', 'PN'].includes(code)) countE++;
                    if (['N', 'AN', 'MN'].includes(code)) countN++;
                }
            }
            const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.innerText = v; };
            setTxt(`stat_totalOff_${uid}`, totalOff);
            setTxt(`stat_holidayOff_${uid}`, holidayOff);
            setTxt(`stat_E_${uid}`, countE);
            setTxt(`stat_N_${uid}`, countN);
        });

        this.shifts.forEach(s => {
            const code = s.code;
            for(let d=1; d<=daysInMonth; d++) {
                const cell = document.getElementById(`footer_${code}_${d}`);
                if (!cell) continue;
                const dayOfWeek = new Date(this.data.year, this.data.month-1, d).getDay(); 
                const needKey = `${code}_${dayOfWeek}`;
                const required = parseInt(dailyNeeds[needKey]) || 0;
                const actual = dailyCounts[d][code] || 0;

                if (required === 0 && actual === 0) {
                    cell.innerHTML = '<span style="color:#eee;">-</span>';
                } else {
                    let text = `${actual}/${required}`;
                    let style = '';
                    if (required > 0 && actual < required) style = 'color:red; font-weight:bold; background:#ffe6e6; display:block; height:100%;';
                    else if (actual > required) style = 'color:blue;';
                    else style = 'color:green;';
                    cell.innerHTML = `<span style="${style}">${text}</span>`;
                }
            }
        });
    },

// 在 schedule_editor_manager.js 中...

    // --- 5. AI 功能 ---
    runAI: async function() {
        if(!confirm("即將執行 AI 自動排班...")) return;
        
        this.isLoading = true;
        const btn = document.getElementById('btnRunAI');
        if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 運算中...'; }

        try {
            await new Promise(r => setTimeout(r, 100)); 

            if(typeof ScheduleBatchRunner === 'undefined') throw new Error("找不到 AI 核心");

            // [關鍵] 將 dailyNeeds 放入規則包
            const aiRules = {
                ...this.unitRules,
                dailyNeeds: this.data.dailyNeeds || {}, 
                shiftCodes: this.shifts.map(s => s.code)
            };

            const runner = new ScheduleBatchRunner(
                this.data.staffList,
                this.data.year,
                this.data.month,
                this.lastMonthAssignments, 
                aiRules
            );

            const results = runner.runAll();
            
            if (results && results.length > 0 && results[0].schedule) {
                this.assignments = results[0].schedule;
                this.renderMatrix();
                this.updateRealTimeStats();
                this.updateScheduleScore();
                await this.saveDraft(true);
                alert(`AI 排班完成！策略: ${results[0].info.name}`);
            } else {
                throw new Error("AI 無法產生有效解");
            }

        } catch(e) {
            console.error(e);
            alert("AI 排班失敗: " + e.message);
        } finally {
            this.isLoading = false;
            if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot"></i> AI 排班'; }
        }
    },

    updateScheduleScore: function() {
        if(typeof scoringManager === 'undefined') return;
        
        // [關鍵] 傳入 dailyNeeds 給評分模組，以便計算缺口率
        const extraData = {
            dailyNeeds: this.data.dailyNeeds || {}
        };

        const scoreData = scoringManager.calculate(
            this.assignments, 
            this.data.staffList, 
            this.data.year, 
            this.data.month,
            extraData // 傳入
        );
        
        this.currentScoreData = scoreData;
        const displayArea = document.getElementById('scoreDisplayArea');
        const scoreText = document.getElementById('mainScoreDisplay');
        if(displayArea && scoreText) {
            displayArea.style.display = 'inline-flex';
            scoreText.innerText = scoreData.total.toFixed(1);
        }
    },

    // 互動函式
    setShift: function(uid, day, code) {
        const key = `current_${day}`;
        if (!this.assignments[uid]) this.assignments[uid] = {};
        if (code === null) delete this.assignments[uid][key]; else this.assignments[uid][key] = code;
        this.renderCell(uid, day); this.updateRealTimeStats(); this.updateScheduleScore();
    },
    renderCell: function(uid, day) {
        const cell = document.getElementById(`cell_${uid}_${day}`);
        if(!cell) return;
        const key = `current_${day}`;
        let shiftCode = this.assignments[uid]?.[key];
        let displayCode = shiftCode;
        let className = 'cell-clickable col-date'; 
        let style = '';
        if (!shiftCode || shiftCode === 'OFF') {
            displayCode = 'OFF'; className += ' shift-off';
            cell.innerText = 'OFF'; cell.style = 'background-color:#eee; color:#999;';
        } else if (shiftCode === 'REQ_OFF') {
            displayCode = '休'; className += ' shift-req-off';
            cell.innerText = '休'; cell.style = 'background-color:#ffeaa7; color:#d35400; font-weight:bold;';
        } else {
            const shiftInfo = this.shifts.find(s => s.code === shiftCode);
            const bgColor = shiftInfo ? shiftInfo.color : '#fff';
            const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
            cell.innerText = shiftCode;
            cell.style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
        }
        cell.className = className;
    },
    handleRightClick: function(e, uid, day) {
        e.preventDefault();
        const menu = document.getElementById('schContextMenu');
        if(!menu) return;
        const ul = menu.querySelector('ul');
        ul.innerHTML = '';
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, 'OFF')">OFF (休)</li>`;
        this.shifts.forEach(s => {
            ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, '${s.code}')" style="color:${s.color}; font-weight:bold;">${s.code} (${s.name})</li>`;
        });
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="border-top:1px solid #eee; color:#e74c3c;">清除</li>`;
        menu.style.display = 'block'; menu.style.left = `${e.pageX}px`; menu.style.top = `${e.pageY}px`;
        const closeMenu = () => { menu.style.display = 'none'; document.removeEventListener('click', closeMenu); };
        document.addEventListener('click', closeMenu);
    },
    setupDragDrop: function() {},
    handleDragStart: function(e, uid, day) { this.dragSrcUid = uid; this.dragSrcDay = day; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.5'; },
    handleDrop: function(e, targetUid, targetDay) { e.preventDefault(); document.getElementById(`cell_${this.dragSrcUid}_${this.dragSrcDay}`).style.opacity = '1'; if (this.dragSrcUid === targetUid && this.dragSrcDay === targetDay) return; this.swapShifts(this.dragSrcUid, this.dragSrcDay, targetUid, targetDay); },
    swapShifts: function(uid1, day1, uid2, day2) {
        const key1 = `current_${day1}`; const key2 = `current_${day2}`;
        if (!this.assignments[uid1]) this.assignments[uid1] = {};
        if (!this.assignments[uid2]) this.assignments[uid2] = {};
        const val1 = this.assignments[uid1][key1]; const val2 = this.assignments[uid2][key2];
        if (val2 === undefined) delete this.assignments[uid1][key1]; else this.assignments[uid1][key1] = val2;
        if (val1 === undefined) delete this.assignments[uid2][key2]; else this.assignments[uid2][key2] = val1;
        this.renderCell(uid1, day1); this.renderCell(uid2, day2);
        this.updateRealTimeStats(); this.updateScheduleScore();
    },
    updateScheduleScore: function() {
        if(typeof scoringManager === 'undefined') return;
        const scoreData = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        this.currentScoreData = scoreData;
        const displayArea = document.getElementById('scoreDisplayArea');
        const scoreText = document.getElementById('mainScoreDisplay');
        if(displayArea && scoreText) {
            displayArea.style.display = 'inline-flex';
            scoreText.innerText = scoreData.total.toFixed(1);
        }
    },
    openScoreModal: function() {
        if (!this.currentScoreData) this.updateScheduleScore();
        const data = this.currentScoreData;
        if (!data || !data.details) return;
        const modal = document.getElementById('scoreDetailModal');
        const content = document.getElementById('scoreDetailContent');
        const totalDisplay = document.getElementById('modalTotalScore');
        totalDisplay.innerText = `${data.total.toFixed(1)} 分`;
        let html = '';
        const order = ['fairness', 'satisfaction', 'fatigue', 'efficiency', 'cost'];
        order.forEach(catKey => {
            const cat = data.details[catKey];
            if (!cat || cat.max === 0) return;
            html += `<div class="score-cat-row"><span>${cat.label}</span><span>${cat.score.toFixed(1)} / ${cat.max}</span></div>`;
            if (cat.subs) cat.subs.forEach((sub, i) => {
                const ratio = sub.max > 0 ? (sub.score / sub.max) : 0;
                let colorClass = ratio >= 0.99 ? 'perfect' : (ratio < 0.6 ? 'bad' : '');
                html += `<div class="score-sub-row"><span>(${i+1}) ${sub.label}</span><span class="score-val ${colorClass}">${sub.score.toFixed(1)} / ${sub.max}</span></div>`;
            });
        });
        content.innerHTML = html;
        modal.classList.add('show');
    },
    saveDraft: async function(silent = false) { try { await db.collection('schedules').doc(this.scheduleId).update({ assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); if(!silent) alert("儲存成功"); } catch(e) { console.error(e); alert("儲存失敗"); } },
    publishSchedule: async function() { if(!confirm("確定要發布?")) return; try { await db.collection('schedules').doc(this.scheduleId).update({ status: 'published', publishedAt: firebase.firestore.FieldValue.serverTimestamp(), assignments: this.assignments }); this.data.status = 'published'; this.renderToolbar(); alert("已發布"); } catch(e) { alert("發布失敗"); } },
    unpublishSchedule: async function() { if(!confirm("確定取消發布?")) return; try { await db.collection('schedules').doc(this.scheduleId).update({ status: 'draft', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); this.data.status = 'draft'; this.renderToolbar(); alert("已取消"); } catch(e) { alert("失敗"); } },
    resetSchedule: async function() { if(!confirm("確定重置?")) return; const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate(); this.data.staffList.forEach(staff => { const uid = staff.uid; if (!this.assignments[uid]) return; for (let d = 1; d <= daysInMonth; d++) { if (this.assignments[uid][`current_${d}`] !== 'REQ_OFF') delete this.assignments[uid][`current_${d}`]; } }); this.renderMatrix(); this.updateRealTimeStats(); this.updateScheduleScore(); await this.saveDraft(true); },
    isLightColor: function(hex) { if(!hex) return true; const r = parseInt(hex.substr(1,2),16); const g = parseInt(hex.substr(3,2),16); const b = parseInt(hex.substr(5,2),16); return (((r*299)+(g*587)+(b*114))/1000) >= 128; },
    showStaffStats: function(uid) { alert("此功能開發中"); }
};
