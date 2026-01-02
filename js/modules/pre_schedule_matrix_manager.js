// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],     // 動態班別列表
    shiftsMap: {},  // 班別對照表
    usersMap: {},   // 人員對照表
    staffList: [],  // 排序後的人員列表
    contextTarget: null, // 右鍵選單目標
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少文件 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        // 1. UI 初始化
        this.showLoading();
        this.cleanup(); 

        try {
            // 2. 平行載入資料
            await Promise.all([
                this.loadShifts(),
                this.loadContextAndUsers() 
            ]);
            
            // 3. 渲染
            this.renderMatrix();
            this.updateStats();
            this.setupEvents(); 
            
            // 設定標題
            const titleEl = document.getElementById('matrixTitle');
            if(titleEl && this.data) {
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

    setupEvents: function() {
        document.onclick = (e) => {
            const menu = document.getElementById('customContextMenu');
            if(menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
    },

    // --- 資料載入層 ---

    loadShifts: async function() {
        // [修正] 改為讀取 app.userUnitId，若無則嘗試從 url 或 data 讀取，這裡先設為防呆
        let unitId = app.userUnitId; 
        
        // 如果是管理員正在看別人的預班表，這裡的 logic 可能要改為讀取 doc 後再 load shifts
        // 但為了平行載入，我們先容錯。若 shift 沒載到，稍後 render 會顯示代碼而已。
        if(!unitId) return;

        const snap = await db.collection('shifts').where('unitId', '==', unitId).get();
        this.shifts = snap.docs.map(d => d.data());
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || '')); 
        
        this.shiftsMap = {};
        this.shifts.forEach(s => this.shiftsMap[s.code] = s);
    },

    loadContextAndUsers: async function() {
        // 1. 載入預班表
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("文件不存在");
        this.data = doc.data();
        
        // [修正] 確保 shifts 正確載入 (如果剛剛平行載入是用錯的 unitId)
        if (this.shifts.length === 0 || this.shifts[0].unitId !== this.data.unitId) {
            console.log("Reloading shifts for unit:", this.data.unitId);
            const shiftSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
            this.shifts = shiftSnap.docs.map(d => d.data());
            this.shiftsMap = {};
            this.shifts.forEach(s => this.shiftsMap[s.code] = s);
        }

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

        // [修正] 這裡的高度設為 auto 或計算值，避免被切掉
        container.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 140px); border:1px solid #ddd;">
                <table id="scheduleMatrix" style="width:100%; border-collapse: separate; border-spacing: 0;">
                    <thead id="matrixHead" style="position:sticky; top:0; z-index:30;"></thead>
                    <tbody id="matrixBody"></tbody>
                </table>
            </div>
        `;
        
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        // 1. 表頭
        let headHtml = `<tr style="background:#f8f9fa;">
            <th class="sticky-col" style="min-width:60px; left:0; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">層級</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = dateObj.getDay();
            const isWeekend = (dayOfWeek===0 || dayOfWeek===6);
            const color = isWeekend ? 'color:red;' : 'color:#333;';
            const bg = isWeekend ? 'background:#fff0f0;' : 'background:#f8f9fa;';
            const dayName = ['日','一','二','三','四','五','六'][dayOfWeek];
            
            headHtml += `<th style="min-width:35px; text-align:center; ${color} ${bg} border-right:1px solid #eee; border-bottom:1px solid #ddd; padding:5px;">
                            ${d}<br><small>${dayName}</small>
                         </th>`;
        }
        headHtml += `<th style="min-width:50px; border-bottom:1px solid #ddd; padding:8px;">OFF數</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. 表身
        if (this.staffList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${daysInMonth + 4}" style="padding:20px; text-align:center;">無人員資料</td></tr>`;
            return;
        }

        this.staffList.forEach(user => {
            const tr = document.createElement('tr');
            
            // 固定欄位
            let rowHtml = `
                <td class="sticky-col" style="left:0; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.employeeId}</td>
                <td class="sticky-col" style="left:60px; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.displayName}</td>
                <td class="sticky-col" style="left:140px; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.level}</td>
            `;

            // 日期欄位
            let offCount = 0;
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                
                // [修正] 安全存取 assignments
                const userAssign = (this.data.assignments && this.data.assignments[user.uid]) || {};
                const shiftCode = userAssign[dateStr] || ''; 
                
                if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

                let cellStyle = 'border-right:1px solid #eee; border-bottom:1px solid #eee;';
                let cellText = '';
                
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

                rowHtml += `<td class="cell-day" 
                              style="cursor:pointer; text-align:center; ${cellStyle}"
                              onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dateStr}')"
                              oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dateStr}')">
                              ${cellText}
                            </td>`;
            }
            
            rowHtml += `<td style="font-weight:bold; text-align:center; border-bottom:1px solid #eee;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    // --- 互動層 ---
    
    handleCellClick: function(e, uid, dateStr) {
        if(!this.data.assignments) this.data.assignments = {};
        if(!this.data.assignments[uid]) this.data.assignments[uid] = {};

        const current = this.data.assignments[uid][dateStr];
        
        // 簡單切換邏輯： 空 -> REQ_OFF -> 空
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
        
        // 動態班別選項
        if (this.shifts.length > 0) {
            this.shifts.forEach(s => {
                // 只有設定為「可包班」或「可預排」的班別才顯示 (這裡假設全部都顯示)
                optionsHtml += `<div class="menu-item" onclick="matrixManager.setShift('${s.code}')" style="padding:8px 15px; cursor:pointer; display:flex; align-items:center; gap:8px;">
                    <span style="background:${s.color}; width:12px; height:12px; display:inline-block; border-radius:2px;"></span> 
                    ${s.name} (${s.code})
                </div>`;
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
        
        // 防止選單超出視窗
        const x = Math.min(e.pageX, window.innerWidth - 160);
        const y = Math.min(e.pageY, window.innerHeight - 200);
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
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
    
    updateStats: function() {
        // 保留介面，暫無實作
    }
};
