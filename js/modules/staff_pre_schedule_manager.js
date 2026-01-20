// js/modules/staff_pre_schedule_manager.js
// 🔧 完整修正版：整合「預班填寫」與「勿排班別 (Avoid Shift)」功能

const staffPreScheduleManager = {
    docId: null,
    data: null,
    shifts: [],
    staffMap: {},
    userRequest: {}, 
    isReadOnly: false,
    selectedDay: null, // 記錄目前右鍵點擊的日子
    globalClickListener: null,
    
    // --- 1. 初始化與導航 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init:", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }

        this.cleanup(); // 清除舊的監聽器
        await this.loadData();
        await this.loadShifts();
        
        this.renderCalendar();
        this.updateStats();
        this.setupEvents();
        
        // 確保右鍵選單元素存在於 Body
        let menu = document.getElementById('staffContextMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'staffContextMenu';
            menu.className = 'context-menu'; // 需配合 CSS
            document.body.appendChild(menu);
        } else if (menu.parentElement !== document.body) {
            document.body.appendChild(menu);
        }
        
        console.log("✅ Staff Pre-Schedule 初始化完成");
    },

    cleanup: function() {
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('staffContextMenu');
        if (menu) menu.style.display = 'none';
    },

    // --- 2. 資料讀取 ---
    loadData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) { alert("找不到預班表"); return; }
        this.data = doc.data();
        
        const uid = app.currentUser.uid;
        
        // 讀取個人的預班資料 (若無則為空物件)
        this.userRequest = (this.data.assignments && this.data.assignments[uid]) || {};
        
        // 檢查是否鎖定 (狀態非 open 或已過期)
        this.isReadOnly = (this.data.status !== 'open');
        
        // 更新 UI 標題與狀態
        document.getElementById('staffPreTitle').innerText = `${this.data.year}年 ${this.data.month}月 預班表`;
        const statusBadge = document.getElementById('staffPreStatus');
        if (this.isReadOnly) {
            statusBadge.innerText = "唯讀 (已關閉)";
            statusBadge.className = "badge badge-secondary";
            const btn = document.getElementById('btnStaffSave');
            if(btn) btn.style.display = 'none';
        } else {
            statusBadge.innerText = "開放填寫中";
            statusBadge.className = "badge badge-success";
        }

        // 填入個人偏好設定 (包班、其他選項)
        const prefs = this.userRequest.preferences || {};
        const bundleSelect = document.getElementById('inputBundleShift');
        if(bundleSelect) bundleSelect.value = prefs.bundleShift || "";
    },

    loadShifts: async function() {
        try {
            const snapshot = await db.collection('shifts')
                .where('unitId', '==', this.data.unitId)
                .orderBy('startTime')
                .get();
            this.shifts = snapshot.docs.map(d => d.data());
            
            // 渲染包班下拉選單
            const bundleSelect = document.getElementById('inputBundleShift');
            if(bundleSelect) {
                // 保留第一項 "無"
                bundleSelect.innerHTML = '<option value="">無 (不包班)</option>';
                this.shifts.forEach(s => {
                    if(s.isBundleAvailable) {
                        bundleSelect.innerHTML += `<option value="${s.code}">${s.code} (${s.name})</option>`;
                    }
                });
                // 恢復選取狀態
                if(this.userRequest.preferences?.bundleShift) {
                    bundleSelect.value = this.userRequest.preferences.bundleShift;
                }
            }
        } catch(e) { console.error("Load Shifts Error:", e); }
    },

    // --- 3. 核心渲染：日曆視圖 ---
    renderCalendar: function() {
        const grid = document.getElementById('calendarGrid');
        if(!grid) return;
        
        grid.innerHTML = '';
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=週日

        // A. 星期標頭
        const weeks = ['日','一','二','三','四','五','六'];
        weeks.forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.innerText = w;
            grid.appendChild(div);
        });

        // B. 空白填充 (月初前)
        for(let i=0; i<firstDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        // C. 日期格子
        for(let d=1; d<=daysInMonth; d++) {
            const div = document.createElement('div');
            div.className = 'calendar-day';
            div.dataset.day = d;
            
            const dateObj = new Date(year, month - 1, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            if(isWeekend) div.classList.add('weekend');

            // 取得目前的設定值
            const key = `current_${d}`;
            const val = this.userRequest[key];
            
            // 構建顯示內容
            let content = '';
            if (val) {
                if (val === 'REQ_OFF') {
                    div.classList.add('selected', 'type-off');
                    content = '<div class="shift-badge off">休</div>';
                } else if (val.startsWith('!')) {
                    // [新增] 勿排班別 (例如 !N)
                    div.classList.add('selected', 'type-avoid');
                    const code = val.substring(1);
                    content = `<div class="shift-badge avoid">勿${code}</div>`;
                } else {
                    // 指定班別
                    div.classList.add('selected', 'type-shift');
                    content = `<div class="shift-badge shift">${val}</div>`;
                }
            }

            div.innerHTML = `
                <div class="day-number ${isWeekend?'holiday':''}">${d}</div>
                <div class="day-content" id="day-content-${d}">${content}</div>
            `;

            // 綁定事件
            if (!this.isReadOnly) {
                // 左鍵點擊：切換 休 -> 清除
                div.onclick = () => this.handleLeftClick(d);
                // 右鍵點擊：開啟完整選單
                div.oncontextmenu = (e) => this.handleRightClick(e, d);
            } else {
                div.classList.add('disabled');
            }

            grid.appendChild(div);
        }
    },

    // --- 4. 互動事件處理 ---

    handleLeftClick: function(day) {
        if(this.isReadOnly) return;
        
        const key = `current_${day}`;
        const currentVal = this.userRequest[key];

        // 簡易切換邏輯：空 -> 休 -> 空 (若要指定班別需用右鍵)
        if (!currentVal) {
            this.setShift(day, 'REQ_OFF');
        } else {
            this.setShift(day, null);
        }
    },

    handleRightClick: function(e, day) {
        e.preventDefault();
        if(this.isReadOnly) return;
        
        this.selectedDay = day; // 記住現在點的是哪一天
        const menu = document.getElementById('staffContextMenu');
        
        // 構建選單 HTML
        let html = `
            <div class="menu-header" style="padding:8px 12px; font-weight:bold; background:#f0f0f0; border-bottom:1px solid #ddd;">
                ${this.data.month}月${day}日 設定
            </div>
            <ul style="list-style:none; padding:0; margin:0;">
                <li onclick="staffPreScheduleManager.menuAction('REQ_OFF')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #eee;">
                    <i class="fas fa-bed" style="width:20px; color:#27ae60;"></i> 排休 (OFF)
                </li>
        `;
        
        // 1. 指定班別區
        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">指定班別</li>`;
        this.shifts.forEach(s => {
            html += `
                <li onclick="staffPreScheduleManager.menuAction('${s.code}')" style="padding:8px 12px; cursor:pointer;">
                    <span style="font-weight:bold; color:${s.color}">${s.code}</span> - ${s.name}
                </li>`;
        });

        // 2. [新增] 勿排班別區 (Avoid Shift)
        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">希望避開 (勿排)</li>`;
        this.shifts.forEach(s => {
            html += `
                <li onclick="staffPreScheduleManager.menuAction('!${s.code}')" style="padding:8px 12px; cursor:pointer; color:#c0392b;">
                    <i class="fas fa-ban" style="width:20px;"></i> 勿排 ${s.code}
                </li>`;
        });

        // 3. 清除
        html += `
            <li style="border-top:1px solid #eee;"></li>
            <li onclick="staffPreScheduleManager.menuAction(null)" style="padding:8px 12px; cursor:pointer; color:#7f8c8d;">
                <i class="fas fa-eraser" style="width:20px;"></i> 清除設定
            </li>
        </ul>`;

        menu.innerHTML = html;
        menu.style.display = 'block';
        
        // 計算位置防止超出螢幕
        let top = e.pageY;
        let left = e.pageX;
        if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
        if (top + menu.offsetHeight > window.innerHeight) top = window.innerHeight - menu.offsetHeight;
        
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    },

    // 選單點擊代理
    menuAction: function(val) {
        if(this.selectedDay !== null) {
            this.setShift(this.selectedDay, val);
        }
        document.getElementById('staffContextMenu').style.display = 'none';
    },

    setShift: function(day, val) {
        const key = `current_${day}`;
        if (val === null) {
            delete this.userRequest[key];
        } else {
            this.userRequest[key] = val;
        }
        
        // 局部更新 UI (不用重繪整個日曆)
        this.updateDayCell(day, val);
        this.updateStats();
    },

    // 更新單一格子的顯示
    updateDayCell: function(day, val) {
        const cell = document.querySelector(`.calendar-day[data-day="${day}"]`);
        const contentDiv = document.getElementById(`day-content-${day}`);
        if(!cell || !contentDiv) return;

        // 重置樣式
        cell.classList.remove('selected', 'type-off', 'type-shift', 'type-avoid');
        
        if (!val) {
            contentDiv.innerHTML = '';
        } else if (val === 'REQ_OFF') {
            cell.classList.add('selected', 'type-off');
            contentDiv.innerHTML = '<div class="shift-badge off">休</div>';
        } else if (val.startsWith('!')) {
            cell.classList.add('selected', 'type-avoid');
            const code = val.substring(1);
            contentDiv.innerHTML = `<div class="shift-badge avoid">勿${code}</div>`;
        } else {
            cell.classList.add('selected', 'type-shift');
            contentDiv.innerHTML = `<div class="shift-badge shift">${val}</div>`;
        }
    },

    updateStats: function() {
        const statsDiv = document.getElementById('staffStats');
        if(!statsDiv) return;

        let offCount = 0;
        let avoidCount = 0;
        let shiftCount = 0;

        Object.values(this.userRequest).forEach(v => {
            if(typeof v !== 'string') return;
            if(v === 'REQ_OFF') offCount++;
            else if(v.startsWith('!')) avoidCount++;
            else shiftCount++;
        });

        statsDiv.innerHTML = `
            <div><span class="badge badge-success">預休: ${offCount}</span></div>
            <div><span class="badge badge-primary">指定: ${shiftCount}</span></div>
            <div><span class="badge badge-danger">勿排: ${avoidCount}</span></div>
        `;
    },

    setupEvents: function() {
        // 全域點擊關閉選單 (點擊非選單區域時關閉)
        this.globalClickListener = (e) => {
            const menu = document.getElementById('staffContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);
    },

    // --- 5. 提交資料 ---
    saveRequest: async function() {
        if (!confirm("確定提交預班資料?")) return;
        try {
            const preferences = {};
            // 收集包班設定
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect) preferences.bundleShift = bundleSelect.value;
            
            // 收集其他可能的偏好輸入
            const selects = document.querySelectorAll('.pref-select');
            selects.forEach(sel => {
                const id = sel.id.replace('pref_', ''); 
                preferences[id] = sel.value;
            });

            const uid = app.currentUser.uid;
            
            // 使用 update key path 確保只更新該使用者的 assignments 欄位
            const updateKey = `assignments.${uid}`;
            const dataToSave = { 
                ...this.userRequest, 
                preferences: preferences,
                updatedAt: new Date().toISOString()
            };

            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: dataToSave
            });
            
            alert("提交成功!");
            // 成功後返回列表
            window.location.hash = '/staff/pre_schedule_list';
            
        } catch (e) { 
            console.error(e); 
            alert("提交失敗: " + e.message); 
        }
    }
};
