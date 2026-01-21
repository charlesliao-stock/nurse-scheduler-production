// js/modules/schedule_editor_manager.js
// 🚀 旗艦版：含上月參照、完整統計、缺口提示、OFF自動補齊

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    lastMonthAssignments: {}, // [新增] 上個月的班表資料
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
        console.log("Schedule Editor Init (Final UI):", id);
        this.scheduleId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.showLoading();
        try {
            await this.loadContext(); 
            
            // 載入基本資料 + 上個月班表
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthData() // [新增]
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
                if (this.data.aiBaseScore) scoringManager.setBase(this.data.aiBaseScore);
            }
            
            this.assignments = this.data.assignments || {};
            if (!this.data.staffList) throw new Error("人員名單資料損毀");

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats(); // 計算統計
            this.updateScheduleScore(); 
            this.setupDragDrop();

        } catch(e) { 
            console.error(e); 
            alert("載入失敗: " + e.message); 
        } finally { this.isLoading = false; }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if(!doc.exists) throw new Error("找不到排班表");
        this.data = doc.data();
    },

    // [新增] 載入上個月的班表 (為了顯示前 6 天)
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

    // --- 2. 工具列 (按鈕優化) ---
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
            // [修改] 按鈕樣式更明顯
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

    // --- 3. 核心渲染 (Matrix) - 含上月資料與統計 ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if(!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['日','一','二','三','四','五','六'];
        
        // 計算上個月顯示的天數 (前6天)
        const prevMonthDaysToShow = 6;
        const prevMonthLastDate = new Date(year, month-1, 0).getDate(); // 上個月最後一天日期

        // 3.1 渲染表頭 (Header)
        let headHtml = `<tr><th style="min-width:120px; position:sticky; left:0; z-index:102; background:#fff; border-right:2px solid #ddd;">人員 / 日期</th>`;
        
        // (A) 上月表頭
        for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
            const d = prevMonthLastDate - i;
            headHtml += `<th class="prev-month-header" style="min-width:35px;">${d}<br><small style="font-size:0.7em">上月</small></th>`;
        }

        // (B) 本月表頭
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay();
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:#e74c3c;' : '';
            headHtml += `<th style="min-width:40px; ${color}">${d}<br><small>${weekDays[dayOfWeek]}</small></th>`;
        }
        
        // (C) 統計表頭 [新增]
        headHtml += `<th class="stats-header">總OFF</th>`;
        headHtml += `<th class="stats-header">假OFF</th>`;
        headHtml += `<th class="stats-header">小夜</th>`;
        headHtml += `<th class="stats-header">大夜</th>`;
        headHtml += `</tr>`;
        thead.innerHTML = headHtml;

        // 3.2 渲染內容 (Body)
        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const staffName = this.usersMap[uid] || staff.name || '未知';
            
            bodyHtml += `<tr>`;
            // 姓名欄
            bodyHtml += `<td style="position:sticky; left:0; z-index:100; background:#fff; font-weight:bold; border-right:2px solid #ddd; padding:5px;">
                            <div style="display:flex; justify-content:space-between;">
                                <span>${staffName}</span>
                                <i class="fas fa-info-circle text-muted" onclick="scheduleEditorManager.showStaffStats('${uid}')"></i>
                            </div>
                         </td>`;
            
            // (A) 上月資料 (唯讀)
            for(let i = prevMonthDaysToShow - 1; i >= 0; i--) {
                const d = prevMonthLastDate - i;
                const prevCode = this.lastMonthAssignments[uid]?.[`current_${d}`] || '';
                bodyHtml += `<td class="prev-month-cell">${prevCode}</td>`;
            }

            // (B) 本月資料
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                let shiftCode = this.assignments[uid]?.[key];
                const isReq = (this.data.preRequests?.[uid]?.[key] === 'REQ_OFF');
                
                // [修改] 若為空值或 undefined，顯示為 OFF (系統視為放假)
                let displayCode = shiftCode;
                let style = '';
                let className = 'cell-clickable';

                if (!shiftCode) {
                    displayCode = 'OFF';
                    className += ' shift-off'; // 灰色
                } else if (shiftCode === 'OFF') {
                    displayCode = 'OFF';
                    className += ' shift-off';
                } else if (shiftCode === 'REQ_OFF') {
                    displayCode = '休';
                    className += ' shift-req-off'; // 黃底紅字
                } else {
                    const shiftInfo = this.shifts.find(s => s.code === shiftCode);
                    const bgColor = shiftInfo ? shiftInfo.color : '#fff';
                    const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
                    style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
                }

                // 衝突提示
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
            
            // (C) 統計欄位 (給 ID 讓 JS 填入)
            bodyHtml += `<td class="stats-cell" id="stat_totalOff_${uid}">-</td>`;
            bodyHtml += `<td class="stats-cell" id="stat_holidayOff_${uid}">-</td>`;
            bodyHtml += `<td class="stats-cell" id="stat_E_${uid}">-</td>`;
            bodyHtml += `<td class="stats-cell" id="stat_N_${uid}">-</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3.3 渲染頁尾 (Footer - 每日人力需求) [新增]
        if(tfoot) {
            let footHtml = `<tr><td style="font-weight:bold; background:#eee; position:sticky; left:0; z-index:100;">每日人力<br>實排/需求</td>`;
            
            // 上月部分空白
            for(let i=0; i<prevMonthDaysToShow; i++) footHtml += `<td style="background:#f0f0f0;"></td>`;
            
            // 本月需求統計
            for(let d=1; d<=daysInMonth; d++) {
                footHtml += `<td class="footer-cell" id="footer_day_${d}"></td>`;
            }
            
            // 統計欄空白
            footHtml += `<td colspan="4" style="background:#eee;"></td></tr>`;
            tfoot.innerHTML = footHtml;
        }
    },

    // --- 4. 統計計算 (Row & Footer) ---
    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {}; // 預班時設定的需求 { "D_1": 5, "N_1": 2 ... } _1 是週一
        
        // 每日計數器 (用於 Footer)
        const dailyCounts = {}; 
        for(let d=1; d<=daysInMonth; d++) dailyCounts[d] = {};

        // 1. 遍歷人員，計算個人統計
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.assignments[uid] || {};
            
            let totalOff = 0;
            let holidayOff = 0;
            let countE = 0;
            let countN = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const dateObj = new Date(this.data.year, this.data.month-1, d);
                const dayOfWeek = dateObj.getDay(); // 0(日)..6(六)
                
                // 處理空值視為 OFF
                let code = assign[`current_${d}`];
                if (!code) code = 'OFF';

                if (code === 'OFF' || code === 'REQ_OFF') {
                    totalOff++;
                    if (dayOfWeek === 0 || dayOfWeek === 6) holidayOff++;
                } else {
                    // 累加每日班別數
                    if (!dailyCounts[d][code]) dailyCounts[d][code] = 0;
                    dailyCounts[d][code]++;

                    // 統計個人的小夜/大夜
                    // 假設小夜代號包含 E, EN; 大夜包含 N, AN
                    if (['E', 'EN', 'PN'].includes(code)) countE++;
                    if (['N', 'AN', 'MN'].includes(code)) countN++;
                }
            }

            // 更新表格右側
            const elTotal = document.getElementById(`stat_totalOff_${uid}`);
            const elHol = document.getElementById(`stat_holidayOff_${uid}`);
            const elE = document.getElementById(`stat_E_${uid}`);
            const elN = document.getElementById(`stat_N_${uid}`);
            
            if(elTotal) elTotal.innerText = totalOff;
            if(elHol) elHol.innerText = holidayOff;
            if(elE) elE.innerText = countE;
            if(elN) elN.innerText = countN;
        });

        // 2. 更新底部 (Footer) 需求對比
        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`footer_day_${d}`);
            if (!cell) continue;

            const dateObj = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            
            let html = '';
            
            // 找出當天所有有排的班別 + 需求中有設定的班別
            // dailyNeeds key 格式通常是: ShiftCode_DayOfWeek (例如 "D_1")
            const activeShifts = new Set([...Object.keys(dailyCounts[d])]);
            
            // 遍歷所有班別定義
            this.shifts.forEach(s => {
                const code = s.code;
                const needKey = `${code}_${dayOfWeek}`;
                const required = parseInt(dailyNeeds[needKey]) || 0;
                const actual = dailyCounts[d][code] || 0;

                // 如果有需求 或 有排人，就顯示
                if (required > 0 || actual > 0) {
                    const diff = actual - required;
                    let displayClass = '';
                    if (required > 0 && actual < required) displayClass = 'shortage'; // 缺人紅色
                    
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

    // --- 5. 互動邏輯 (更新) ---
    
    setShift: function(uid, day, code) {
        const key = `current_${day}`;
        if (!this.assignments[uid]) this.assignments[uid] = {};
        
        // 如果是 'OFF' 或 null，直接刪除該 key (讓 renderMatrix 預設為 OFF)
        // 或是明確設為 'OFF' 也可以，這裡選擇設為 'OFF' 以保持資料一致性
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;

        // 局部重繪單元格 (優化效能)
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
        let className = 'cell-clickable';

        // 邏輯同 renderMatrix
        if (!shiftCode || shiftCode === 'OFF') {
            cell.innerText = 'OFF';
            cell.style = 'background-color:#eee; color:#999;';
            cell.className = className + ' shift-off';
        } else if (shiftCode === 'REQ_OFF') {
            cell.innerText = '休';
            cell.style = 'background-color:#ffeaa7; color:#d35400; font-weight:bold;';
            cell.className = className + ' shift-req-off';
        } else {
            const shiftInfo = this.shifts.find(s => s.code === shiftCode);
            const bgColor = shiftInfo ? shiftInfo.color : '#fff';
            const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
            cell.innerText = shiftCode;
            cell.style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
            cell.className = className;
        }
    },

    handleRightClick: function(e, uid, day) {
        e.preventDefault();
        const menu = document.getElementById('schContextMenu');
        if(!menu) return;
        const ul = menu.querySelector('ul');
        ul.innerHTML = '';
        
        // OFF 選項
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, 'OFF')">OFF (休)</li>`;
        // 班別選項
        this.shifts.forEach(s => {
            ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, '${s.code}')" style="color:${s.color}; font-weight:bold;">${s.code} (${s.name})</li>`;
        });
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="border-top:1px solid #eee; color:#e74c3c;">清除</li>`;

        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        const closeMenu = () => { menu.style.display = 'none'; document.removeEventListener('click', closeMenu); };
        document.addEventListener('click', closeMenu);
    },

    // --- 其他原有功能保持不變 ---
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

    // 更新分數與統計
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
