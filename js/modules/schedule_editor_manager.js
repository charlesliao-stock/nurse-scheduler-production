// js/modules/schedule_editor_manager.js
// 🚀 旗艦完整版：含上月參照、自動OFF、完整統計(Row/Footer)、CSS對齊修正

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    lastMonthAssignments: {}, // 上個月的班表資料
    shifts: [], 
    assignments: {}, 
    unitRules: {}, 
    staffMap: {}, 
    usersMap: {}, 
    isLoading: false,
    dragSrcUid: null, 
    dragSrcDay: null,
    currentScoreData: null,

    // --- 1. 初始化與資料載入 ---
    init: async function(id) { 
        console.log("Schedule Editor Init (Final UI):", id);
        this.scheduleId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.showLoading();
        try {
            await this.loadContext(); 
            
            // 平行載入所有必要資料 (含上個月資料)
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthData()
            ]);
            
            // 載入評分模組
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
                if (this.data.aiBaseScore) scoringManager.setBase(this.data.aiBaseScore);
            }
            
            // 資料防呆
            this.assignments = this.data.assignments || {};
            if (!this.data.staffList) throw new Error("人員名單資料損毀");

            // 渲染介面
            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats(); // 初始計算統計
            this.updateScheduleScore(); // 初始計算分數
            this.setupDragDrop();

        } catch(e) { 
            console.error(e); 
            alert("載入失敗: " + e.message); 
        } finally { 
            this.isLoading = false; 
        }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if(!doc.exists) throw new Error("找不到排班表");
        this.data = doc.data();
    },

    // 載入上個月資料 (用於顯示前6天)
    loadLastMonthData: async function() {
        try {
            let prevYear = this.data.year;
            let prevMonth = this.data.month - 1;
            if (prevMonth === 0) { prevMonth = 12; prevYear--; }

            const snapshot = await db.collection('schedules')
                .where('unitId', '==', this.data.unitId)
                .where('year', '==', prevYear)
                .where('month', '==', prevMonth)
                .limit(1)
                .get();

            if (!snapshot.empty) {
                this.lastMonthAssignments = snapshot.docs[0].data().assignments || {};
            } else {
                this.lastMonthAssignments = {};
            }
        } catch(e) { console.error("Load Last Month Error:", e); }
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

    // --- 2. 工具列 (按鈕樣式優化) ---
    renderToolbar: function() {
        const title = document.getElementById('schTitle');
        const badge = document.getElementById('schStatus');
        const toolbarRight = document.getElementById('toolbarRight');

        if(title) title.innerText = `${this.data.year}年 ${this.data.month}月 排班表`;
        
        let statusText = '草稿';
        let statusColor = 'secondary';
        if(this.data.status === 'published') { statusText = '已發布'; statusColor = 'success'; }
        
        if(badge) {
            badge.innerText = statusText;
            badge.className = `badge badge-${statusColor}`;
        }

        if(toolbarRight) {
            let html = '';
            // 使用 btn-action-lg 類別 (需配合 CSS)
            if(this.data.status === 'draft') {
                html += `<button class="btn btn-primary btn-action-lg" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
                html += `<button class="btn btn-success btn-action-lg" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-bullhorn"></i> 發布</button>`;
                html += `<button class="btn btn-danger btn-action-lg" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-trash-restore"></i> 重置</button>`;
                html += `<button class="btn" style="background:#8e44ad; color:white;" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 排班</button>`;
            } else {
                html += `<button class="btn btn-warning btn-action-lg" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-undo"></i> 取消發布</button>`;
            }
            toolbarRight.innerHTML = html;
        }
    },

    // --- 3. 核心渲染 (Matrix) - CSS Class 對齊修正版 ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if(!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['日','一','二','三','四','五','六'];
        
        // 設定顯示上個月的天數
        const prevMonthDaysToShow = 6;
        const prevMonthLastDate = new Date(year, month-1, 0).getDate(); 

        // 3.1 渲染表頭 (Header)
        // [修正] 加入 class="col-name" 強制寬度
        let headHtml = `<tr><th class="col-name">人員 / 日期</th>`;
        
        // (A) 上月表頭 (唯讀)
        for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
            const d = prevMonthLastDate - i;
            // [修正] 加入 class="col-date"
            headHtml += `<th class="col-date prev-month-header">${d}<br><small style="font-size:0.7em">上月</small></th>`;
        }

        // (B) 本月表頭
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay();
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:#e74c3c;' : '';
            // [修正] 加入 class="col-date"
            headHtml += `<th class="col-date" style="${color}">${d}<br><small>${weekDays[dayOfWeek]}</small></th>`;
        }
        
        // (C) 統計表頭
        headHtml += `<th class="col-stat">總OFF</th>`;
        headHtml += `<th class="col-stat">假OFF</th>`;
        headHtml += `<th class="col-stat">小夜</th>`;
        headHtml += `<th class="col-stat">大夜</th>`;
        headHtml += `</tr>`;
        thead.innerHTML = headHtml;

        // 3.2 渲染內容 (Body)
        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const staffName = this.usersMap[uid] || staff.name || '未知';
            
            bodyHtml += `<tr>`;
            
            // [修正] 姓名欄加入 class="col-name"
            bodyHtml += `<td class="col-name">
                            <div style="display:flex; justify-content:space-between;">
                                <span>${staffName}</span>
                                <i class="fas fa-info-circle text-muted" onclick="scheduleEditorManager.showStaffStats('${uid}')"></i>
                            </div>
                         </td>`;
            
            // (A) 上月資料 (唯讀)
            for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
                const d = prevMonthLastDate - i;
                const prevCode = this.lastMonthAssignments[uid]?.[`current_${d}`] || '';
                // [修正] 加入 class="col-date"
                bodyHtml += `<td class="col-date prev-month-cell">${prevCode}</td>`;
            }

            // (B) 本月資料
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                let shiftCode = this.assignments[uid]?.[key];
                const isReq = (this.data.preRequests?.[uid]?.[key] === 'REQ_OFF');
                
                let displayCode = shiftCode;
                let style = '';
                // [修正] 加入 class="col-date" 確保對齊
                let className = 'cell-clickable col-date'; 

                // 處理空格 -> OFF
                if (!shiftCode || shiftCode === 'OFF') {
                    displayCode = 'OFF';
                    className += ' shift-off';
                } else if (shiftCode === 'REQ_OFF') {
                    displayCode = '休';
                    className += ' shift-req-off';
                } else {
                    const shiftInfo = this.shifts.find(s => s.code === shiftCode);
                    const bgColor = shiftInfo ? shiftInfo.color : '#fff';
                    const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
                    style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
                }

                // 衝突紅框
                if (isReq && shiftCode && shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF') {
                    style += 'border:2px solid red;';
                }

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
            
            // (C) 統計欄位 (加入 col-stat)
            bodyHtml += `<td class="col-stat stats-cell" id="stat_totalOff_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_holidayOff_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_E_${uid}">-</td>`;
            bodyHtml += `<td class="col-stat stats-cell" id="stat_N_${uid}">-</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3.3 渲染頁尾 (Footer - 每日需求)
        if(tfoot) {
            // [修正] 加入 col-name
            let footHtml = `<tr><td class="col-name" style="font-weight:bold; background:#eee;">每日人力<br>實排/需求</td>`;
            
            // 上月空白 [修正] 加入 col-date
            for(let i=0; i<prevMonthDaysToShow; i++) footHtml += `<td class="col-date" style="background:#f0f0f0;"></td>`;
            
            // 本月需求 [修正] 加入 col-date
            for(let d=1; d<=daysInMonth; d++) {
                footHtml += `<td class="col-date footer-cell" id="footer_day_${d}"></td>`;
            }
            
            // 統計空白
            footHtml += `<td colspan="4" style="background:#eee;"></td></tr>`;
            tfoot.innerHTML = footHtml;
        }
    },

    // --- 4. 統計計算 (更新 Row & Footer) ---
    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {}; 
        
        // 準備 Footer 計數器
        const dailyCounts = {}; 
        for(let d=1; d<=daysInMonth; d++) dailyCounts[d] = {};

        // 4.1 計算每一列 (Row) 的個人統計
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.assignments[uid] || {};
            
            let totalOff = 0;
            let holidayOff = 0;
            let countE = 0;
            let countN = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const dateObj = new Date(this.data.year, this.data.month-1, d);
                const dayOfWeek = dateObj.getDay(); // 0=日, 6=六
                
                // 空值視為 OFF
                let code = assign[`current_${d}`];
                if (!code) code = 'OFF';

                if (code === 'OFF' || code === 'REQ_OFF') {
                    totalOff++;
                    if (dayOfWeek === 0 || dayOfWeek === 6) holidayOff++;
                } else {
                    // 累加 Footer 計數
                    if (!dailyCounts[d][code]) dailyCounts[d][code] = 0;
                    dailyCounts[d][code]++;

                    // 統計小夜(E)/大夜(N) - 依據代號前綴判斷
                    if (['E', 'EN', 'PN'].includes(code)) countE++;
                    if (['N', 'AN', 'MN'].includes(code)) countN++;
                }
            }

            // 更新 DOM
            const elTotal = document.getElementById(`stat_totalOff_${uid}`);
            const elHol = document.getElementById(`stat_holidayOff_${uid}`);
            const elE = document.getElementById(`stat_E_${uid}`);
            const elN = document.getElementById(`stat_N_${uid}`);
            
            if(elTotal) elTotal.innerText = totalOff;
            if(elHol) elHol.innerText = holidayOff;
            if(elE) elE.innerText = countE;
            if(elN) elN.innerText = countN;
        });

        // 4.2 計算底部 (Footer) 缺口
        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`footer_day_${d}`);
            if (!cell) continue;

            const dateObj = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            
            let html = '';
            
            // 找出當天所有相關班別 (有排的 + 有需求的)
            // dailyNeeds 的 key 格式假設為 "ShiftCode_DayOfWeek" (例如 "D_1")
            const activeShifts = new Set(Object.keys(dailyCounts[d]));
            
            this.shifts.forEach(s => {
                const code = s.code;
                const needKey = `${code}_${dayOfWeek}`;
                const required = parseInt(dailyNeeds[needKey]) || 0;
                const actual = dailyCounts[d][code] || 0;

                // 顯示條件：有需求 OR 實際有排人
                if (required > 0 || actual > 0) {
                    let displayClass = '';
                    // 缺人判定
                    if (required > 0 && actual < required) displayClass = 'shortage'; 
                    
                    html += `
                        <div class="footer-item">
                            <span style="font-weight:bold; color:${s.color}">${code}</span>
                            <span class="${displayClass}">${actual}/${required}</span>
                        </div>
                    `;
                }
            });
            cell.innerHTML = html;
        }
    },

    // --- 5. 互動邏輯 ---
    
    setShift: function(uid, day, code) {
        const key = `current_${day}`;
        if (!this.assignments[uid]) this.assignments[uid] = {};
        
        // 空值或OFF都刪除key，讓render預設為OFF
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;

        // 局部更新單元格
        this.renderCell(uid, day);
        this.updateRealTimeStats(); // 重新計算統計
        this.updateScheduleScore();
    },

    renderCell: function(uid, day) {
        const cell = document.getElementById(`cell_${uid}_${day}`);
        if(!cell) return;
        
        const key = `current_${day}`;
        let shiftCode = this.assignments[uid]?.[key];
        
        let displayCode = shiftCode;
        let style = '';
        // [修正] 保持 col-date
        let className = 'cell-clickable col-date'; 

        if (!shiftCode || shiftCode === 'OFF') {
            displayCode = 'OFF';
            className += ' shift-off';
            cell.innerText = 'OFF';
            cell.style = 'background-color:#eee; color:#999;';
        } else if (shiftCode === 'REQ_OFF') {
            displayCode = '休';
            className += ' shift-req-off';
            cell.innerText = '休';
            cell.style = 'background-color:#ffeaa7; color:#d35400; font-weight:bold;';
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
        
        // OFF
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, 'OFF')">OFF (休)</li>`;
        
        // Shift List
        this.shifts.forEach(s => {
            ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, '${s.code}')" style="color:${s.color}; font-weight:bold;">${s.code} (${s.name})</li>`;
        });
        
        // Clear
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="border-top:1px solid #eee; color:#e74c3c;">清除</li>`;

        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        const closeMenu = () => { menu.style.display = 'none'; document.removeEventListener('click', closeMenu); };
        document.addEventListener('click', closeMenu);
    },

    // --- 其他功能 (拖拉/存檔) ---
    
    setupDragDrop: function() {}, // 內聯HTML處理
    handleDragStart: function(e, uid, day) { this.dragSrcUid = uid; this.dragSrcDay = day; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.5'; },
    handleDrop: function(e, targetUid, targetDay) { e.preventDefault(); document.getElementById(`cell_${this.dragSrcUid}_${this.dragSrcDay}`).style.opacity = '1'; if (this.dragSrcUid === targetUid && this.dragSrcDay === targetDay) return; this.swapShifts(this.dragSrcUid, this.dragSrcDay, targetUid, targetDay); },
    
    swapShifts: function(uid1, day1, uid2, day2) {
        const key1 = `current_${day1}`; const key2 = `current_${day2}`;
        if (!this.assignments[uid1]) this.assignments[uid1] = {};
        if (!this.assignments[uid2]) this.assignments[uid2] = {};
        
        const val1 = this.assignments[uid1][key1];
        const val2 = this.assignments[uid2][key2];
        
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

    saveDraft: async function(silent = false) {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            if(!silent) alert("儲存成功");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },
    publishSchedule: async function() {
        if(!confirm("確定要發布排班表嗎？")) return;
        try { await db.collection('schedules').doc(this.scheduleId).update({ status: 'published', publishedAt: firebase.firestore.FieldValue.serverTimestamp(), assignments: this.assignments }); this.data.status = 'published'; this.renderToolbar(); alert("排班表已發布！"); } catch(e) { alert("發布失敗"); }
    },
    unpublishSchedule: async function() {
        if(!confirm("確定取消發布？")) return;
        try { await db.collection('schedules').doc(this.scheduleId).update({ status: 'draft', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); this.data.status = 'draft'; this.renderToolbar(); alert("已取消發布"); } catch(e) { alert("失敗"); }
    },
    resetSchedule: async function() {
        if(!confirm("確定重置？將清除所有非預班的內容。")) return;
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.assignments[uid]) return;
            for (let d = 1; d <= daysInMonth; d++) {
                if (this.assignments[uid][`current_${d}`] !== 'REQ_OFF') delete this.assignments[uid][`current_${d}`];
            }
        });
        this.renderMatrix(); this.updateRealTimeStats(); this.updateScheduleScore(); await this.saveDraft(true);
    },
    runAI: function() { alert("AI 排班功能尚未連結"); },
    isLightColor: function(hex) { if(!hex) return true; const r = parseInt(hex.substr(1,2),16); const g = parseInt(hex.substr(3,2),16); const b = parseInt(hex.substr(5,2),16); return (((r*299)+(g*587)+(b*114))/1000) >= 128; },
    showStaffStats: function(uid) { alert("此功能開發中"); }
};
