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

        this.addBtn.onclick = (e) => this.addShiftRow(e);
        this.saveBtn.onclick = (e) => this.handleSave(e);

        // 🌟 分區核心：檢查是否有選擇單位
        const activeUnitId = sysContext.getActiveUnitId();
        if (!activeUnitId) {
            this.tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5"><i class="bi bi-arrow-up-circle"></i> 請先於左上角選擇單位，才能設定該單位的班別。</td></tr>';
            this.addBtn.disabled = true;
            this.saveBtn.disabled = true;
            return;
        }

        // 初始載入
        this.render();
    },

    render: function() {
        // 🌟 讀取：只讀取當前單位的班別
        const shifts = sysContext.getShifts(); 
        this.tbody.innerHTML = '';

        if (Object.keys(shifts).length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">此單位尚無班別設定，請新增。</td></tr>';
        } else {
            // 排序：建議依照工時或習慣排序，這裡先簡單依照 Key
            Object.values(shifts).forEach(s => {
                this.addShiftRow(null, s.code, s.name, s.category, s.color, s.hours);
            });
        }
    },

    addShiftRow: function(e, code='', name='', type='Day', color='#eeeeee', hours=8) {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        if(this.tbody.innerHTML.includes('尚無班別') || this.tbody.innerHTML.includes('請先於左上角')) {
            this.tbody.innerHTML = '';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="form-control shift-code" value="${code}" placeholder="代碼 (D)"></td>
            <td><input type="text" class="form-control shift-name" value="${name}" placeholder="名稱 (白班)"></td>
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
        
        // 🌟 分區核心：再次確認單位 ID
        const unitId = sysContext.getActiveUnitId();
        if (!unitId) {
            alert("未選擇單位，無法儲存。");
            return;
        }

        const saveBtn = this.saveBtn;
        const originalText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 儲存中...';

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
            // 🌟 寫入：存入該單位的資料文件
            await UnitService.updateShifts(unitId, shiftsMap);
            
            // 更新本地快取，讓排班表不用 F5 就能抓到新班別
            sysContext.updateLocalShifts(shiftsMap);
            
            alert(`✅ [${sysContext.getUnitName()}] 班別設定已儲存！`);
        } catch (error) {
            alert("❌ 儲存失敗: " + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText;
        }
    }
};
