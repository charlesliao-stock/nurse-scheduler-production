// js/modules/pre_schedule_matrix_manager.js (優化版)

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {},
    globalClickListener: null,
    isLoading: false,

    // --- 初始化 ---
    init: async function(id) {
        console.log("🎯 Matrix Manager Init:", id);
        
        if(!id) {
            alert("錯誤：缺少預班表 ID");
            window.location.hash = '/admin/pre_schedules';
            return;
        }
        
        this.docId = id;
        this.isLoading = true;
        
        try {
            // 顯示載入狀態
            this.showLoading();
            
            // 並行載入資料
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
            console.log("✅ Matrix 初始化完成");
            
        } catch(error) {
            console.error("❌ Matrix 初始化失敗:", error);
            alert("載入失敗: " + error.message);
            window.location.hash = '/admin/pre_schedules';
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.innerHTML = '<div style="padding:60px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:3rem; margin-bottom:20px;"></i><br>載入排班矩陣中...</div>';
        }
    },

    // --- 載入班別 ---
    loadShifts: async function() {
        try {
            const snapshot = await db.collection('shifts').get();
            this.shifts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`載入 ${this.shifts.length} 個班別`);
        } catch(e) {
            console.error("Load Shifts Error:", e);
            this.shifts = [];
        }
    },

    // --- 載入使用者 ---
    loadUsers: async function() {
        try {
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.usersMap = {};
            snapshot.forEach(doc => {
                this.usersMap[doc.id] = doc.data();
            });
            console.log(`載入 ${Object.keys(this.usersMap).length} 位使用者`);
        } catch(e) {
            console.error("Load Users Error:", e);
            this.usersMap = {};
        }
    },

    // --- 載入排班資料 ---
    loadScheduleData: async function() {
        try {
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            
            if (!doc.exists) { 
                throw new Error("找不到該預班表資料");
            }
            
            this.data = doc.data();
            this.localAssignments = this.data.assignments || {};
            
            // 更新標題
            const titleEl = document.getElementById('matrixTitle');
            if(titleEl) {
                titleEl.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
            }
            
            // 更新狀態
            const statusMap = { 
                'open': '開放中', 
                'closed': '已截止', 
                'scheduled': '已排班' 
            };
            const badgeColor = { 
                'open': '#2ecc71', 
                'closed': '#e74c3c', 
                'scheduled': '#3498db' 
            };
            const st = this.data.status || 'open';
            const statusEl = document.getElementById('matrixStatus');
            if(statusEl) {
                statusEl.textContent = statusMap[st] || st;
                statusEl.style.background = badgeColor[st] || '#999';
            }
            
            console.log(`載入預班表: ${this.data.year}/${this.data.month}, 狀態: ${st}`);
            
        } catch(e) {
            console.error("Load Schedule Error:", e);
            throw e;
        }
    },

    // --- 渲染矩陣 ---
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        if(!thead || !tbody || !tfoot) {
            console.error("找不到表格元素");
            return;
        }
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // === 1. 表頭 ===
        let header1 = `<tr>
            <th rowspan="2">員編</th>
            <th rowspan="2">姓名</th>
            <th rowspan="2">特註</th>
            <th rowspan="2">偏好</th>
            <th colspan="6" style="background:#eee;">上月</th>
            <th colspan="${daysInMonth}">本月 ${month} 月</th>
            <th rowspan="2" style="background:#fff; position:sticky; right:0; z-index:20; border-left:2px solid #ccc; width:60px;">統計<br>(OFF)</th>
        </tr>`;
        
        let header2 = `<tr>`;
        
        // 上月 6 天
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        for(let i = 5; i >= 0; i--) {
            const d = lastMonthLastDay - i;
            header2 += `<th class="cell-last-month cell-narrow">${d}</th>`;
        }
        
        // 本月
        for(let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeek = dateObj.getDay(); 
            const color = (dayOfWeek === 0 || dayOfWeek === 6) ? 'color:red;' : '';
            header2 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        
        thead.innerHTML = header1 + header2;

        // === 2. 內容 ===
        const staffList = this.data.staffList || [];
        if(staffList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100" style="text-align:center; padding:40px; color:#999;">無人員資料</td></tr>';
            return;
        }
        
        staffList.sort((a, b) => (a.empId || '').localeCompare(b.empId || ''));

        let bodyHtml = '';
        
        staffList.forEach(u => {
            const userInfo = this.usersMap[u.uid] || {};
            
            // 特註圖示
            let noteIcon = '';
            if (userInfo.schedulingParams?.isPregnant) {
                noteIcon += '<i class="fas fa-baby" title="孕" style="color:#e67e22;"></i> ';
            }
            if (userInfo.schedulingParams?.isBreastfeeding) {
                noteIcon += '<i class="fas fa-cookie" title="哺" style="color:#d35400;"></i>';
            }
            
            const pref = ''; // 預留：偏好班別

            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${noteIcon}</td>
                <td>${pref}</td>`;
            
            const assign = this.localAssignments[u.uid] || {};
            
            // 上月格
            for(let i = 5; i >= 0; i--) {
                const d = lastMonthLastDay - i;
                const key = `last_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-last-month cell-narrow" 
                    data-type="last" data-day="${d}" 
                    onmousedown="matrixManager.onCellClick(event, this)"
                    oncontextmenu="return false;">${this.renderCellContent(val)}</td>`;
            }
            
            // 本月格
            for(let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                    data-type="current" data-day="${d}" 
                    onmousedown="matrixManager.onCellClick(event, this)"
                    oncontextmenu="return false;">${this.renderCellContent(val)}</td>`;
            }
            
            // 統計欄
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; color:#333;">0</td>`;
            bodyHtml += `</tr>`;
        });
        
        tbody.innerHTML = bodyHtml;

        // === 3. 底部 ===
        let footHtml = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i = 0; i < 6; i++) {
            footHtml += `<td class="cell-narrow" style="background:#eee;">-</td>`;
        }
        for(let d = 1; d <= daysInMonth; d++) {
            footHtml += `<td id="stat_col_${d}" class="cell-narrow" style="font-weight:bold; color:#333;">0</td>`;
        }
        footHtml += `<td>-</td></tr>`;
        tfoot.innerHTML = footHtml;
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return '<span class="shift-admin-off">OFF</span>';
        if(val === 'REQ_OFF') return '<span class="shift-req-off">休</span>';
        if(val.startsWith('!')) {
            return `<span class="shift-ban"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        }
        return `<span class="shift-normal">${val}</span>`;
    },

    // --- 互動邏輯 ---
    onCellClick: function(e, cell) {
        // 阻止預設右鍵選單
        if (e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
        }

        const uid = cell.parentElement.dataset.uid;
        const type = cell.dataset.type; 
        const day = cell.dataset.day;
        const key = type === 'last' ? `last_${day}` : `current_${day}`;

        if (e.button === 0) {
            // 左鍵：切換 OFF
            this.handleLeftClick(uid, key);
        } else if (e.button === 2) {
            // 右鍵：顯示選單
            this.handleRightClick(e, uid, key, type, day);
        }
        
        const val = (this.localAssignments[uid] && this.localAssignments[uid][key]) || '';
        cell.innerHTML = this.renderCellContent(val);
        this.updateStats();
    },

    handleLeftClick: function(uid, key) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const current = this.localAssignments[uid][key];
        
        if (current === 'OFF') {
            delete this.localAssignments[uid][key];
        } else {
            this.localAssignments[uid][key] = 'OFF';
        }
    },

    handleRightClick: function(e, uid, key, type, day) {
        const menu = document.getElementById('customContextMenu');
        const options = document.getElementById('contextMenuOptions');
        const title = document.getElementById('contextMenuTitle');
        
        if(!menu || !options || !title) return;
        
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

        // 班別選項
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
        
        // 定位選單
        let x = e.pageX;
        let y = e.pageY;
        
        // 防止超出視窗
        setTimeout(() => {
            if (y + menu.offsetHeight > window.innerHeight) {
                y = window.innerHeight - menu.offsetHeight - 10;
            }
            if (x + menu.offsetWidth > window.innerWidth) {
                x = window.innerWidth - menu.offsetWidth - 10;
            }
            
            menu.style.display = 'block';
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
        }, 0);
    },

    setShift: function(uid, key, val) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        
        if (val === null) {
            delete this.localAssignments[uid][key];
        } else {
            this.localAssignments[uid][key] = val;
        }

        // 更新格子
        const type = key.startsWith('last') ? 'last' : 'current';
        const day = key.split('_')[1];
        const row = document.querySelector(`tr[data-uid="${uid}"]`);
        const cell = row?.querySelector(`td[data-type="${type}"][data-day="${day}"]`);
        if(cell) cell.innerHTML = this.renderCellContent(val);

        this.updateStats();
        
        // 關閉選單
        const menu = document.getElementById('customContextMenu');
        if(menu) menu.style.display = 'none';
    },

    // --- 統計更新 ---
    updateStats: function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const maxOff = this.data.settings?.maxOffDays || 8; 

        const colStats = {}; 
        for(let d = 1; d <= daysInMonth; d++) colStats[d] = 0;

        this.data.staffList.forEach(u => {
            const assign = this.localAssignments[u.uid] || {};
            let totalOff = 0; 
            let userReqOff = 0; 

            for(let d = 1; d <= daysInMonth; d++) {
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
                    cell.title = `預休 ${userReqOff} 天，超過上限 ${maxOff} 天`;
                } else {
                    cell.classList.remove('text-danger');
                    cell.title = '';
                }
            }
        });

        // 更新每日統計
        for(let d = 1; d <= daysInMonth; d++) {
            const cell = document.getElementById(`stat_col_${d}`);
            if(cell) cell.textContent = colStats[d];
        }
    },

    // --- 事件管理 ---
    setupEvents: function() {
        // 全域點擊關閉選單
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);

        // 監聽容器右鍵
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.oncontextmenu = (e) => {
                e.preventDefault();
                return false;
            };
        }
        
        console.log("✅ 事件監聽設定完成");
    },

    cleanup: function() {
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
            this.globalClickListener = null;
        }
        console.log("🧹 清理完成");
    },

    // --- 儲存與執行 ---
    saveData: async function() {
        if(this.isLoading) {
            alert("系統忙碌中，請稍候");
            return;
        }

        try {
            this.isLoading = true;
            
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            alert("✅ 草稿已儲存");
            
        } catch(e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    executeSchedule: async function() {
        // 檢查紅字警告
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告：有紅字！確定強制執行？")) return;
        } else {
            if(!confirm("確定執行排班？執行後將截止預班。")) return;
        }

        try {
            this.isLoading = true;
            
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                status: 'closed', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            alert("✅ 執行成功！");
            history.back(); 
            
        } catch(e) {
            console.error("Execute Error:", e);
            alert("執行失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    }
};

// 重寫 init 以支持 cleanup
const originalInit = matrixManager.init;
matrixManager.init = function(id) {
    this.cleanup();
    originalInit.call(this, id);
};
