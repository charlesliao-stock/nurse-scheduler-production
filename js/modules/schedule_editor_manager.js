// js/modules/schedule_editor_manager.js
// 🚀 完整版：整合評分詳情視窗、即時統計、拖拉排班與自動存檔

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    shifts: [], 
    assignments: {}, 
    unitRules: {}, 
    staffMap: {}, 
    usersMap: {}, 
    isLoading: false,
    dragSrcUid: null, 
    dragSrcDay: null,
    currentScoreData: null, // [新增] 暫存評分結果供視窗使用

    // --- 1. 初始化與資料載入 ---
    init: async function(id) { 
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.showLoading();
        try {
            await this.loadContext(); 
            
            // 平行載入所有相依資料
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules()
            ]);
            
            // [關鍵] 載入評分模組設定
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
                // 設定 AI 原始分數基準 (若有的話)
                if (this.data.aiBaseScore) {
                    scoringManager.setBase(this.data.aiBaseScore);
                }
            }
            
            // 資料防呆驗證
            if (!this.data.assignments || typeof this.data.assignments !== 'object') {
                this.data.assignments = {};
            }
            this.assignments = this.data.assignments;
            
            if (!this.data.staffList || !Array.isArray(this.data.staffList)) {
                throw new Error("人員名單 (StaffList) 資料損毀，無法載入排班表。");
            }

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore(); // [新增] 初始化時計算一次分數
            this.setupDragDrop();

        } catch(e) { 
            console.error(e); 
            alert("載入失敗: " + e.message); 
            window.location.hash = '/admin/schedule_list';
        } finally { 
            this.isLoading = false; 
        }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if(!doc.exists) throw new Error("找不到排班表");
        this.data = doc.data();
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').where('unitId', '==', this.data.unitId).orderBy('startTime').get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadUsers: async function() {
        // 建立 uid -> name 的快取對照表
        const snap = await db.collection('users').where('unitId', '==', this.data.unitId).get();
        this.usersMap = {};
        snap.forEach(d => {
            const u = d.data();
            this.usersMap[d.id] = u.displayName || u.name;
        });
        
        this.staffMap = {};
        this.data.staffList.forEach(s => { this.staffMap[s.uid] = s; });
    },

    loadUnitRules: async function() {
        const doc = await db.collection('units').doc(this.data.unitId).get();
        if(doc.exists) this.unitRules = doc.data().schedulingRules || {};
    },

    showLoading: function() {
        const grid = document.getElementById('schBody');
        if(grid) grid.innerHTML = '<tr><td colspan="35" style="padding:50px; text-align:center;">資料載入中...</td></tr>';
    },

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
            if(this.data.status === 'draft') {
                html += `<button class="btn btn-primary" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
                html += `<button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-bullhorn"></i> 發布</button>`;
                html += `<button class="btn btn-danger" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-trash-restore"></i> 重置</button>`;
                html += `<button class="btn" style="background:#8e44ad; color:white;" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 自動排班</button>`;
            } else {
                html += `<button class="btn btn-warning" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-undo"></i> 取消發布 (轉回草稿)</button>`;
            }
            toolbarRight.innerHTML = html;
        }
    },

    // --- 2. 核心渲染 (Matrix) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        if(!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekDays = ['日','一','二','三','四','五','六'];

        // 2.1 渲染表頭
        let headHtml = `<tr><th style="min-width:100px; position:sticky; left:0; z-index:101; background:#f8f9fa;">人員 / 日期</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay();
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:#e74c3c;' : '';
            headHtml += `<th style="min-width:40px; ${color}">${d}<br><small>${weekDays[dayOfWeek]}</small></th>`;
        }
        headHtml += `<th style="min-width:60px;">時數</th><th style="min-width:60px;">夜班</th></tr>`;
        thead.innerHTML = headHtml;

        // 2.2 渲染內容
        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const staffName = this.usersMap[uid] || staff.name || '未知';
            
            bodyHtml += `<tr>`;
            // 姓名欄
            bodyHtml += `<td style="position:sticky; left:0; z-index:100; background:#fff; font-weight:bold; border-right:2px solid #ddd;">
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0 5px;">
                                <span>${staffName}</span>
                                <i class="fas fa-info-circle text-muted" style="cursor:pointer; font-size:0.8rem;" onclick="scheduleEditorManager.showStaffStats('${uid}')"></i>
                            </div>
                         </td>`;
            
            // 日期欄
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const shiftCode = this.assignments[uid]?.[key] || '';
                const cellId = `cell_${uid}_${d}`;
                
                // 檢查是否為預班請求 (REQ_OFF)
                const isReq = (this.data.preRequests?.[uid]?.[key] === 'REQ_OFF');
                
                let cellClass = 'cell-clickable';
                let style = '';
                let content = '';

                if (shiftCode) {
                    if (shiftCode === 'OFF') {
                        content = 'OFF';
                        style = 'background-color:#eee; color:#999;';
                    } else if (shiftCode === 'REQ_OFF') {
                        content = '休';
                        style = 'background-color:#ffeaa7; color:#d35400; font-weight:bold;';
                    } else {
                        const shiftInfo = this.shifts.find(s => s.code === shiftCode);
                        const bgColor = shiftInfo ? shiftInfo.color : '#fff';
                        const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
                        content = shiftCode;
                        style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
                    }
                }

                // 標記預班衝突 (如果原本想要OFF，結果被排班)
                if (isReq && shiftCode && shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF') {
                    style += 'border:2px solid red;';
                }

                bodyHtml += `<td id="${cellId}" class="${cellClass}" style="${style}"
                                draggable="true"
                                ondragstart="scheduleEditorManager.handleDragStart(event, '${uid}', ${d})"
                                ondrop="scheduleEditorManager.handleDrop(event, '${uid}', ${d})"
                                ondragover="event.preventDefault()"
                                onclick="scheduleEditorManager.handleCellClick('${uid}', ${d})"
                                oncontextmenu="scheduleEditorManager.handleRightClick(event, '${uid}', ${d})">
                                ${content}
                             </td>`;
            }
            
            // 統計欄位 (由 updateRealTimeStats 填入)
            bodyHtml += `<td id="stat_hours_${uid}">-</td><td id="stat_night_${uid}">-</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    // --- 3. 評分系統整合 (核心修改) ---

    // 更新左上角按鈕分數
    updateScheduleScore: function() {
        if(typeof scoringManager === 'undefined') return;
        
        // 呼叫 scoringManager 計算，取得包含 details 的完整結構
        const scoreData = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        this.currentScoreData = scoreData; // [關鍵] 存入暫存

        // 更新 Toolbar 左側的按鈕顯示
        const displayArea = document.getElementById('scoreDisplayArea');
        const scoreText = document.getElementById('mainScoreDisplay');
        
        if(displayArea && scoreText) {
            displayArea.style.display = 'inline-flex';
            scoreText.innerText = scoreData.total.toFixed(1);
            
            // 比較基準分 (若有)
            const diff = scoringManager.getScoreDiff(scoreData.total);
            if (diff !== null && diff !== 0) {
                const icon = diff > 0 ? '🔺' : '🔻';
                // 這裡只顯示簡單的升降箭頭
                scoreText.innerHTML += ` <small style="font-size:0.7em; opacity:0.8; margin-left:3px;">${icon}</small>`;
            }
        }
    },

    // [新增] 開啟評分詳情視窗
    openScoreModal: function() {
        // 若無資料則重新計算
        if (!this.currentScoreData) {
            this.updateScheduleScore();
        }
        const data = this.currentScoreData;
        if (!data || !data.details) return;

        const modal = document.getElementById('scoreDetailModal');
        const content = document.getElementById('scoreDetailContent');
        const totalDisplay = document.getElementById('modalTotalScore');
        
        if(!modal || !content) return;

        // 設定總分顯示
        totalDisplay.innerText = `${data.total.toFixed(1)} 分`;

        let html = '';
        
        // 定義顯示順序
        const order = ['fairness', 'satisfaction', 'fatigue', 'efficiency', 'cost'];
        
        order.forEach(catKey => {
            const cat = data.details[catKey];
            if (!cat) return;
            
            // 若該大項總配分為 0 (代表全部未啟用)，則跳過不顯示
            if (cat.max === 0) return;

            // 1. 大項標題列
            html += `
                <div class="score-cat-row">
                    <span>${cat.label}</span>
                    <span>${cat.score.toFixed(1)} / ${cat.max}</span>
                </div>
            `;

            // 2. 子項目列表
            if (cat.subs && cat.subs.length > 0) {
                cat.subs.forEach((sub, index) => {
                    const idxStr = `(${index + 1})`;
                    
                    // 根據得分比例給予顏色 (滿分綠色，不及格紅色)
                    const ratio = sub.max > 0 ? (sub.score / sub.max) : 0;
                    let colorClass = '';
                    if (ratio >= 0.99) colorClass = 'perfect'; // CSS class define in html
                    else if (ratio < 0.6) colorClass = 'bad';

                    html += `
                        <div class="score-sub-row">
                            <span>${idxStr} ${sub.label}</span>
                            <span class="score-val ${colorClass}">${sub.score.toFixed(1)} / ${sub.max}</span>
                        </div>
                    `;
                });
            } else {
                html += `<div class="score-sub-row" style="color:#999; font-style:italic;">(無啟用項目)</div>`;
            }
        });

        content.innerHTML = html;
        modal.classList.add('show');
    },

    // --- 4. 編輯與互動邏輯 ---

    handleCellClick: function(uid, day) {
        // 這裡可以做點擊選取，或直接觸發右鍵選單邏輯
        // 目前保留為空，供未來擴充
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
        
        // 清除
        ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="border-top:1px solid #eee; color:#e74c3c;">清除</li>`;

        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        // 點擊其他地方關閉選單
        const closeMenu = () => {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        };
        document.addEventListener('click', closeMenu);
    },

    setShift: function(uid, day, code) {
        const key = `current_${day}`;
        if (!this.assignments[uid]) this.assignments[uid] = {};
        
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;

        this.renderCell(uid, day);
        this.updateRealTimeStats();
        this.updateScheduleScore(); // 操作後即時更新分數
    },

    renderCell: function(uid, day) {
        const cell = document.getElementById(`cell_${uid}_${day}`);
        if(!cell) return;
        
        const key = `current_${day}`;
        const shiftCode = this.assignments[uid]?.[key];
        
        if (!shiftCode) {
            cell.innerText = '';
            cell.style = '';
            cell.className = 'cell-clickable';
            return;
        }

        if (shiftCode === 'OFF') {
            cell.innerText = 'OFF';
            cell.style = 'background-color:#eee; color:#999;';
        } else if (shiftCode === 'REQ_OFF') {
            cell.innerText = '休';
            cell.style = 'background-color:#ffeaa7; color:#d35400; font-weight:bold;';
        } else {
            const shiftInfo = this.shifts.find(s => s.code === shiftCode);
            const bgColor = shiftInfo ? shiftInfo.color : '#fff';
            const textColor = this.isLightColor(bgColor) ? '#000' : '#fff';
            cell.innerText = shiftCode;
            cell.style = `background-color:${bgColor}; color:${textColor}; font-weight:bold;`;
        }
    },

    // --- 5. 拖拉換班邏輯 ---
    setupDragDrop: function() {
        // 已在 HTML 中內聯綁定，此處保留擴充性
    },

    handleDragStart: function(e, uid, day) {
        this.dragSrcUid = uid;
        this.dragSrcDay = day;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
    },

    handleDrop: function(e, targetUid, targetDay) {
        e.preventDefault();
        const srcCell = document.getElementById(`cell_${this.dragSrcUid}_${this.dragSrcDay}`);
        if(srcCell) srcCell.style.opacity = '1';

        if (this.dragSrcUid === targetUid && this.dragSrcDay === targetDay) return;

        this.swapShifts(this.dragSrcUid, this.dragSrcDay, targetUid, targetDay);
    },

    swapShifts: function(uid1, day1, uid2, day2) {
        const key1 = `current_${day1}`;
        const key2 = `current_${day2}`;

        // 確保物件存在
        if (!this.assignments[uid1]) this.assignments[uid1] = {};
        if (!this.assignments[uid2]) this.assignments[uid2] = {};

        const val1 = this.assignments[uid1][key1];
        const val2 = this.assignments[uid2][key2];

        // 交換
        if (val2 === undefined) delete this.assignments[uid1][key1];
        else this.assignments[uid1][key1] = val2;

        if (val1 === undefined) delete this.assignments[uid2][key2];
        else this.assignments[uid2][key2] = val1;

        // 重繪
        this.renderCell(uid1, day1);
        this.renderCell(uid2, day2);
        
        // 更新統計
        this.updateRealTimeStats();
        this.updateScheduleScore();
    },

    // --- 6. 統計與存檔 ---

    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.assignments[uid] || {};
            
            let workHours = 0;
            let nightCount = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const code = assign[`current_${d}`];
                if(code && code !== 'OFF' && code !== 'REQ_OFF') {
                    const s = this.shifts.find(x => x.code === code);
                    if(s) {
                        workHours += (parseFloat(s.hours) || 0);
                        // 簡單判定夜班 (假設 20:00 後開始或跨日)
                        const startH = parseInt(s.startTime.split(':')[0]);
                        if(startH >= 20 || startH <= 4) nightCount++; 
                    }
                }
            }

            const elH = document.getElementById(`stat_hours_${uid}`);
            const elN = document.getElementById(`stat_night_${uid}`);
            if(elH) elH.innerText = workHours;
            if(elN) elN.innerText = nightCount;
        });

        // 更新人力缺口 (Needs)
        // 這裡可視需要加入更新 Needs 表格的邏輯
    },

    saveDraft: async function(silent = false) {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if(!silent) alert("儲存成功");
        } catch(e) { 
            console.error(e);
            alert("儲存失敗"); 
        }
    },
    
    publishSchedule: async function() {
        if(!confirm("確定要發布排班表嗎？\n發布後將通知所有同仁。")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
                assignments: this.assignments
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("排班表已發布！");
        } catch(e) { alert("發布失敗: " + e.message); }
    },

    unpublishSchedule: async function() {
        if(!confirm("確定取消發布？\n狀態將變回草稿。")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'draft',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("已取消發布");
        } catch(e) { alert("失敗"); }
    },

    resetSchedule: async function() {
        if(!confirm("確定重置？\n將清除所有「非預班」的排班內容，回復到初始狀態。")) return;
        
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.assignments[uid]) return;
            
            // 保留 REQ_OFF，清除其他
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                const val = this.assignments[uid][key];
                if (val !== 'REQ_OFF') {
                    delete this.assignments[uid][key];
                }
            }
        });

        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        await this.saveDraft(true);
    },

    runAI: function() {
        // AI 排班入口，通常會跳轉或彈出選項
        alert("AI 排班功能尚未連結 (請確認 ScheduleBatchRunner 是否啟用)");
    },

    // 輔助：判斷顏色深淺 (決定文字黑或白)
    isLightColor: function(hex) {
        if(!hex) return true;
        const r = parseInt(hex.substr(1,2),16);
        const g = parseInt(hex.substr(3,2),16);
        const b = parseInt(hex.substr(5,2),16);
        const yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 128);
    },

    showStaffStats: function(uid) {
        alert("人員詳細統計功能開發中...");
    }
};
