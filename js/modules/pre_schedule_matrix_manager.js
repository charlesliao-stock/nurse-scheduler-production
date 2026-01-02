// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
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
            // 1. 平行載入資料 (優化速度)
            await Promise.all([
                this.loadShifts(),
                this.loadContextAndUsers() 
            ]);
            
            // 2. 渲染畫面
            this.renderMatrix();
            this.updateStats(); // 恢復統計功能
            this.setupEvents(); // 修復事件綁定
            
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

    // --- 事件綁定 (修復 setupEvents is not a function 錯誤) ---
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

    // --- 資料載入 ---

    loadShifts: async function() {
        let unitId = app.userUnitId; 
        if(!unitId) return;

        const snap = await db.collection('shifts').where('unitId', '==', unitId).get();
        this.shifts = snap.docs.map(d => d.data());
        // 排序：讓常用的班別排前面
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || '')); 
        
        this.shiftsMap = {};
        this.shifts.forEach(s => this.shiftsMap[s.code] = s);
    },

    loadContextAndUsers: async function() {
        // 1. 載入預班表
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("文件不存在");
        this.data = doc.data();
        
        // 確保 shifts 載入正確的單位 (如果管理員跨單位查看)
        if (this.shifts.length === 0 || (this.shifts[0] && this.shifts[0].unitId !== this.data.unitId)) {
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

        // 依員編排序
        this.staffList.sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));
    },

    // --- 渲染與互動 ---

    renderMatrix: function() {
        const container = document.getElementById('matrixContainer');
        if(!container) return;

        // 還原您習慣的版面高度設定
        container.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 140px); border:1px solid #ddd; position:relative;">
                <table id="scheduleMatrix" style="width:100%; border-collapse: separate; border-spacing: 0;">
                    <thead id="matrixHead" style="position:sticky; top:0; z-index:30;"></thead>
                    <tbody id="matrixBody"></tbody>
                    <tfoot id="matrixFoot" style="position:sticky; bottom:0; z-index:30; background:#f9f9f9; border-top:2px solid #ddd;"></tfoot>
                </table>
            </div>
        `;
        
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot'); // 恢復頁尾統計
        
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        // 1. 表頭渲染
        let headHtml = `<tr style="background:#f8f9fa;">
            <th class="sticky-col" style="min-width:60px; left:0; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:31; border-right:1px solid #ddd; border-bottom:1px solid #ddd; padding:8px;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:31; border-right:2px solid #ccc; border-bottom:1px solid #ddd; padding:8px;">層級</th>`;
        
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

        // 2. 表身渲染
        if (this.staffList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${daysInMonth + 4}" style="padding:20px; text-align:center;">無人員資料</td></tr>`;
            return;
        }

        this.staffList.forEach(user => {
            const tr = document.createElement('tr');
            
            // 固定欄位 (左側資訊)
            let rowHtml = `
                <td class="sticky-col" style="left:0; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.employeeId}</td>
                <td class="sticky-col" style="left:60px; background:#fff; border-right:1px solid #ddd; border-bottom:1px solid #eee; padding:5px;">${user.displayName}</td>
                <td class="sticky-col" style="left:140px; background:#fff; border-right:2px solid #ccc; border-bottom:1px solid #eee; padding:5px;">${user.level}</td>
            `;

            // 日期欄位
            let offCount = 0;
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                
                const userAssign = (this.data.assignments && this.data.assignments[user.uid]) || {};
                const shiftCode = userAssign[dateStr] || ''; 
                
                if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

                let cellStyle = 'border-right:1px solid #eee; border-bottom:1px solid #eee; cursor:pointer; text-align:center;';
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

                // 恢復：左鍵點擊切換，右鍵選單
                rowHtml += `<td class="cell-day" 
                              style="${cellStyle}"
                              onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dateStr}')"
                              oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dateStr}')">
                              ${cellText}
                            </td>`;
            }
            
            rowHtml += `<td style="font-weight:bold; text-align:center; border-bottom:1px solid #eee;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });

        // 3. 頁尾統計 (恢復您原本的功能：人力供需 A/B)
        // A = 需求 (Daily Need), B = 目前人數 (Available)
        if (tfoot) {
            let footHtml = `<tr>
                <td class="sticky-col" colspan="3" style="left:0; background:#f9f9f9; border-top:2px solid #ddd; border-right:2px solid #ccc; padding:8px; text-align:right; font-weight:bold;">
                    人力供需 (需/現)
                </td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                // 簡易計算：假設每日需求固定為 X (這裡先暫時顯示目前排班人數)
                // 實際上應讀取 rules.dailyNeeds
                // 這裡我們顯示：有排班的人數 (Supply)
                
                let supply = 0;
                this.staffList.forEach(u => {
                    const code = (this.data.assignments?.[u.uid]?.[dateStr]);
                    if(code && code !== 'OFF' && code !== 'REQ_OFF') supply++;
                });

                // 假設需求 (可從 rules 讀取，這裡暫時留空或顯示 supply)
                footHtml += `<td style="text-align:center; font-size:0.85rem; color:#666; border-right:1px solid #eee; padding:5px;">
                    - / ${supply}
                </td>`;
            }
            footHtml += `<td></td></tr>`;
            tfoot.innerHTML = footHtml;
        }
    },

    // --- 統計更新 (保留介面) ---
    updateStats: function() {
        // 因為已經在 renderMatrix 的 tfoot 處理了，這裡可以做額外的計算
    },

    // --- 互動邏輯 ---
    
    handleCellClick: function(e, uid, dateStr) {
        // 左鍵點擊： 空 -> OFF -> 空 (符合您要求的預設 OFF)
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
        
        // 班別選項 (可預排的班別)
        if (this.shifts.length > 0) {
            this.shifts.forEach(s => {
                if(s.isBundleAvailable) { // 只顯示可包班/預排的班別
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
        
        // 防止選單超出視窗
        const x = Math.min(e.pageX, window.innerWidth - 180);
        const y = Math.min(e.pageY, window.innerHeight - 250);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        // Hover 樣式
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
    }
};
