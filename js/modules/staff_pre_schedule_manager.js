// js/modules/staff_pre_schedule_manager.js
// 🔧 最終完美版：初始化修復 + 完整統計功能 (人數/名單/紅框/橘框)

const staffPreScheduleManager = {
    docId: null,
    data: null,       
    userData: null,   
    allUsersMap: {},  
    shifts: [],
    
    // 資料狀態
    userRequest: {},      // 我的預班 (編輯中)
    allAssignments: {},   // 所有人的預班 (唯讀，用於統計)
    
    // 規則與限制
    rules: {
        maxOff: 8,         // 每月最大預休數
        maxHoliday: 8,     // 假日數
        dailyLimit: 2,     // 每日預休上限
        showNames: true    // 是否顯示名單
    },
    
    isReadOnly: false,
    selectedDay: null,
    globalClickListener: null,
    
    // --- 1. 初始化 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init (Final Fix):", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }
        this.cleanup();
        
        const grid = document.getElementById('calendarGrid');
        if(grid) grid.innerHTML = '<div style="padding:20px; text-align:center;">資料載入中...</div>';

        try {
            // [關鍵 1] 必須先載入主檔，確保取得 unitId 與 assignments
            await this.loadData(); 

            // [關鍵 2] 有了 unitId 後，才能並行載入其他資料
            await Promise.all([
                this.loadUserProfile(), 
                this.loadAllUserNames(), // 用於顯示 Tooltip 名單
                this.loadShifts()
            ]);
            
            this.parseRules();         
            this.renderSidebar();      
            this.renderCalendar();     // [關鍵] 這裡會渲染紅框/橘框
            this.updateSidebarStats(); 
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
        // [重要] 取得所有人的資料，用於計算當日已休人數
        this.allAssignments = this.data.assignments || {};
        
        // 深拷貝自己的資料，作為編輯中的狀態
        this.userRequest = (this.allAssignments[uid]) ? JSON.parse(JSON.stringify(this.allAssignments[uid])) : {};
        
        this.isReadOnly = (this.data.status !== 'open');
        
        // UI 更新
        const titleEl = document.getElementById('staffPreTitle');
        if(titleEl) titleEl.innerText = `${this.data.year}年 ${this.data.month}月 預班表`;
        
        const statusBadge = document.getElementById('staffPreStatus');
        const saveBtn = document.getElementById('btnStaffSave');
        
        if (statusBadge) {
            if (this.isReadOnly) {
                statusBadge.innerText = "唯讀 (已關閉)";
                statusBadge.className = "badge badge-secondary";
                if(saveBtn) saveBtn.style.display = 'none';
            } else {
                statusBadge.innerText = "開放填寫中";
                statusBadge.className = "badge badge-success";
                if(saveBtn) saveBtn.style.display = 'inline-block';
            }
        }
    },

    loadUserProfile: async function() {
        const uid = app.currentUser.uid;
        const doc = await db.collection('users').doc(uid).get();
        this.userData = doc.exists ? doc.data() : { schedulingParams: {} };
    },

    loadAllUserNames: async function() {
        if(!this.data || !this.data.unitId) return;
        const snap = await db.collection('users').where('unitId', '==', this.data.unitId).get();
        this.allUsersMap = {};
        snap.forEach(doc => {
            const d = doc.data();
            this.allUsersMap[doc.id] = d.displayName || d.name || '同仁';
        });
    },

    loadShifts: async function() {
        if(!this.data || !this.data.unitId) return;
        const snapshot = await db.collection('shifts')
            .where('unitId', '==', this.data.unitId)
            .orderBy('startTime')
            .get();
        this.shifts = snapshot.docs.map(d => d.data());
    },

    parseRules: function() {
        const settings = this.data.settings || {};
        this.rules.maxOff = parseInt(settings.maxPreScheduleOff) || 8;
        this.rules.dailyLimit = parseInt(settings.maxDailyOff) || 0; // 0 為不限
        this.rules.showNames = (settings.privacyShowNames !== false); 
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        let holidays = 0;
        for(let d=1; d<=daysInMonth; d++) {
            const day = new Date(year, month-1, d).getDay();
            if(day === 0 || day === 6) holidays++;
        }
        this.rules.maxHoliday = holidays;
    },

    // --- 3. 渲染側邊欄 ---
    renderSidebar: function() {
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
            `;
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
            else if (v !== 'REQ_OFF' && !v.startsWith('preference')) shiftCount++;
        });

        // 超額紅字邏輯
        const isOverLimit = offCount > this.rules.maxOff;
        const offColor = isOverLimit ? '#e74c3c' : '#2c3e50';

        statsDiv.innerHTML = `
            <div style="margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
                <div style="display:flex; justify-content:space-between;">
                    <span>已預休天數:</span>
                    <span style="font-weight:bold; color:${offColor};">${offCount} / ${this.rules.maxOff}</span>
                </div>
                <div style="font-size:0.8rem; color:#999;">(本月假日共 ${this.rules.maxHoliday} 天)</div>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <span class="badge badge-primary">指定: ${shiftCount}</span>
                <span class="badge badge-danger">勿排: ${avoidCount}</span>
            </div>
        `;
    },

    // --- 4. 核心渲染：日曆視圖 (含統計、名單、顏色) ---
    renderCalendar: function() {
        const grid = document.getElementById('calendarGrid');
        if(!grid) return;
        
        grid.innerHTML = '';
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); 

        ['日','一','二','三','四','五','六'].forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.innerText = w;
            grid.appendChild(div);
        });

        for(let i=0; i<firstDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        for(let d=1; d<=daysInMonth; d++) {
            const div = document.createElement('div');
            div.className = 'calendar-day';
            div.dataset.day = d;
            
            const dateObj = new Date(year, month - 1, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            if(isWeekend) div.classList.add('weekend');

            // --- [恢復] 統計與名單計算邏輯 ---
            // 1. 計算該日預休人數 (資料庫別人 + 我目前的修改)
            const offCount = this.calculateDailyOffCount(d);
            const limit = this.rules.dailyLimit;
            const isFull = (limit > 0 && offCount >= limit);
            
            // 2. 決定邊框顏色 (Orange: 充足, Red: 滿了)
            if (limit > 0) {
                if (isFull) div.classList.add('quota-full');      
                else div.classList.add('quota-available');        
            }

            // 3. Tooltip (顯示姓名)
            let tooltipText = `預休: ${offCount} 人`;
            if (this.rules.showNames && offCount > 0) {
                const names = this.getDailyOffNames(d);
                if (names.length > 0) {
                    tooltipText += `\n名單: ${names.join(', ')}`;
                }
            }
            div.title = tooltipText;

            // --- 內容渲染 ---
            const key = `current_${d}`;
            const myVal = this.userRequest[key];
            
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

            // 4. 右下角統計數字
            const statsText = limit > 0 ? `${offCount}/${limit}` : `${offCount}`;
            const statsColor = isFull ? '#e74c3c' : '#aaa'; 

            div.innerHTML = `
                <div class="day-number ${isWeekend?'holiday':''}">${d}</div>
                <div class="day-content" id="day-content-${d}">${content}</div>
                <div class="day-stats" style="color:${statsColor};">${statsText}</div>
            `;

            if (!this.isReadOnly) {
                // 左鍵：預設排休
                div.onclick = () => this.handleLeftClick(d);
                // 右鍵：更多選項
                div.oncontextmenu = (e) => this.handleRightClick(e, d);
            } else {
                div.classList.add('disabled');
            }

            grid.appendChild(div);
        }
    },

    // --- [恢復] 核心統計輔助函式 ---
    
    // 計算某天總共有多少人休假 (含我)
    calculateDailyOffCount: function(day) {
        let count = 0;
        const key = `current_${day}`;
        const myUid = app.currentUser.uid;

        // 1. 算別人 (從資料庫讀取)
        Object.keys(this.allAssignments).forEach(uid => {
            if (uid !== myUid && this.allAssignments[uid][key] === 'REQ_OFF') {
                count++;
            }
        });
        
        // 2. 算我 (從本地編輯狀態讀取)
        if (this.userRequest[key] === 'REQ_OFF') {
            count++;
        }
        return count;
    },

    // 取得某天休假的名單
    getDailyOffNames: function(day) {
        const names = [];
        const key = `current_${day}`;
        const myUid = app.currentUser.uid;

        // 1. 別人
        Object.keys(this.allAssignments).forEach(uid => {
            if (uid !== myUid && this.allAssignments[uid][key] === 'REQ_OFF') {
                names.push(this.allUsersMap[uid] || '同仁');
            }
        });

        // 2. 我
        if (this.userRequest[key] === 'REQ_OFF') {
            names.push(this.allUsersMap[myUid] || '我');
        }
        return names;
    },

    countMyOffs: function() {
        let count = 0;
        Object.values(this.userRequest).forEach(v => {
            if(v === 'REQ_OFF') count++;
        });
        return count;
    },

    // --- 5. 互動事件 ---

    handleLeftClick: function(day) {
        if(this.isReadOnly) return;
        const key = `current_${day}`;
        const currentVal = this.userRequest[key];
        // 空白 -> 休，其他 -> 清除
        if (!currentVal) this.trySetShift(day, 'REQ_OFF');
        else this.trySetShift(day, null);
    },

    handleRightClick: function(e, day) {
        e.preventDefault();
        if(this.isReadOnly) return;
        this.selectedDay = day;
        const menu = document.getElementById('staffContextMenu');
        
        let html = `
            <div class="menu-header" style="padding:8px 12px; font-weight:bold; background:#f0f0f0; border-bottom:1px solid #ddd;">
                ${this.data.month}月${day}日
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

        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">希望避開</li>`;
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
        if(this.selectedDay !== null) this.trySetShift(this.selectedDay, val);
        document.getElementById('staffContextMenu').style.display = 'none';
    },

    trySetShift: function(day, val) {
        const key = `current_${day}`;
        
        // 檢查 1: 個人預休上限
        if (val === 'REQ_OFF') {
            const currentOffs = this.countMyOffs();
            const oldValue = this.userRequest[key];
            if (oldValue !== 'REQ_OFF' && currentOffs >= this.rules.maxOff) {
                alert(`無法預休：您本月預休已達上限 (${this.rules.maxOff} 天)`);
                return;
            }
            
            // 檢查 2: 每日名額上限 (預測)
            const dayCount = this.calculateDailyOffCount(day);
            const myOldVal = this.userRequest[key];
            const willBeCount = (myOldVal === 'REQ_OFF') ? dayCount : dayCount + 1;
             
            if (this.rules.dailyLimit > 0 && willBeCount > this.rules.dailyLimit) {
                 if(!confirm(`該日預休名額將達 (${willBeCount}/${this.rules.dailyLimit}) 人。確定仍要排休嗎？`)) return;
            }
        }

        if (val === null) delete this.userRequest[key];
        else this.userRequest[key] = val;
        
        this.renderCalendar(); // 重繪
        this.updateSidebarStats();
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
