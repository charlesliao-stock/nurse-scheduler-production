// js/modules/staff_pre_schedule_manager.js
// 🔧 修正版：修復星期六可預班人數計算錯誤

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
        maxSpecificShifts: 5,
        dailyLimit: 2,
        showNames: true,
        weekStartDay: 1,
        allowBundleSelection: true,
        allowShiftPreferences: true,
        allowSpecificShifts: true
    },
    
    isReadOnly: false,
    selectedDay: null,
    globalClickListener: null,
    
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init (Fixed DayOfWeek):", id);
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
        this.rules.maxSpecificShifts = parseInt(settings.maxSpecificShifts) || 5;
        this.rules.dailyLimit = parseInt(settings.dailyReserved) || 0;
        this.rules.showNames = (settings.showAllNames !== false);
        this.rules.allowBundleSelection = (settings.allowBundleSelection !== false);
        this.rules.allowShiftPreferences = (settings.allowShiftPreferences !== false);
        this.rules.allowSpecificShifts = (settings.allowSpecificShifts !== false);
    },

    // 🔥 修正：正確計算 dayOfWeek 索引
    getDailyQuota: function(day) {
        if (!this.data) return 0;
        const totalStaff = (this.data.staffList || []).length;
        const year = this.data.year;
        const month = this.data.month;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, day);
        
        // 🔥 關鍵修正：轉換 JS 的 getDay() 到 dailyNeeds 的索引
        // JS getDay(): 0=週日, 1=週一, 2=週二, 3=週三, 4=週四, 5=週五, 6=週六
        // dailyNeeds 索引: 0=週一, 1=週二, 2=週三, 3=週四, 4=週五, 5=週六, 6=週日
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

    renderSidebar: function() {
        const bundleSelect = document.getElementById('inputBundleShift');
        const bundleGroup = document.getElementById('bundleGroup');
        const prefContainer = document.getElementById('prefContainer');
        const prefGroup = document.getElementById('prefGroup');
        
        // 🆕 包班選單控制
        if (bundleSelect) {
            const canBundle = this.userData?.schedulingParams?.canBundleShifts === true;
            
            // 如果設定不允許，或同仁沒有包班權限，就隱藏
            if (!this.rules.allowBundleSelection || !canBundle) {
                if(bundleGroup) bundleGroup.style.display = 'none';
            } else {
                let options = '<option value="">無 (不包班)</option>';
                this.shifts.forEach(s => {
                    if (s.isBundleAvailable) options += `<option value="${s.code}">${s.code} (${s.name})</option>`;
                });
                bundleSelect.innerHTML = options;
                bundleSelect.disabled = this.isReadOnly;
                if (this.userRequest.preferences?.bundleShift) bundleSelect.value = this.userRequest.preferences.bundleShift;
                if(bundleGroup) bundleGroup.style.display = 'block';
                bundleSelect.onchange = () => renderPrefs();
            }
        }

        // 🆕 志願序控制
        if (prefGroup) {
            if (!this.rules.allowShiftPreferences) {
                prefGroup.style.display = 'none';
            } else {
                prefGroup.style.display = 'block';
            }
        }
        
        const renderPrefs = () => {
            if (!prefContainer || !this.rules.allowShiftPreferences) return;
            
            const preferences = this.userRequest.preferences || {};
            
            // 取得當前包班設定
            const currentBundle = bundleSelect ? bundleSelect.value : '';
            const bundleShiftData = currentBundle ? this.shifts.find(s => s.code === currentBundle) : null;

            // 取得當前已選的志願，用於排除重複
            const s1 = document.getElementById('pref_favShift')?.value || preferences.favShift || '';
            const s2 = document.getElementById('pref_favShift2')?.value || preferences.favShift2 || '';
            const s3 = document.getElementById('pref_favShift3')?.value || preferences.favShift3 || '';

            const getFilteredShifts = (currentVal, otherVals) => {
                const today = new Date();
                const params = this.userData?.schedulingParams || {};
                const isPregnant = params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today;
                const isBreastfeeding = params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today;
                const isPGY = params.isPGY && params.pgyExpiry && new Date(params.pgyExpiry) >= today;

                const isEveningOrNightBundle = currentBundle && bundleShiftData 
                    ? shiftUtils.isEveningOrNightShift(bundleShiftData)
                    : false;

                return this.shifts.filter(s => {
                    if (s.code === 'OFF') return false;
                    
                    const isNightShift = shiftUtils.isNightShift(s);
                    const isEveningOrNightShift = shiftUtils.isEveningOrNightShift(s);
                    
                    if ((isPregnant || isBreastfeeding || isPGY) && isNightShift) return false;
                    if (isEveningOrNightBundle && isEveningOrNightShift && s.code !== currentBundle) return false;
                    if (s.code !== '' && otherVals.includes(s.code) && s.code !== currentVal) return false;

                    return true;
                });
            };

            let html = '';
            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第一志願</span>
                    <select id="pref_favShift" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s1, [s2, s3]).map(s => `<option value="${s.code}" ${s1===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;

            html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第二志願</span>
                    <select id="pref_favShift2" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s2, [s1, s3]).map(s => `<option value="${s.code}" ${s2===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
            
            const allowThreeShifts = this.data.settings?.allowThreeShifts === true;
            if (allowThreeShifts) {
                html += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="flex-shrink:0; width:60px;">第三志願</span>
                    <select id="pref_favShift3" class="pref-select form-control" ${this.isReadOnly ? 'disabled' : ''}>
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s3, [s1, s2]).map(s => `<option value="${s.code}" ${s3===s.code?'selected':''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                `;
            }
            
            prefContainer.innerHTML = html;

            ['pref_favShift', 'pref_favShift2', 'pref_favShift3'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.onchange = () => {
                        if (!this.userRequest.preferences) this.userRequest.preferences = {};
                        this.userRequest.preferences.favShift = document.getElementById('pref_favShift')?.value || '';
                        this.userRequest.preferences.favShift2 = document.getElementById('pref_favShift2')?.value || '';
                        if (document.getElementById('pref_favShift3')) {
                            this.userRequest.preferences.favShift3 = document.getElementById('pref_favShift3').value;
                        }
                        renderPrefs();
                    };
                }
            });
        };

        renderPrefs();
    },

    updateSidebarStats: function() {
        const offCount = this.countMyOffs();
        const holidayOffCount = this.countMyHolidayOffs();
        
        // 🆕 新增：指定班別統計
        const specificCount = this.countMySpecificShifts();
        
        const elOffCount = document.getElementById('statOffCount');
        const elMaxOff = document.getElementById('limitMaxOff');
        const elHolidayOffCount = document.getElementById('statHolidayOffCount');
        const elMaxHoliday = document.getElementById('limitMaxHoliday');
        
        // 🆕 新增：指定班別顯示
        const elSpecificCount = document.getElementById('statSpecificCount');
        const elMaxSpecific = document.getElementById('limitMaxSpecific');

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
        
        // 🆕 新增：更新指定班別統計
        if (elSpecificCount) {
            elSpecificCount.innerText = specificCount;
            elSpecificCount.style.color = specificCount > this.rules.maxSpecificShifts ? '#e74c3c' : 'inherit';
        }
        if (elMaxSpecific) elMaxSpecific.innerText = this.rules.maxSpecificShifts;

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

    // 🆕 新增：計算指定班別次數
    countMySpecificShifts: function() {
        let count = 0;
        Object.keys(this.userRequest).forEach(key => {
            if (key.startsWith('current_')) {
                const val = this.userRequest[key];
                // 計算指定班別（非 OFF）和勿排班別（!開頭）
                if (val && val !== 'REQ_OFF') {
                    count++;
                }
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
        
        // 🆕 檢查是否允許使用右鍵選單
        if (!this.rules.allowSpecificShifts) {
            return; // 不顯示右鍵選單
        }
        
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
        // 🆕 新增：指定班別上限檢查
        else if (val !== null && val !== 'REQ_OFF') {
            const currentSpecificCount = this.countMySpecificShifts();
            const oldValue = this.userRequest[key];
            
            // 如果舊值不是指定班別，而新值是指定班別，需要檢查上限
            const isOldSpecific = oldValue && oldValue !== 'REQ_OFF';
            const isNewSpecific = true; // val 已經確定不是 null 和 REQ_OFF
            
            if (!isOldSpecific && isNewSpecific) {
                if (currentSpecificCount >= this.rules.maxSpecificShifts) {
                    alert(`無法指定班別：您本月指定班別已達上限 (${this.rules.maxSpecificShifts} 次)\n\n目前已指定：${currentSpecificCount} 次`);
                    return;
                }
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
            const preferences = {};
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect && !bundleSelect.disabled) preferences.bundleShift = bundleSelect.value;
            const selects = document.querySelectorAll('.pref-select');
            selects.forEach(sel => {
                const id = sel.id.replace('pref_', ''); 
                preferences[id] = sel.value;
            });

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
            alert("提交成功!");
            window.location.hash = '/staff/pre_schedule_list';
        } catch (e) { console.error(e); alert("提交失敗: " + e.message); }
    }
};
