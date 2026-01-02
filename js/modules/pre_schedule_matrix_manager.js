// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,      // 當月預班表資料
    prevData: {},    // 前月正式班表資料 (用於顯示前6天)
    shifts: [],      
    shiftsMap: {},   
    usersMap: {},    
    staffList: [],   
    contextTarget: null, 
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少文件 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        this.showLoading();
        this.cleanup(); 

        try {
            // 1. 載入當月預班表
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            this.data = doc.data();

            // 2. 平行載入其他必要資料 (含前月班表)
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadPreviousMonthData() // [新增] 載入前月最後幾天
            ]);
            
            // 3. 渲染
            this.renderMatrix();
            this.setupEvents(); 
            
            // 設定標題
            const titleEl = document.getElementById('matrixTitle');
            if(titleEl) {
                titleEl.textContent = `${this.data.unitId} - ${this.data.year} 年 ${this.data.month} 月預班表`;
            }

        } catch(error) {
            console.error(error);
            const c = document.getElementById('matrixContainer');
            if(c) c.innerHTML = `<div style="color:red; padding:20px;">載入失敗: ${error.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    cleanup: function() {
        const oldMenu = document.getElementById('customContextMenu');
        if(oldMenu) oldMenu.remove();
        document.onclick = null; 
    },

    showLoading: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = '<div style="padding:50px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</div>';
    },

    // --- 資料載入層 ---

    loadShifts: async function() {
        let unitId = this.data ? this.data.unitId : app.userUnitId;
        if(!unitId) return;

        const snap = await db.collection('shifts').where('unitId', '==', unitId).get();
        this.shifts = snap.docs.map(d => d.data());
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || '')); 
        
        this.shiftsMap = {};
        this.shifts.forEach(s => this.shiftsMap[s.code] = s);
    },

    loadUsers: async function() {
        const userSnap = await db.collection('users')
            .where('unitId', '==', this.data.unitId)
            .where('isActive', '==', true)
            .get();

        this.usersMap = {};
        this.staffList = [];
        
        userSnap.forEach(u => {
            const userData = u.data();
            this.usersMap[u.id] = { uid: u.id, ...userData };
            this.staffList.push({ uid: u.id, ...userData });
        });

        this.staffList.sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));
    },

    // [新增] 載入前一個月的班表資料 (為了顯示最後6天)
    loadPreviousMonthData: async function() {
        let pYear = this.data.year;
        let pMonth = this.data.month - 1;
        if (pMonth === 0) { pMonth = 12; pYear--; }

        try {
            // 嘗試讀取前一個月的「正式班表 (schedules)」
            // 注意：這裡假設正式班表已建立。若無，則該區塊會空白。
            const snaps = await db.collection('schedules')
                .where('unitId', '==', this.data.unitId)
                .where('year', '==', pYear)
                .where('month', '==', pMonth)
                .limit(1)
                .get();

            if (!snaps.empty) {
                const docData = snaps.docs[0].data();
                this.prevData = docData.assignments || {}; // 格式: { uid: { dateStr: code } }
            } else {
                this.prevData = {};
            }
        } catch (e) {
            console.error("Load prev month error:", e);
            this.prevData = {};
        }
    },

    // --- 渲染層 ---

    renderMatrix: function() {
        const container = document.getElementById('matrixContainer');
        if(!container) return;

        container.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 140px); border:1px solid #ddd; position:relative;">
                <table id="scheduleMatrix" style="border-collapse: separate; border-spacing: 0;">
                    <thead id="matrixHead" style="position:sticky; top:0; z-index:30;"></thead>
                    <tbody id="matrixBody"></tbody>
                </table>
            </div>
        `;
        
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        
        // --- 計算日期範圍 ---
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        // 前一個月的最後 6 天
        let pYear = this.data.year;
        let pMonth = this.data.month - 1;
        if(pMonth === 0) { pMonth = 12; pYear--; }
        const daysInPrevMonth = new Date(pYear, pMonth, 0).getDate();
        const prevStartDay = daysInPrevMonth - 5; // 例如 31-5 = 26 (顯示 26~31)
        const prevDays = [];
        for(let d = prevStartDay; d <= daysInPrevMonth; d++) {
            prevDays.push({
                d: d,
                dateStr: `${pYear}-${String(pMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
                isPrev: true
            });
        }

        // 當月所有天數
        const currentDays = [];
        for(let d = 1; d <= daysInMonth; d++) {
            currentDays.push({
                d: d,
                dateStr: `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
                isPrev: false
            });
        }

        const allDays = [...prevDays, ...currentDays];

        // 1. 渲染表頭
        let headHtml = `<tr style="background:#f8f9fa;">
            <th class="sticky-col" style="min-width:60px; left:0; z-index:31; border-right:1px solid #ccc; border-bottom:1px solid #ccc; padding:8px;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:31; border-right:1px solid #ccc; border-bottom:1px solid #ccc; padding:8px;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:31; border-right:2px solid #999; border-bottom:1px solid #ccc; padding:8px;">層級</th>`;
        
        allDays.forEach(dayInfo => {
            const dateObj = new Date(dayInfo.dateStr);
            const dayOfWeek = dateObj.getDay();
            const dayName = ['日','一','二','三','四','五','六'][dayOfWeek];
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            
            let style = 'min-width:35px; text-align:center; padding:5px; border-bottom:1px solid #ccc; border-right:1px solid #eee;';
            
            if (dayInfo.isPrev) {
                // 前月樣式 (較暗)
                style += 'background:#e0e0e0; color:#666; font-size:0.9rem; border-bottom:1px solid #999;';
                if (dayInfo.d === daysInPrevMonth) style += 'border-right:2px solid #999;'; // 分隔線
            } else {
                // 當月樣式
                style += isWeekend ? 'background:#fff0f0; color:red;' : 'background:#f8f9fa; color:#333;';
            }

            headHtml += `<th style="${style}">
                            ${dayInfo.d}<br><small>${dayName}</small>
                         </th>`;
        });
        
        headHtml += `<th style="min-width:50px; border-bottom:1px solid #ccc; padding:8px;">OFF數</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. 渲染表身
        if (this.staffList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${allDays.length + 4}" style="padding:20px; text-align:center;">無人員資料</td></tr>`;
            return;
        }

        this.staffList.forEach(user => {
            const tr = document.createElement('tr');
            
            // 固定欄位
            let rowHtml = `
                <td class="sticky-col" style="left:0; background:#fff; border-right:1px solid #eee; border-bottom:1px solid #eee; padding:5px;">${user.employeeId}</td>
                <td class="sticky-col" style="left:60px; background:#fff; border-right:1px solid #eee; border-bottom:1px solid #eee; padding:5px;">${user.displayName}</td>
                <td class="sticky-col" style="left:140px; background:#fff; border-right:2px solid #999; border-bottom:1px solid #eee; padding:5px;">${user.level}</td>
            `;

            let offCount = 0;

            // 日期欄位迴圈
            allDays.forEach(dayInfo => {
                let cellStyle = 'text-align:center; border-bottom:1px solid #eee; border-right:1px solid #eee; font-size:0.9rem;';
                let cellText = '';
                let cellClass = 'cell-day';
                let onClick = '';
                let onCtx = '';

                if (dayInfo.isPrev) {
                    // --- 前月資料 (唯讀) ---
                    cellStyle += 'background:#f0f0f0; color:#888; cursor:default;';
                    if (dayInfo.d === daysInPrevMonth) cellStyle += 'border-right:2px solid #999;';
                    
                    const shiftCode = this.prevData[user.uid]?.[dayInfo.dateStr] || '';
                    cellText = shiftCode;
                    // 如果有班別顏色，也可以加上
                    if (this.shiftsMap[shiftCode]) {
                        const color = this.shiftsMap[shiftCode].color;
                        cellStyle += `background:${color}33; color:#000; font-weight:bold;`; // 變淡
                    }

                } else {
                    // --- 當月資料 (可互動) ---
                    cellStyle += 'cursor:pointer;';
                    
                    const userAssign = (this.data.assignments && this.data.assignments[user.uid]) || {};
                    const shiftCode = userAssign[dayInfo.dateStr] || '';

                    if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

                    // 顏色渲染
                    if(shiftCode === 'REQ_OFF') {
                        cellStyle += 'background:#2ecc71; color:white;'; 
                        cellText = '休';
                    } else if (shiftCode === 'OFF') {
                        cellStyle += 'background:#95a5a6; color:white;'; 
                        cellText = 'OFF';
                    } else if (this.shiftsMap[shiftCode]) {
                        const color = this.shiftsMap[shiftCode].color || '#3498db';
                        cellStyle += `background:${color}; color:white;`;
                        cellText = shiftCode;
                    }

                    // 綁定事件 (傳入參數)
                    onClick = `onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dayInfo.dateStr}')"`;
                    onCtx = `oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dayInfo.dateStr}')"`;
                }

                rowHtml += `<td ${cellClass} style="${cellStyle}" ${onClick} ${onCtx}>${cellText}</td>`;
            });
            
            rowHtml += `<td style="font-weight:bold; text-align:center; border-bottom:1px solid #eee;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    // --- 互動層 ---
    
    setupEvents: function() {
        // 全域點擊，關閉右鍵選單
        document.onclick = (e) => {
            const menu = document.getElementById('customContextMenu');
            if(menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
    },

    handleCellClick: function(e, uid, dateStr) {
        // 左鍵點擊：切換 OFF (灰色) -> 空
        // 您的需求："左鍵預設 OFF"
        
        if(!this.data.assignments) this.data.assignments = {};
        if(!this.data.assignments[uid]) this.data.assignments[uid] = {};

        const current = this.data.assignments[uid][dateStr];
        
        if (current === 'OFF') {
            delete this.data.assignments[uid][dateStr]; // 清除
        } else {
            this.data.assignments[uid][dateStr] = 'OFF'; // 設定為 OFF
        }

        this.renderMatrix();
        this.saveData();
    },

    handleRightClick: function(e, uid, dateStr) {
        e.preventDefault();
        this.contextTarget = { uid, dateStr };
        
        const menu = this.getOrCreateContextMenu();
        
        let optionsHtml = '';
        
        // 班別選項
        if (this.shifts.length > 0) {
            this.shifts.forEach(s => {
                optionsHtml += `<div class="menu-item" onclick="matrixManager.setShift('${s.code}')" style="padding:8px 15px; cursor:pointer; display:flex; align-items:center; gap:8px;">
                    <span style="background:${s.color}; width:12px; height:12px; display:inline-block; border-radius:2px;"></span> 
                    ${s.name} (${s.code})
                </div>`;
            });
            optionsHtml += `<div style="height:1px; background:#eee; margin:5px 0;"></div>`;
        }

        // 功能選項
        optionsHtml += `
            <div class="menu-item" onclick="matrixManager.setShift('REQ_OFF')" style="padding:8px 15px; cursor:pointer;">🟢 預休 (REQ)</div>
            <div class="menu-item" onclick="matrixManager.setShift('OFF')" style="padding:8px 15px; cursor:pointer;">⚪ 一般 OFF</div>
            <div class="menu-item" onclick="matrixManager.setShift(null)" style="padding:8px 15px; cursor:pointer; color:red;">❌ 清除</div>
        `;

        menu.innerHTML = optionsHtml;
        menu.style.display = 'block';
        
        // 防止選單超出邊界
        const x = Math.min(e.pageX, window.innerWidth - 180);
        const y = Math.min(e.pageY, window.innerHeight - 250);
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        // Hover 效果
        const items = menu.querySelectorAll('.menu-item');
        items.forEach(item => {
            item.onmouseover = () => item.style.background = '#f0f0f0';
            item.onmouseout = () => item.style.background = 'white';
        });
    },

    getOrCreateContextMenu: function() {
        let menu = document.getElementById('customContextMenu');
        if(!menu) {
            menu = document.createElement('div');
            menu.id = 'customContextMenu';
            menu.style.cssText = 'display:none; position:absolute; z-index:1000; background:white; border:1px solid #ccc; box-shadow:2px 2px 8px rgba(0,0,0,0.2); min-width:150px; border-radius:4px; padding:5px 0;';
            document.body.appendChild(menu);
        }
        return menu;
    },

    setShift: function(code) {
        if(!this.contextTarget) return;
        const { uid, dateStr } = this.contextTarget;
        
        if(!this.data.assignments) this.data.assignments = {};
        if(!this.data.assignments[uid]) this.data.assignments[uid] = {};

        if(code) {
            this.data.assignments[uid][dateStr] = code;
        } else {
            delete this.data.assignments[uid][dateStr];
        }

        this.renderMatrix(); 
        this.saveData();
        
        const menu = document.getElementById('customContextMenu');
        if(menu) menu.style.display = 'none';
    },

    saveData: async function() {
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.data.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("Auto saved.");
        } catch(e) {
            console.error("Save failed", e);
        }
    },
    
    updateStats: function() {}
};
