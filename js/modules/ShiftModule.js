import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const ShiftModule = {
    init: function() {
        this.tbody = document.getElementById('shift-table-body');
        this.addBtn = document.getElementById('btn-add-shift-row');
        this.saveBtn = document.getElementById('btn-save-shifts');

        if (!this.tbody) return;

        // 防止重複綁定
        this.addBtn.onclick = () => this.addShiftRow();
        this.saveBtn.onclick = () => this.handleSave();

        // 監聽 Tab 切換，每次切換到班別頁籤時刷新資料 (確保資料與 Context 同步)
        const tabEl = document.getElementById('tab-shift');
        if(tabEl) {
            tabEl.addEventListener('shown.bs.tab', () => {
                this.render();
            });
        }
    },

    render: function() {
        const shifts = sysContext.getShifts();
        this.tbody.innerHTML = '';

        if (Object.keys(shifts).length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">尚無班別設定，請新增。</td></tr>';
        } else {
            Object.values(shifts).forEach(s => {
                this.addShiftRow(s.code, s.name, s.category, s.color, s.hours);
            });
        }
    },

    addShiftRow: function(code='', name='', type='Day', color='#eeeeee', hours=8) {
        if(this.tbody.innerHTML.includes('尚無班別')) {
            this.tbody.innerHTML = '';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="form-control shift-code" value="${code}" placeholder="代碼"></td>
            <td><input type="text" class="form-control shift-name" value="${name}" placeholder="名稱"></td>
            <td>
                <select class="form-select shift-type">
                    <option value="Day" ${type==='Day'?'selected':''}>Day (日)</option>
                    <option value="Evening" ${type==='Evening'?'selected':''}>Evening (小)</option>
                    <option value="Night" ${type==='Night'?'selected':''}>Night (大)</option>
                    <option value="Off" ${type==='Off'?'selected':''}>Off (休)</option>
                </select>
            </td>
            <td><input type="color" class="form-control form-control-color w-100 shift-color" value="${color}"></td>
            <td><input type="number" class="form-control shift-hours" value="${hours}"></td>
            <td><button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()"><i class="bi bi-trash"></i></button></td>
        `;
        this.tbody.appendChild(tr);
    },

    handleSave: async function() {
        const saveBtn = this.saveBtn;
        const originalText = saveBtn.innerHTML;
        
        // UI 回饋：按鈕變更狀態
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 儲存中...';

        const unitId = sysContext.getUnitId();
        const rows = this.tbody.querySelectorAll('tr');
        const shiftsMap = {};

        rows.forEach(row => {
            const code = row.querySelector('.shift-code')?.value.trim();
            if(code) {
                shiftsMap[code] = {
                    code: code,
                    name: row.querySelector('.shift-name').value.trim(),
                    category: row.querySelector('.shift-type').value,
                    color: row.querySelector('.shift-color').value,
                    hours: Number(row.querySelector('.shift-hours').value)
                };
            }
        });

        try {
            // 1. 寫入資料庫
            await UnitService.updateShifts(unitId, shiftsMap);
            
            // 2. 🌟 關鍵：更新本地 Context，不需重整網頁
            sysContext.updateLocalShifts(shiftsMap);

            alert("✅ 班別設定已儲存！");

        } catch (error) {
            alert("❌ 儲存失敗: " + error.message);
        } finally {
            // 恢復按鈕
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText;
        }
    }
};
