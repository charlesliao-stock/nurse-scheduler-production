import { sysContext } from "../core/SystemContext.js";
import { StaffService } from "../services/StaffService.js";
import { ScheduleService } from "../services/ScheduleService.js";

export const ScheduleEditorModule = {
    state: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 2, // 預設排下個月
        staffList: [],
        currentSchedule: {}, // 格式: { userId: { 1: 'D', 2: 'N'... } }
        worker: null // Web Worker 實例
    },

    init: async function() {
        // 處理跨年問題
        if (this.state.month > 12) { 
            this.state.year++; 
            this.state.month = 1; 
        }

        this.container = document.getElementById('schedule-grid-container');
        this.statusLabel = document.getElementById('schedule-status-label');
        
        // 綁定按鈕
        const btnAI = document.getElementById('btn-run-ai');
        const btnSave = document.getElementById('btn-save-schedule');
        const btnClear = document.getElementById('btn-clear-schedule');

        // 防止重複綁定
        if(btnAI) btnAI.onclick = () => this.runAI();
        if(btnSave) btnSave.onclick = () => this.saveSchedule();
        if(btnClear) btnClear.onclick = () => this.clearSchedule();

        // 初始化 Web Worker
        this.initWorker();

        // 載入資料
        await this.loadData();
    },

    initWorker: function() {
        if (window.Worker) {
            // 建立 Worker 實例
            this.state.worker = new Worker('js/workers/ai-scheduler.js');
            
            // 監聽 Worker 回傳
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
        const unitId = sysContext.getUnitId();
        this.container.innerHTML = '<div class="text-center p-5"><div class="spinner-border"></div></div>';

        try {
            // 1. 取得員工列表
            this.state.staffList = await StaffService.getStaffList(unitId);
            
            // 2. 嘗試讀取已存檔的排班
            const savedData = await ScheduleService.getFinalSchedule(unitId, this.state.year, this.state.month);
            
            if (savedData && savedData.assignments) {
                this.state.currentSchedule = savedData.assignments;
                if(this.statusLabel) this.statusLabel.innerText = `狀態：${savedData.status === 'Published' ? '已公告' : '草稿'}`;
            } else {
                this.state.currentSchedule = {}; // 無資料，全空
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

        this.setLoading(true, "AI 正在運算最佳排程 (Cycle 1-3)...");

        const unitId = sysContext.getUnitId();
        
        // 1. 先讀取預班資料 (Wishes)
        const preSchedules = await ScheduleService.getPreSchedule(unitId, this.state.year, this.state.month);

        // 2. 打包資料送給 Worker
        const payload = {
            staffList: this.state.staffList,
            shifts: sysContext.getShifts(),
            preSchedules: preSchedules,
            year: this.state.year,
            month: this.state.month,
            daysInMonth: new Date(this.state.year, this.state.month, 0).getDate()
        };

        // 3. 發送指令
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
        
        // 表頭日期
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(this.state.year, this.state.month - 1, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
            html += `<th style="min-width: 40px; ${isWeekend ? 'color:red' : ''}">${d}</th>`;
        }
        html += `</tr></thead><tbody>`;

        // 內容
        this.state.staffList.forEach(staff => {
            html += `<tr>
                <td class="position-sticky start-0 bg-white fw-bold text-start ps-2" style="z-index: 4;">${staff.name}</td>`;
            
            const userSchedule = this.state.currentSchedule[staff.id] || {};

            for (let d = 1; d <= daysInMonth; d++) {
                const shiftCode = userSchedule[d];
                let cellStyle = '';
                let display = '';

                if (shiftCode && shiftsConfig[shiftCode]) {
                    const s = shiftsConfig[shiftCode];
                    cellStyle = `background-color: ${s.color}; cursor: pointer;`;
                    display = s.code;
                } else {
                    cellStyle = `cursor: pointer;`; // 空白格
                }

                // 點擊儲存格切換班別
                // 這裡使用 onclick 傳遞參數，因為動態生成的格數太多，用 addEventListener 效能較差
                html += `<td style="${cellStyle}" onclick="ScheduleEditorModule.toggleCell('${staff.id}', ${d})">${display}</td>`;
            }
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        this.container.innerHTML = html;
    },

    toggleCell: function(staffId, day) {
        // 取得目前班別 -> 找下一個班別
        const current = this.state.currentSchedule[staffId]?.[day];
        const shiftKeys = Object.keys(sysContext.getShifts());
        
        // 選項循環： [班別1, 班別2..., OFF, null(清空)]
        const options = [...shiftKeys, 'OFF', null]; 
        
        // 如果現在是 null，indexOf 會回傳 -1，+1 變 0，剛好是第一個班別
        // 如果現在是 'OFF'，下一個就是 null
        let nextIndex = options.indexOf(current) + 1;
        if (nextIndex >= options.length) nextIndex = 0;
        
        const nextShift = options[nextIndex];

        // 更新狀態
        if (!this.state.currentSchedule[staffId]) this.state.currentSchedule[staffId] = {};
        this.state.currentSchedule[staffId][day] = nextShift;

        // 重新渲染
        this.renderGrid();
    },

    saveSchedule: async function() {
        const btn = document.getElementById('btn-save-schedule');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '儲存中...';

        try {
            const unitId = sysContext.getUnitId();
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

// 將模組掛載到 window，以便 HTML onclick 可以呼叫
window.ScheduleEditorModule = ScheduleEditorModule;
