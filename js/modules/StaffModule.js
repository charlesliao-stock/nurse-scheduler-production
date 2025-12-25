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
        
        // 🌟 修正：不管有沒有選單位，都要先綁定事件
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.handleAddClick());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        document.getElementById('staff-search-input')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        document.getElementById('btn-download-template')?.addEventListener('click', () => this.downloadTemplate());
        document.getElementById('btn-import-staff')?.addEventListener('click', () => document.getElementById('file-import-staff').click());
        document.getElementById('file-import-staff')?.addEventListener('change', (e) => this.handleImport(e));

        document.querySelectorAll('th.sortable').forEach(th => {
            th.onclick = () => this.handleSort(th.getAttribute('data-sort'));
        });

        document.getElementById('staff-hireDate')?.addEventListener('change', (e) => {
            this.updateSeniorityText(e.target.value);
        });

        document.getElementById('staff-special')?.addEventListener('change', (e) => {
            const opts = document.getElementById('staff-special-options');
            if(opts) e.target.checked ? opts.classList.remove('d-none') : opts.classList.add('d-none');
        });

        // 嘗試載入資料 (內部會檢查單位)
        this.initDropdowns();
        await this.loadList();
    },

    // 🌟 新增：點擊新增按鈕時的檢查
    handleAddClick: function() {
        if (!sysContext.getActiveUnitId()) {
            alert("請先於左上角選擇一個單位，才能新增人員。");
            return;
        }
        this.openModal();
    },

    initDropdowns: function() {
        const unitId = sysContext.getActiveUnitId();
        const unitName = sysContext.getUnitName();
        
        // 只有在有單位時才填入，否則顯示提示
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
        // 🌟 檢查移動到這裡：若無單位，顯示提示訊息
        const unitId = sysContext.getActiveUnitId();
        if (!unitId) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5"><i class="bi bi-arrow-up-circle"></i> 請先選擇單位以檢視資料</td></tr>';
            return;
        }

        try {
            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error(e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗</td></tr>';
        }
    },

    // ... (handleSearch, handleSort, applyFilterAndSort, render, handleDelete, calcSeniority, downloadTemplate 保持不變) ...
    
    // 請保留原本的這些函式內容
    applyFilterAndSort: function(resetDisplay = true) {
        if (resetDisplay) {
            const searchInput = document.getElementById('staff-search-input');
            const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
            if (keyword) { this.handleSearch(keyword); return; } 
            else { this.state.displayStaff = [...this.state.allStaff]; }
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

            const seniority = this.calcSeniority(s.hireDate);

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
        document.getElementById('staff-unitId').value = sysContext.getActiveUnitId();

        const firstTabEl = document.querySelector('#staffTab button[data-bs-target="#tab-basic"]');
        if(firstTabEl) { const t = new bootstrap.Tab(firstTabEl); t.show(); }

        const specialOptionsDiv = document.getElementById('staff-special-options');
        if(specialOptionsDiv) specialOptionsDiv.classList.add('d-none');

        if (staff) {
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
        // ... (保持不變)
        const unitId = document.getElementById('staff-unitId').value;
        // 防呆：如果是空值 (未選單位時打開 Modal)
        if(!unitId) { alert("系統錯誤：未取得單位 ID"); return; }

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

        if(!data.empId || !data.name) {
            alert("編號與姓名為必填");
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

    handleDelete: async function(empId) {
        if(confirm(`刪除 ${empId}?`)) {
            try { await StaffService.deleteStaff(empId); this.loadList(); }
            catch(e) { alert(e.message); }
        }
    },
    handleSearch: function(k) { 
        k = k.toLowerCase().trim();
        if (!k) this.state.displayStaff = [...this.state.allStaff];
        else this.state.displayStaff = this.state.allStaff.filter(s => s.empId.toLowerCase().includes(k) || s.name.toLowerCase().includes(k));
        this.applyFilterAndSort(false);
    },
    handleSort: function(f) {
        if (this.state.sortField === f) this.state.sortAsc = !this.state.sortAsc;
        else { this.state.sortField = f; this.state.sortAsc = true; }
        this.applyFilterAndSort(false);
    },
    calcSeniority: function(d) {
        if(!d) return '-'; 
        const diff = new Date() - new Date(d);
        const y = Math.floor(diff/31557600000);
        return y > 0 ? `${y}年` : `未滿1年`;
    },
    updateSeniorityText: function(d) {
        const el = document.getElementById('staff-seniority-text');
        if(el) el.innerText = `年資: ${this.calcSeniority(d)}`;
    },
    downloadTemplate: function() {
        const csvContent = "\uFEFF員工編號,姓名,層級(N/N1/N2/N3/N4),組別,Email,到職日(YYYY-MM-DD)\nA001,王小美,N1,A,user1@test.com,2020-01-01";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "人員匯入範例.csv";
        link.click();
    },
    handleImport: function(e) {
        const activeUnitId = sysContext.getActiveUnitId();
        if(!activeUnitId) { alert("請先選擇單位"); e.target.value=''; return; }

        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const rows = evt.target.result.split('\n').slice(1);
            let successCount = 0;
            for(let row of rows) {
                const cols = row.split(',');
                if(cols.length >= 2) {
                    try {
                        await StaffService.addStaff({
                            unitId: activeUnitId, // 🌟 使用 Active Unit
                            empId: cols[0].trim(),
                            name: cols[1].trim(),
                            level: cols[2]?.trim() || 'N',
                            group: cols[3]?.trim() || '',
                            email: cols[4]?.trim() || '',
                            hireDate: cols[5]?.trim() || null
                        });
                        successCount++;
                    } catch(err) { console.error("匯入失敗:", row, err); }
                }
            }
            alert(`匯入完成，成功 ${successCount} 筆`);
            this.loadList();
            e.target.value = '';
        };
        reader.readAsText(file);
    }
};
