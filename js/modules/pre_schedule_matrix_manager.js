// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],     // 動態班別列表
    shiftsMap: {},  // 班別對照表 (Code -> Info)
    usersMap: {},   // 人員對照表 (UID -> Info)
    staffList: [],  // 排序後的人員列表
    contextTarget: null, // 右鍵選單的目標儲存格
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少文件 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        // 1. UI 初始化
        this.showLoading();
        this.cleanup(); // 清理舊監聽器

        try {
            // 2. 平行載入所有必要資料 (解決 N+1 問題)
            await Promise.all([
                this.loadShifts(),
                this.loadContextAndUsers() 
            ]);
            
            // 3. 渲染與設定
            this.renderMatrix();
            this.updateStats();
            this.setupEvents(); // [修正點] 現在這個函式已經被定義了
            
            // 設定標題
            const titleEl = document.getElementById('matrixTitle');
            if(titleEl && this.data) {
                titleEl.textContent = `${this.data.year} 年 ${this.data.month} 月預班表`;
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
        // 移除可能殘留的 DOM
        const oldMenu = document.getElementById('customContextMenu');
        if(oldMenu) oldMenu.remove();
        
        // 清除全域事件 (避免重複綁定)
        document.onclick = null; 
    },

    showLoading: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = '<div style="padding:50px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</div>';
    },

    // --- [新增] 遺漏的事件設定函式 ---
    setupEvents: function() {
        // 點擊空白處關閉右鍵選單
        document.onclick = (e) => {
            const menu = document.getElementById('customContextMenu');
            if(menu && menu.style.display === 'block') {
                // 如果點擊的不是選單本身，就關閉它
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
    },

    // --- 資料載入層 ---

    loadShifts: async function() {
        const unitId = app.userUnitId;
        if(!unitId) return;

        const snap = await db.collection('shifts').where('unitId', '==', unitId).get();
        this.shifts = snap.docs.map(d => d.data());
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || '')); 
        
        this.shiftsMap = {};
        this.shifts.forEach(s => this.shiftsMap[s.code] = s);
    },

    loadContextAndUsers: async function() {
        // 1. 載入預班表文件
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("文件不存在");
        this.data = doc.data();
        
        // 2. 載入人員
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

        // 排序
        this.staffList.sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));
    },

    // --- 渲染層 ---

    renderMatrix: function() {
        const container = document.getElementById('matrixContainer');
        if(!container) return;

        container.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 120px);">
                <table id="scheduleMatrix">
                    <thead id="matrixHead"></thead>
                    <tbody id="matrixBody"></tbody>
                </table>
            </div>
        `;
        
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        // 1. 表頭
        let headHtml = `<tr>
            <th class="sticky-col" style="min-width:60px; left:0; z-index:20;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:20;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:20;">層級</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = dateObj.getDay();
            const isWeekend = (dayOfWeek===0 || dayOfWeek===6);
            const color = isWeekend ? 'color:red;' : '';
            const dayName = ['日','一','二','三','四','五','六'][dayOfWeek];
            headHtml += `<th style="min-width:35px; text-align:center; ${color}">${d}<br><small>${dayName}</small></th>`;
        }
        headHtml += `<th style="min-width:50px;">OFF數</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. 表身
        this.staffList.forEach(user => {
            const tr = document.createElement('tr');
            
            // 固定欄位
            let rowHtml = `
                <td class="sticky-col" style="left:0; background:#fff;">${user.employeeId}</td>
                <td class="sticky-col" style="left:60px; background:#fff;">${user.displayName}</td>
                <td class="sticky-col" style="left:140px; background:#fff;">${user.level}</td>
            `;

            // 日期欄位
            let offCount = 0;
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                
                const userAssign = (this.data.assignments && this.data.assignments[user.uid]) || {};
                const shiftCode = userAssign[dateStr] || ''; 
                
                if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

                let cellStyle = '';
                let cellText = '';
                
                if(shiftCode === 'REQ_OFF') {
                    cellStyle = 'background:#2ecc71; color:white;'; 
                    cellText = '休';
                } else if (shiftCode === 'OFF') {
                    cellStyle = 'background:#95a5a6; color:white;'; 
                    cellText = 'OFF';
                } else if (this.shiftsMap[shiftCode]) {
                    const color = this.shiftsMap[shiftCode].color || '#3498db';
                    cellStyle = `background:${color}; color:white;`;
                    cellText = shiftCode;
                }

                rowHtml += `<td class="cell-day" 
                              style="cursor:pointer; text-align:center; ${cellStyle}"
                              onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dateStr}')"
                              oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dateStr}')">
                              ${cellText}
                            </td>`;
            }
            
            rowHtml += `<td style="font-weight:bold; text-align:center;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    // --- 互動層 ---
    
    handleCellClick: function(e, uid, dateStr) {
        // 左鍵點擊切換：空 -> REQ_OFF -> 空
        if(!this.data.assignments) this.data.assignments = {};
        if(!this.data.assignments[uid]) this.data.assignments[uid] = {};

        const current = this.data.assignments[uid][dateStr];
        
        if (current === 'REQ_OFF') {
            delete this.data.assignments[uid][dateStr];
        } else {
            this.data.assignments[uid][dateStr] = 'REQ_OFF';
        }

        this.renderMatrix();
        this.saveData();
    },

    handleRightClick: function(e, uid, dateStr) {
        e.preventDefault();
        this.contextTarget = { uid, dateStr };
        
        const menu = this.getOrCreateContextMenu();
        
        let optionsHtml = '';
        this.shifts.forEach(s => {
            if(s.isBundleAvailable) { 
                optionsHtml += `<div class="menu-item" onclick="matrixManager.setShift('${s.code}')" style="padding:8px 15px; cursor:pointer; display:flex; align-items:center; gap:8px;">
                    <span style="background:${s.color}; width:12px; height:12px; display:inline-block; border-radius:2px;"></span> 
                    ${s.name} (${s.code})
                </div>`;
            }
        });
        
        optionsHtml += `
            <div style="height:1px; background:#eee; margin:5px 0;"></div>
            <div class="menu-item" onclick="matrixManager.setShift('REQ_OFF')" style="padding:8px 15px; cursor:pointer;">🟢 預休 (REQ)</div>
            <div class="menu-item" onclick="matrixManager.setShift('OFF')" style="padding:8px 15px; cursor:pointer;">⚪ 一般 OFF</div>
            <div class="menu-item" onclick="matrixManager.setShift(null)" style="padding:8px 15px; cursor:pointer; color:red;">❌ 清除</div>
        `;

        menu.innerHTML = optionsHtml;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        
        // 滑鼠移入效果
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
            menu.style.cssText = 'display:none; position:absolute; z-index:1000; background:white; border:1px solid #ccc; box-shadow:2px 2px 5px rgba(0,0,0,0.2); min-width:150px; border-radius:4px; padding:5px 0;';
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
        
        // 關閉選單
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
    
    // --- [新增] 統計功能 (防止呼叫時報錯) ---
    updateStats: function() {
        // 這裡可以實作 "每日預休人數" 的統計
        // 目前先留空，確保 init 不會報錯
        const statusEl = document.getElementById('matrixStatus');
        if(statusEl && this.data) {
            // 範例：顯示最後更新時間
            // statusEl.textContent = "已儲存";
        }
    }
};
