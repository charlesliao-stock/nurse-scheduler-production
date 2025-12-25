import { ScheduleService } from "../services/ScheduleService.js";
import { sysContext } from "../core/SystemContext.js";

export const PreScheduleModule = {
    state: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 2, 
        userWishes: {},
        currentDay: null
    },

    init: async function() {
        if (this.state.month > 12) {
            this.state.year++;
            this.state.month = 1;
        }

        this.container = document.getElementById('calendar-container');
        this.monthLabel = document.getElementById('pre-month-label');
        
        if (!this.container) return; // 防呆

        document.getElementById('btn-prev-month').onclick = () => this.changeMonth(-1);
        document.getElementById('btn-next-month').onclick = () => this.changeMonth(1);
        document.getElementById('btn-save-wishes').onclick = () => this.saveToDB();

        // Modal
        const modalEl = document.getElementById('wishModal');
        this.wishModal = new bootstrap.Modal(modalEl);
        
        this.renderShiftOptions(); 

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
            const data = await ScheduleService.getPreSchedule(unitId, this.state.year, this.state.month);
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
        const startDay = firstDayObj.getDay(); 

        let html = '';
        for (let i = 0; i < startDay; i++) {
            html += `<div class="calendar-day disabled"></div>`;
        }

        const shiftsConfig = sysContext.getShifts();

        for (let d = 1; d <= daysInMonth; d++) {
            const currentWishCode = this.state.userWishes[d];
            let shiftContent = '';
            let style = '';

            if (currentWishCode && shiftsConfig[currentWishCode]) {
                const s = shiftsConfig[currentWishCode];
                style = `background-color: ${s.color}; border-color: #ccc;`;
                shiftContent = `<span class="fw-bold">${s.code}</span>`;
            }

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

    renderShiftOptions: function() {
        const container = document.getElementById('modal-shift-options');
        const shifts = sysContext.getShifts();
        let html = `<button class="btn btn-outline-secondary w-100 mb-2" onclick="PreScheduleModule.selectShift(null)">清除 (無預班)</button>`;

        Object.values(shifts).forEach(s => {
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
                unitId, this.state.year, this.state.month, userId, this.state.userWishes
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
window.PreScheduleModule = PreScheduleModule;
