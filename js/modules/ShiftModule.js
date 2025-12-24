import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const ShiftModule = {
    init: function() {
        this.tbody = document.getElementById('shift-table-body');
        this.addBtn = document.getElementById('btn-add-shift-row');
        this.saveBtn = document.getElementById('btn-save-shifts');

        if (!this.tbody) return;

        // 🌟 修正 1：明確傳入 event 參數 (e)
        // 並強制指定按鈕 type="button" 以防萬一
        this.addBtn.type = "button";
        this.saveBtn.type = "button";

        this.addBtn.onclick = (e) => this.addShiftRow(e);
        this.saveBtn.onclick = (e) => this.handleSave(e);

        // 監聽 Tab 切換
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
                // 這裡傳入 null 是因為 render 不需要 event
                this.addShiftRow(null, s.code, s.name, s.category, s.color, s.hours);
            });
        }
    },

    addShiftRow: function(e, code='', name='', type='Day', color='#eeeeee', hours=8) {
        // 🌟 修正 2：如果有事件觸發，先阻止冒泡
        if(e) {
            e.preventDefault(); 
            e.stopPropagation();
        }

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
            <td><button type="button" class="btn btn-sm btn-outline-danger btn-remove"><i class="bi bi-trash"></i></button></td>
        `;
        
        // 綁定刪除按鈕 (使用 class 綁定更安全)
        const removeBtn = tr.querySelector('.btn-remove');
        removeBtn.onclick = (evt) => {
            evt.preventDefault(); // 防止刪除按鈕也觸發刷新
            tr.remove();
        };

        this.tbody.appendChild(tr);
    },

    handleSave: async function(e) {
        // 🌟 修正 3：絕對阻止表單提交行為
        if(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const saveBtn = this.saveBtn;
        const originalText = saveBtn.innerHTML;
        
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
            // 寫入資料庫
            await UnitService.updateShifts(unitId, shiftsMap);
            
            // 更新本地記憶體
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
