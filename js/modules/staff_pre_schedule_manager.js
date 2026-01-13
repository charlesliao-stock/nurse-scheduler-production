// js/modules/staff_pre_schedule_manager.js
// 修正版：修復員工端預班的右鍵選單

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

        this.cleanup();
        await this.loadData();
        await this.loadShifts();
        
        this.renderCalendar();
        this.updateStats();
        this.setupEvents();
        
        const menu = document.getElementById('staffContextMenu');
        if (menu && menu.parentElement !== document.body) {
            document.body.appendChild(menu);
        }
        
        console.log("✅ Staff Pre-Schedule 初始化完成");
    },

    loadShifts: async function() {
        try {
            const snapshot = await db.collection('shifts').get();
            this.shifts = snapshot.docs.map(d => d.data());
        } catch(e) { 
            console.error("載入班別失敗:", e);
        }
    },

    loadData: async function() {
        // ... (保持原本的 loadData 邏輯不變，直接從您上傳的檔案複製使用) ...
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
            const uid = app.currentUser.uid;
            const assignments = this.data.assignments || {};

            if (assignments[uid]) {
                this.userRequest = { ...assignments[uid] };
                this.userPreferences = this.userRequest.preferences || {};
            }

            Object.keys(assignments).forEach(userId => {
                const userAssign = assignments[userId];
                Object.keys(userAssign).forEach(key => {
                    if (key.startsWith('current_')) {
                        const day = parseInt(key.split('_')[1]);
                        const val = userAssign[key];
                        if (val === 'REQ_OFF' || val === 'OFF') {
                            if (userId !== uid) {
                                this.otherRequests[day] = (this.otherRequests[day] || 0) + 1;
                            }
                        }
                    }
                });
            });

            document.getElementById('limitMaxOff').textContent = this.maxOff;
            document.getElementById('limitMaxHoliday').textContent = this.maxHoliday;
            this.renderRightPanel();
        } catch (e) { console.error(e); }
    },
    
    renderRightPanel: function() { /* ... 保持您原本的邏輯 ... */ },
    isLateShift: function(shift) { /* ... 保持您原本的邏輯 ... */ },
    initPreferenceSelects: function(isRestricted) { /* ... 保持您原本的邏輯 ... */ },
    updatePreferenceOptions: function(isRestricted) { /* ... 保持您原本的邏輯 ... */ },
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
            const isHoliday = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.dataset.day = d;
            
            if (isHoliday) cell.classList.add('is-weekend');
            
            const key = `current_${d}`;
            const val = this.userRequest[key];

            // 渲染內容 (Badge)
            if (val === 'REQ_OFF') {
                cell.classList.add('selected');
                cell.innerHTML += `<div style="position:absolute; top:5px; right:5px; font-weight:bold; color:#2ecc71;">OFF</div>`;
            } else if (val) {
                const shift = this.shifts.find(s => s.code === val);
                const color = shift ? shift.color : '#333';
                cell.classList.add('selected'); 
                cell.innerHTML += `<div class="shift-tag" style="background:${color};">${val}</div>`;
            }

            const myCount = (val === 'REQ_OFF') ? 1 : 0; 
            const used = (this.otherRequests[d] || 0) + myCount;
            const quota = this.calcRemaining(d);
            
            let slotClass = (used >= quota) ? 'day-slots full' : 'day-slots';
            cell.innerHTML += `
                <div class="day-number ${isHoliday?'holiday':''}">${d}</div>
                <div class="${slotClass}"><i class="fas fa-user"></i> ${used}/${quota}</div>
            `;

            if (!this.isReadOnly) {
                // 左鍵點擊
                cell.addEventListener('click', () => {
                   if (val) this.setShift(d, null, isHoliday, used, quota);
                   else this.setShift(d, 'REQ_OFF', isHoliday, used, quota);
                });
                
                // 右鍵點擊
                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
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

    // [關鍵修正] 適應新版 index.html 的空 UL 結構
    handleRightClick: function(e, day, isHoliday, used, quota) {
        const menu = document.getElementById('staffContextMenu');
        if (!menu) return;

        let list = menu.querySelector('ul');
        if(!list) list = menu; // fallback
        
        list.innerHTML = ''; // 清空

        // 標題
        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px 10px; background:#f8f9fa; font-weight:bold; border-bottom:1px solid #ddd;">${day}日 志願</div>`;
        list.appendChild(header);

        // 選項生成器
        const addItem = (icon, text, onClick) => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="margin-right:8px;">${icon}</span> ${text}`;
            li.style.padding = '8px 15px';
            li.style.cursor = 'pointer';
            li.onmouseover = () => li.style.background = '#f1f1f1';
            li.onmouseout = () => li.style.background = 'white';
            li.onclick = () => {
                onClick();
                menu.style.display = 'none';
            };
            list.appendChild(li);
        };

        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        
        // 1. 預休
        addItem('<span style="color:#2ecc71;">●</span>', '預休 (REQ_OFF)', () => this.setShift(day, 'REQ_OFF', isHoliday, used, quota));
        
        // 2. 班別
        unitShifts.forEach(s => {
            addItem(
                `<span style="color:${s.color}; font-weight:bold;">${s.code}</span>`, 
                `指定 ${s.name}`, 
                () => this.setShift(day, s.code, isHoliday, used, quota)
            );
        });

        // 3. 清除
        const sep = document.createElement('li');
        sep.style.borderTop = '1px solid #eee';
        sep.style.margin = '5px 0';
        list.appendChild(sep);
        
        addItem('<i class="fas fa-eraser" style="color:red;"></i>', '清除', () => this.setShift(day, null, isHoliday, used, quota));

        // 顯示
        menu.style.display = 'block';
        this.positionMenu(e, menu);
    },

    positionMenu: function(e, menu) {
        const menuWidth = 200;
        const menuHeight = menu.offsetHeight || 300;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        let left = e.pageX;
        let top = e.pageY;
        if (left + menuWidth > windowWidth) left = windowWidth - menuWidth - 10;
        if (top + menuHeight > windowHeight) top = windowHeight - menuHeight - 10;
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    },

    setShift: function(day, code, isHoliday, used, quota) {
        // ... (保持原本的檢查邏輯) ...
        const key = `current_${day}`;
        if (code === null) {
            delete this.userRequest[key];
        } else {
            if (code === 'REQ_OFF') {
                const predicted = (this.otherRequests[day] || 0) + 1;
                if (predicted > quota) {
                   if(!confirm(`該日預班人數 (${predicted}) 已達上限 (${quota}),確定要候補嗎?`)) return; 
                }
                if (!this.checkLimits(code, day, isHoliday)) return;
            }
            this.userRequest[key] = code;
        }
        this.renderCalendar();
        this.updateStats();
    },

    checkLimits: function(newCode, newDay, isTargetHoliday) {
        if (newCode !== 'REQ_OFF') return true;
        let offCount = 1; 
        let holidayOffCount = isTargetHoliday ? 1 : 0;
        
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
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('staffContextMenu');
        if (menu) menu.style.display = 'none';
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
