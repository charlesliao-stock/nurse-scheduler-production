import { sysContext, PERMISSIONS_OPTS } from "../core/SystemContext.js";
import { StaffService } from "../services/StaffService.js";
import { ScheduleService } from "../services/ScheduleService.js";

export const ScheduleEditorModule = {
    state: {
        // ... (保持不變)
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

        const activeUnitId = sysContext.getActiveUnitId();
        if (!activeUnitId) {
            this.container.innerHTML = '<div class="alert alert-warning text-center p-5">請先於左上角選擇單位</div>';
            return;
        }

        // 🌟 權限控制
        const canEdit = sysContext.hasPermission(PERMISSIONS_OPTS.EDIT_SCHEDULE);
        const btnRun = document.getElementById('btn-run-ai');
        const btnSave = document.getElementById('btn-save-schedule');
        const btnClear = document.getElementById('btn-clear-schedule');

        if (!canEdit) {
            // 隱藏操作按鈕
            if(btnRun) btnRun.classList.add('d-none');
            if(btnSave) btnSave.classList.add('d-none');
            if(btnClear) btnClear.classList.add('d-none');
        } else {
            if(btnRun) { btnRun.classList.remove('d-none'); btnRun.onclick = () => this.runAI(); }
            if(btnSave) { btnSave.classList.remove('d-none'); btnSave.onclick = () => this.saveSchedule(); }
            if(btnClear) { btnClear.classList.remove('d-none'); btnClear.onclick = () => this.clearSchedule(); }
        }

        this.initWorker();
        await this.loadData();
    },

    // ... (initWorker, loadData, runAI 保持不變) ...

    renderGrid: function() {
        // ... (表頭生成邏輯保持不變) ...
        const daysInMonth = new Date(this.state.year, this.state.month, 0).getDate();
        const shiftsConfig = sysContext.getShifts();
        const canEdit = sysContext.hasPermission(PERMISSIONS_OPTS.EDIT_SCHEDULE); // 檢查權限

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
                let cellStyle = canEdit ? 'cursor: pointer;' : ''; // 無權限時不顯示手型
                let display = '';
                if (shiftCode && shiftsConfig[shiftCode]) {
                    const s = shiftsConfig[shiftCode];
                    cellStyle += `background-color: ${s.color};`;
                    display = s.code;
                }
                
                // 只有有權限才綁定 onclick
                const clickEvent = canEdit ? `onclick="ScheduleEditorModule.toggleCell('${staff.id}', ${d})"` : '';
                
                html += `<td style="${cellStyle}" ${clickEvent}>${display}</td>`;
            }
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
        this.container.innerHTML = html;
    },

    // ... (toggleCell, saveSchedule, clearSchedule, setLoading 保持不變) ...
    // 請務必保留這些函式
};
