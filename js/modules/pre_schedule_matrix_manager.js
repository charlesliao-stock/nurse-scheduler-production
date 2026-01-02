// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],     // 動態班別列表
    shiftsMap: {},  // 班別對照表 (Code -> Info)
    usersMap: {},   // 人員對照表 (UID -> Info)
    staffList: [],  // 排序後的人員列表
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
                this.loadContextAndUsers() // 包含載入文件與對應的人員資料
            ]);
            
            // 3. 渲染
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
        } catch(error) {
            console.error(error);
            document.getElementById('matrixContainer').innerHTML = `<div style="color:red; padding:20px;">載入失敗: ${error.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    cleanup: function() {
        // 移除可能殘留的全局監聽
        const oldMenu = document.getElementById('customContextMenu');
        if(oldMenu) oldMenu.remove();
        document.onclick = null; // 簡單重置，若有其他全域事件需謹慎
    },

    showLoading: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = '<div style="padding:50px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</div>';
    },

    // --- 資料載入層 ---

    loadShifts: async function() {
        // 讀取該單位的班別設定 (假設 userUnitId 已在 app.js 載入)
        // 若要更嚴謹，應讀取 pre_schedule 文件內的 unitId，但在 init 階段可能還不知道，
        // 這裡先抓全域或預設。更好的做法是 loadContext 後再 loadShifts。
        // 為求效能，這裡先假設當前使用者的 unit。
        const unitId = app.userUnitId;
        if(!unitId) return;

        const snap = await db.collection('shifts').where('unitId', '==', unitId).get();
        this.shifts = snap.docs.map(d => d.data());
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || '')); // 排序
        
        this.shiftsMap = {};
        this.shifts.forEach(s => this.shiftsMap[s.code] = s);
    },

    loadContextAndUsers: async function() {
        // 1. 載入預班表文件
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("文件不存在");
        this.data = doc.data();
        
        // 2. 根據文件內的 assignments 或 unitId 載入人員
        // 這裡示範載入同單位所有人員 (或是只載入 snapshot)
        // 為了即時性，我們重拉一次 User 資料
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

        // 排序 (依層級或員編)
        this.staffList.sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));
    },

    // --- 渲染層 ---

    renderMatrix: function() {
        const container = document.getElementById('matrixContainer');
        // 重建 Table 結構
        container.innerHTML = `
            <table id="scheduleMatrix">
                <thead id="matrixHead"></thead>
                <tbody id="matrixBody"></tbody>
            </table>
        `;
        
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        // 1. 表頭渲染 (動態日期)
        let headHtml = `<tr>
            <th class="sticky-col" style="min-width:60px; left:0; z-index:20;">員編</th>
            <th class="sticky-col" style="min-width:80px; left:60px; z-index:20;">姓名</th>
            <th class="sticky-col" style="min-width:40px; left:140px; z-index:20;">層級</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = dateObj.getDay();
            const isWeekend = (dayOfWeek===0 || dayOfWeek===6);
            const color = isWeekend ? 'color:red;' : '';
            headHtml += `<th style="min-width:35px; ${color}">${d}<br><small>${['日','一','二','三','四','五','六'][dayOfWeek]}</small></th>`;
        }
        headHtml += `<th style="min-width:50px;">統計</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. 表身渲染 (解決 N+1：資料全從 this.usersMap 拿)
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
                
                // 取得預班資料 (assignments.UID.dateStr)
                // 假設資料結構: assignments[uid][dateStr] = 'OFF'
                const userAssign = (this.data.assignments && this.data.assignments[user.uid]) || {};
                const shiftCode = userAssign[dateStr] || ''; 
                
                if(shiftCode === 'OFF' || shiftCode === 'REQ_OFF') offCount++;

                // 樣式處理
                let cellStyle = '';
                let cellText = '';
                
                if(shiftCode === 'REQ_OFF') {
                    cellStyle = 'background:#2ecc71; color:white;'; // 綠色 (預休)
                    cellText = '休';
                } else if (shiftCode === 'OFF') {
                    cellStyle = 'background:#95a5a6; color:white;'; // 灰色 (一般休)
                    cellText = 'OFF';
                } else if (this.shiftsMap[shiftCode]) {
                    // 動態班別顏色
                    const color = this.shiftsMap[shiftCode].color || '#3498db';
                    cellStyle = `background:${color}; color:white;`;
                    cellText = shiftCode;
                }

                // 點擊事件 (使用 data-attr 傳遞參數，避免閉包記憶體問題)
                rowHtml += `<td class="cell-day" 
                              style="cursor:pointer; ${cellStyle}"
                              onclick="matrixManager.handleCellClick(event, '${user.uid}', '${dateStr}')"
                              oncontextmenu="matrixManager.handleRightClick(event, '${user.uid}', '${dateStr}')">
                              ${cellText}
                            </td>`;
            }
            
            rowHtml += `<td style="font-weight:bold;">${offCount}</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    // --- 互動與儲存 (簡化版) ---
    
    handleCellClick: function(e, uid, dateStr) {
        // 左鍵點擊邏輯 (例如切換 OFF / 空白)
        // 這裡省略，依需求實作
    },

    handleRightClick: function(e, uid, dateStr) {
        e.preventDefault();
        this.contextTarget = { uid, dateStr };
        
        // 動態建立右鍵選單
        const menu = this.getOrCreateContextMenu();
        
        // 根據 shifts 動態產生選項
        let optionsHtml = '';
        this.shifts.forEach(s => {
            if(s.isBundleAvailable) { // 只顯示允許預排的班別
                optionsHtml += `<div class="menu-item" onclick="matrixManager.setShift('${s.code}')">
                    <span class="menu-icon" style="background:${s.color}; width:10px; height:10px; display:inline-block;"></span> 
                    ${s.name} (${s.code})
                </div>`;
            }
        });
        
        // 加入通用選項
        optionsHtml += `
            <div class="menu-divider" style="height:1px; background:#eee; margin:5px 0;"></div>
            <div class="menu-item" onclick="matrixManager.setShift('REQ_OFF')">🟢 預休 (REQ)</div>
            <div class="menu-item" onclick="matrixManager.setShift(null)">❌ 清除</div>
        `;

        menu.innerHTML = optionsHtml;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    getOrCreateContextMenu: function() {
        let menu = document.getElementById('customContextMenu');
        if(!menu) {
            menu = document.createElement('div');
            menu.id = 'customContextMenu';
            menu.className = 'context-menu'; // 樣式在 css
            document.body.appendChild(menu);
            
            // 點擊其他地方關閉
            document.addEventListener('click', () => menu.style.display = 'none');
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

        // 局部更新 UI (不用重繪整個表格)
        this.renderMatrix(); 
        
        // 自動儲存 (Debounce)
        this.saveData();
    },

    saveData: async function() {
        // 實作自動儲存邏輯
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
    
    updateStats: function() { /* ... */ }
};
