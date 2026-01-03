// js/modules/staff_pre_schedule_manager.js

const staffPreScheduleManager = {
    docId: null,
    data: null,
    shifts: [],
    staffMap: {},
    userRequest: {}, // 存放使用者的預班請求
    targetDay: null, // 右鍵點擊的日期
    
    // 初始化
    init: async function(id) {
        console.log("📝 Staff Pre-Schedule Init:", id);
        this.docId = id;
        
        if (!app.currentUser) {
            alert("請先登入");
            return;
        }

        this.cleanup(); // 清理舊監聽器

        try {
            // 1. 載入資料
            await this.loadData();
            await this.loadShifts();
            
            // 2. 渲染畫面
            this.renderHeader();
            this.renderCalendar();
            this.updateStats();
            this.setupEvents();
            
            // [修正] 確保右鍵選單移至 body
            const menu = document.getElementById('staffContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }
            
            console.log("✅ Staff Pre-Schedule 初始化完成");

        } catch (e) {
            console.error(e);
            alert("載入失敗: " + e.message);
        }
    },

    cleanup: function() {
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('staffContextMenu');
        if (menu) menu.style.display = 'none';
    },

    // --- 資料載入 ---
    loadData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("找不到預班表");
        this.data = doc.data();
        
        // 讀取該使用者的現有請求
        const uid = app.currentUser.uid;
        const allAssignments = this.data.assignments || {};
        this.userRequest = allAssignments[uid] || {};
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').get();
        let allShifts = snap.docs.map(d => d.data());
        // 過濾單位
        if(this.data.unitId) {
            allShifts = allShifts.filter(s => s.unitId === this.data.unitId);
        }
        this.shifts = allShifts;
    },

    // --- 渲染 ---
    renderHeader: function() {
        const title = document.getElementById('preScheduleTitle');
        const status = document.getElementById('preScheduleStatus');
        if(title) title.textContent = `${this.data.year} 年 ${this.data.month} 月 - 我的預班`;
        if(status) {
            const isOpen = this.data.status === 'open';
            status.textContent = isOpen ? '開放填寫中' : '已截止';
            status.className = `badge ${isOpen ? 'badge-success' : 'badge-danger'}`;
            
            // 如果已截止，隱藏提交按鈕
            const btn = document.querySelector('.btn-primary'); // 假設提交按鈕有這個 class
            if(btn) btn.style.display = isOpen ? 'inline-block' : 'none';
        }
    },

    renderCalendar: function() {
        const grid = document.getElementById('calendarGrid');
        if(!grid) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const firstDayOfWeek = new Date(year, month-1, 1).getDay(); // 0=Sun

        grid.innerHTML = '';

        // 1. 填補空白天數
        for(let i=0; i<firstDayOfWeek; i++) {
            const empty = document.createElement('div');
            empty.className = 'calendar-day empty';
            grid.appendChild(empty);
        }

        // 2. 產生日期格
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const key = `current_${d}`;
            const val = this.userRequest[key] || '';
            
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.dataset.day = d;
            
            // 根據選定值設定樣式
            this.applyCellStyle(cell, val);

            // 內容 HTML
            cell.innerHTML = `
                <div class="date-num">${d}</div>
                <div class="shift-val">${this.getShiftName(val)}</div>
            `;

            // 事件綁定 (右鍵選單)
            if(this.data.status === 'open') {
                cell.oncontextmenu = (e) => this.handleRightClick(e, d);
                // 手機版長按支援 (可選)
                // cell.addEventListener('touchstart', ...);
            }

            grid.appendChild(cell);
        }
    },

    applyCellStyle: function(cell, val) {
        // 重置
        cell.style.background = '#fff';
        cell.style.color = '#333';
        
        if (val === 'REQ_OFF') {
            cell.style.background = '#2ecc71'; // 綠色
            cell.style.color = '#fff';
        } else if (val) {
            const shift = this.shifts.find(s => s.code === val);
            if(shift) {
                cell.style.background = shift.color;
                cell.style.color = '#fff';
            }
        }
    },

    getShiftName: function(code) {
        if(code === 'REQ_OFF') return '預休';
        if(!code) return '';
        return code;
    },

    // --- [關鍵修正] 右鍵選單動態生成 ---
    handleRightClick: function(e, day) {
        e.preventDefault();
        this.targetDay = day;

        const menu = document.getElementById('staffContextMenu');
        if (!menu) return;

        // [重要] 填入選單內容
        const ul = menu.querySelector('ul') || menu;
        ul.innerHTML = ''; // 清空舊內容

        // 1. 標題
        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px 10px; background:#f1f1f1; font-weight:bold; border-bottom:1px solid #ddd;">${day}號 志願</div>`;
        header.style.pointerEvents = 'none';
        ul.appendChild(header);

        // 2. 預休選項 (REQ_OFF)
        const reqOffLi = document.createElement('li');
        reqOffLi.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:#2ecc71;margin-right:8px;border-radius:50%;"></span>預休 (REQ_OFF)`;
        reqOffLi.style.padding = '8px 12px';
        reqOffLi.style.cursor = 'pointer';
        reqOffLi.onclick = () => this.setShift('REQ_OFF');
        reqOffLi.onmouseover = () => reqOffLi.style.background = '#f9f9f9';
        reqOffLi.onmouseout = () => reqOffLi.style.background = 'white';
        ul.appendChild(reqOffLi);

        // 3. 可選班別 (如果單位允許選特定班)
        this.shifts.forEach(s => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${s.color};margin-right:8px;border-radius:50%;"></span>${s.code} (${s.name})`;
            li.style.padding = '8px 12px';
            li.style.cursor = 'pointer';
            li.onclick = () => this.setShift(s.code);
            li.onmouseover = () => li.style.background = '#f9f9f9';
            li.onmouseout = () => li.style.background = 'white';
            ul.appendChild(li);
        });

        // 4. 清除
        const clearLi = document.createElement('li');
        clearLi.innerHTML = `<span style="color:red;"><i class="fas fa-times"></i> 清除</span>`;
        clearLi.style.padding = '8px 12px';
        clearLi.style.cursor = 'pointer';
        clearLi.style.borderTop = '1px solid #eee';
        clearLi.onclick = () => this.setShift(null);
        clearLi.onmouseover = () => clearLi.style.background = '#fff0f0';
        clearLi.onmouseout = () => clearLi.style.background = 'white';
        ul.appendChild(clearLi);

        // 顯示
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    setShift: function(val) {
        if (!this.targetDay) return;
        
        const key = `current_${this.targetDay}`;
        
        if (val === null) {
            delete this.userRequest[key];
        } else {
            this.userRequest[key] = val;
        }

        // 隱藏選單
        document.getElementById('staffContextMenu').style.display = 'none';

        // 更新單一格子的顯示 (效能優化)
        const cell = document.querySelector(`.calendar-day[data-day="${this.targetDay}"]`);
        if(cell) {
            this.applyCellStyle(cell, val);
            cell.querySelector('.shift-val').textContent = this.getShiftName(val);
        }

        this.updateStats();
    },

    setupEvents: function() {
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        this.globalClickListener = (e) => {
            const menu = document.getElementById('staffContextMenu');
            if (menu) menu.style.display = 'none';
        };
        document.addEventListener('click', this.globalClickListener);
    },

    updateStats: function() {
        // 計算預休天數等
        let offCount = 0;
        Object.values(this.userRequest).forEach(v => {
            if(v === 'REQ_OFF') offCount++;
        });
        
        const statEl = document.getElementById('reqOffCount');
        if(statEl) statEl.textContent = offCount;
    },

    saveRequest: async function() {
        if (!confirm("確定提交您的預班資料嗎？")) return;

        try {
            const uid = app.currentUser.uid;
            // 更新路徑：assignments.{uid}
            const updateKey = `assignments.${uid}`;
            
            // 這裡可以加入 preferences (包班意願等) 的收集
            const preferences = {}; 
            // 如果 HTML 有相關輸入框，例如 bundleSelect
            const bundleSelect = document.getElementById('inputBundleShift');
            if(bundleSelect) preferences.bundleShift = bundleSelect.value;

            // 組合完整資料
            const userData = {
                ...this.userRequest, // current_1: 'N', ...
                preferences: preferences // 包班偏好
            };

            await db.collection('pre_schedules').doc(this.docId).update({
                [updateKey]: userData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            alert("提交成功！");
            history.back(); // 或 window.location.hash = '/staff/pre_schedule_list';

        } catch (e) {
            console.error(e);
            alert("提交失敗: " + e.message);
        }
    }
};
