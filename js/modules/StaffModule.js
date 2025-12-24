// js/modules/StaffModule.js
import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    // 初始化模組
    init: async function() {
        this.cacheDOM();
        this.bindEvents();
        await this.loadAndRender();
    },

    cacheDOM: function() {
        this.container = document.getElementById('staff-module-container');
        this.tableBody = document.getElementById('staff-table-body');
        this.addBtn = document.getElementById('btn-add-staff');
        this.saveBtn = document.getElementById('btn-save-staff');
        this.form = document.getElementById('add-staff-form');
        this.modalElement = document.getElementById('addStaffModal');
        // Bootstrap Modal 實例
        this.modal = new bootstrap.Modal(this.modalElement);
    },

    bindEvents: function() {
        this.addBtn.addEventListener('click', () => {
            this.form.reset();
            this.modal.show();
        });

        this.saveBtn.addEventListener('click', async () => {
            await this.handleSave();
        });
    },

    loadAndRender: async function() {
        try {
            const unitId = sysContext.currentUser.unitId;
            const staffList = await StaffService.getStaffList(unitId);
            this.renderTable(staffList);
        } catch (error) {
            alert("載入人員失敗: " + error.message);
        }
    },

    renderTable: function(list) {
        this.tableBody.innerHTML = '';
        if (list.length === 0) {
            this.tableBody.innerHTML = '<tr><td colspan="6" class="text-center">尚無人員資料</td></tr>';
            return;
        }

        list.forEach(staff => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${staff.empId || '-'}</td>
                <td>${staff.name}</td>
                <td><span class="badge bg-info text-dark">${staff.level || 'N'}</span></td>
                <td>${staff.group || '未分組'}</td>
                <td>
                    ${staff.isPregnant ? '<span class="badge bg-danger">孕</span>' : ''}
                    ${staff.onlyDayShift ? '<span class="badge bg-warning text-dark">僅白</span>' : ''}
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-primary">編輯</button>
                </td>
            `;
            this.tableBody.appendChild(row);
        });
    },

    handleSave: async function() {
        // 1. 蒐集表單資料
        const empId = document.getElementById('staff-empId').value;
        const name = document.getElementById('staff-name').value;
        const level = document.getElementById('staff-level').value;
        const group = document.getElementById('staff-group').value;
        const isPregnant = document.getElementById('staff-pregnant').checked;

        if(!empId || !name) {
            alert("員工編號與姓名為必填");
            return;
        }

        const newStaff = {
            unitId: sysContext.currentUser.unitId, // 綁定當前單位
            empId,
            name,
            level,
            group,
            isPregnant,
            role: 'User' // 預設角色
        };

        try {
            await StaffService.addStaff(newStaff);
            this.modal.hide();
            this.loadAndRender(); // 重新整理列表
            // 使用 SweetAlert (如果有的話) 或原生 Alert
            alert("新增成功！");
        } catch (error) {
            alert("新增失敗：" + error.message);
        }
    }
};
