// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,      // 預班表資料
    shifts: [],      // 班別清單
    localAssignments: {}, // 本地暫存排班 { uid: { key: val } }
    usersMap: {},    // 人員詳細資料 (為了特註)
    globalClickListener: null, // 用於 cleanup

    // --- 初始化 ---
    init: async function(id) {
        console.log("Matrix Manager Init:", id);
        this.docId = id;
        
        // 1. 載入必要資料
        await Promise.all([
            this.loadShifts(),
            this.loadUsers(),
            this.loadScheduleData()
        ]);
        
        // 2. 渲染
        this.renderMatrix();
        this.updateStats(); // 初始計算
        
        // 3. 綁定事件 (包含 cleanup 機制)
        this.setupEvents();
    },

    loadShifts: async function() {
        const snapshot = await db.collection('shifts').get();
        this.shifts = snapshot.docs.map(doc => doc.data());
    },

    loadUsers: async function() {
        // 載入全人員以取得 "特註" (如孕、哺)
        // 實務上若人多，建議只載入該單位人員
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

    // --- 渲染矩陣 ---
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // 1. 表頭 (Header)
        let header1 = `<tr><th rowspan="2">員編</th><th rowspan="2">姓名</th><th rowspan="2">特註</th><th rowspan="2">偏好</th><th colspan="6" style="background:#eee;">上月</th><th colspan="${daysInMonth}">本月 ${month} 月</th><th rowspan="2" style="background:#fff; position:sticky; right:0; z-index:20; border-left:2px solid #ccc; width:60px;">統計<br>(OFF)</th></tr>`;
        let header2 = `<tr>`;
        
        // 上月 6 天
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        for(let i=5; i>=0; i--) {
            const d = lastMonthLastDay - i;
            header2 += `<th class="cell-last-month">${d}</th>`;
        }
        // 本月
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:red;' : '';
            header2 += `<th style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        thead.innerHTML = header1 + header2;

        // 2. 內容 (Body)
        let bodyHtml = '';
        const staffList = this.data.staffList || [];
        // 排序
        staffList.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        staffList.forEach(u => {
            const userInfo = this.usersMap[u.uid] || {};
            // 特註圖示
            let noteIcon = '';
            if (userInfo.schedulingParams?.isPregnant) noteIcon += '<i class="fas fa-baby" title="孕" style="color:#e67e22;"></i> ';
            if (userInfo.schedulingParams?.isBreastfeeding) noteIcon += '<i class="fas fa-cookie" title="哺" style="color:#d35400;"></i>';
            
            // 偏好 (暫無資料源，留空)
            const pref = ''; 

            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${noteIcon}</td>
                <td>${pref}</td>`;
            
            // 上月
            const assign = this.localAssignments[u.uid] || {};
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const key = `last_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-last-month" data-type="last" data-day="${d}" onmousedown="matrixManager.onCellClick(event, this)">${this.renderCellContent(val)}</td>`;
            }
            // 本月
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable" data-type="current" data-day="${d}" onmousedown="matrixManager.onCellClick(event, this)">${this.renderCellContent(val)}</td>`;
            }
            // 統計欄
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; color:#333;">0</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部統計 (Footer)
        let footHtml = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i=0; i<6; i++) footHtml += `<td style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            footHtml += `<td id="stat_col_${d}" style="font-weight:bold; color:#333;">0</td>`;
        }
        footHtml += `<td>-</td></tr>`;
        tfoot.innerHTML = footHtml;
    },

    renderCellContent: function(val) {
        if(!val) return '';
        // 管理者強制 OFF (紫色)
        if(val === 'OFF') return '<span class="shift-admin-off">OFF</span>';
        // 員工預假 (綠色)
        if(val === 'REQ_OFF') return '<span class="shift-req-off">休</span>';
        // 勿排 (紅色禁止)
        if(val.startsWith('!')) return `<span class="shift-ban"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        // 一般班別
        return `<span class="shift-normal">${val}</span>`;
    },

    // --- 互動邏輯 ---
    onCellClick: function(e, cell) {
        const uid = cell.parentElement.dataset.uid;
        const type = cell.dataset.type; 
        const day = cell.dataset.day;
        const key = type === 'last' ? `last_${day}` : `current_${day}`;

        if (e.button === 0) { // 左鍵
            this.handleLeftClick(uid, key);
        } else if (e.button === 2) { // 右鍵
            this.handleRightClick(e, uid, key, type, day);
        }
        
        // 更新顯示與統計
        const val = (this.localAssignments[uid] && this.localAssignments[uid][key]) || '';
        cell.innerHTML = this.renderCellContent(val);
        this.updateStats();
    },

    handleLeftClick: function(uid, key) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const current = this.localAssignments[uid][key];
        
        // 左鍵邏輯：空白 -> 紫色OFF -> 空白
        // 注意：如果原本是 REQ_OFF (員工預假)，左鍵點擊會覆蓋成 紫色OFF (管理者強制)
        if (current === 'OFF') {
            delete this.localAssignments[uid][key];
        } else {
            this.localAssignments[uid][key] = 'OFF';
        }
    },

    handleRightClick: function(e, uid, key, type, day) {
        e.preventDefault();
        const menu = document.getElementById('customContextMenu');
        const options = document.getElementById('contextMenuOptions');
        const title = document.getElementById('contextMenuTitle');
        
        title.textContent = `設定 ${day} 日 (右鍵)`;
        let html = '';

        // 1. OFF 選項
        if (type === 'current') {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#9b59b6;"></span></span> 強制休 (Admin)
            </div>`;
            // 讓管理者也可以幫員工補劃預假 (綠色)
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'REQ_OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#2ecc71;"></span></span> 預休 (User)
            </div>`;
            html += `<div class="menu-separator"></div>`;
        } else {
            // 上個月的右鍵只有 OFF (代表休假)
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon">O</span> OFF
            </div>`;
            html += `<div class="menu-separator"></div>`;
        }

        // 2. 班別選項
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '${s.code}')">
                <span class="menu-icon" style="color:${s.color}; font-weight:bold;">${s.code}</span> 指定 ${s.name}
            </div>`;
        });

        // 3. 勿排選項 (僅本月)
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
        
        // 計算選單位置 (避免超出螢幕)
        let x = e.pageX;
        let y = e.pageY;
        // 簡單判定 (可優化)
        if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;
        
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },

    setShift: function(uid, key, val) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        
        if (val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;

        // 更新 UI
        const type = key.startsWith('last') ? 'last' : 'current';
        const day = key.split('_')[1];
        const row = document.querySelector(`tr[data-uid="${uid}"]`);
        const cell = row.querySelector(`td[data-type="${type}"][data-day="${day}"]`);
        if(cell) cell.innerHTML = this.renderCellContent(val);

        this.updateStats();
        document.getElementById('customContextMenu').style.display = 'none';
    },

    // --- 統計與紅字檢核 (方案 B) ---
    updateStats: function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const maxOff = this.data.settings.maxOffDays || 8; 

        // 每日統計器
        const colStats = {}; 
        for(let d=1; d<=daysInMonth; d++) colStats[d] = 0;

        this.data.staffList.forEach(u => {
            const assign = this.localAssignments[u.uid] || {};
            let totalOff = 0; // 總 OFF (顯示用)
            let userReqOff = 0; // 員工申請 OFF (檢核用)

            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                
                // 計算總 OFF (含紫、綠)
                if (val === 'OFF' || val === 'REQ_OFF') {
                    totalOff++;
                    colStats[d]++;
                }
                // 計算檢核 OFF (只算綠色 REQ_OFF)
                if (val === 'REQ_OFF') {
                    userReqOff++;
                }
            }

            // 更新個人欄位
            const cell = document.getElementById(`stat_row_${u.uid}`);
            if(cell) {
                cell.textContent = totalOff;
                // 方案 B: 只有當 "員工預假" 超過上限時，才亮紅燈
                if (userReqOff > maxOff) {
                    cell.classList.add('text-danger');
                    cell.title = `預假 ${userReqOff} 天，超過上限 ${maxOff} 天`;
                } else {
                    cell.classList.remove('text-danger');
                    cell.title = '';
                }
            }
        });

        // 更新底部每日統計
        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`stat_col_${d}`);
            if(cell) cell.textContent = colStats[d];
        }
    },

    // --- 事件管理與資源釋放 (Cleanup) ---
    setupEvents: function() {
        // 1. 全域點擊關閉選單
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.style.display === 'block') {
                // 檢查是否點在選單外
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);

        // 2. 監聽 Matrix 容器的 ContextMenu (防止瀏覽器選單)
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.oncontextmenu = (e) => e.preventDefault();
        }
    },

    cleanup: function() {
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
            this.globalClickListener = null;
            console.log("Matrix Events Cleaned up.");
        }
    },

    // --- 儲存與執行 ---
    saveData: async function() {
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                // 更新統計數字
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("草稿已儲存");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },

    executeSchedule: async function() {
        // 紅字檢查
        if (document.querySelector('.text-danger')) {
            const confirmMsg = "警告：部分人員「預假天數」超過上限 (紅字)！\n\n點擊「確定」將強制忽略並執行排班。\n點擊「取消」返回修正。";
            if(!confirm(confirmMsg)) return;
        } else {
            if(!confirm("確定執行排班？\n此動作將鎖定預班表 (截止)，並進入正式排班流程。")) return;
        }

        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                status: 'closed', // 鎖定
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            alert("執行成功！預班表已鎖定。");
            history.back(); // 返回列表
        } catch(e) { alert("執行失敗: " + e.message); }
    }
};

// 確保 init 前先清乾淨
const originalInit = matrixManager.init;
matrixManager.init = function(id) {
    this.cleanup();
    originalInit.call(this, id);
};
