import { sysContext } from "../core/SystemContext.js";
import { StaffService } from "../services/StaffService.js";
import { ScheduleService } from "../services/ScheduleService.js";

export const ScheduleEditorModule = {
    state: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 2,
        staffList: [],
        currentSchedule: {},
        worker: null
    },

    init: async function() {
        if (this.state.month > 12) { this.state.year++; this.state.month = 1; }

        this.container = document.getElementById('schedule-grid-container');
        this.statusLabel = document.getElementById('schedule-status-label');
        
        if (!this.container) return;

        // 🌟 檢查單位是否已選擇
        const activeUnitId = sysContext.getActiveUnitId();
        if (!activeUnitId) {
            this.container.innerHTML = '<div class="alert alert-warning text-center p-5">請先於左上角選擇單位</div>';
            if(this.statusLabel) this.statusLabel.innerText = "狀態：未選擇單位";
            return;
        }

        document.getElementById('btn-run-ai').onclick = () => this.runAI();
        document.getElementById('btn-save-schedule').onclick = () => this.saveSchedule();
        document.getElementById('btn-clear-schedule').onclick = () => this.clearSchedule();

        this.initWorker();
        await this.loadData();
    },

    initWorker: function() {
        if (window.Worker && !this.state.worker) {
            this.state.worker = new Worker('js/workers/ai-scheduler.js');
            this.state.worker.onmessage = (e) => {
                const { type, result, message } = e.data;
                if (type === 'SUCCESS') {
                    console.log("[Editor] AI 運算完成", result);
                    this.state.currentSchedule = result;
                    this.renderGrid();
                    this.setLoading(false);
                    alert("✅ AI 排班完成！請檢視結果並手動微調。");
                } else if (type === 'ERROR') {
                    console.error("[Editor] AI 錯誤", message);
                    this.setLoading(false);
                    alert("AI 運算發生錯誤: " + message);
                }
            };
        }
    },

    loadData: async function() {
        // 🌟 使用 getActiveUnitId
        const unitId = sysContext.getActiveUnitId();
        if(!unitId) return;

        this.container.innerHTML = '<div class="text-center p-5"><div class="spinner-border"></div></div>';

        try {
            // 載入人員
            this.state.staffList = await StaffService.getStaffList(unitId);
            
            // 載入排班表
            const savedData = await ScheduleService.getFinalSchedule(unitId, this.state.year, this.state.month);
            
            if (savedData && savedData.assignments) {
                this.state.currentSchedule = savedData.assignments;
                if(this.statusLabel) this.statusLabel.innerText = `狀態：${savedData.status === 'Published' ? '已公告' : '草稿'}`;
            } else {
                this.state.currentSchedule = {};
                if(this.statusLabel) this.statusLabel.innerText = "狀態：尚未建立";
            }
            this.renderGrid();
        } catch (error) {
            console.error(error);
            this.container.innerHTML = `<div class="alert alert-danger">載入失敗: ${error.message}</div>`;
        }
    },

    runAI: async function() {
        if (!confirm(`確定要執行 AI 排班嗎？\n這將會覆蓋目前的排班內容 (預班除外)。`)) return;
        
        const unitId = sysContext.getActiveUnitId(); // 🌟 使用 getActiveUnitId
        if(!unitId) { alert("未選擇單位"); return; }

        this.setLoading(true, "AI 正在運算最佳排程...");
        
        const preSchedules = await ScheduleService.getPreSchedule(unitId, this.state.year, this.state.month);
        const payload = {
            staffList: this.state.staffList,
            shifts: sysContext.getShifts(),
            preSchedules: preSchedules,
            daysInMonth: new Date(this.state.year, this.state.month, 0).getDate()
        };
        this.state.worker.postMessage({ type: 'START_AI', payload });
    },

    renderGrid: function() {
        const daysInMonth = new Date(this.state.year, this.state.month, 0).getDate();
        const shiftsConfig = sysContext.getShifts();

        let html = `<div class="table-responsive" style="max-height: 70vh; overflow: auto;">
            <table class="table table-bordered table-sm text-center" style="font-size: 0.9rem;">
                <thead class="table-light position-sticky top-0" style="z-index: 5;">
                    <tr>
                        <th class="position-sticky start-0 bg-light" style="z-index: 6; min-width: 100px;">員工</th>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(this.state.year, this.state.month - 1, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            html += `<th style="min-width: 40px; ${isWeekend ? 'color:red' : ''}">${d}</th>`;
        }
        html += `</tr></thead><tbody>`;

        this.state.staffList.forEach(staff => {
            html += `<tr><td class="position-sticky start-0 bg-white fw-bold text-start ps-2" style="z-index: 4;">${staff.name}</td>`;
            const userSchedule = this.state.currentSchedule[staff.id] || {};

            for (let d = 1; d <= daysInMonth; d++) {
                const shiftCode = userSchedule[d];
                let cellStyle = 'cursor: pointer;';
                let display = '';
                if (shiftCode && shiftsConfig[shiftCode]) {
                    const s = shiftsConfig[shiftCode];
                    cellStyle += `background-color: ${s.color};`;
                    display = s.code;
                }
                html += `<td style="${cellStyle}" onclick="ScheduleEditorModule.toggleCell('${staff.id}', ${d})">${display}</td>`;
            }
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
        this.container.innerHTML = html;
    },

    toggleCell: function(staffId, day) {
        const current = this.state.currentSchedule[staffId]?.[day];
        const shiftKeys = Object.keys(sysContext.getShifts());
        const options = [...shiftKeys, 'OFF', null]; 
        let nextIndex = options.indexOf(current) + 1;
        if (nextIndex >= options.length) nextIndex = 0;
        const nextShift = options[nextIndex];

        if (!this.state.currentSchedule[staffId]) this.state.currentSchedule[staffId] = {};
        this.state.currentSchedule[staffId][day] = nextShift;
        this.renderGrid();
    },

    saveSchedule: async function() {
        const btn = document.getElementById('btn-save-schedule');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '儲存中...';
        try {
            const unitId = sysContext.getActiveUnitId(); // 🌟 使用 getActiveUnitId
            if(!unitId) throw new Error("未選擇單位");

            await ScheduleService.saveFinalSchedule(unitId, this.state.year, this.state.month, this.state.currentSchedule);
            alert("✅ 排班表已儲存！");
        } catch (error) {
            alert("儲存失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },

    clearSchedule: function() {
        if(confirm("確定要清空整張排班表嗎？")) {
            this.state.currentSchedule = {};
            this.renderGrid();
        }
    },

    setLoading: function(isLoading, text) {
        const overlay = document.getElementById('loading-overlay');
        const txt = document.getElementById('loading-text');
        if (isLoading) {
            txt.innerText = text;
            overlay.classList.remove('d-none');
        } else {
            overlay.classList.add('d-none');
        }
    }
};

window.ScheduleEditorModule = ScheduleEditorModule;
