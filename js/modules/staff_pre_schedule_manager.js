// js/modules/staff_pre_schedule_manager.js

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
    globalClickListener: null, // [新增]
    
    // --- 進入點 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    // --- 初始化 ---
    init: async function(id) {
        console.log("Staff Pre-Schedule Init:", id);
        this.docId = id;
        
        if (!app.currentUser) { alert("請先登入"); return; }

        await this.loadShifts();
        await this.loadData();
        
        this.renderCalendar();
        this.updateStats();
        this.setupEvents(); // [新增]
        
        // 確保選單在 body (避免座標問題)
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
                            this.otherRequests[day] = (this.otherRequests[day] || 0) + 1;
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
        const s = this.data.settings || {};

        db.collection('users').doc(user.uid).get().then(doc => {
            const uData = doc.data();
            const params = uData.schedulingParams || {};
            
            document.getElementById('badgePregnant').style.display = params.isPregnant ? 'inline-block' : 'none';
            document.getElementById('badgeBreastfeeding').style.display = params.isBreastfeeding ? 'inline-block' : 'none';
            if(params.isPregnant || params.isBreastfeeding) document.getElementById('specialStatusArea').style.display = 'block';

            if(params.canBundleShifts) {
                document.getElementById('bundleGroup').style.display = 'block';
                const sel = document.getElementById('inputBundleShift');
                sel.innerHTML = '<option value="">無 (不包班)</option>';
                const validShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId && sh.isBundleAvailable);
                validShifts.forEach(sh => {
                    sel.innerHTML += `<option value="${sh.code}">${sh.name} (${sh.code})</option>`;
                });
                if (this.userPreferences.bundleShift) sel.value = this.userPreferences.bundleShift;
            }
        });

        const prefContainer = document.getElementById('prefContainer');
        prefContainer.innerHTML = '';
        const mode = s.shiftTypeMode; 
        const allowThree = s.allowThreeShifts; 
        let count = 0;
        if (mode === "2") count = 2; 
        else if (mode === "3") count = allowThree ? 3 : 0; 

        if (count > 0) {
            const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
            for (let i = 1; i <= count; i++) {
                const div = document.createElement('div');
                div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '10px';
                const label = document.createElement('span');
                label.textContent = `第 ${i} 志願:`; label.style.fontSize = '0.9rem'; label.style.width = '60px';
                const select = document.createElement('select');
                select.className = 'pref-select'; select.id = `pref_priority_${i}`;
                select.style.flex = '1'; select.style.padding = '6px'; select.style.border = '1px solid #ccc'; select.style.borderRadius = '4px';
                select.innerHTML = '<option value="">請選擇</option>';
                unitShifts.forEach(sh => { select.innerHTML += `<option value="${sh.code}">${sh.name}</option>`; });
                const savedVal = this.userPreferences[`priority_${i}`];
                if (savedVal) select.value = savedVal;
                div.appendChild(label); div.appendChild(select); prefContainer.appendChild(div);
            }
        } else {
            prefContainer.innerHTML = '<div style="color:#999; font-size:0.9rem;">依單位規定排班，無需填寫志願。</div>';
        }
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
            if (isHoliday) cell.classList.add('is-weekend');
            
            const key = `current_${d}`;
            const val = this.userRequest[key];

            // 判斷當前值
            if (val === 'REQ_OFF') {
                cell.classList.add('selected');
                cell.innerHTML += `<div class="my-status"><i class="fas fa-check-circle"></i></div>`;
            } else if (val) {
                // 如果是指定班別 (例如 'D', 'N')
                cell.classList.add('selected'); // 顯示選取狀態
                // 這裡可以考慮給不同顏色，目前先維持綠底
                // 顯示班別代號
                cell.innerHTML += `<div class="shift-tag">${val}</div>`;
            }

            const used = this.otherRequests[d] || 0;
            const quota = this.calcRemaining(d);
            
            // 邊框警告邏輯 (只針對 REQ_OFF 需要檢查額度，指定班別不需要)
            if (val === 'REQ_OFF') {
                if (used > quota) cell.classList.add('warn-red');
                else cell.classList.add('warn-orange');
            }

            let slotHtml = `<i class="fas fa-user"></i> ${used} / ${quota}`;
            let slotClass = (used >= quota) ? 'day-slots full' : 'day-slots';
            let tooltip = `已預班人數: ${used}`;
            if (this.data.settings.showAllNames && this.dailyNames[d] && this.dailyNames[d].length > 0) {
                tooltip = "已預班人員:\n" + this.dailyNames[d].join('\n');
            }

            cell.innerHTML += `
                <div class="day-number ${isHoliday?'holiday':''}">${d}</div>
                <div class="${slotClass}" title="${tooltip}">${slotHtml}</div>
            `;

            if (!this.isReadOnly) {
                // [關鍵] 左鍵點擊 (預設 OFF)
                cell.onclick = (e) => {
                    // 防止右鍵觸發 onclick
                    this.toggleDay(d, cell, isHoliday, used, quota);
                };
                
                // [關鍵] 右鍵點擊 (開啟選單)
                cell.oncontextmenu = (e) => {
                    this.handleRightClick(e, d, isHoliday, used, quota);
                };
            } else {
                cell.classList.add('disabled');
            }
            container.appendChild(cell);
        }
    },

    // --- 左鍵：快速切換 OFF ---
    toggleDay: function(day, cell, isHoliday, used, quota) {
        // 如果選單是開啟的，先關閉選單，不執行動作
        const menu = document.getElementById('staffContextMenu');
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            return;
        }

        const key = `current_${day}`;
        const currentVal = this.userRequest[key];

        // 邏輯：如果有值 (不論是 OFF 還是班別)，點擊就清除；如果沒值，就設為 REQ_OFF
        if (currentVal) {
            this.setShift(day, null, isHoliday, used, quota);
        } else {
            this.setShift(day, 'REQ_OFF', isHoliday, used, quota);
        }
    },

    // --- 右鍵：開啟選單 ---
    handleRightClick: function(e, day, isHoliday, used, quota) {
        e.preventDefault();
        e.stopPropagation();

        const menu = document.getElementById('staffContextMenu');
        const title = document.getElementById('staffMenuTitle');
        const options = document.getElementById('staffMenuOptions');
        
        title.textContent = `${this.data.month}月 ${day}日`;
        
        let html = '';
        
        // 1. 預休 (User 的 OFF)
        html += `<div class="menu-item" onclick="staffPreScheduleManager.setShift(${day}, 'REQ_OFF', ${isHoliday}, ${used}, ${quota})">
            <span class="menu-icon"><span class="color-dot" style="background:#2ecc71;"></span></span> 預休 (OFF)
        </div>`;
        
        html += `<div class="menu-separator"></div>`;

        // 2. 指定班別 (只列出該單位的班別)
        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        unitShifts.forEach(s => {
            html += `<div class="menu-item" onclick="staffPreScheduleManager.setShift(${day}, '${s.code}', ${isHoliday}, ${used}, ${quota})">
                <span class="menu-icon" style="color:${s.color}; font-weight:bold;">${s.code}</span> 指定 ${s.name}
            </div>`;
        });

        html += `<div class="menu-separator"></div>`;
        
        // 3. 清除
        html += `<div class="menu-item" style="color:red;" onclick="staffPreScheduleManager.setShift(${day}, null, ${isHoliday}, ${used}, ${quota})">
            <span class="menu-icon"><i class="fas fa-eraser"></i></span> 清除
        </div>`;

        options.innerHTML = html;

        // 定位邏輯
        menu.style.display = 'block';
        menu.style.visibility = 'hidden'; 
        setTimeout(() => {
            let x = e.pageX;
            let y = e.pageY;
            if (x + menu.offsetWidth > window.innerWidth) x -= menu.offsetWidth;
            if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.visibility = 'visible'; 
        }, 0);
    },

    // --- 設定班別 (核心邏輯) ---
    setShift: function(day, code, isHoliday, used, quota) {
        // 隱藏選單
        document.getElementById('staffContextMenu').style.display = 'none';
        
        const key = `current_${day}`;

        // 清除
        if (code === null) {
            delete this.userRequest[key];
            this.renderCalendar(); // 重繪 (最簡單，更新樣式)
            this.updateStats();
            return;
        }

        // 如果是 REQ_OFF，需檢查限制
        if (code === 'REQ_OFF') {
            // 額度警告
            if (used >= quota) {
                if(!confirm(`該日預班人數 (${used}) 已達上限 (${quota})，確定要候補嗎？`)) return;
            }
            // 個人上限檢查 (需先把該日暫時加進去算，或是由 checkLimits 處理)
            if (!this.checkLimits(code, day, isHoliday)) return;
        }

        // 設定值
        this.userRequest[key] = code;
        this.renderCalendar();
        this.updateStats();
    },

    checkLimits: function(newCode, newDay, isTargetHoliday) {
        // 只有 OFF 才需要檢查上限
        if (newCode !== 'REQ_OFF') return true;

        let offCount = 0;
        let holidayOffCount = 0;
        
        // 先加上這一次的 (假設成功)
        offCount++;
        if (isTargetHoliday) holidayOffCount++;

        // 加上已選的其他 OFF (排除目前正在修改的這一天，避免重複算)
        Object.keys(this.userRequest).forEach(k => {
            const d = parseInt(k.split('_')[1]);
            if (d !== newDay && this.userRequest[k] === 'REQ_OFF') {
                offCount++;
                const date = new Date(this.data.year, this.data.month - 1, d);
                const w = date.getDay();
                if (w === 0 || w === 6) holidayOffCount++;
            }
        });

        if (offCount > this.maxOff) {
            alert(`超過預班總天數上限 (${this.maxOff} 天)`);
            return false;
        }
        if (holidayOffCount > this.maxHoliday) {
            alert(`超過假日預班上限 (${this.maxHoliday} 天)`);
            return false;
        }
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

    // --- 事件管理 ---
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
        if (menu && menu.parentElement === document.body) {
            menu.remove();
        }
    },

    saveRequest: async function() {
        if (!confirm("確定提交預班資料？")) return;

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
            const dataToSave = { 
                ...this.userRequest,
                preferences: preferences 
            };

            const updateKey = `assignments.${uid}`;
            
            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: dataToSave
            });

            alert("提交成功！");
            history.back();

        } catch (e) {
            console.error(e);
            alert("提交失敗: " + e.message);
        }
    }
};

// 複寫 init 以支援 cleanup
const staffOriginalInit = staffPreScheduleManager.init;
staffPreScheduleManager.init = function(id) {
    if(this.cleanup) this.cleanup();
    staffOriginalInit.call(this, id);
};
