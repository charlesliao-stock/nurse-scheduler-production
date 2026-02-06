// js/modules/staff_pre_schedule_manager.js
// 🔧 修正版 v2：
// - 修復星期六可預班人數計算錯誤
// - 新增志願重複檢查（動態過濾）
// - 新增包班與志願衝突檢查（4小時內同系列）
// - 修正第三志願存取一致性

const staffPreScheduleManager = {
    docId: null,
    data: null,       
    userData: null,   
    allUsersMap: {},  
    shifts: [],
    
    userRequest: {},
    allAssignments: {},
    
    rules: {
        maxOff: 8,
        maxHoliday: 8,
        dailyLimit: 2,
        showNames: true,
        weekStartDay: 1
    },
    
    isReadOnly: false,
    selectedDay: null,
    globalClickListener: null,
    
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init (Fixed DayOfWeek + Preference Validation):", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }
        this.cleanup();
        
        const grid = document.getElementById('calendarGrid');
        if(grid) grid.innerHTML = '<div style="padding:20px; text-align:center;">資料載入中...</div>';

        try {
            await this.loadData(); 
            await Promise.all([
                this.loadUserProfile(), 
                this.loadAllUserNames(),
                this.loadShifts(),
                this.loadUnitRules()
            ]);
            
            this.parseRules();         
            this.renderSidebar();      
            this.renderCalendar();
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

    loadData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("找不到預班表");
        this.data = doc.data();
        
        const uid = app.getUid();
        this.allAssignments = this.data.assignments || {};
        this.userRequest = (this.allAssignments[uid]) ? JSON.parse(JSON.stringify(this.allAssignments[uid])) : {};
        this.isReadOnly = (this.data.status !== 'open');
        
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
        const uid = app.getUid();
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
        this.shifts = snapshot.docs.map(d => d.data()).filter(s => s.isPreScheduleAvailable);
    },

    loadUnitRules: async function() {
        if(!this.data || !this.data.unitId) return;
        try {
            const doc = await db.collection('units').doc(this.data.unitId).get();
            if(doc.exists) {
                const r = doc.data().schedulingRules || {};
                this.rules.weekStartDay = (r.hard?.weekStartDay !== undefined && r.hard?.weekStartDay !== null) 
                                          ? parseInt(r.hard.weekStartDay) : 1;
            }
        } catch(e) {
            console.error("Load Unit Rules Error:", e);
        }
    },

    parseRules: function() {
        const settings = this.data.settings || {};
        this.rules.maxOff = parseInt(settings.maxOffDays) || 8;
        this.rules.maxHoliday = parseInt(settings.maxHolidayOffs) || 0;
        this.rules.dailyLimit = parseInt(settings.dailyReserved) || 0;
        this.rules.showNames = (settings.showAllNames !== false); 
    },

    getDailyQuota: function(day) {
        if (!this.data) return 0;
        const totalStaff = (this.data.staffList || []).length;
        const year = this.data.year;
        const month = this.data.month;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, day);
        
        const jsDay = dateObj.getDay();
        const dayOfWeek = (jsDay === 0) ? 6 : jsDay - 1;
        
        let dailyNeedCount = 0;
        
        const specific = this.data.specificNeeds || {};
        const hasSpecific = Object.values(specific).some(sn => sn.date === dateStr);
        
        if (hasSpecific) {
            Object.values(specific).forEach(sn => {
                if (sn.date === dateStr) dailyNeedCount += (parseInt(sn.count) || 0);
            });
        } else {
            const needs = this.data.dailyNeeds || {};
            this.shifts.forEach(s => {
                const key = `${s.code}_${dayOfWeek}`;
                if (needs[key]) dailyNeedCount += (parseInt(needs[key]) || 0);
            });
        }

        const dailyReserved = parseInt(this.data.settings?.dailyReserved) || 0;
        return Math.max(0, totalStaff - dailyNeedCount - dailyReserved);
    },

    // 🆕 工具函式：解析時間為小時數
    parseTime: function(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m || 0) / 60;
    },

    // 🆕 工具函式：判斷兩個班別是否為同系列（4小時內）
    isSameShiftFamily: function(shift1, shift2) {
        if (!shift1 || !shift2) return false;
        
        const t1 = this.parseTime(shift1.startTime);
        const t2 = this.parseTime(shift2.startTime);
        
        // 計算時差（考慮跨日）
        let diff = Math.abs(t1 - t2);
        if (diff > 12) diff = 24 - diff; // 跨日修正 (22:00 vs 00:00 = 2h)
        
        return diff <= 4; // 4小時內視為同系列
    },

    // 🆕 工具函式：根據包班過濾可選班別
    filterShiftsByBundle: function(bundleShiftCode, allowThreeShifts) {
        // 若允許3種志願，或無包班，不過濾
        if (allowThreeShifts || !bundleShiftCode) {
            return this.shifts.filter(s => s.code !== 'OFF');
        }
        
        const bundleData = this.shifts.find(s => s.code === bundleShiftCode);
        if (!bundleData) return this.shifts.filter(s => s.code !== 'OFF');
        
        return this.shifts.filter(s => {
            if (s.code === 'OFF') return false;
            if (s.code === bundleShiftCode) return true; // 包班本身可選
            
            // 檢查是否為同系列班別（4小時內）
            return !this.isSameShiftFamily(bundleData, s);
        });
    },

    renderSidebar: function() {
        const bundleSelect = document.getElementById('inputBundleShift');
        const bundleGroup = document.getElementById('bundleGroup');
        const prefContainer = document.getElementById('prefContainer');
        
        const renderPrefs = () => {
            if (!prefContainer) return;
            
            const bundleShift = bundleSelect ? bundleSelect.value : '';
            const allowThreeShifts = this.data.settings?.allowThreeShifts === true;
            const preferences = this.userRequest.preferences || {};
            
            // 🔥 根據包班過濾可選班別
            let availableShifts = this.filterShiftsByBundle(bundleShift, allowThreeShifts);
            
            let html = '';
            
            // 第一志願
            const pref1 = preferences.favShift || '';
            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第一志願</span>
                    <select id="pref_favShift" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${availableShifts.map(s => `<option value="${s.code}" ${pref1===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;

            // 第二志願（排除第一志願已選）
            const pref2 = preferences.favShift2 || '';
            const availableForPref2 = availableShifts.filter(s => s.code !== pref1);
            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第二志願</span>
                    <select id="pref_favShift2" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${availableForPref2.map(s => `<option value="${s.code}" ${pref2===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
            
            // 第三志願（僅在 allowThreeShifts = true 時顯示，排除第一、二志願已選）
            if (allowThreeShifts) {
                const pref3 = preferences.favShift3 || '';
                const availableForPref3 = availableShifts.filter(s => s.code !== pref1 && s.code !== pref2);
                html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第三志願</span>
                    <select id="pref_favShift3" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${availableForPref3.map(s => `<option value="${s.code}" ${pref3===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                `;
            }
            
            prefContainer.innerHTML = html;
            
            // 🔥 監聽志願變更，動態更新下一個志願的選項
            const pref1Select = document.getElementById('pref_favShift');
            const pref2Select = document.getElementById('pref_favShift2');
            
            if (pref1Select) {
                pref1Select.onchange = () => renderPrefs();
            }
            
            if (pref2Select) {
                pref2Select.onchange = () => renderPrefs();
            }
        };

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
                bundleSelect.onchange = renderPrefs;
            } else {
                if(bundleGroup) bundleGroup.style.display = 'none';
            }
        }

        renderPrefs();
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

    renderCalendar: function() {
        const grid = document.getElementById('calendarGrid');
        if(!grid) return;
        
        grid.innerHTML = '';
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        const firstDayObj = new Date(year, month - 1, 1);
        const firstDayOfWeek = firstDayObj.getDay(); 

        const weekStart = this.rules.weekStartDay;

        let weekHeaders = [];
        if (weekStart === 1) {
            weekHeaders = ['一','二','三','四','五','六','日'];
        } else {
            weekHeaders = ['日','一','二','三','四','五','六'];
        }

        weekHeaders.forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.innerText = w;
            grid.appendChild(div);
        });

        let emptyCount = 0;
        if (weekStart === 1) {
            emptyCount = (firstDayOfWeek === 0) ? 6 : firstDayOfWeek - 1;
        } else {
            emptyCount = firstDayOfWeek;
        }

        for(let i=0; i<emptyCount; i++) {
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

            const key = `current_${d}`;
            const myVal = this.userRequest[key];
            let isMySelection = false;
            
            const offCount = this.calculateDailyOffCount(d);
            const limit = this.getDailyQuota(d);
            const isFull = (limit > 0 && offCount >= limit);
            
            if (myVal) {
                isMySelection = true;
                div.classList.add('my-selection');
            } else if (limit > 0) {
                if (isFull) div.classList.add('quota-full');      
                else div.classList.add('quota-available');        
            }

            let tooltipText = `預休: ${offCount} 人 / 可預休上限: ${limit} 人`;
            if (this.rules.showNames && offCount > 0) {
                const names = this.getDailyOffNames(d);
                if (names.length > 0) tooltipText += `\n名單: ${names.join(', ')}`;
            }
            div.title = tooltipText;

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

            const statsText = limit > 0 ? `${offCount}/${limit}` : `${offCount}`;
            const statsColor = (limit > 0 && isFull) ? '#e74c3c' : '#aaa'; 

            div.innerHTML = `
                <div class="day-number ${isWeekend?'holiday':''}">${d}</div>
                <div class="day-content" id="day-content-${d}">${content}</div>
                <div class="day-stats" style="color:${statsColor};">${statsText}</div>
            `;

            if (!this.isReadOnly) {
                div.onclick = () => this.handleLeftClick(d);
                div.oncontextmenu = (e) => this.handleRightClick(e, d);
            } else {
                div.classList.add('disabled');
            }

            grid.appendChild(div);
        }
    },

    calculateDailyOffCount: function(day) {
        let count = 0;
        const key = `current_${day}`;
        const myUid = app.getUid();
        Object.keys(this.allAssignments).forEach(uid => {
            if (uid !== myUid && this.allAssignments[uid][key] === 'REQ_OFF') count++;
        });
        if (this.userRequest[key] === 'REQ_OFF') count++;
        return count;
    },

    getDailyOffNames: function(day) {
        const names = [];
        const key = `current_${day}`;
        const myUid = app.getUid();
        Object.keys(this.allAssignments).forEach(uid => {
            if (uid !== myUid && this.allAssignments[uid][key] === 'REQ_OFF') {
                names.push(this.allUsersMap[uid] || '同仁');
            }
        });
        if (this.userRequest[key] === 'REQ_OFF') {
            names.push(this.allUsersMap[myUid] || '我');
        }
        return names;
    },

    countMyOffs: function() {
        let count = 0;
        Object.values(this.userRequest).forEach(v => { if(v === 'REQ_OFF') count++; });
        return count;
    },

    handleLeftClick: function(day) {
        if(this.isReadOnly) return;
        const key = `current_${day}`;
        const currentVal = this.userRequest[key];
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
        
        const menuWidth = 160;
        const menuHeight = menu.offsetHeight;
        
        let top = e.pageY + 5;
        let left = e.pageX + 5;
        
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 10;
        }
        if (top + menuHeight > window.innerHeight) {
            top = window.innerHeight - menuHeight - 10;
        }
        
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
    },

    menuAction: function(val) {
        if(this.selectedDay !== null) this.trySetShift(this.selectedDay, val);
        document.getElementById('staffContextMenu').style.display = 'none';
    },

    trySetShift: function(day, val) {
        const key = `current_${day}`;
        if (val === 'REQ_OFF') {
            const currentOffs = this.countMyOffs();
            const currentHolidayOffs = this.countMyHolidayOffs();
            const oldValue = this.userRequest[key];
            
            if (oldValue !== 'REQ_OFF') {
                if (currentOffs >= this.rules.maxOff) {
                    alert(`無法預休：您本月預休已達上限 (${this.rules.maxOff} 天)`);
                    return;
                }
                const year = this.data.year;
                const month = this.data.month;
                const dateObj = new Date(year, month - 1, day);
                const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
                
                if (isWeekend && this.rules.maxHoliday > 0 && currentHolidayOffs >= this.rules.maxHoliday) {
                    alert(`無法預休：您本月假日預休已達上限 (${this.rules.maxHoliday} 天)`);
                    return;
                }
            }
            const dayCount = this.calculateDailyOffCount(day);
            const myOldVal = this.userRequest[key];
            const willBeCount = (myOldVal === 'REQ_OFF') ? dayCount : dayCount + 1;
            const limit = this.getDailyQuota(day);
             
            if (limit > 0 && willBeCount > limit) {
                 if(!confirm(`該日預休名額將達 (${willBeCount}/${limit}) 人。確定仍要排休嗎？`)) return;
            }
        }
        if (val === null) delete this.userRequest[key];
        else this.userRequest[key] = val;
        this.renderCalendar(); 
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
            // 🔥 收集偏好設定
            const preferences = {};
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect && !bundleSelect.disabled) {
                preferences.bundleShift = bundleSelect.value;
            }
            
            // 🔥 明確取得各志願值
            const pref1 = document.getElementById('pref_favShift')?.value || '';
            const pref2 = document.getElementById('pref_favShift2')?.value || '';
            const pref3El = document.getElementById('pref_favShift3');
            const pref3 = pref3El ? (pref3El.value || '') : '';
            
            // 🔥 驗證 1：志願不可重複
            const prefs = [pref1, pref2, pref3].filter(p => p !== '');
            const uniquePrefs = new Set(prefs);
            
            if (prefs.length !== uniquePrefs.size) {
                alert('⚠️ 各志願不可重複，請重新選擇');
                return;
            }
            
            // 🔥 驗證 2：包班衝突檢查（僅在 allowThreeShifts = false 時）
            const bundleShift = preferences.bundleShift || '';
            const allowThreeShifts = this.data.settings?.allowThreeShifts === true;
            
            if (!allowThreeShifts && bundleShift) {
                const bundleData = this.shifts.find(s => s.code === bundleShift);
                
                if (bundleData) {
                    const invalidPrefs = prefs.filter(p => {
                        if (p === bundleShift) return false; // 包班本身可選
                        const prefData = this.shifts.find(s => s.code === p);
                        return this.isSameShiftFamily(bundleData, prefData);
                    });
                    
                    if (invalidPrefs.length > 0) {
                        alert(`⚠️ 包班 ${bundleShift} 時，志願不可選擇同系列班別（開始時間前後4小時內）\n衝突班別：${invalidPrefs.join(', ')}`);
                        return;
                    }
                }
            }
            
            // 🔥 儲存志願（根據 allowThreeShifts 決定是否儲存第三志願）
            preferences.favShift = pref1;
            preferences.favShift2 = pref2;
            if (allowThreeShifts) {
                preferences.favShift3 = pref3;
            }

            const uid = app.getUid();
            const updateKey = `assignments.${uid}`;
            const dataToSave = { 
                ...this.userRequest, 
                preferences: preferences,
                updatedAt: new Date().toISOString()
            };

            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: dataToSave
            });
            
            alert("✅ 提交成功!");
            window.location.hash = '/staff/pre_schedule_list';
            
        } catch (e) { 
            console.error(e); 
            alert("❌ 提交失敗: " + e.message); 
        }
    }
};
