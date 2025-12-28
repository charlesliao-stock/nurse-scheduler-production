// js/modules/staff_pre_schedule_manager.js

const staffPreScheduleManager = {
    docId: null,
    data: null,
    shifts: [],
    userRequest: {}, 
    otherRequests: {}, // { day: count }
    dailyNeeds: {}, // { "SHIFT_DAYIDX": count }
    dailyReserved: 0,
    maxOff: 0,
    maxHoliday: 0,
    totalStaffCount: 0,
    
    // --- 進入點 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    init: async function(id) {
        console.log("Staff Pre-Schedule Init:", id);
        this.docId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        await Promise.all([
            this.loadShifts(),
            this.loadData()
        ]);
        
        this.renderCalendar();
        this.updateStats();
    },

    loadShifts: async function() {
        const s = await db.collection('shifts').get();
        this.shifts = s.docs.map(d => d.data());
    },

    loadData: async function() {
        try {
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            if (!doc.exists) throw new Error("資料不存在");
            
            this.data = doc.data();
            const s = this.data.settings || {};
            
            this.dailyReserved = s.dailyReserved || 0;
            this.maxOff = s.maxOffDays || 8;
            this.maxHoliday = s.maxHolidayOffs || 2;
            this.totalStaffCount = (this.data.staffList || []).length;
            this.dailyNeeds = this.data.dailyNeeds || {};

            document.getElementById('staffPreTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 預班`;
            
            // 狀態與權限
            const today = new Date().toISOString().split('T')[0];
            const isOpen = (today >= s.openDate && today <= s.closeDate && this.data.status !== 'closed');
            const badge = document.getElementById('staffPreStatus');
            
            if (isOpen) {
                badge.textContent = "開放中"; badge.style.background = "#2ecc71";
                document.getElementById('btnStaffSave').style.display = 'inline-flex';
                this.isReadOnly = false;
            } else {
                badge.textContent = "唯讀"; badge.style.background = "#e74c3c";
                document.getElementById('btnStaffSave').style.display = 'none';
                this.isReadOnly = true;
            }

            // 讀取請求
            this.userRequest = {};
            this.otherRequests = {}; 
            const uid = app.currentUser.uid;
            const assignments = this.data.assignments || {};

            if (assignments[uid]) this.userRequest = { ...assignments[uid] };

            Object.keys(assignments).forEach(userId => {
                const userAssign = assignments[userId];
                Object.keys(userAssign).forEach(key => {
                    if (key.startsWith('current_')) {
                        const day = parseInt(key.split('_')[1]);
                        const val = userAssign[key];
                        if (val === 'REQ_OFF' || val === 'OFF') {
                            this.otherRequests[day] = (this.otherRequests[day] || 0) + 1;
                        }
                    }
                });
            });

            // 初始化右側面板
            document.getElementById('limitMaxOff').textContent = this.maxOff;
            document.getElementById('limitMaxHoliday').textContent = this.maxHoliday;
            this.renderRightPanel();

        } catch (e) { console.error(e); alert("載入失敗: " + e.message); }
    },

    renderRightPanel: function() {
        // 特殊身份
        const user = app.currentUser; // 需要完整 user data? 
        // 這裡需要重新讀取 user data 以取得 schedulingParams
        db.collection('users').doc(user.uid).get().then(doc => {
            const uData = doc.data();
            const params = uData.schedulingParams || {};
            
            if(params.isPregnant) document.getElementById('badgePregnant').style.display = 'inline-block';
            else document.getElementById('badgePregnant').style.display = 'none';
            
            if(params.isBreastfeeding) document.getElementById('badgeBreastfeeding').style.display = 'inline-block';
            else document.getElementById('badgeBreastfeeding').style.display = 'none';
            
            if(params.isPregnant || params.isBreastfeeding) 
                document.getElementById('specialStatusArea').style.display = 'block';

            // 包班選單
            if(params.canBundleShifts) {
                document.getElementById('bundleGroup').style.display = 'block';
                const sel = document.getElementById('inputBundleShift');
                sel.innerHTML = '<option value="">無 (不包班)</option>';
                // 篩選 shift 中有 isBundleAvailable (需在 Shift Manager 實作，這裡先列出全部)
                this.shifts.forEach(s => {
                    sel.innerHTML += `<option value="${s.code}">${s.name}</option>`;
                });
                // 帶入舊值 (假設存於 userRequest.bundle) - 暫略
            }
        });

        // 3種班
        if (this.data.settings.allowThreeShifts) {
            document.getElementById('prefShiftTypeGroup').style.display = 'block';
        }
    },

    // [核心] 計算每日餘額
    calcRemaining: function(day) {
        // 1. 計算該日是星期幾 (0-6)
        const date = new Date(this.data.year, this.data.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; // 轉為 0=Mon, 6=Sun 配合矩陣習慣 (或維持 0=Sun)
        // 我們的矩陣是 Mon=0 ... Sun=6? 還是跟 Date.getDay() 一樣 0=Sun?
        // 在 PreManager 中我們用 days=['週一'...]，生成 key: CODE_0 (週一)。
        // Date.getDay(): 0=Sun, 1=Mon.
        // 對應轉換: (getDay() + 6) % 7 => 0=Mon, 6=Sun.
        const matrixDayIdx = (date.getDay() + 6) % 7; 

        // 2. 計算當日總需求 (Sum of dailyNeeds for this day)
        let totalNeed = 0;
        this.shifts.forEach(s => {
            const key = `${s.code}_${matrixDayIdx}`;
            totalNeed += (this.dailyNeeds[key] || 0);
        });

        // 3. 公式: 總人 - 總需 - 保留
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
            if (this.userRequest[key] === 'REQ_OFF') cell.classList.add('selected');

            // 計算數字
            const used = this.otherRequests[d] || 0;
            const quota = this.calcRemaining(d);
            
            // 判斷邊框顏色 (若已選)
            if (cell.classList.contains('selected')) {
                if (used > quota) cell.classList.add('warn-red'); // 超額
                else cell.classList.add('warn-orange'); // 正常
            }

            // 人頭圖示
            let slotHtml = `<i class="fas fa-user"></i> ${used} / ${quota}`;
            let slotClass = (used >= quota) ? 'day-slots full' : 'day-slots';

            // Tooltip (顯示人名)
            let tooltip = `已預班: ${used} 人`;
            if (this.data.settings.showAllNames) {
                // 需遍歷 assignments (效能較差，暫略，可優化)
            }

            cell.innerHTML = `
                <div class="day-number ${isHoliday?'holiday':''}">${d}</div>
                <div class="my-status"><i class="fas fa-check-circle"></i></div>
                <div class="${slotClass}" title="${tooltip}">${slotHtml}</div>
            `;

            if (!this.isReadOnly) {
                cell.onclick = () => this.toggleDay(d, cell, isHoliday, used, quota);
            } else {
                cell.classList.add('disabled');
            }
            container.appendChild(cell);
        }
    },

    toggleDay: function(day, cell, isHoliday, used, quota) {
        const key = `current_${day}`;
        const isSelected = this.userRequest[key] === 'REQ_OFF';

        if (isSelected) {
            delete this.userRequest[key];
            cell.classList.remove('selected', 'warn-red', 'warn-orange');
        } else {
            // 檢核
            if (used >= quota) {
                if(!confirm(`該日預班人數 (${used}) 已達上限 (${quota})，確定要候補嗎？`)) return;
            }
            if (!this.checkLimits(isHoliday)) return;

            this.userRequest[key] = 'REQ_OFF';
            cell.classList.add('selected');
            
            // 設定邊框
            if (used >= quota) cell.classList.add('warn-red');
            else cell.classList.add('warn-orange');
        }
        this.updateStats();
    },

    checkLimits: function(isTargetHoliday) {
        let offCount = 0;
        let holidayOffCount = 0;
        
        if (isTargetHoliday) holidayOffCount++;
        offCount++;

        Object.keys(this.userRequest).forEach(k => {
            if (this.userRequest[k] === 'REQ_OFF') {
                offCount++;
                const d = parseInt(k.split('_')[1]);
                const date = new Date(this.data.year, this.data.month - 1, d);
                const w = date.getDay();
                if (w === 0 || w === 6) holidayOffCount++;
            }
        });

        // 注意：這裡因為先加了1，所以判斷要寬鬆一點，或是重算比較準
        // 重算邏輯：
        let currentOff = 0;
        let currentHol = 0;
        // 把 userRequest 跑一遍即可 (包含剛加的) - 不對，userRequest 還沒加進去
        // 簡單做：
        if (offCount > this.maxOff) { alert("超過預休上限"); return false; }
        if (holidayOffCount > this.maxHoliday) { alert("超過假日上限"); return false; }
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
    },

    saveRequest: async function() {
        if (!confirm("確定提交？")) return;
        try {
            const uid = app.currentUser.uid;
            const updateKey = `assignments.${uid}`;
            // 儲存偏好 (需合併到 assignments 或另開欄位，這裡先存請求)
            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: this.userRequest
            });
            alert("提交成功");
            history.back();
        } catch (e) { alert("失敗: " + e.message); }
    }
};
