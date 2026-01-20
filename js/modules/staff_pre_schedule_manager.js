// js/modules/staff_pre_schedule_manager.js
// 🔧 全功能修復版：補回限制檢查、人數統計、人員名單顯示

const staffPreScheduleManager = {
    docId: null,
    data: null,       // 預班表主檔
    userData: null,   // 個人資料
    allUsersMap: {},  // UID -> Name 對照表 (用於顯示誰休假)
    shifts: [],
    
    // 資料狀態
    userRequest: {},      // 我的預班
    allAssignments: {},   // 所有人的預班 (用於統計)
    
    // 規則與限制
    rules: {
        maxOff: 0,        // 每月最大預休數
        maxHoliday: 0,    // 假日數 (參考用)
        dailyLimit: 0     // 每日預休上限 (若有設定)
    },
    
    // UI 狀態
    isReadOnly: false,
    selectedDay: null,
    globalClickListener: null,
    
    // --- 1. 初始化 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init (Full):", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }

        this.cleanup();
        
        // 顯示載入中
        document.getElementById('calendarGrid').innerHTML = '<div style="padding:20px; text-align:center;">資料載入中...</div>';

        try {
            // 平行載入所有必要資料
            await Promise.all([
                this.loadData(),        // 載入預班表 (含所有 assignments)
                this.loadUserProfile(), // 載入個人權限
                this.loadAllUserNames(),// 載入所有人名 (顯示名單用)
                this.loadShifts()       // 載入班別
            ]);
            
            this.parseRules();         // 解析規則
            this.renderCalendar();     // 渲染日曆
            this.renderSidebar();      // 渲染側邊欄(偏好)
            this.updateSidebarStats(); // 更新統計數據
            this.setupEvents();
            this.initContextMenu();

        } catch (e) {
            console.error("Init Error:", e);
            alert("初始化失敗：" + e.message);
        }
    },

    cleanup: function() {
        if(this.globalClickListener) document.removeEventListener('click', this.globalClickListener);
        const menu = document.getElementById('staffContextMenu');
        if (menu) menu.style.display = 'none';
    },

    initContextMenu: function() {
        let menu = document.getElementById('staffContextMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'staffContextMenu';
            menu.className = 'context-menu';
            document.body.appendChild(menu);
        } else if (menu.parentElement !== document.body) {
            document.body.appendChild(menu);
        }
    },

    // --- 2. 資料載入 ---
    
    loadData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("找不到預班表");
        this.data = doc.data();
        
        const uid = app.currentUser.uid;
        
        // 取得所有人的資料 (用於統計)
        this.allAssignments = this.data.assignments || {};
        // 取得自己的資料 (用於編輯)
        this.userRequest = (this.allAssignments[uid]) ? JSON.parse(JSON.stringify(this.allAssignments[uid])) : {};
        
        // 檢查狀態
        this.isReadOnly = (this.data.status !== 'open');
        
        // UI 標題更新
        document.getElementById('staffPreTitle').innerText = `${this.data.year}年 ${this.data.month}月 預班表`;
        const statusBadge = document.getElementById('staffPreStatus');
        const saveBtn = document.getElementById('btnStaffSave');
        
        if (this.isReadOnly) {
            statusBadge.innerText = "唯讀 (已關閉)";
            statusBadge.className = "badge badge-secondary";
            if(saveBtn) saveBtn.style.display = 'none';
        } else {
            statusBadge.innerText = "開放填寫中";
            statusBadge.className = "badge badge-success";
            if(saveBtn) saveBtn.style.display = 'inline-block';
        }
    },

    loadUserProfile: async function() {
        const uid = app.currentUser.uid;
        const doc = await db.collection('users').doc(uid).get();
        this.userData = doc.exists ? doc.data() : { schedulingParams: {} };
    },

    // [關鍵] 載入單位所有人員名稱，以便顯示 "誰也休假"
    loadAllUserNames: async function() {
        if(!this.data.unitId) return;
        // 為了效能，只撈取該單位的 user
        const snap = await db.collection('users')
            .where('unitId', '==', this.data.unitId)
            .get();
            
        this.allUsersMap = {};
        snap.forEach(doc => {
            const d = doc.data();
            this.allUsersMap[doc.id] = d.displayName || d.name || '同仁';
        });
    },

    loadShifts: async function() {
        if(!this.data.unitId) return;
        const snapshot = await db.collection('shifts')
            .where('unitId', '==', this.data.unitId)
            .orderBy('startTime')
            .get();
        this.shifts = snapshot.docs.map(d => d.data());
    },

    parseRules: function() {
        // 從 pre_schedule 資料中讀取規則，若無則用預設值
        const settings = this.data.settings || {};
        
        // 1. 每月最大預休天數
        this.rules.maxOff = parseInt(settings.maxPreScheduleOff) || 100; // 預設寬鬆
        
        // 2. 假日天數 (用於參考)
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        let holidays = 0;
        for(let d=1; d<=daysInMonth; d++) {
            const day = new Date(year, month-1, d).getDay();
            if(day === 0 || day === 6) holidays++;
        }
        this.rules.maxHoliday = holidays;
        
        // 3. 每日預休上限 (例如每天最多 3 人預休)
        this.rules.dailyLimit = parseInt(settings.maxDailyOff) || 0; // 0 代表不限
    },

    // --- 3. 渲染邏輯 ---

    renderSidebar: function() {
        // 1. 包班選項
        const bundleSelect = document.getElementById('inputBundleShift');
        const bundleSection = document.getElementById('bundleSection');
        if (bundleSelect) {
            const canBundle = this.userData?.schedulingParams?.canBundleShifts === true;
            if (canBundle) {
                let options = '<option value="">無 (不包班)</option>';
                this.shifts.forEach(s => {
                    if (s.isBundleAvailable) options += `<option value="${s.code}">${s.code} (${s.name})</option>`;
                });
                bundleSelect.innerHTML = options;
                bundleSelect.disabled = this.isReadOnly;
                if (this.userRequest.preferences?.bundleShift) bundleSelect.value = this.userRequest.preferences.bundleShift;
                if(bundleSection) bundleSection.style.display = 'block';
            } else {
                bundleSelect.innerHTML = '<option value="">未開放包班</option>';
                bundleSelect.disabled = true;
            }
        }
        
        // 2. 偏好班別 (若有容器)
        const prefList = document.getElementById('prefList');
        if (prefList) {
            const savedPref = this.userRequest.preferences?.favShift || '';
            prefList.innerHTML = `
                <div class="form-group" style="margin-top:15px;">
                    <label style="font-weight:bold; color:#2c3e50;">偏好主要班別</label>
                    <select id="pref_favShift" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${this.shifts.map(s => `<option value="${s.code}" ${savedPref===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                <hr>
                <div id="dayDetailPanel" style="color:#666; font-size:0.9rem;">
                    <p>請點擊左側日曆查看當日詳情</p>
                </div>
            `;
        }
    },

    renderCalendar: function() {
        const grid = document.getElementById('calendarGrid');
        if(!grid) return;
        
        grid.innerHTML = '';
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); 

        // 標頭
        ['日','一','二','三','四','五','六'].forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.innerText = w;
            grid.appendChild(div);
        });

        // 空白
        for(let i=0; i<firstDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        // 日子
        for(let d=1; d<=daysInMonth; d++) {
            const div = document.createElement('div');
            div.className = 'calendar-day';
            div.dataset.day = d;
            
            const dateObj = new Date(year, month - 1, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            if(isWeekend) div.classList.add('weekend');

            // 我的設定
            const key = `current_${d}`;
            const myVal = this.userRequest[key];
            
            // [新增] 統計當日預休人數
            const offCount = this.calculateDailyOffCount(d);
            const isFull = (this.rules.dailyLimit > 0 && offCount >= this.rules.dailyLimit);

            let content = '';
            if (myVal) {
                if (myVal === 'REQ_OFF') {
                    div.classList.add('selected', 'type-off');
                    content = '<div class="shift-badge off">休</div>';
                } else if (myVal.startsWith('!')) {
                    div.classList.add('selected', 'type-avoid');
                    const code = myVal.substring(1);
                    content = `<div class="shift-badge avoid">勿${code}</div>`;
                } else {
                    div.classList.add('selected', 'type-shift');
                    content = `<div class="shift-badge shift">${myVal}</div>`;
                }
            }

            // [新增] 顯示統計 Badge
            let statsHtml = '';
            if (offCount > 0) {
                const color = isFull ? 'red' : '#95a5a6';
                statsHtml = `<div class="day-stats" style="color:${color};"><i class="fas fa-user-clock"></i> ${offCount}</div>`;
            }

            div.innerHTML = `
                <div class="day-number ${isWeekend?'holiday':''}">${d}</div>
                <div class="day-content" id="day-content-${d}">${content}</div>
                ${statsHtml}
            `;

            if (!this.isReadOnly) {
                // 左鍵：顯示詳情
                div.onclick = () => this.handleLeftClick(d);
                // 右鍵：設定
                div.oncontextmenu = (e) => this.handleRightClick(e, d);
            } else {
                div.classList.add('disabled');
            }

            grid.appendChild(div);
        }
    },

    // 計算某天有多少人預休 (REQ_OFF)
    calculateDailyOffCount: function(day) {
        let count = 0;
        const key = `current_${day}`;
        // 遍歷所有人的資料
        Object.values(this.allAssignments).forEach(assign => {
            if (assign[key] === 'REQ_OFF') count++;
        });
        // 記得把自己目前的暫存也算進去 (或修正)
        // 這裡採用: 顯示的是「資料庫裡的狀態」 + 「我自己目前的變更」
        // 為了簡化，顯示資料庫的狀態為主，自己的狀態透過 UI 呈現
        return count;
    },

    // 取得某天預休的人員名單
    getDailyOffNames: function(day) {
        const names = [];
        const key = `current_${day}`;
        Object.keys(this.allAssignments).forEach(uid => {
            if (this.allAssignments[uid][key] === 'REQ_OFF') {
                const name = this.allUsersMap[uid] || '未知';
                // 如果是自己，標註一下
                if(uid === app.currentUser.uid) names.push(`${name}(我)`);
                else names.push(name);
            }
        });
        return names;
    },

    // --- 4. 互動事件 ---

    // 左鍵：選中日期，並在側邊欄顯示詳情
    handleLeftClick: function(day) {
        // 移除其他選中樣式
        document.querySelectorAll('.calendar-day.focused').forEach(el => el.classList.remove('focused'));
        const cell = document.querySelector(`.calendar-day[data-day="${day}"]`);
        if(cell) cell.classList.add('focused');

        this.updateDayDetailSidebar(day);
    },

    // 更新側邊欄的當日詳情
    updateDayDetailSidebar: function(day) {
        const panel = document.getElementById('dayDetailPanel');
        if(!panel) return;

        const offNames = this.getDailyOffNames(day);
        const count = offNames.length;
        const limit = this.rules.dailyLimit > 0 ? ` / ${this.rules.dailyLimit}` : '';
        
        let html = `
            <div style="background:#f8f9fa; padding:10px; border-radius:4px; margin-top:10px;">
                <h5 style="margin:0 0 10px 0; border-bottom:1px solid #ddd; padding-bottom:5px;">
                    ${this.data.month}月${day}日 詳情
                </h5>
                <div style="margin-bottom:5px;">
                    <strong>預休人數：</strong> 
                    <span style="color:${(this.rules.dailyLimit>0 && count>=this.rules.dailyLimit)?'red':'green'} font-weight:bold;">
                        ${count}${limit}
                    </span>
                </div>
        `;

        if (count > 0) {
            html += `<div style="font-size:0.85rem; color:#555;"><strong>名單：</strong><br>`;
            html += offNames.join('、');
            html += `</div>`;
        } else {
            html += `<div style="color:#999; font-size:0.85rem;">尚無人預休</div>`;
        }
        
        html += `</div>`;
        panel.innerHTML = html;
    },

    handleRightClick: function(e, day) {
        e.preventDefault();
        if(this.isReadOnly) return;
        
        // 自動選中該日
        this.handleLeftClick(day);

        this.selectedDay = day;
        const menu = document.getElementById('staffContextMenu');
        
        let html = `
            <div class="menu-header" style="padding:8px 12px; font-weight:bold; background:#f0f0f0; border-bottom:1px solid #ddd;">
                設定 ${this.data.month}/${day}
            </div>
            <ul style="list-style:none; padding:0; margin:0;">
                <li onclick="staffPreScheduleManager.menuAction('REQ_OFF')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #eee;">
                    <i class="fas fa-bed" style="width:20px; color:#27ae60;"></i> 排休 (OFF)
                </li>
        `;
        
        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">指定班別</li>`;
        this.shifts.forEach(s => {
            html += `
                <li onclick="staffPreScheduleManager.menuAction('${s.code}')" style="padding:8px 12px; cursor:pointer;">
                    <span style="font-weight:bold; color:${s.color}">${s.code}</span> - ${s.name}
                </li>`;
        });

        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">希望避開 (勿排)</li>`;
        this.shifts.forEach(s => {
            html += `
                <li onclick="staffPreScheduleManager.menuAction('!${s.code}')" style="padding:8px 12px; cursor:pointer; color:#c0392b;">
                    <i class="fas fa-ban" style="width:20px;"></i> 勿排 ${s.code}
                </li>`;
        });

        html += `
            <li style="border-top:1px solid #eee;"></li>
            <li onclick="staffPreScheduleManager.menuAction(null)" style="padding:8px 12px; cursor:pointer; color:#7f8c8d;">
                <i class="fas fa-eraser" style="width:20px;"></i> 清除設定
            </li>
        </ul>`;

        menu.innerHTML = html;
        menu.style.display = 'block';
        
        let top = e.pageY;
        let left = e.pageX;
        if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
        if (top + menu.offsetHeight > window.innerHeight) top = window.innerHeight - menu.offsetHeight;
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    },

    menuAction: function(val) {
        if(this.selectedDay !== null) this.setShift(this.selectedDay, val);
        document.getElementById('staffContextMenu').style.display = 'none';
    },

    // [關鍵] 設定班別並檢查限制
    setShift: function(day, val) {
        const key = `current_${day}`;
        
        // 1. 檢查每人每月預休上限
        if (val === 'REQ_OFF') {
            const currentOffs = this.countMyOffs();
            const oldValue = this.userRequest[key];
            // 如果原本不是 OFF，現在要改成 OFF，則計數+1
            if (oldValue !== 'REQ_OFF' && currentOffs >= this.rules.maxOff) {
                alert(`無法預休：您本月預休已達上限 (${this.rules.maxOff} 天)`);
                return;
            }
        }

        // 2. 檢查每日預休上限 (軟性檢查)
        if (val === 'REQ_OFF') {
             const dayCount = this.calculateDailyOffCount(day);
             if (this.rules.dailyLimit > 0 && dayCount >= this.rules.dailyLimit) {
                 if(!confirm(`警告：當日預休人數 (${dayCount}人) 已達建議上限。確定要繼續排休嗎？`)) {
                     return;
                 }
             }
        }

        // 執行更新
        if (val === null) delete this.userRequest[key];
        else this.userRequest[key] = val;
        
        this.updateDayCell(day, val);
        this.updateSidebarStats();
        // 如果側邊欄正在顯示這一天，也要更新詳情
        if (document.querySelector(`.calendar-day[data-day="${day}"]`).classList.contains('focused')) {
            this.updateDayDetailSidebar(day);
        }
    },

    countMyOffs: function() {
        let count = 0;
        Object.values(this.userRequest).forEach(v => {
            if(v === 'REQ_OFF') count++;
        });
        return count;
    },

    updateDayCell: function(day, val) {
        const cell = document.querySelector(`.calendar-day[data-day="${day}"]`);
        const contentDiv = document.getElementById(`day-content-${day}`);
        if(!cell || !contentDiv) return;

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

    updateSidebarStats: function() {
        const statsDiv = document.getElementById('staffStats');
        if(!statsDiv) return;

        const offCount = this.countMyOffs();
        let avoidCount = 0;
        let shiftCount = 0;

        Object.values(this.userRequest).forEach(v => {
            if(typeof v !== 'string') return;
            if(v.startsWith('!')) avoidCount++;
            else if (v !== 'REQ_OFF') shiftCount++;
        });

        // 顯示統計與限制
        statsDiv.innerHTML = `
            <div style="margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
                <div style="display:flex; justify-content:space-between;">
                    <span>預休天數:</span>
                    <span style="font-weight:bold; ${offCount>this.rules.maxOff?'color:red':''}">${offCount} / ${this.rules.maxOff}</span>
                </div>
                <div style="font-size:0.8rem; color:#999;">(假日共 ${this.rules.maxHoliday} 天)</div>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <span class="badge badge-primary">指定: ${shiftCount}</span>
                <span class="badge badge-danger">勿排: ${avoidCount}</span>
            </div>
        `;
    },

    setupEvents: function() {
        this.globalClickListener = (e) => {
            const menu = document.getElementById('staffContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) menu.style.display = 'none';
            }
        };
        document.addEventListener('click', this.globalClickListener);
    },

    saveRequest: async function() {
        if (!confirm("確定提交預班資料?")) return;
        try {
            const preferences = {};
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect && !bundleSelect.disabled) preferences.bundleShift = bundleSelect.value;
            
            const selects = document.querySelectorAll('.pref-select');
            selects.forEach(sel => {
                const id = sel.id.replace('pref_', ''); 
                preferences[id] = sel.value;
            });

            const uid = app.currentUser.uid;
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
            window.location.hash = '/staff/pre_schedule_list';
            
        } catch (e) { 
            console.error(e); 
            alert("提交失敗: " + e.message); 
        }
    }
};
