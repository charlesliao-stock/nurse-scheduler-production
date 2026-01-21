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
        // [修正] 對應 pre_schedule_manager.js 中的欄位名稱
        this.rules.maxOff = parseInt(settings.maxOffDays) || 8;
        this.rules.maxHoliday = parseInt(settings.maxHolidayOffs) || 0;
        this.rules.dailyLimit = parseInt(settings.dailyReserved) || 0; // 這裡通常是控床名額，但在預班端可能被當作上限
        this.rules.showNames = (settings.showAllNames !== false); 
    },

    // [新增] 取得每日可預班人數 (分母)
    // 邏輯：人員設定中的總人數 - 每日需求設定中的總需求數 - 每日保留名額 (控床)
    getDailyQuota: function(day) {
        if (!this.data) return 0;
        
        // 1. 取得人員設定中的總人數 (來自 staffList)
        const totalStaff = (this.data.staffList || []).length;
        
        // 2. 取得該日的每日需求數 (來自 dailyNeeds 或 specificNeeds)
        const year = this.data.year;
        const month = this.data.month;
        const dateObj = new Date(year, month - 1, day);
        const dayOfWeek = dateObj.getDay(); // 0 (日) 到 6 (六)
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        let dailyNeedCount = 0;
        
        // 優先檢查臨時需求 (specificNeeds)
        const specific = this.data.specificNeeds || {};
        const hasSpecific = Object.values(specific).some(sn => sn.date === dateStr);
        
        if (hasSpecific) {
            // 如果當天有臨時需求，加總該日所有班別的需求
            Object.values(specific).forEach(sn => {
                if (sn.date === dateStr) {
                    dailyNeedCount += (parseInt(sn.count) || 0);
                }
            });
        } else {
            // 否則使用週循環需求 (dailyNeeds)
            const needs = this.data.dailyNeeds || {};
            this.shifts.forEach(s => {
                const key = `${s.code}_${dayOfWeek}`;
                if (needs[key]) {
                    dailyNeedCount += (parseInt(needs[key]) || 0);
                }
            });
        }

        // 3. 取得每日保留名額 (控床)
        const dailyReserved = parseInt(this.data.settings?.dailyReserved) || 0;
        
        // 4. 計算分母：總人數 - 總需求數 - 每日保留名額
        // 確保結果不小於 0
        return Math.max(0, totalStaff - dailyNeedCount - dailyReserved);
    },

    // --- 3. 渲染側邊欄 ---
    renderSidebar: function() {
        const bundleSelect = document.getElementById('inputBundleShift');
        const bundleGroup = document.getElementById('bundleGroup');
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
                if(bundleGroup) bundleGroup.style.display = 'block';
            } else {
                if(bundleGroup) bundleGroup.style.display = 'none';
            }
        }

        const prefContainer = document.getElementById('prefContainer');
        if (prefContainer) {
            const preferences = this.userRequest.preferences || {};
            let html = '';
            
            // 志願 1
            const pref1 = preferences.favShift || '';
            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第一志願</span>
                    <select id="pref_favShift" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${this.shifts.map(s => `<option value="${s.code}" ${pref1===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;

            // 志願 2
            const pref2 = preferences.favShift2 || '';
            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第二志願</span>
                    <select id="pref_favShift2" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${this.shifts.map(s => `<option value="${s.code}" ${pref2===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;

            prefContainer.innerHTML = html;
        }
    },

    updateSidebarStats: function() {
        const offCount = this.countMyOffs();
        const holidayOffCount = this.countMyHolidayOffs();
        
        const elOffCount = document.getElementById('statOffCount');
        const elMaxOff = document.getElementById('limitMaxOff');
        const elHolidayOffCount = document.getElementById('statHolidayOffCount');
        const elMaxHoliday = document.getElementById('limitMaxHoliday');

        if (elOffCount) {
            elOffCount.innerText = offCount;
            elOffCount.style.color = offCount > this.rules.maxOff ? '#e74c3c' : 'inherit';
        }
        if (elMaxOff) elMaxOff.innerText = this.rules.maxOff;
        
        if (elHolidayOffCount) {
            elHolidayOffCount.innerText = holidayOffCount;
            elHolidayOffCount.style.color = (this.rules.maxHoliday > 0 && holidayOffCount > this.rules.maxHoliday) ? '#e74c3c' : 'inherit';
        }
        if (elMaxHoliday) elMaxHoliday.innerText = this.rules.maxHoliday;

        // 懷孕/哺乳狀態
        const specialArea = document.getElementById('specialStatusArea');
        if (specialArea) {
            const isPregnant = this.userData?.isPregnant === true;
            const isBreastfeeding = this.userData?.isBreastfeeding === true;
            
            document.getElementById('badgePregnant').style.display = isPregnant ? 'inline-block' : 'none';
            document.getElementById('badgeBreastfeeding').style.display = isBreastfeeding ? 'inline-block' : 'none';
            
            specialArea.style.display = (isPregnant || isBreastfeeding) ? 'block' : 'none';
        }
    },

    countMyHolidayOffs: function() {
        let count = 0;
        const year = this.data.year;
        const month = this.data.month;
        
        Object.keys(this.userRequest).forEach(key => {
            if (key.startsWith('current_') && this.userRequest[key] === 'REQ_OFF') {
                const day = parseInt(key.replace('current_', ''));
                const dateObj = new Date(year, month - 1, day);
                const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
                if (isWeekend) count++;
            }
        });
        return count;
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
            // [修正] 分母改為「可預班人數」 = 總人數 - 每日需求數
            const limit = this.getDailyQuota(d);
            const isFull = (limit > 0 && offCount >= limit);
            
            // 2. 決定邊框顏色 (Orange: 充足, Red: 滿了)
            if (limit > 0) {
                if (isFull) div.classList.add('quota-full');      
                else div.classList.add('quota-available');        
            }

            // 3. Tooltip (顯示姓名)
            let tooltipText = `預休: ${offCount} 人 / 可預休上限: ${limit} 人`;
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
            const statsColor = (limit > 0 && isFull) ? '#e74c3c' : '#aaa'; 

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
            const currentHolidayOffs = this.countMyHolidayOffs();
            const oldValue = this.userRequest[key];
            
            if (oldValue !== 'REQ_OFF') {
                // 總預休上限檢查
                if (currentOffs >= this.rules.maxOff) {
                    alert(`無法預休：您本月預休已達上限 (${this.rules.maxOff} 天)`);
                    return;
                }
                
                // 假日預休上限檢查
                const year = this.data.year;
                const month = this.data.month;
                const day = parseInt(key.replace('current_', ''));
                const dateObj = new Date(year, month - 1, day);
                const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
                
                if (isWeekend && this.rules.maxHoliday > 0 && currentHolidayOffs >= this.rules.maxHoliday) {
                    alert(`無法預休：您本月假日預休已達上限 (${this.rules.maxHoliday} 天)`);
                    return;
                }
            }
            
            // 檢查 2: 每日名額上限 (預測)
            const dayCount = this.calculateDailyOffCount(day);
            const myOldVal = this.userRequest[key];
            const willBeCount = (myOldVal === 'REQ_OFF') ? dayCount : dayCount + 1;
            
            // [修正] 使用 getDailyQuota(day) 作為上限判斷基準
            const limit = this.getDailyQuota(day);
             
            if (limit > 0 && willBeCount > limit) {
                 if(!confirm(`該日預休名額將達 (${willBeCount}/${limit}) 人。確定仍要排休嗎？`)) return;
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
