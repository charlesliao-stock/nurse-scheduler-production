// js/modules/staff_pre_schedule_manager.js

const staffPreScheduleManager = {
    docId: null,
    data: null,
    shifts: [],
    staffMap: {}, // uid -> name 對照表
    dailyNames: {}, // day -> [name1, name2...]
    userRequest: {}, 
    userPreferences: {}, // [新增] 儲存使用者的偏好 (包班、志願序)
    otherRequests: {}, 
    dailyNeeds: {}, 
    dailyReserved: 0,
    maxOff: 0,
    maxHoliday: 0,
    totalStaffCount: 0,
    isReadOnly: false,
    
    // --- 進入點 ---
    open: function(id) {
        window.location.hash = `/staff/pre_schedule?id=${id}`;
    },

    // --- 初始化 ---
    init: async function(id) {
        console.log("Staff Pre-Schedule Init:", id);
        this.docId = id;
        
        if (!app.currentUser) {
            alert("請先登入");
            return;
        }

        // 先載入班別，再載入資料
        await this.loadShifts();
        await this.loadData();
        
        this.renderCalendar();
        this.updateStats();
    },

    loadShifts: async function() {
        try {
            // 注意：這裡是撈全部班別，後續會依照該單位的 shifts 過濾 (或假設系統只撈該單位的)
            // 嚴謹做法：loadData 後再確認 unitId 撈 shift，但為了簡化流程先全撈或假設已是該單位
            const s = await db.collection('shifts').get();
            this.shifts = s.docs.map(d => d.data());
        } catch(e) { console.error("Load Shifts Error:", e); }
    },

    // --- 載入資料 ---
    loadData: async function() {
        try {
            const doc = await db.collection('pre_schedules').doc(this.docId).get();
            if (!doc.exists) throw new Error("資料不存在");
            
            this.data = doc.data();
            const s = this.data.settings || {};
            
            // 1. 基礎參數
            this.dailyReserved = parseInt(s.dailyReserved) || 0;
            this.maxOff = parseInt(s.maxOffDays) || 8;
            this.maxHoliday = parseInt(s.maxHolidayOffs) || 2;
            this.dailyNeeds = this.data.dailyNeeds || {}; 

            // 2. 建立人員對照表 (用於 Tooltip 顯示姓名)
            this.staffMap = {};
            (this.data.staffList || []).forEach(staff => {
                this.staffMap[staff.uid] = staff.name;
            });
            this.totalStaffCount = (this.data.staffList || []).length;

            // 3. 狀態檢查
            const today = new Date().toISOString().split('T')[0];
            const isOpen = (today >= s.openDate && today <= s.closeDate && this.data.status !== 'closed');
            const badge = document.getElementById('staffPreStatus');
            
            // 更新標題
            document.getElementById('staffPreTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 預班`;

            if (isOpen) {
                badge.textContent = "開放中"; 
                badge.style.background = "#2ecc71";
                document.getElementById('btnStaffSave').style.display = 'inline-flex';
                this.isReadOnly = false;
            } else {
                badge.textContent = "唯讀 (已截止)"; 
                badge.style.background = "#e74c3c";
                document.getElementById('btnStaffSave').style.display = 'none';
                this.isReadOnly = true;
            }

            // 4. 解析 Assignments 與 姓名清單
            this.userRequest = {};
            this.otherRequests = {}; 
            this.dailyNames = {}; // 重置

            const uid = app.currentUser.uid;
            const assignments = this.data.assignments || {};

            // 讀取自己的資料 (包含預休 & 偏好)
            if (assignments[uid]) {
                // 預休資料
                this.userRequest = { ...assignments[uid] };
                // 移除偏好設定的 key (避免混淆)，偏好通常另外存或存在特定 key
                // 假設我們將偏好存在 assignments[uid].preferences 裡
                this.userPreferences = this.userRequest.preferences || {};
                delete this.userRequest.preferences; 
            } else {
                this.userPreferences = {};
            }

            // 遍歷所有人的預班
            Object.keys(assignments).forEach(userId => {
                const userAssign = assignments[userId];
                const userName = this.staffMap[userId] || "未知人員";

                Object.keys(userAssign).forEach(key => {
                    // key: current_1, current_2...
                    if (key.startsWith('current_')) {
                        const day = parseInt(key.split('_')[1]);
                        const val = userAssign[key];
                        
                        if (val === 'REQ_OFF' || val === 'OFF') {
                            // 計數
                            this.otherRequests[day] = (this.otherRequests[day] || 0) + 1;
                            
                            // 紀錄姓名 (依設定決定是否顯示)
                            if (s.showAllNames) {
                                if (!this.dailyNames[day]) this.dailyNames[day] = [];
                                this.dailyNames[day].push(userName);
                            }
                        }
                    }
                });
            });

            // 初始化 UI
            document.getElementById('limitMaxOff').textContent = this.maxOff;
            document.getElementById('limitMaxHoliday').textContent = this.maxHoliday;
            
            // 渲染右側面板 (包含修正後的偏好選單)
            this.renderRightPanel();

        } catch (e) {
            console.error(e);
            alert("載入失敗: " + e.message);
        }
    },

    // --- 右側面板 (修正包班與偏好) ---
    renderRightPanel: function() {
        const user = app.currentUser;
        const s = this.data.settings || {};

        // 1. 特殊身份 & 包班意願 (需讀取 User 最新狀態)
        db.collection('users').doc(user.uid).get().then(doc => {
            const uData = doc.data();
            const params = uData.schedulingParams || {};
            
            // 特殊身份標籤
            document.getElementById('badgePregnant').style.display = params.isPregnant ? 'inline-block' : 'none';
            document.getElementById('badgeBreastfeeding').style.display = params.isBreastfeeding ? 'inline-block' : 'none';
            if(params.isPregnant || params.isBreastfeeding) document.getElementById('specialStatusArea').style.display = 'block';

            // 包班意願
            if(params.canBundleShifts) {
                document.getElementById('bundleGroup').style.display = 'block';
                const sel = document.getElementById('inputBundleShift');
                sel.innerHTML = '<option value="">無 (不包班)</option>';
                
                // [修正 1] 過濾：只顯示 isBundleAvailable 為 true 的班別
                // 並且只顯示該單位的班別 (unitId 匹配)
                const validShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId && sh.isBundleAvailable);
                
                validShifts.forEach(sh => {
                    sel.innerHTML += `<option value="${sh.code}">${sh.name} (${sh.code})</option>`;
                });

                // 帶入舊值
                if (this.userPreferences.bundleShift) {
                    sel.value = this.userPreferences.bundleShift;
                }
            }
        });

        // 2. [修正 2] 排班偏好 (動態生成)
        const prefContainer = document.getElementById('prefContainer');
        prefContainer.innerHTML = ''; // 清空

        // 判斷模式：2種 或 3種
        const mode = s.shiftTypeMode; // "2" 或 "3"
        const allowThree = s.allowThreeShifts; // boolean

        // 決定下拉選單數量
        let count = 0;
        if (mode === "2") {
            count = 2; // 第一志願、第二志願
        } else if (mode === "3") {
            // 如果是 3 種班，且允許自願，則顯示 3 個；若不允許自願，可能顯示 0 個或預設
            // 依需求：排班偏好...依照設定...動態改變
            // 若 allowThree 是 true，顯示 3 個；否則顯示 0 個 (或顯示預設文字)
            count = allowThree ? 3 : 0; 
        }

        if (count > 0) {
            // 篩選出該單位的班別選項
            const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
            
            for (let i = 1; i <= count; i++) {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';

                const label = document.createElement('span');
                label.textContent = `第 ${i} 志願:`;
                label.style.fontSize = '0.9rem';
                label.style.width = '60px';

                const select = document.createElement('select');
                select.className = 'pref-select';
                select.id = `pref_priority_${i}`;
                select.style.flex = '1';
                select.style.padding = '6px';
                select.style.border = '1px solid #ccc';
                select.style.borderRadius = '4px';

                select.innerHTML = '<option value="">請選擇</option>';
                unitShifts.forEach(sh => {
                    select.innerHTML += `<option value="${sh.code}">${sh.name}</option>`;
                });

                // 帶入舊值
                const savedVal = this.userPreferences[`priority_${i}`];
                if (savedVal) select.value = savedVal;

                div.appendChild(label);
                div.appendChild(select);
                prefContainer.appendChild(div);
            }
        } else {
            prefContainer.innerHTML = '<div style="color:#999; font-size:0.9rem;">依單位規定排班，無需填寫志願。</div>';
        }
    },

    // --- 計算餘額 ---
    calcRemaining: function(day) {
        const date = new Date(this.data.year, this.data.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; // 0=Mon, 6=Sun

        let totalNeed = 0;
        // 計算當日總需求 (遍歷所有班別在該日的設定)
        // 這裡需要過濾出該單位的班別
        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        
        unitShifts.forEach(s => {
            const key = `${s.code}_${dayIdx}`;
            totalNeed += (this.dailyNeeds[key] || 0);
        });

        // 總人數 - 總需求 - Buffer
        return this.totalStaffCount - totalNeed - this.dailyReserved;
    },

    // --- 渲染月曆 ---
    renderCalendar: function() {
        const container = document.getElementById('calendarGrid');
        container.innerHTML = '';

        const weeks = ['日', '一', '二', '三', '四', '五', '六'];
        weeks.forEach(w => {
            const div = document.createElement('div');
            div.className = 'calendar-header';
            div.textContent = w;
            if (w === '日' || w === '六') div.style.color = '#e74c3c';
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

            // 計算名額
            const used = this.otherRequests[d] || 0;
            const quota = this.calcRemaining(d);
            
            // 判斷紅框/橘框
            if (cell.classList.contains('selected')) {
                if (used > quota) cell.classList.add('warn-red');
                else cell.classList.add('warn-orange');
            }

            // 人頭與數字
            let slotHtml = `<i class="fas fa-user"></i> ${used} / ${quota}`;
            let slotClass = (used >= quota) ? 'day-slots full' : 'day-slots';

            // [修正 3] Tooltip 顯示姓名
            let tooltip = `已預班人數: ${used}`;
            if (this.data.settings.showAllNames && this.dailyNames[d] && this.dailyNames[d].length > 0) {
                // 將名字串接，用換行符號分隔
                tooltip = "已預班人員:\n" + this.dailyNames[d].join('\n');
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
            // 額度警告
            if (used >= quota) {
                if(!confirm(`該日預班人數 (${used}) 已達上限 (${quota})，確定要候補嗎？`)) return;
            }
            
            // 限制檢查
            if (!this.checkLimits(isHoliday)) return;

            this.userRequest[key] = 'REQ_OFF';
            cell.classList.add('selected');
            
            if (used >= quota) cell.classList.add('warn-red');
            else cell.classList.add('warn-orange');
        }
        this.updateStats();
    },

    checkLimits: function(isTargetHoliday) {
        let offCount = 0;
        let holidayOffCount = 0;
        
        // 假設這一步成功，先加 1
        if (isTargetHoliday) holidayOffCount++;
        offCount++;

        // 加上已選的
        Object.keys(this.userRequest).forEach(k => {
            if (this.userRequest[k] === 'REQ_OFF') {
                offCount++;
                const d = parseInt(k.split('_')[1]);
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
        
        // 紅字提示
        document.getElementById('statOffCount').style.color = (offCount > this.maxOff) ? 'red' : '';
        document.getElementById('statHolidayOffCount').style.color = (holidayOffCount > this.maxHoliday) ? 'red' : '';
    },

    saveRequest: async function() {
        if (!confirm("確定提交預班資料？")) return;

        try {
            // 收集偏好設定
            const preferences = {};
            
            // 包班
            const bundleSelect = document.getElementById('inputBundleShift');
            if (bundleSelect) preferences.bundleShift = bundleSelect.value;

            // 志願序
            const selects = document.querySelectorAll('.pref-select');
            selects.forEach(sel => {
                const id = sel.id.replace('pref_', ''); // priority_1
                preferences[id] = sel.value;
            });

            // 儲存
            const uid = app.currentUser.uid;
            
            // 將偏好也存在 userRequest 物件中 (或分開存，這裡為了方便存取放在一起)
            // 注意：存檔時，assignments.{uid} 是整個被覆蓋，所以要包含所有資料
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
