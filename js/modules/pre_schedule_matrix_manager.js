// js/modules/pre_schedule_matrix_manager.js
// Fix: 基於原版架構修復，補回前月資料與正確的點擊互動

const matrixManager = {
    docId: null,
    data: null,      // 當月預班表
    prevData: {},    // 前月正式班表 (用於顯示前6天)
    shifts: [],
    shiftsMap: {},
    usersMap: {},
    staffList: [],   // 排序後的人員列表
    localAssignments: {}, // 本地暫存
    contextTarget: null,
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少文件 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        try {
            this.showLoading();
            this.cleanup(); // 清理舊監聽

            // 1. 先讀取主文件 (取得年份月份)
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            this.data = doc.data();
            this.localAssignments = this.data.assignments || {};

            // 2. 平行載入所有參照資料 (包含前一個月)
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadPreviousMonthData() // [新增] 載入前月資料
            ]);
            
            // 3. 還原表格結構 (這是您原本的關鍵函式)
            this.restoreTableStructure();
            
            // 4. 渲染與統計
            this.renderMatrix();
            this.updateStats(); 
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
        const unitId = this.data.unitId;
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

    // [新增] 載入前月資料
    loadPreviousMonthData: async function() {
        let pYear = this.data.year;
        let pMonth = this.data.month - 1;
        if (pMonth === 0) { pMonth = 12; pYear--; }

        try {
            // 讀取前月正式班表
            const snaps = await db.collection('schedules')
                .where('unitId', '==', this.data.unitId)
                .where('year', '==', pYear)
                .where('month', '==', pMonth)
                .limit(1)
                .get();

            if (!snaps.empty) {
                const docData = snaps.docs[0].data();
                // 格式: assignments[uid][dateStr]
                this.prevData = docData.assignments || {}; 
            } else {
                this.prevData = {};
            }
        } catch (e) {
            console.warn("前月資料載入失敗", e);
            this.prevData = {};
        }
    },

    // --- 版面結構 (保留您原本的設計) ---

    restoreTableStructure: function() {
        const container = document.getElementById('matrixContainer');
        if(!container) return;

        container.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 140px); border:1px solid #ddd; position:relative;">
                <table id="scheduleMatrix" style="width:100%; border-collapse: separate; border-spacing: 0;">
                    <thead id="matrixHead" style="position:sticky; top:0; z-index:30;"></thead>
                    <tbody id="matrixBody"></tbody>
                    <tfoot id="matrixFoot" style="position:sticky; bottom:0; z-index:30; background:#f9f9f9; border-top:2px solid #ddd;"></tfoot>
                </table>
            </div>
        `;
    },

    // --- 核心渲染 ---

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        if(!thead || !tbody) return;

        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        // 0. 準備所有日期 (包含前月最後 6 天)
        let pYear = this.data.year;
        let pMonth = this.data.month - 1;
        if(pMonth === 0) { pMonth = 12; pYear--; }
        const daysInPrevMonth = new Date(pYear, pMonth, 0).getDate();
        const prevStartDay = daysInPrevMonth - 5; 
        
        this.allDays = []; // 存入全域變數供 updateStats 使用

        // 前月
        for(let d = prevStartDay; d <= daysInPrevMonth; d++) {
            this.allDays.push({
                d: d,
                dateStr: `${pYear}-${String(pMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
                isPrev: true
            });
        }
        // 當月
        for(let d = 1; d <= daysInMonth; d++) {
            this.allDays.push({
                d: d,
                dateStr: `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
                isPrev: false
            });
        }

        // 1. 渲染表頭
        let headHtml = `<tr style="background:#f8f9fa;">
            <th class="sticky-col" style="min-width:60px; left:0; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:31; border-right:2px solid #ccc; border-bottom:1px solid #ddd; padding:8px;">層級</th>`;
        
        this.allDays.forEach(dayInfo => {
            const dateObj = new Date(dayInfo.dateStr);
            const dayOfWeek = dateObj.getDay();
            const dayName = ['日','一','二','三','四','五','六'][dayOfWeek];
            const isWeekend = (dayOfWeek===0 || dayOfWeek===6);
            
            let style = 'min-width:35px; text-align:center; padding:5px; border-bottom:1px solid #ddd; border-right:1px solid #eee;';
            
            if (dayInfo.isPrev) {
                style += 'background:#e0e0e0; color:#666; border-bottom:1px solid #999;'; // 前月深灰底
                if(dayInfo.d === daysInPrevMonth) style += 'border-right:2px solid #999;'; // 分隔線
            } else {
                style += isWeekend ? 'background:#fff0f0; color:red;' : 'background:#f8f9fa; color:#333;';
            }

            headHtml += `<th style="${style}">${dayInfo.d}<br><small>${dayName}</small></th>`;
        });
        headHtml += `<th style="min-width:50px; border-bottom:1px solid #ddd; padding:8px;">OFF數</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. 渲染表身
        if (this.staffList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${this.allDays.length + 4}" style="padding:20px; text-align:center;">無人員資料</td></tr>`;
            return;
        }

        this.staffList.forEach(user => {
            const tr = document.createElement('tr');
            
            // 左側固定欄位
            let rowHtml = `
                <td class="sticky-col" style="left:0; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.employeeId}</td>
                <td class="sticky-col" style="left:60px; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.displayName}</td>
                <td class="sticky-col" style="left:140px; background:#fff; border-right:2px solid #ccc; border-bottom:1px solid #eee; padding:5px;">${user.level}</td>
            `;

            let offCount = 0;

            this.allDays.forEach(dayInfo => {
                let cellStyle = 'text-align:center; border-bottom:1px solid #eee; border-right:1px solid #eee; font-size:0.9rem;';
                let cellText = '';
                let events = '';

                if (dayInfo.isPrev) {
                    // --- 前月資料 (唯讀) ---
                    cellStyle += 'background:#f0f0f0; color:#888; cursor:default;';
                    if(dayInfo.d === daysInPrevMonth) cellStyle += 'border-right:2px solid #999;';
                    
                    // 從 prevData 讀取 (注意結構)
                    const uData = this.prevData[user.uid] || {};
                    // 有可能直接是字串，或在 assignments 物件下
                    const code = uData[dayInfo.dateStr] || (uData.assignments ? uData.assignments[dayInfo.dateStr] : '') || '';
                    
                    if(this.shiftsMap[code]) {
                         const color = this.shiftsMap[code].color;
                         cellStyle += `background:${color}44; color:#000; font-weight:bold;`; // 變淡
                         cellText = code;
                    } else {
                        cellText = code;
                    }

                } else {
                    // --- 當月資料 (可互動) ---
                    cellStyle += 'cursor:pointer;';
                    
                    const userAssign = this.localAssignments[user.uid] || {};
                    const shiftCode = userAssign[dayInfo.dateStr] || ''; 
                    
                    if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

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

                    // 綁定事件
                    events = `onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dayInfo.dateStr}')" 
                              oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dayInfo.dateStr}')"`;
                }

                rowHtml += `<td class="cell-day" style="${cellStyle}" ${events}>${cellText}</td>`;
            });
            
            rowHtml += `<td style="font-weight:bold; text-align:center; border-bottom:1px solid #eee;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    // --- 3. 統計列 (恢復您的 A/B 統計) ---
    updateStats: function() {
        const tfoot = document.getElementById('matrixFoot');
        if(!tfoot || !this.allDays) return;

        let footHtml = `<tr>
            <td class="sticky-col" colspan="3" style="left:0; background:#f9f9f9; border-top:2px solid #ddd; border-right:2px solid #ccc; padding:8px; text-align:right; font-weight:bold;">
                人力供需 (需/現)
            </td>`;
        
        this.allDays.forEach(dayInfo => {
            let cellStyle = 'text-align:center; font-size:0.85rem; color:#666; border-right:1px solid #eee; padding:5px; border-top:2px solid #ddd;';
            
            if (dayInfo.isPrev) {
                cellStyle += 'background:#e0e0e0;';
                if(dayInfo.d === this.allDays[5].d) cellStyle += 'border-right:2px solid #999;'; 
                footHtml += `<td style="${cellStyle}">-</td>`;
            } else {
                // 計算當日可用人數 (Supply)
                let supply = 0;
                this.staffList.forEach(u => {
                    const code = (this.localAssignments[u.uid]?.[dayInfo.dateStr]);
                    // 只要不是休假，就算有人力
                    if(code && code !== 'OFF' && code !== 'REQ_OFF') supply++;
                });
                
                // 這裡暫時顯示 Supply (Demand 可從 rules 讀取)
                footHtml += `<td style="${cellStyle}">- / ${supply}</td>`;
            }
        });

        footHtml += `<td style="border-top:2px solid #ddd;"></td></tr>`;
        tfoot.innerHTML = footHtml;
    },

    // --- 互動邏輯 ---

    setupEvents: function() {
        // [修正] 全域點擊只負責關閉選單，不干擾其他操作
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
        // [修正] 左鍵預設行為： 空 -> OFF -> 空
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};

        const current = this.localAssignments[uid][dateStr];
        
        if (current === 'OFF') {
            delete this.localAssignments[uid][dateStr]; // 清除
        } else {
            this.localAssignments[uid][dateStr] = 'OFF'; // 設定為 OFF
        }

        this.renderMatrix(); // 局部重繪
        this.updateStats();  // 更新統計
        this.saveData();     // 背景儲存
    },

    handleRightClick: function(e, uid, dateStr) {
        e.preventDefault();
        this.contextTarget = { uid, dateStr };
        
        const menu = this.getOrCreateContextMenu();
        
        let optionsHtml = '';
        // 班別選項
        if (this.shifts.length > 0) {
            this.shifts.forEach(s => {
                if(s.isBundleAvailable) {
                    optionsHtml += `<div class="menu-item" onclick="matrixManager.setShift('${s.code}')" style="padding:8px 15px; cursor:pointer; display:flex; align-items:center; gap:8px;">
                        <span style="background:${s.color}; width:12px; height:12px; display:inline-block; border-radius:2px;"></span> 
                        ${s.name} (${s.code})
                    </div>`;
                }
            });
            optionsHtml += `<div style="height:1px; background:#eee; margin:5px 0;"></div>`;
        }

        optionsHtml += `
            <div class="menu-item" onclick="matrixManager.setShift('REQ_OFF')" style="padding:8px 15px; cursor:pointer;">🟢 預休 (REQ)</div>
            <div class="menu-item" onclick="matrixManager.setShift('OFF')" style="padding:8px 15px; cursor:pointer;">⚪ 一般 OFF</div>
            <div class="menu-item" onclick="matrixManager.setShift(null)" style="padding:8px 15px; cursor:pointer; color:red;">❌ 清除</div>
        `;

        menu.innerHTML = optionsHtml;
        menu.style.display = 'block';
        
        // 防止超出邊界
        const x = Math.min(e.pageX, window.innerWidth - 180);
        const y = Math.min(e.pageY, window.innerHeight - 250);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // 樣式
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
        
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};

        if(code) {
            this.localAssignments[uid][dateStr] = code;
        } else {
            delete this.localAssignments[uid][dateStr];
        }

        this.renderMatrix(); 
        this.updateStats();
        this.saveData();
        
        const menu = document.getElementById('customContextMenu');
        if(menu) menu.style.display = 'none';
    },

    saveData: async function() {
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("Auto saved.");
        } catch(e) {
            console.error("Save failed", e);
        }
    }
};
