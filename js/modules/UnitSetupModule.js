import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const UnitSetupModule = {
    init: function() {
        this.form = document.getElementById('unit-setup-form');
        this.tbody = document.getElementById('setup-shift-tbody');
        this.addBtn = document.getElementById('btn-add-shift-row');

        // 綁定事件
        this.addBtn.addEventListener('click', () => this.addShiftRow());
        this.form.addEventListener('submit', (e) => this.handleSave(e));

        // 預設加入 4 個標準班別列 (D, E, N, OFF)
        this.addShiftRow('D', '白班', 'Day', '#ffe6e6');
        this.addShiftRow('E', '小夜', 'Evening', '#fff5e6');
        this.addShiftRow('N', '大夜', 'Night', '#e6f2ff');
        this.addShiftRow('OFF', '休假', 'Off', '#eeeeee');
    },

    addShiftRow: function(code='', name='', type='Day', color='#ffffff') {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="text" class="form-control form-control-sm shift-code" value="${code}" placeholder="代號"></td>
            <td><input type="text" class="form-control form-control-sm shift-name" value="${name}" placeholder="名稱"></td>
            <td>
                <select class="form-select form-select-sm shift-type">
                    <option value="Day" ${type==='Day'?'selected':''}>Day</option>
                    <option value="Evening" ${type==='Evening'?'selected':''}>Evening</option>
                    <option value="Night" ${type==='Night'?'selected':''}>Night</option>
                    <option value="Off" ${type==='Off'?'selected':''}>Off</option>
                </select>
            </td>
            <td><input type="color" class="form-control form-control-color shift-color" value="${color}"></td>
            <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">X</button></td>
        `;
        this.tbody.appendChild(row);
    },

    handleSave: async function(e) {
        e.preventDefault();
        const unitId = document.getElementById('setup-unit-id').value;
        const unitName = document.getElementById('setup-unit-name').value;
        
        // 蒐集班別資料
        const shifts = {};
        const rows = this.tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const code = row.querySelector('.shift-code').value;
            const name = row.querySelector('.shift-name').value;
            const type = row.querySelector('.shift-type').value;
            const color = row.querySelector('.shift-color').value;
            
            if(code) {
                shifts[code] = { code, name, category: type, color };
            }
        });

        try {
            if(Object.keys(shifts).length === 0) throw new Error("至少需要一個班別");

            await UnitService.createUnitConfig(sysContext.currentUser.uid, unitId, unitName, shifts);
            
            alert("設定建立成功！系統將重新載入。");
            window.location.reload();

        } catch (error) {
            alert("儲存失敗: " + error.message);
        }
    }
};
