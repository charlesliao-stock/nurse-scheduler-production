import { ScheduleService } from "../services/ScheduleService.js";
import { sysContext } from "../core/SystemContext.js";

export const PreScheduleModule = {
    state: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 2, // 預設排下個月 (1月排2月)
        userWishes: {}, // 當前使用者的預班暫存
        currentDay: null // 目前點擊的日期
    },

    init: async function() {
        // 處理跨年問題 (例如 12月排明年1月)
        if (this.state.month > 12) {
            this.state.year++;
            this.state.month = 1;
        }

        this.container = document.getElementById('calendar-container');
        this.monthLabel = document.getElementById('pre-month-label');
        
        // 綁定切換月份按鈕
        document.getElementById('btn-prev-month').onclick = () => this.changeMonth(-1);
        document.getElementById('btn-next-month').onclick = () => this.changeMonth(1);
        document.getElementById('btn-save-wishes').onclick = () => this.saveToDB();

        // Modal 相關
        this.wishModal = new bootstrap.Modal(document.getElementById('wishModal'));
        this.renderShiftOptions(); // 🌟 動態產生 Modal 內的班別按鈕

        await this.loadData();
    },

    changeMonth: async function(delta) {
        this.state.month += delta;
        if(this.state.month > 12) { this.state.month = 1; this.state.year++; }
        if(this.state.month < 1) { this.state.month = 12; this.state.year--; }
        await this.loadData();
    },

    loadData: async function() {
        this.monthLabel.innerText = `${this.state.year}年 ${this.state.month}月`;
        this.container.innerHTML = '<div class="text-center p-5"><div class="spinner-border"></div></div>';

        const unitId = sysContext.getUnitId();
        const userId = sysContext.getCurrentUserId();

        try {
            // 從 DB 讀取整個月的預班表
            const data = await ScheduleService.getPreSchedule(unitId, this.state.year, this.state.month);
            
            // 擷取自己的部分
            if (data && data.wishes && data.wishes[userId]) {
                this.state.userWishes = data.wishes[userId];
            } else {
                this.state.userWishes = {};
            }

            this.renderCalendar();
        } catch (error) {
            console.error(error);
            this.container.innerHTML = `<div class="alert alert-danger">載入失敗: ${error.message}</div>`;
        }
    },

    renderCalendar: function() {
        const daysInMonth = new Date(this.state.year, this.state.month, 0).getDate();
        const firstDayObj = new Date(this.state.year, this.state.month - 1, 1);
        const startDay = firstDayObj.getDay(); // 0(Sun) - 6(Sat)

        let html = '';

        // 補前面的空白
        for (let i = 0; i < startDay; i++) {
            html += `<div class="calendar-day disabled"></div>`;
        }

        // 產生 1 ~ 31 日
        const shiftsConfig = sysContext.getShifts();

        for (let d = 1; d <= daysInMonth; d++) {
            const currentWishCode = this.state.userWishes[d];
            let shiftContent = '';
            let style = '';

            // 如果這天有預班，顯示顏色與代號
            if (currentWishCode && shiftsConfig[currentWishCode]) {
                const s = shiftsConfig[currentWishCode];
                style = `background-color: ${s.color}; border-color: #ccc;`;
                shiftContent = `<span class="fw-bold">${s.code}</span>`;
            }

            // 檢查是否為週末 (顯示紅字)
            const dayOfWeek = new Date(this.state.year, this.state.month - 1, d).getDay();
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            const textClass = isWeekend ? 'text-danger' : 'text-dark';

            html += `
                <div class="calendar-day" onclick="PreScheduleModule.openDay(${d})" style="${style}">
                    <div class="day-num ${textClass}">${d}</div>
                    <div class="day-content">${shiftContent}</div>
                </div>
            `;
        }

        this.container.innerHTML = html;
    },

    // 🌟 關鍵：動態產生班別選項按鈕
    renderShiftOptions: function() {
        const container = document.getElementById('modal-shift-options');
        const shifts = sysContext.getShifts();
        let html = '';

        // 加入 "清除" 按鈕
        html += `<button class="btn btn-outline-secondary w-100 mb-2" onclick="PreScheduleModule.selectShift(null)">清除 (無預班)</button>`;

        // 遍歷所有動態班別
        Object.values(shifts).forEach(s => {
            // 使用內聯樣式顯示班別顏色，增加辨識度
            html += `
                <button class="btn btn-light w-100 mb-2 border" 
                        style="border-left: 5px solid ${s.color} !important; text-align:left;"
                        onclick="PreScheduleModule.selectShift('${s.code}')">
                    <strong>${s.code}</strong> - ${s.name}
                </button>`;
        });

        container.innerHTML = html;
    },

    openDay: function(day) {
        this.state.currentDay = day;
        document.getElementById('modal-date-title').innerText = `${this.state.month}月 ${day}日`;
        this.wishModal.show();
    },

    selectShift: function(shiftCode) {
        if (shiftCode) {
            this.state.userWishes[this.state.currentDay] = shiftCode;
        } else {
            delete this.state.userWishes[this.state.currentDay];
        }
        
        // 暫存後立即更新畫面 (Optimistic UI)
        this.renderCalendar();
        this.wishModal.hide();
    },

    saveToDB: async function() {
        const btn = document.getElementById('btn-save-wishes');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 儲存中...';

        try {
            const unitId = sysContext.getUnitId();
            const userId = sysContext.getCurrentUserId();
            
            await ScheduleService.savePersonalWishes(
                unitId, 
                this.state.year, 
                this.state.month, 
                userId, 
                this.state.userWishes
            );
            
            alert("✅ 預班已儲存！");
        } catch (error) {
            alert("儲存失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

// 將模組掛載到 window，讓 HTML onclick 可以呼叫
window.PreScheduleModule = PreScheduleModule;
