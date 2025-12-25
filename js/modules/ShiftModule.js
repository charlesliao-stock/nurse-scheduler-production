import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const ShiftModule = {
    init: function() {
        this.tbody = document.getElementById('shift-table-body');
        this.addBtn = document.getElementById('btn-add-shift-row');
        this.saveBtn = document.getElementById('btn-save-shifts');

        if (!this.tbody) return;

        this.addBtn.type = "button";
        this.saveBtn.type = "button";

        // 防止重複綁定：先移除再新增 (或使用 onclick)
        this.addBtn.onclick = (e) => this.addShiftRow(e);
        this.saveBtn.onclick = (e) => this.handleSave(e);

        // 初始載入
        this.render();
    },

    render: function() {
        const shifts = sysContext.getShifts();
        this.tbody.innerHTML = '';

        if (Object.keys(shifts).length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">尚無班別設定，請新增。</td></tr>';
        } else {
            Object.values(shifts).forEach(s => {
                this.addShiftRow(null, s.code, s.name, s.category, s.color, s.hours);
            });
        }
    },

    addShiftRow: function(e, code='', name='', type='Day', color='#eeeeee', hours=8) {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        if(this.tbody.innerHTML.includes('尚無班別')) this.tbody.innerHTML = '';

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
            <td><button type="button" class="btn btn-sm btn-outline-danger btn-remove"><i class="bi bi-trash"></i></button></td>
        `;
        
        tr.querySelector('.btn-remove').onclick = (evt) => { evt.preventDefault(); tr.remove(); };
        this.tbody.appendChild(tr);
    },

    handleSave: async function(e) {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        
        const saveBtn = this.saveBtn;
        const originalText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

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
            await UnitService.updateShifts(unitId, shiftsMap);
            sysContext.updateLocalShifts(shiftsMap);
            alert("✅ 班別設定已儲存！");
        } catch (error) {
            alert("❌ 儲存失敗: " + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText;
        }
    }
};
