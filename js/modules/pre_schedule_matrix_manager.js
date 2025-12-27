// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {},
    globalClickListener: null,

    // --- 初始化 ---
    init: async function(id) {
        console.log("Matrix Manager Init:", id);
        this.docId = id;
        
        await Promise.all([
            this.loadShifts(),
            this.loadUsers(),
            this.loadScheduleData()
        ]);
        
        this.renderMatrix();
        this.updateStats();
        this.setupEvents();
    },

    loadShifts: async function() {
        const snapshot = await db.collection('shifts').get();
        this.shifts = snapshot.docs.map(doc => doc.data());
    },

    loadUsers: async function() {
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        snapshot.forEach(doc => {
            this.usersMap[doc.id] = doc.data();
        });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) { alert("資料不存在"); return; }
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        document.getElementById('matrixTitle').innerHTML = 
            `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const statusMap = { 'open':'開放中', 'closed':'已截止', 'scheduled':'已排班' };
        const badgeColor = { 'open':'#2ecc71', 'closed':'#e74c3c', 'scheduled':'#3498db' };
        const st = this.data.status;
        const el = document.getElementById('matrixStatus');
        el.textContent = statusMap[st] || st;
        el.style.background = badgeColor[st] || '#999';
    },

    // --- 渲染矩陣 (修正：加入 .cell-narrow) ---
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // 1. 表頭
        let header1 = `<tr><th rowspan="2">員編</th><th rowspan="2">姓名</th><th rowspan="2">特註</th><th rowspan="2">偏好</th><th colspan="6" style="background:#eee;">上月</th><th colspan="${daysInMonth}">本月 ${month} 月</th><th rowspan="2" style="background:#fff; position:sticky; right:0; z-index:20; border-left:2px solid #ccc; width:60px;">統計<br>(OFF)</th></tr>`;
        let header2 = `<tr>`;
        
        // 上月 6 天 (加入 cell-narrow)
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        for(let i=5; i>=0; i--) {
            const d = lastMonthLastDay - i;
            header2 += `<th class="cell-last-month cell-narrow">${d}</th>`;
        }
        // 本月 (加入 cell-narrow)
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:red;' : '';
            header2 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        thead.innerHTML = header1 + header2;

        // 2. 內容
        let bodyHtml = '';
        const staffList = this.data.staffList || [];
        staffList.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        staffList.forEach(u => {
            const userInfo = this.usersMap[u.uid] || {};
            let noteIcon = '';
            if (userInfo.schedulingParams?.isPregnant) noteIcon += '<i class="fas fa-baby" title="孕" style="color:#e67e22;"></i> ';
            if (userInfo.schedulingParams?.isBreastfeeding) noteIcon += '<i class="fas fa-cookie" title="哺" style="color:#d35400;"></i>';
            const pref = ''; 

            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${noteIcon}</td>
                <td>${pref}</td>`;
            
            // 上月格 (加入 cell-narrow)
            const assign = this.localAssignments[u.uid] || {};
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const key = `last_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-last-month cell-narrow" data-type="last" data-day="${d}" onmousedown="matrixManager.onCellClick(event, this)">${this.renderCellContent(val)}</td>`;
            }
            // 本月格 (加入 cell-narrow)
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" data-type="current" data-day="${d}" onmousedown="matrixManager.onCellClick(event, this)">${this.renderCellContent(val)}</td>`;
            }
            // 統計欄
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; color:#333;">0</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部
        let footHtml = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i=0; i<6; i++) footHtml += `<td class="cell-narrow" style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            footHtml += `<td id="stat_col_${d}" class="cell-narrow" style="font-weight:bold; color:#333;">0</td>`;
        }
        footHtml += `<td>-</td></tr>`;
        tfoot.innerHTML = footHtml;
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return '<span class="shift-admin-off">OFF</span>';
        if(val === 'REQ_OFF') return '<span class="shift-req-off">休</span>';
        if(val.startsWith('!')) return `<span class="shift-ban"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        return `<span class="shift-normal">${val}</span>`;
    },

    // --- 互動邏輯 ---
    onCellClick: function(e, cell) {
        const uid = cell.parentElement.dataset.uid;
        const type = cell.dataset.type; 
        const day = cell.dataset.day;
        const key = type === 'last' ? `last_${day}` : `current_${day}`;

        if (e.button === 0) {
            this.handleLeftClick(uid, key);
        } else if (e.button === 2) {
            this.handleRightClick(e, uid, key, type, day);
        }
        
        const val = (this.localAssignments[uid] && this.localAssignments[uid][key]) || '';
        cell.innerHTML = this.renderCellContent(val);
        this.updateStats();
    },

    handleLeftClick: function(uid, key) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const current = this.localAssignments[uid][key];
        
        if (current === 'OFF') delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = 'OFF';
    },

    handleRightClick: function(e, uid, key, type, day) {
        // [關鍵] 阻止預設選單
        e.preventDefault();
        e.stopPropagation();

        const menu = document.getElementById('customContextMenu');
        const options = document.getElementById('contextMenuOptions');
        const title = document.getElementById('contextMenuTitle');
        
        title.textContent = `設定 ${day} 日 (右鍵)`;
        let html = '';

        if (type === 'current') {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#9b59b6;"></span></span> 強制休 (Admin)
            </div>`;
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'REQ_OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#2ecc71;"></span></span> 預休 (User)
            </div>`;
            html += `<div class="menu-separator"></div>`;
        } else {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon">O</span> OFF
            </div>`;
            html += `<div class="menu-separator"></div>`;
        }

        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '${s.code}')">
                <span class="menu-icon" style="color:${s.color}; font-weight:bold;">${s.code}</span> 指定 ${s.name}
            </div>`;
        });

        if (type === 'current') {
            html += `<div class="menu-separator"></div>`;
            this.shifts.forEach(s => {
                html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '!${s.code}')" style="color:#c0392b;">
                    <span class="menu-icon"><i class="fas fa-ban"></i></span> 勿排 ${s.name}
                </div>`;
            });
        }

        html += `<div class="menu-separator"></div>`;
        html += `<div class="menu-item" style="color:red;" onclick="matrixManager.setShift('${uid}', '${key}', null)">
            <span class="menu-icon"><i class="fas fa-eraser"></i></span> 清除
        </div>`;

        options.innerHTML = html;
        
        let x = e.pageX;
        let y = e.pageY;
        if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;
        
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },

    setShift: function(uid, key, val) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        
        if (val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;

        const type = key.startsWith('last') ? 'last' : 'current';
        const day = key.split('_')[1];
        const row = document.querySelector(`tr[data-uid="${uid}"]`);
        const cell = row.querySelector(`td[data-type="${type}"][data-day="${day}"]`);
        if(cell) cell.innerHTML = this.renderCellContent(val);

        this.updateStats();
        document.getElementById('customContextMenu').style.display = 'none';
    },

    updateStats: function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const maxOff = this.data.settings.maxOffDays || 8; 

        const colStats = {}; 
        for(let d=1; d<=daysInMonth; d++) colStats[d] = 0;

        this.data.staffList.forEach(u => {
            const assign = this.localAssignments[u.uid] || {};
            let totalOff = 0; 
            let userReqOff = 0; 

            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if (val === 'OFF' || val === 'REQ_OFF') {
                    totalOff++;
                    colStats[d]++;
                }
                if (val === 'REQ_OFF') userReqOff++;
            }

            const cell = document.getElementById(`stat_row_${u.uid}`);
            if(cell) {
                cell.textContent = totalOff;
                if (userReqOff > maxOff) {
                    cell.classList.add('text-danger');
                    cell.title = `預假 ${userReqOff} 天，超過上限 ${maxOff} 天`;
                } else {
                    cell.classList.remove('text-danger');
                    cell.title = '';
                }
            }
        });

        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`stat_col_${d}`);
            if(cell) cell.textContent = colStats[d];
        }
    },

    // --- 事件管理 (防止預設右鍵) ---
    setupEvents: function() {
        // 1. 全域左鍵關閉選單
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);

        // 2. [關鍵] 監聽 Matrix 容器的 ContextMenu
        // 不論點哪裡，只要在容器內，就阻止瀏覽器預設選單
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 如果點擊的不是格子 (例如卷軸或空白處)，確保自訂選單也關閉
                if (!e.target.classList.contains('cell-clickable') && !e.target.closest('.cell-clickable')) {
                    document.getElementById('customContextMenu').style.display = 'none';
                }
            };
        }
    },

    cleanup: function() {
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
            this.globalClickListener = null;
        }
        // 移除容器的事件 (如果容器還存在)
        const container = document.getElementById('matrixContainer');
        if(container) container.oncontextmenu = null;
    },

    saveData: async function() {
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("草稿已儲存");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },

    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("警告：有紅字！確定強制執行？")) return;
        } else {
            if(!confirm("確定執行排班？")) return;
        }

        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                status: 'closed', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("執行成功！");
            history.back(); 
        } catch(e) { alert("執行失敗: " + e.message); }
    }
};

const originalInit = matrixManager.init;
matrixManager.init = function(id) {
    this.cleanup();
    originalInit.call(this, id);
};
