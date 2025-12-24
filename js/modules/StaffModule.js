import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    init: async function() {
        this.tbody = document.getElementById('staff-table-body');
        this.addBtn = document.getElementById('btn-add-staff');
        this.saveBtn = document.getElementById('btn-save-staff');
        
        // Modal instance
        const modalEl = document.getElementById('addStaffModal');
        this.modal = new bootstrap.Modal(modalEl);

        this.addBtn.onclick = () => {
            document.getElementById('add-staff-form').reset();
            this.modal.show();
        };

        this.saveBtn.onclick = () => this.handleSave();

        await this.loadList();
    },

    loadList: async function() {
        try {
            const unitId = sysContext.getUnitId();
            const list = await StaffService.getStaffList(unitId);
            this.render(list);
        } catch (e) {
            console.error(e);
        }
    },

    render: function(list) {
        this.tbody.innerHTML = '';
        if(list.length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">尚無人員</td></tr>';
            return;
        }
        list.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.empId}</td>
                <td>${s.name}</td>
                <td><span class="badge bg-light text-dark border">${s.level}</span></td>
                <td>${s.group || '-'}</td>
                <td>${s.isPregnant ? '<span class="badge bg-danger">孕/哺</span>' : ''}</td>
                <td><button class="btn btn-sm btn-outline-primary">編輯</button></td>
            `;
            this.tbody.appendChild(tr);
        });
    },

    handleSave: async function() {
        const data = {
            empId: document.getElementById('staff-empId').value,
            name: document.getElementById('staff-name').value,
            level: document.getElementById('staff-level').value,
            group: document.getElementById('staff-group').value,
            isPregnant: document.getElementById('staff-pregnant').checked,
            unitId: sysContext.getUnitId()
        };

        if(!data.empId || !data.name) {
            alert("請輸入完整資料");
            return;
        }

        try {
            await StaffService.addStaff(data);
            this.modal.hide();
            this.loadList();
            alert("✅ 新增成功");
        } catch (error) {
            alert("失敗: " + error.message);
        }
    }
};
