import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    state: {
        allStaff: [],
        displayStaff: [],
        sortField: 'empId',
        sortAsc: true,
        currentEditId: null
    },

    init: async function() {
        this.tbody = document.getElementById('staff-table-body');
        if (!this.tbody) return;

        this.modalEl = document.getElementById('addStaffModal');
        this.modalTitle = document.getElementById('staffModalTitle');
        if (this.modalEl) {
            this.modal = new bootstrap.Modal(this.modalEl);
        }
        
        // 綁定事件
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.handleAddClick());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        document.getElementById('staff-search-input')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        // ... (其他事件綁定保持不變: import, sort, hireDate, special) ...
        document.getElementById('btn-download-template')?.addEventListener('click', () => this.downloadTemplate());
        document.getElementById('btn-import-staff')?.addEventListener('click', () => document.getElementById('file-import-staff').click());
        document.getElementById('file-import-staff')?.addEventListener('change', (e) => this.handleImport(e));
        document.querySelectorAll('th.sortable').forEach(th => th.onclick = () => this.handleSort(th.getAttribute('data-sort')));
        document.getElementById('staff-hireDate')?.addEventListener('change', (e) => this.updateSeniorityText(e.target.value));
        document.getElementById('staff-special')?.addEventListener('change', (e) => {
            const opts = document.getElementById('staff-special-options');
            if(opts) e.target.checked ? opts.classList.remove('d-none') : opts.classList.add('d-none');
        });

        // 初始化
        this.initDropdowns();
        await this.loadList();
    },

    handleAddClick: function() {
        if (!sysContext.getActiveUnitId()) {
            alert("請先於左上角選擇一個單位，才能新增人員。");
            return;
        }
        this.openModal();
    },

    initDropdowns: function() {
        // 🌟 分區核心：下拉選單只顯示當前單位，並鎖定
        const unitId = sysContext.getActiveUnitId();
        const unitName = sysContext.getUnitName();
        
        const text = unitId ? `${unitName}` : "未選擇";
        const val = unitId || "";

        const filterSelect = document.getElementById('staff-filter-unit');
        const modalSelect = document.getElementById('staff-unitId');
        
        const opt = `<option value="${val}" selected>${text}</option>`;
        if(filterSelect) filterSelect.innerHTML = opt;
        if(modalSelect) modalSelect.innerHTML = opt;

        this.refreshUnitOptions();
    },

    refreshUnitOptions: function() {
        // 🌟 分區核心：只讀取當前單位的 Group/Title
        const config = sysContext.getUnitConfig();
        const groups = config?.groups || [];
        const titles = config?.titles || [];

        const groupSelect = document.getElementById('staff-group');
        const titleSelect = document.getElementById('staff-title');

        if(groupSelect) {
            let html = '<option value="">無</option>';
            groups.forEach(g => html += `<option value="${g}">${g}</option>`);
            groupSelect.innerHTML = html;
        }
        if(titleSelect) {
            let html = '<option value="">無</option>';
            titles.forEach(t => html += `<option value="${t}">${t}</option>`);
            titleSelect.innerHTML = html;
        }
    },

    loadList: async function() {
        const unitId = sysContext.getActiveUnitId();
        if (!unitId) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5"><i class="bi bi-arrow-up-circle"></i> 請先選擇單位以檢視資料</td></tr>';
            return;
        }

        try {
            // 🌟 分區核心：只撈取該單位的員工
            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error(e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗</td></tr>';
        }
    },

    openModal: function(staff = null) {
        document.getElementById('add-staff-form').reset();
        this.refreshUnitOptions(); 
        
        // 🌟 鎖定單位 ID
        document.getElementById('staff-unitId').value = sysContext.getActiveUnitId();

        const firstTabEl = document.querySelector('#staffTab button[data-bs-target="#tab-basic"]');
        if(firstTabEl) { const t = new bootstrap.Tab(firstTabEl); t.show(); }

        const specialOptionsDiv = document.getElementById('staff-special-options');
        if(specialOptionsDiv) specialOptionsDiv.classList.add('d-none');

        if (staff) {
            // ... (資料回填邏輯，與之前相同，略過以節省篇幅) ...
            this.state.currentEditId = staff.empId;
            document.getElementById('staff-original-empId').value = staff.empId;
            if(this.modalTitle) this.modalTitle.innerText = "編輯人員";
            document.getElementById('staff-empId').value = staff.empId;
            document.getElementById('staff-name').value = staff.name;
            document.getElementById('staff-title').value = staff.title || '';
            document.getElementById('staff-email').value = staff.email || '';
            document.getElementById('staff-password').value = staff.password || '123456';
            document.getElementById('staff-level').value = staff.level;
            document.getElementById('staff-group').value = staff.group || '';
            document.getElementById('staff-role').value = staff.role || 'User';
            document.getElementById('staff-hireDate').value = staff.hireDate || '';
            this.updateSeniorityText(staff.hireDate);

            const attr = staff.attributes || {};
            document.getElementById('staff-pregnant').checked = attr.isPregnant || false;
            document.getElementById('staff-nursing').checked = attr.isNursing || false;
            document.getElementById('staff-canBundle').checked = attr.canBundle || false;
            if(attr.isSpecial) {
                document.getElementById('staff-special').checked = true;
                if(specialOptionsDiv) specialOptionsDiv.classList.remove('d-none');
                if(attr.specialType === 'noNight') document.getElementById('special-noNight').checked = true;
                else document.getElementById('special-dayOnly').checked = true;
            }
        } else {
            this.state.currentEditId = null;
            document.getElementById('staff-original-empId').value = "";
            if(this.modalTitle) this.modalTitle.innerText = "新增人員";
            this.updateSeniorityText('');
        }
        this.modal.show();
    },

    handleSave: async function() {
        const unitId = document.getElementById('staff-unitId').value;
        if(!unitId) { alert("系統錯誤：未取得單位 ID"); return; }
        
        // ... (取值與儲存邏輯，與之前相同) ...
        const specialChecked = document.getElementById('staff-special').checked;
        let specialType = 'dayOnly';
        if(document.getElementById('special-noNight').checked) specialType = 'noNight';

        const data = {
            unitId: unitId,
            empId: document.getElementById('staff-empId').value.trim(),
            name: document.getElementById('staff-name').value.trim(),
            title: document.getElementById('staff-title').value,
            email: document.getElementById('staff-email').value.trim(),
            password: document.getElementById('staff-password').value.trim(),
            level: document.getElementById('staff-level').value,
            group: document.getElementById('staff-group').value,
            role: document.getElementById('staff-role').value,
            hireDate: document.getElementById('staff-hireDate').value,
            isPregnant: document.getElementById('staff-pregnant').checked,
            isNursing: document.getElementById('staff-nursing').checked,
            isSpecial: specialChecked,
            specialType: specialChecked ? specialType : null,
            canBundle: document.getElementById('staff-canBundle').checked
        };

        if(!data.empId || !data.name) { alert("必填未填"); return; }

        try {
            const oldId = document.getElementById('staff-original-empId').value;
            if (this.state.currentEditId && oldId && oldId !== data.empId) {
                if(!confirm("員工編號已改，將重建資料，確定？")) return;
                await StaffService.deleteStaff(oldId);
                await StaffService.addStaff(data);
            } else if (this.state.currentEditId) {
                await StaffService.updateStaff(this.state.currentEditId, data);
            } else {
                await StaffService.addStaff(data);
            }
            this.modal.hide();
            this.loadList();
            alert("儲存成功");
        } catch (error) {
            alert("失敗: " + error.message);
        }
    },
    
    // ... (helper functions 保持不變) ...
    handleDelete: async function(id) { if(confirm("刪除?")) { await StaffService.deleteStaff(id); this.loadList(); } },
    handleSearch: function(k) { 
        k=k.toLowerCase().trim(); 
        if(!k) this.state.displayStaff=[...this.state.allStaff];
        else this.state.displayStaff=this.state.allStaff.filter(s=>s.empId.toLowerCase().includes(k)||s.name.toLowerCase().includes(k));
        this.applyFilterAndSort(false);
    },
    handleSort: function(f) { 
        if(this.state.sortField===f) this.state.sortAsc=!this.state.sortAsc;
        else { this.state.sortField=f; this.state.sortAsc=true; }
        this.applyFilterAndSort(false);
    },
    calcSeniority: function(d) { if(!d) return '-'; const y=Math.floor((new Date()-new Date(d))/31557600000); return y>0?`${y}年`:'未滿1年'; },
    updateSeniorityText: function(d) { const el=document.getElementById('staff-seniority-text'); if(el) el.innerText=`年資: ${this.calcSeniority(d)}`; },
    downloadTemplate: function() { /* ... */ },
    handleImport: function(e) { /* ... */ }
};
