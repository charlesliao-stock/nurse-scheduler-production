// js/modules/pre_schedule_matrix_manager.js
// 修正版：保留原始複雜排版，修復右鍵選單空白問題

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {},
    globalClickListener: null,
    isLoading: false,

    init: async function(id) {
        console.log("🎯 Matrix Manager Init:", id);
        
        if(!id) {
            alert("錯誤:缺少預班表 ID");
            window.location.hash = '/admin/pre_schedules';
            return;
        }
        
        this.cleanup();
        this.docId = id;
        this.isLoading = true;
        
        try {
            this.showLoading();
            
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            // 使用原始的表格結構還原函數
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
            // 確保選單在 body
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }
            
            console.log("✅ Matrix 初始化完成");
            
        } catch(error) {
            console.error("❌ Matrix 初始化失敗:", error);
            alert("載入失敗: " + error.message);
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

    restoreTableStructure: function() {
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.innerHTML = `
                <div class="table-responsive" style="max-height: calc(100vh - 200px); overflow: auto;">
                    <table id="scheduleMatrix" class="table table-bordered table-sm text-center">
                        <thead id="matrixHead" class="thead-light"></thead>
                        <tbody id="matrixBody"></tbody>
                        <tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; font-weight:bold; border-top:2px solid #ddd;"></tfoot>
                    </table>
                </div>
            `;
        }
    },

    loadShifts: async function() {
        const snapshot = await db.collection('shifts').get();
        this.shifts = snapshot.docs.map(doc => doc.data());
    },

    loadUsers: async function() {
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        snapshot.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        // 更新標題與狀態
        const titleEl = document.getElementById('matrixTitle');
        if(titleEl) titleEl.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const statusMap = { 'open':'開放中', 'closed':'已截止', 'scheduled':'已排班' };
        const st = this.data.status || 'open';
        const statusEl = document.getElementById('matrixStatus');
        if(statusEl) {
            statusEl.textContent = statusMap[st] || st;
            statusEl.className = `badge ${st === 'open' ? 'bg-success' : 'bg-secondary'}`;
        }
    },

    // 保留原始的渲染邏輯 (雙層表頭 + 上個月資料)
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 表頭 (Header)
        let header1 = `<tr>
            <th rowspan="2" style="vertical-align:middle; position:sticky; left:0; z-index:30; background:#fff;">員編</th>
            <th rowspan="2" style="vertical-align:middle; position:sticky; left:60px; z-index:30; background:#fff;">姓名</th>
            <th rowspan="2" style="vertical-align:middle;">特註</th>
            <th rowspan="2" style="vertical-align:middle;">偏好</th>
            <th colspan="6" style="background:#f1f1f1;">上月</th>
            <th colspan="${daysInMonth}" style="background:#e3f2fd;">本月 ${month} 月</th>
            <th rowspan="2" style="vertical-align:middle; position:sticky; right:0; z-index:30; background:#fff; border-left:2px solid #ccc; width:60px;">統計<br>(OFF)</th>
        </tr>`;
        
        let header2 = `<tr>`;
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        
        // 上月最後 6 天
        for(let i=5; i>=0; i--) {
            const d = lastMonthLastDay - i;
            header2 += `<th class="cell-narrow" style="background:#f9f9f9; color:#666;">${d}</th>`;
        }
        
        // 本月天數
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:red;' : '';
            header2 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        thead.innerHTML = header1 + header2;

        // 2. 內容 (Body)
        let bodyHtml = '';
        const staffList = this.data.staffList || [];
        // 依照員編排序
        staffList.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        staffList.forEach(u => {
            const userInfo = this.usersMap[u.uid] || {};
            const params = userInfo.schedulingParams || {};
            let noteIcon = '';

            const isPregnant = params.isPregnant && (!params.pregnantExpiry || params.pregnantExpiry >= today);
            const isBreastfeeding = params.isBreastfeeding && (!params.breastfeedingExpiry || params.breastfeedingExpiry >= today);

            if (isPregnant) noteIcon += '<i class="fas fa-baby" title="孕" style="color:#e67e22;"></i> ';
            if (isBreastfeeding) noteIcon += '<i class="fas fa-cookie" title="哺" style="color:#d35400;"></i>';
            
            const assign = this.localAssignments[u.uid] || {};
            const pref = assign.preferences || {};
            let prefHtml = '';
            if (pref.bundleShift) {
                prefHtml += `<span class="badge badge-info">包${pref.bundleShift}</span>`;
            }
            
            // 這裡使用您原本的變數 u.empId (解決 undefined 問題)
            bodyHtml += `<tr data-uid="${u.uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:20;">${u.empId || ''}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:20; font-weight:bold;">${u.name}</td>
                <td>${noteIcon}</td>
                <td style="font-size:0.8rem; color:#666;">${prefHtml}</td>`;
            
            // 上月資料格子
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const key = `last_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                    style="background:#f9f9f9;"
                    data-type="last" data-day="${d}" 
                    data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            
            // 本月資料格子
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                    data-type="current" data-day="${d}" 
                    data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            
            // 統計欄
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold;">0</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部 (Footer)
        let footHtml = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i=0; i<6; i++) footHtml += `<td style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            footHtml += `<td id="stat_col_${d}" style="font-weight:bold;">0</td>`;
        }
        footHtml += `<td>-</td></tr>`;
        tfoot.innerHTML = footHtml;
        
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        // 樣式對應
        if(val === 'OFF') return '<span style="color:#bdc3c7;">OFF</span>';
        if(val === 'REQ_OFF') return '<span class="badge badge-success" style="background:#2ecc71;">休</span>'; // 綠色預休
        if(val.startsWith('!')) return `<span style="color:#c0392b; font-size:0.8rem;"><i class="fas fa-ban"></i>${val.replace('!', '')}</span>`;
        
        // 嘗試找班別顏色
        const shift = this.shifts.find(s => s.code === val);
        const color = shift ? shift.color : '#3498db';
        return `<span class="badge" style="background:${color}; color:white;">${val}</span>`;
    },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            // 左鍵點擊 (簡易切換)
            cell.addEventListener('mousedown', (e) => {
                if (e.button === 0) { 
                    const uid = cell.dataset.uid;
                    const type = cell.dataset.type;
                    const day = cell.dataset.day;
                    const key = type === 'last' ? `last_${day}` : `current_${day}`;
                    
                    // 簡單切換 OFF
                    if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
                    const current = this.localAssignments[uid][key];
                    if (current === 'OFF') delete this.localAssignments[uid][key];
                    else this.localAssignments[uid][key] = 'OFF';
                    
                    cell.innerHTML = this.renderCellContent(this.localAssignments[uid][key]);
                    this.updateStats();
                }
            });
            
            // 右鍵點擊
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const uid = cell.dataset.uid;
                const type = cell.dataset.type;
                const day = cell.dataset.day;
                const key = type === 'last' ? `last_${day}` : `current_${day}`;
                
                this.handleRightClick(e, uid, key, type, day);
                return false;
            });
        });
    },

    // [關鍵修正] 適應新版 index.html 的空 UL 結構
    handleRightClick: function(e, uid, key, type, day) {
        const menu = document.getElementById('customContextMenu');
        if (!menu) return;

        // 取得內部的 ul (新結構)
        let list = menu.querySelector('ul');
        if(!list) {
            // 相容性: 如果沒有 ul，直接用 menu 當容器
            list = menu;
        }

        // 清空並重建選單內容
        list.innerHTML = ''; 

        // 1. 標題
        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px 10px; background:#f8f9fa; font-weight:bold; border-bottom:1px solid #ddd; color:#333;">設定 ${day} 日</div>`;
        header.style.cursor = 'default';
        list.appendChild(header);

        // 2. 選項生成
        const addItem = (icon, text, onClick, color) => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="width:20px; display:inline-block; text-align:center; margin-right:5px;">${icon}</span> ${text}`;
            li.style.padding = '8px 15px';
            li.style.cursor = 'pointer';
            if(color) li.style.color = color;
            li.onmouseover = () => li.style.background = '#f1f1f1';
            li.onmouseout = () => li.style.background = 'white';
            li.onclick = () => {
                onClick();
                menu.style.display = 'none';
            };
            list.appendChild(li);
        };

        if (type === 'current') {
            addItem('<span style="color:#2ecc71;">●</span>', '預休 (REQ_OFF)', () => this.setShift(uid, key, 'REQ_OFF'));
            addItem('<span style="color:#bdc3c7;">●</span>', '強制休 (OFF)', () => this.setShift(uid, key, 'OFF'));
        } else {
            addItem('O', 'OFF', () => this.setShift(uid, key, 'OFF'));
        }

        // 分隔線
        const sep = document.createElement('li');
        sep.style.borderTop = '1px solid #eee';
        sep.style.margin = '5px 0';
        list.appendChild(sep);

        // 班別列表
        this.shifts.forEach(s => {
            addItem(
                `<span style="color:${s.color}; font-weight:bold;">${s.code}</span>`, 
                `指定 ${s.name}`, 
                () => this.setShift(uid, key, s.code)
            );
        });

        if (type === 'current') {
            list.appendChild(sep.cloneNode());
            this.shifts.forEach(s => {
                addItem(
                    `<i class="fas fa-ban"></i>`, 
                    `勿排 ${s.code}`, 
                    () => this.setShift(uid, key, `!${s.code}`),
                    '#c0392b'
                );
            });
        }

        // 清除
        list.appendChild(sep.cloneNode());
        addItem('<i class="fas fa-eraser"></i>', '清除', () => this.setShift(uid, key, null), 'red');

        // 顯示並定位
        menu.style.display = 'block';
        this.positionMenu(e, menu);
    },

    setShift: function(uid, key, val) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if (val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        // 更新該格顯示
        const type = key.startsWith('last') ? 'last' : 'current';
        const day = key.split('_')[1];
        const row = document.querySelector(`tr[data-uid="${uid}"]`);
        const cell = row?.querySelector(`td[data-type="${type}"][data-day="${day}"]`);
        
        if(cell) cell.innerHTML = this.renderCellContent(val);
        this.updateStats();
    },

    positionMenu: function(e, menu) {
        const menuWidth = 200; // 估計寬度
        const menuHeight = menu.offsetHeight || 300;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let left = e.pageX;
        let top = e.pageY;

        if (left + menuWidth > windowWidth) left = windowWidth - menuWidth - 10;
        if (top + menuHeight > windowHeight) top = windowHeight - menuHeight - 10;

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    },

    updateStats: function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const maxOff = this.data.settings?.maxOffDays || 8; 
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
                    cell.style.color = 'red';
                    cell.title = `預休 ${userReqOff} 天,超過上限 ${maxOff} 天`;
                } else {
                    cell.style.color = 'black';
                    cell.title = '';
                }
            }
        });
        
        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`stat_col_${d}`);
            if(cell) cell.textContent = colStats[d];
        }
    },

    setupEvents: function() {
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);
    },

    cleanup: function() {
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('customContextMenu');
        if (menu) menu.style.display = 'none';
    },

    saveData: async function() {
        try {
            this.isLoading = true;
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("✅ 草稿已儲存");
        } catch(e) { 
            console.error(e); 
            alert("儲存失敗: " + e.message); 
        } finally { 
            this.isLoading = false; 
        }
    },

    executeSchedule: async function() {
        if(!confirm("確定執行排班?執行後將截止預班。")) return;
        try {
            this.isLoading = true;
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                status: 'closed', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("✅ 執行成功!");
            history.back(); 
        } catch(e) { 
            alert("執行失敗: " + e.message); 
        } finally { 
            this.isLoading = false; 
        }
    }
};
