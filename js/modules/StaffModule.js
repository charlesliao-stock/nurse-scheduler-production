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

        // 🌟 檢查：若無 activeUnitId，不執行 (雖然 app.js 有擋，但雙重保險)
        const activeUnitId = sysContext.getActiveUnitId();
        if (!activeUnitId) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">未選擇單位</td></tr>';
            return;
        }

        this.modalEl = document.getElementById('addStaffModal');
        this.modalTitle = document.getElementById('staffModalTitle');
        if (this.modalEl) {
            this.modal = new bootstrap.Modal(this.modalEl);
        }
        
        // 綁定事件
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        document.getElementById('staff-search-input')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        // ... (其他綁定保持不變) ...
        document.querySelectorAll('th.sortable').forEach(th => {
            th.onclick = () => this.handleSort(th.getAttribute('data-sort'));
        });

        // 初始載入
        this.initDropdowns();
        await this.loadList();
    },

    initDropdowns: function() {
        // 🌟 改用 getActiveUnitId
        const unitId = sysContext.getActiveUnitId();
        const unitName = sysContext.getUnitName();
        
        const filterSelect = document.getElementById('staff-filter-unit');
        const modalSelect = document.getElementById('staff-unitId');
        
        const opt = `<option value="${unitId}" selected>${unitName}</option>`;
        if(filterSelect) filterSelect.innerHTML = opt;
        if(modalSelect) modalSelect.innerHTML = opt;

        this.refreshUnitOptions();
    },

    refreshUnitOptions: function() {
        const config = sysContext.unitConfig || {};
        const groups = config.groups || [];
        const titles = config.titles || [];

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
        try {
            // 🌟 改用 getActiveUnitId
            const unitId = sysContext.getActiveUnitId();
            if(!unitId) return;

            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error(e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗</td></tr>';
        }
    },

    // ... (handleSearch, handleSort, applyFilterAndSort, render, handleDelete, calcSeniority, downloadTemplate, handleImport 保持不變) ...
    // 請保留原本的這些函式，只需確保 openModal 與 handleSave 使用 getActiveUnitId

    applyFilterAndSort: function(resetDisplay = true) {
        if (resetDisplay) {
            const searchInput = document.getElementById('staff-search-input');
            const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
            if (keyword) {
                this.handleSearch(keyword);
                return; 
            } else {
                this.state.displayStaff = [...this.state.allStaff];
            }
        }
        const field = this.state.sortField;
        const asc = this.state.sortAsc ? 1 : -1;
        this.state.displayStaff.sort((a, b) => {
            const valA = (a[field] || '').toString();
            const valB = (b[field] || '').toString();
            return valA.localeCompare(valB, 'zh-Hant') * asc;
        });
        this.render();
    },
    
    // ... Render ...
    render: function() {
        if(!this.tbody) return;
        this.tbody.innerHTML = '';
        const list = this.state.displayStaff;
        if (list.length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">無資料</td></tr>';
            return;
        }
        const unitName = sysContext.getUnitName();
        list.forEach(s => {
            const attr = s.attributes || {};
            let badges = '';
            if (attr.isPregnant) badges += '<span class="badge bg-danger me-1">孕</span>';
            if (attr.isNursing) badges += '<span class="badge bg-warning text-dark me-1">哺</span>';
            if (attr.isSpecial) {
                const typeText = attr.specialType === 'dayOnly' ? '限白' : '限早';
                badges += `<span class="badge bg-info text-dark me-1">特:${typeText}</span>`;
            }
            if (attr.canBundle) badges += '<span class="badge bg-success me-1">包</span>';

            const seniority = this.calcSeniority(s.hireDate); // 記得保留 calcSeniority

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${s.empId}</td>
                <td class="fw-bold">${s.name}</td>
                <td>${s.title || '-'}</td>
                <td><span class="badge bg-light text-dark border">${s.level}</span></td>
                <td>${s.group || '-'}</td>
                <td>${s.role === 'Admin' ? '管理' : '一般'}</td>
                <td class="small text-muted">${seniority}</td>
                <td>${badges}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary btn-edit me-1"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger btn-del"><i class="bi bi-trash"></i></button>
                </td>
            `;
            tr.querySelector('.btn-edit').onclick = () => this.openModal(s);
            tr.querySelector('.btn-del').onclick = () => this.handleDelete(s.empId);
            this.tbody.appendChild(tr);
        });
    },

    openModal: function(staff = null) {
        document.getElementById('add-staff-form').reset();
        this.refreshUnitOptions(); 
        
        // 🌟 確保 Modal 中的單位 ID 是 Active Unit
        document.getElementById('staff-unitId').value = sysContext.getActiveUnitId();

        // (其餘 Modal 邏輯保持不變，包含 Tab 切換、資料回填...)
        if (staff) {
            this.state.currentEditId = staff.empId;
            document.getElementById('staff-original-empId').value = staff.empId;
            if(this.modalTitle) this.modalTitle.innerText = "編輯人員";
            // ... 回填欄位 ...
            document.getElementById('staff-empId').value = staff.empId;
            document.getElementById('staff-name').value = staff.name;
            document.getElementById('staff-title').value = staff.title || '';
            document.getElementById('staff-email').value = staff.email || '';
            document.getElementById('staff-password').value = staff.password || '123456';
            document.getElementById('staff-level').value = staff.level;
            document.getElementById('staff-group').value = staff.group || '';
            document.getElementById('staff-role').value = staff.role || 'User';
            document.getElementById('staff-hireDate').value = staff.hireDate || '';
            
            const attr = staff.attributes || {};
            document.getElementById('staff-pregnant').checked = attr.isPregnant || false;
            document.getElementById('staff-nursing').checked = attr.isNursing || false;
            document.getElementById('staff-canBundle').checked = attr.canBundle || false;
            if(attr.isSpecial) {
                document.getElementById('staff-special').checked = true;
                const opts = document.getElementById('staff-special-options');
                if(opts) opts.classList.remove('d-none');
                if(attr.specialType === 'noNight') document.getElementById('special-noNight').checked = true;
                else document.getElementById('special-dayOnly').checked = true;
            }

        } else {
            this.state.currentEditId = null;
            document.getElementById('staff-original-empId').value = "";
            if(this.modalTitle) this.modalTitle.innerText = "新增人員";
            const opts = document.getElementById('staff-special-options');
            if(opts) opts.classList.add('d-none');
        }
        this.modal.show();
    },

    handleSave: async function() {
        // ... (保持不變，記得 unitId 取值要正確)
        const data = {
            // 🌟 這裡要取 DOM 的值，它已經被 openModal 設定為 Active Unit 了
            unitId: document.getElementById('staff-unitId').value, 
            empId: document.getElementById('staff-empId').value.trim(),
            name: document.getElementById('staff-name').value.trim(),
            // ... 其他欄位 ...
            title: document.getElementById('staff-title').value,
            email: document.getElementById('staff-email').value.trim(),
            password: document.getElementById('staff-password').value.trim(),
            level: document.getElementById('staff-level').value,
            group: document.getElementById('staff-group').value,
            role: document.getElementById('staff-role').value,
            hireDate: document.getElementById('staff-hireDate').value,
            isPregnant: document.getElementById('staff-pregnant').checked,
            isNursing: document.getElementById('staff-nursing').checked,
            isSpecial: document.getElementById('staff-special').checked,
            canBundle: document.getElementById('staff-canBundle').checked
        };
        
        let specialType = 'dayOnly';
        if(document.getElementById('special-noNight').checked) specialType = 'noNight';
        data.specialType = data.isSpecial ? specialType : null;

        if(!data.empId || !data.name) {
            alert("必填欄位未填");
            return;
        }

        try {
            const oldId = document.getElementById('staff-original-empId').value;
            if (this.state.currentEditId && oldId && oldId !== data.empId) {
                if(!confirm("員工編號已修改，確定建立新資料？")) return;
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
    
    // 記得保留這些 helper
    handleDelete: async function(empId) {
        if(confirm(`刪除 ${empId}?`)) {
            try { await StaffService.deleteStaff(empId); this.loadList(); }
            catch(e) { alert(e.message); }
        }
    },
    handleSearch: function(k) { /* ... */ },
    handleSort: function(f) { /* ... */ },
    calcSeniority: function(d) { 
        if(!d) return '-'; 
        // ... 簡單計算
        const diff = new Date() - new Date(d);
        const y = Math.floor(diff/31557600000);
        return y > 0 ? `${y}年` : `未滿1年`;
    },
    updateSeniorityText: function(d) { /* ... */ },
    downloadTemplate: function() { /* ... */ },
    handleImport: function(e) { /* ... */ }
};
