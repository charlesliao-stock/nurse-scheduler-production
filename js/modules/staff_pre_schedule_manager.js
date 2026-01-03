// js/modules/staff_pre_schedule_manager.js (修正版)

const staffPreScheduleManager = {
    docId: null,
    data: null,
    shifts: [],
    staffMap: {},
    dailyNames: {}, 
    userRequest: {}, 
    userPreferences: {}, 
    otherRequests: {}, 
    dailyNeeds: {}, 
    dailyReserved: 0,
    maxOff: 0,
    maxHoliday: 0,
    totalStaffCount: 0,
    isReadOnly: false,
    globalClickListener: null,
    
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init:", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }

        await this.loadShifts();
        await this.loadData();
        
        this.renderCalendar();
        this.updateStats();
        this.setupEvents();
        
        const menu = document.getElementById('staffContextMenu');
        if (menu && menu.parentElement !== document.body) {
            document.body.appendChild(menu);
        }
    },

    loadShifts: async function() {
        try {
            const s = await db.collection('shifts').get();
            this.shifts = s.docs.map(d => d.data());
        } catch(e) { console.error(e); }
    },

    loadData: async function() {
        try {
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            if (!doc.exists) throw new Error("資料不存在");
            
            this.data = doc.data();
            const s = this.data.settings || {};
            
            this.dailyReserved = parseInt(s.dailyReserved) || 0;
            this.maxOff = parseInt(s.maxOffDays) || 8;
            this.maxHoliday = parseInt(s.maxHolidayOffs) || 2;
            this.dailyNeeds = this.data.dailyNeeds || {}; 

            this.staffMap = {};
            (this.data.staffList || []).forEach(staff => {
                this.staffMap[staff.uid] = staff.name;
            });
            this.totalStaffCount = (this.data.staffList || []).length;

            document.getElementById('staffPreTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 預班`;
            
            const today = new Date().toISOString().split('T')[0];
            const isOpen = (today >= s.openDate && today <= s.closeDate && this.data.status !== 'closed');
            const badge = document.getElementById('staffPreStatus');
            
            if (isOpen) {
                badge.textContent = "開放中"; badge.style.background = "#2ecc71";
                document.getElementById('btnStaffSave').style.display = 'inline-flex';
                this.isReadOnly = false;
            } else {
                badge.textContent = "唯讀 (已截止)"; badge.style.background = "#e74c3c";
                document.getElementById('btnStaffSave').style.display = 'none';
                this.isReadOnly = true;
            }

            this.userRequest = {};
            this.otherRequests = {}; 
            this.dailyNames = {}; 

            const uid = app.currentUser.uid;
            const assignments = this.data.assignments || {};

            if (assignments[uid]) {
                this.userRequest = { ...assignments[uid] };
                this.userPreferences = this.userRequest.preferences || {};
                delete this.userRequest.preferences; 
            } else {
                this.userPreferences = {};
            }

            Object.keys(assignments).forEach(userId => {
                const userAssign = assignments[userId];
                const userName = this.staffMap[userId] || "未知人員";

                Object.keys(userAssign).forEach(key => {
                    if (key.startsWith('current_')) {
                        const day = parseInt(key.split('_')[1]);
                        const val = userAssign[key];
                        
                        if (val === 'REQ_OFF' || val === 'OFF') {
                            if (userId !== uid) {
                                this.otherRequests[day] = (this.otherRequests[day] || 0) + 1;
                            }
                            
                            if (s.showAllNames) {
                                if (!this.dailyNames[day]) this.dailyNames[day] = [];
                                this.dailyNames[day].push(userName);
                            }
                        }
                    }
                });
            });

            document.getElementById('limitMaxOff').textContent = this.maxOff;
            document.getElementById('limitMaxHoliday').textContent = this.maxHoliday;
            this.renderRightPanel();

        } catch (e) {
            console.error(e);
            alert("載入失敗: " + e.message);
        }
    },

    renderRightPanel: function() {
        const user = app.currentUser;
        
        db.collection('users').doc(user.uid).get().then(doc => {
            const uData = doc.data();
            const params = uData.schedulingParams || {};
            const today = new Date().toISOString().split('T')[0];

            const isPregnant = params.isPregnant && (!params.pregnantExpiry || params.pregnantExpiry >= today);
            const isBreastfeeding = params.isBreastfeeding && (!params.breastfeedingExpiry || params.breastfeedingExpiry >= today);
            
            document.getElementById('badgePregnant').style.display = isPregnant ? 'inline-block' : 'none';
            document.getElementById('badgeBreastfeeding').style.display = isBreastfeeding ? 'inline-block' : 'none';
            document.getElementById('specialStatusArea').style.display = (isPregnant || isBreastfeeding) ? 'block' : 'none';

            const isRestricted = isPregnant || isBreastfeeding;

            if(params.canBundleShifts) {
                document.getElementById('bundleGroup').style.display = 'block';
                const sel = document.getElementById('inputBundleShift');
                sel.innerHTML = '<option value="">無 (不包班)</option>';
                
                const validShifts = this.shifts.filter(sh => {
                    if (sh.unitId !== this.data.unitId || !sh.isBundleAvailable) return false;
                    if (isRestricted && this.isLateShift(sh)) return false;
                    return true;
                });

                validShifts.forEach(sh => {
                    sel.innerHTML += `<option value="${sh.code}">${sh.name} (${sh.code})</option>`;
                });

                if (this.userPreferences.bundleShift) sel.value = this.userPreferences.bundleShift;
                sel.onchange = () => this.updatePreferenceOptions(isRestricted);
            }
            
            this.initPreferenceSelects(isRestricted);
            this.updatePreferenceOptions(isRestricted);
        });
    },

    isLateShift: function(shift) {
        if (!shift.startTime || !shift.endTime) return false;
        
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const [eh, em] = shift.endTime.split(':').map(Number);
        
        const start = sh + sm / 60;
        const end = eh + em / 60;
        
        if (end < start) return true;
        if (start < 6) return true;
        if (start >= 22) return true;
        if (end > 22) return true;
        
        return false;
    },

    initPreferenceSelects: function(isRestricted) {
        const s = this.data.settings || {};
        const prefContainer = document.getElementById('prefContainer');
        prefContainer.innerHTML = '';

        const mode = s.shiftTypeMode; 
        const allowThree = s.allowThreeShifts; 
        let count = 0;
        
        if (mode === "2") count = 2; 
        else if (mode === "3") count = allowThree ? 3 : 0; 

        if (count > 0) {
            for (let i = 1; i <= count; i++) {
                const div = document.createElement('div');
                div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '10px';
                
                const label = document.createElement('span');
                label.textContent = `第 ${i} 志願:`; label.style.fontSize = '0.9rem'; label.style.width = '60px';
                
                const select = document.createElement('select');
                select.className = 'pref-select'; 
                select.id = `pref_priority_${i}`;
                select.style.flex = '1'; select.style.padding = '6px'; 
                select.style.border = '1px solid #ccc'; select.style.borderRadius = '4px';
                
                div.appendChild(label); div.appendChild(select); prefContainer.appendChild(div);
            }
        } else {
            prefContainer.innerHTML = '<div style="color:#999; font-size:0.9rem;">依單位規定排班,無需填寫志願。</div>';
        }
    },

    updatePreferenceOptions: function(isRestricted) {
        const s = this.data.settings || {};
        const mode = s.shiftTypeMode; 
        const bundleVal = document.getElementById('inputBundleShift')?.value || "";
        
        const unitShifts = this.shifts.filter(sh => {
            if (sh.unitId !== this.data.unitId) return false;
            if (isRestricted && this.isLateShift(sh)) return false;
            return true;
        });
        
        const selects = document.querySelectorAll('.pref-select');
        if(selects.length === 0) return;

        selects.forEach(sel => {
            const currentVal = sel.value || this.userPreferences[sel.id.replace('pref_', '')];
            sel.innerHTML = '<option value="">請選擇</option>';
            
            unitShifts.forEach(sh => {
                let isHidden = false;
                if (mode === "2" && bundleVal !== "") {
                    if (sh.isBundleAvailable && sh.code !== bundleVal) {
                        isHidden = true;
                    }
                }
                if (!isHidden) {
                    sel.innerHTML += `<option value="${sh.code}">${sh.name}</option>`;
                }
            });

            sel.value = currentVal;
            if (sel.selectedIndex === -1) sel.value = "";
        });
    },

    calcRemaining: function(day) {
        const date = new Date(this.data.year, this.data.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        let totalNeed = 0;
        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        unitShifts.forEach(s => {
            const key = `${s.code}_${dayIdx}`;
            totalNeed += (this.dailyNeeds[key] || 0);
        });
        return this.totalStaffCount - totalNeed - this.dailyReserved;
    },

    renderCalendar: function() {
        const container = document.getElementById('calendarGrid');
        container.innerHTML = '';
        const weeks = ['日', '一', '二', '三', '四', '五', '六'];
        weeks.forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.textContent = w;
            if (w==='日'||w==='六') div.style.color='#e74c3c';
            container.appendChild(div);
        });

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

        for (let i = 0; i < firstDayOfWeek; i++) container.appendChild(document.createElement('div'));

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeek = dateObj.getDay();
            const isHoliday = (dayOfWeek === 0 || dayOfWeek === 6);
            
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.dataset.day = d;
            cell.dataset.isHoliday = isHoliday;
            
            if (isHoliday) cell.classList.add('is-weekend');
            
            const key = `current_${d}`;
            const val = this.userRequest[key];

            if (val === 'REQ_OFF') {
                cell.classList.add('selected');
                cell.innerHTML += `<div class="my-status" style="font-weight:900; color:#2ecc71; font-size:1rem; top:5px; right:5px;">OFF</div>`;
            } else if (val && val.startsWith('!')) {
                cell.innerHTML += `<div class="shift-tag" style="color:#e74c3c; font-size:0.9rem;"><i class="fas fa-ban"></i> ${val.replace('!', '')}</div>`;
            } else if (val) {
                cell.classList.add('selected'); 
                cell.innerHTML += `<div class="shift-tag">${val}</div>`;
            }

            const myCount = (val === 'REQ_OFF') ? 1 : 0; 
            const used = (this.otherRequests[d] || 0) + myCount;
            const quota = this.calcRemaining(d);
            
            if (val === 'REQ_OFF') {
                if (used > quota) cell.classList.add('warn-red');
                else cell.classList.add('warn-orange');
            }

            let slotHtml = `<i class="fas fa-user"></i> ${used} / ${quota}`;
            let slotClass = (used >= quota) ? 'day-slots full' : 'day-slots';
            
            let tooltip = `已預班人數: ${used}`;
            if (this.data.settings.showAllNames && this.dailyNames[d]) {
                const names = [...this.dailyNames[d]];
                tooltip = "已預班人員:\n" + names.join('\n');
            }

            cell.innerHTML += `
                <div class="day-number ${isHoliday?'holiday':''}">${d}</div>
                <div class="${slotClass}" title="${tooltip}">${slotHtml}</div>
            `;

            if (!this.isReadOnly) {
                // [關鍵修正] 使用 addEventListener 而非 onclick
                cell.addEventListener('click', (e) => {
                    const menu = document.getElementById('staffContextMenu');
                    if (menu && menu.style.display === 'block') {
                        menu.style.display = 'none';
                        return;
                    }
                    this.toggleDay(d, cell, isHoliday, used, quota);
                });
                
                // [關鍵修正] 右鍵選單事件
                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault(); // 只阻擋瀏覽器預設選單
                    e.stopPropagation();
                    this.handleRightClick(e, d, isHoliday, used, quota);
                    return false;
                });
            } else {
                cell.classList.add('disabled');
            }
            
            container.appendChild(cell);
        }
    },

    toggleDay: function(day, cell, isHoliday, used, quota) {
        const key = `current_${day}`;
        const currentVal = this.userRequest[key];

        if (currentVal) {
            this.setShift(day, null, isHoliday, used, quota);
        } else {
            const predictedUsed = used + 1;
            if (predictedUsed > quota) {
                if(!confirm(`該日預班人數 (${predictedUsed}) 已達上限 (${quota}),確定要候補嗎?`)) return;
            }
            if (!this.checkLimits('REQ_OFF', day, isHoliday)) return;
            this.setShift(day, 'REQ_OFF', isHoliday, used, quota);
        }
    },

    handleRightClick: function(e, day, isHoliday, used, quota) {
        const menu = document.getElementById('staffContextMenu');
        const title = document.getElementById('staffMenuTitle');
        const options = document.getElementById('staffMenuOptions');
        
        if (!menu || !title || !options) return;
        
        title.textContent = `${this.data.month}月 ${day}日`;
        
        let html = '';
        
        // [修正] 與管理員端一致的選單結構
        html += `<div class="menu-item" onclick="staffPreScheduleManager.setShift(${day}, 'REQ_OFF', ${isHoliday}, ${used}, ${quota})">
            <span class="menu-icon"><span class="color-dot" style="background:#2ecc71;"></span></span> 預休 (User)
        </div>`;
        html += `<div class="menu-separator"></div>`;

        // 班別選項
        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        unitShifts.forEach(s => {
            html += `<div class="menu-item" onclick="staffPreScheduleManager.setShift(${day}, '${s.code}', ${isHoliday}, ${used}, ${quota})">
                <span class="menu-icon" style="color:${s.color}; font-weight:bold;">${s.code}</span> 指定 ${s.name}
            </div>`;
        });

        // 勿排選項
        html += `<div class="menu-separator"></div>`;
        unitShifts.forEach(s => {
            html += `<div class="menu-item" onclick="staffPreScheduleManager.setShift(${day}, '!${s.code}', ${isHoliday}, ${used}, ${quota})" style="color:#c0392b;">
                <span class="menu-icon"><i class="fas fa-ban"></i></span> 勿排 ${s.name}
            </div>`;
        });

        // 清除選項
        html += `<div class="menu-separator"></div>`;
        html += `<div class="menu-item" style="color:red;" onclick="staffPreScheduleManager.setShift(${day}, null, ${isHoliday}, ${used}, ${quota})">
            <span class="menu-icon"><i class="fas fa-eraser"></i></span> 清除
        </div>`;

        options.innerHTML = html;
        menu.style.display = 'block';
        menu.style.visibility = 'hidden'; 
        
        requestAnimationFrame(() => {
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            let x = e.pageX;
            let y = e.pageY;
            
            if (e.clientX + menuWidth > viewportWidth) {
                x = e.pageX - menuWidth;
            }
            
            if (e.clientY + menuHeight > viewportHeight) {
                y = e.pageY - menuHeight;
            }
            
            x = Math.max(10, Math.min(x, viewportWidth - menuWidth - 10));
            y = Math.max(10, Math.min(y, viewportHeight - menuHeight - 10));
            
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.visibility = 'visible';
        });
    },

    setShift: function(day, code, isHoliday, used, quota) {
        const menu = document.getElementById('staffContextMenu');
        if(menu) menu.style.display = 'none';
        
        const key = `current_${day}`;
        if (code === null) {
            delete this.userRequest[key];
        } else {
            if (code === 'REQ_OFF') {
                const originalVal = this.userRequest[key];
                if (originalVal !== 'REQ_OFF') {
                    const otherCount = this.otherRequests[day] || 0;
                    const predicted = otherCount + 1;
                    if (predicted > quota) {
                       if(!confirm(`該日預班人數 (${predicted}) 已達上限 (${quota}),確定要候補嗎?`)) return; 
                    }
                    if (!this.checkLimits(code, day, isHoliday)) return;
                }
            }
            this.userRequest[key] = code;
        }
        this.renderCalendar();
        this.updateStats();
    },

    checkLimits: function(newCode, newDay, isTargetHoliday) {
        if (newCode !== 'REQ_OFF') return true;
        let offCount = 0;
        let holidayOffCount = 0;
        offCount++;
        if (isTargetHoliday) holidayOffCount++;
        Object.keys(this.userRequest).forEach(k => {
            const d = parseInt(k.split('_')[1]);
            if (d !== newDay && this.userRequest[k] === 'REQ_OFF') {
                offCount++;
                const date = new Date(this.data.year, this.data.month - 1, d);
                const w = date.getDay();
                if (w === 0 || w === 6) holidayOffCount++;
            }
        });
        if (offCount > this.maxOff) { alert(`超過預班總天數上限 (${this.maxOff} 天)`); return false; }
        if (holidayOffCount > this.maxHoliday) { alert(`超過假日預班上限 (${this.maxHoliday} 天)`); return false; }
        return true;
    },

    updateStats: function() {
        let offCount = 0;
        let holidayOffCount = 0;
        Object.keys(this.userRequest).forEach(k => {
            if (this.userRequest[k] === 'REQ_OFF') {
                offCount++;
                const d = parseInt(k.split('_')[1]);
                const date = new Date(this.data.year, this.data.month - 1, d);
                const w = date.getDay();
                if (w === 0 || w === 6) holidayOffCount++;
            }
        });
        document.getElementById('statOffCount').textContent = offCount;
        document.getElementById('statHolidayOffCount').textContent = holidayOffCount;
        document.getElementById('statOffCount').style.color = (offCount > this.maxOff) ? 'red' : '';
        document.getElementById('statHolidayOffCount').style.color = (holidayOffCount > this.maxHoliday) ? 'red' : '';
    },

    setupEvents: function() {
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

    cleanup: function() {
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('staffContextMenu');
        if (menu) {
            menu.style.display = 'none';
        }
    },

    saveRequest: async function() {
        if (!confirm("確定提交預班資料?")) return;
        try {
            const preferences = {};
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect) preferences.bundleShift = bundleSelect.value;
            const selects = document.querySelectorAll('.pref-select');
            selects.forEach(sel => {
                const id = sel.id.replace('pref_', ''); 
                preferences[id] = sel.value;
            });
            const uid = app.currentUser.uid;
            const dataToSave = { ...this.userRequest, preferences: preferences };
            const updateKey = `assignments.${uid}`;
            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: dataToSave
            });
            alert("提交成功!");
            history.back();
        } catch (e) { console.error(e); alert("提交失敗: " + e.message); }
    }
};

const staffOriginalInit = staffPreScheduleManager.init;
staffPreScheduleManager.init = function(id) {
    if(this.cleanup) this.cleanup();
    staffOriginalInit.call(this, id);
};
