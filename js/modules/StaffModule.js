import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    // 狀態管理
    state: {
        allStaff: [],
        displayStaff: [],
        sortField: 'empId',
        sortAsc: true,
        currentEditId: null
    },

    // 🌟 init 不需參數，因為 HTML 此時已經在網頁上了
    init: async function() {
        // DOM 綁定
        this.tbody = document.getElementById('staff-table-body');
        this.modalEl = document.getElementById('addStaffModal');
        this.modalTitle = document.getElementById('staffModalTitle');
        
        // 防呆：如果切換畫面太快，DOM 可能抓不到，做個檢查
        if (!this.tbody) return;

        // 初始化 Modal
        this.modal = new bootstrap.Modal(this.modalEl);
        
        // 綁定按鈕與事件
        // 使用 ?. 運算子防止某些按鈕不存在時報錯
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        document.getElementById('staff-search-input')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        document.getElementById('btn-download-template')?.addEventListener('click', () => this.downloadTemplate());
        document.getElementById('btn-import-staff')?.addEventListener('click', () => document.getElementById('file-import-staff').click());
        document.getElementById('file-import-staff')?.addEventListener('change', (e) => this.handleImport(e));

        // 綁定表頭排序
        document.querySelectorAll('th.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.onclick = () => { // 使用 onclick 避免重複綁定
                const field = th.getAttribute('data-sort');
                this.handleSort(field);
            };
        });

        // 綁定年資計算
        document.getElementById('staff-hireDate')?.addEventListener('change', (e) => {
            this.updateSeniorityText(e.target.value);
        });

        // 初始化單位下拉選單
        this.initUnitSelect();

        // 載入資料
        await this.loadList();
    },

    initUnitSelect: function() {
        const select = document.getElementById('staff-filter-unit');
        const modalSelect = document.getElementById('staff-unitId');
        
        const unitId = sysContext.getUnitId();
        const unitName = sysContext.getUnitName();

        if(select) select.innerHTML = `<option value="${unitId}" selected>${unitName}</option>`;
        if(modalSelect) modalSelect.innerHTML = `<option value="${unitId}" selected>${unitName}</option>`;
    },

    loadList: async function() {
        try {
            const unitId = sysContext.getUnitId();
            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error(e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗</td></tr>';
        }
    },

    handleSearch: function(keyword) {
        keyword = keyword.toLowerCase().trim();
        if (!keyword) {
            this.state.displayStaff = [...this.state.allStaff];
        } else {
            this.state.displayStaff = this.state.allStaff.filter(s => 
                s.empId.toLowerCase().includes(keyword) || 
                s.name.toLowerCase().includes(keyword)
            );
        }
        this.applyFilterAndSort(false);
    },

    handleSort: function(field) {
        if (this.state.sortField === field) {
            this.state.sortAsc = !this.state.sortAsc;
        } else {
            this.state.sortField = field;
            this.state.sortAsc = true;
        }
        this.applyFilterAndSort(false);
    },

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

    render: function() {
        if(!this.tbody) return;
        this.tbody.innerHTML = '';
        const list = this.state.displayStaff;

        if (list.length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">無相符資料</td></tr>';
            return;
        }

        const unitName = sysContext.getUnitName();

        list.forEach(s => {
            const attr = s.attributes || {};
            let badges = '';
            if (attr.isPregnant) badges += '<span class="badge bg-danger me-1">孕</span>';
            if (attr.isNursing) badges += '<span class="badge bg-warning text-dark me-1">哺</span>';
            if (attr.isSpecial) badges += '<span class="badge bg-info text-dark me-1">特</span>';
            if (attr.canBundle) badges += '<span class="badge bg-success me-1">包</span>';

            const seniority = this.calcSeniority(s.hireDate);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${s.empId}</td>
                <td class="fw-bold">${s.name}</td>
                <td><span class="badge bg-light text-dark border">${s.level}</span></td>
                <td>${s.group || '-'}</td>
                <td>${s.role === 'Admin' ? '<i class="bi bi-shield-lock text-primary"></i>' : ''}</td>
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
        const form = document.getElementById('add-staff-form');
        if(form) form.reset();
        
        // 切換回第一個 Tab
        const firstTabEl = document.querySelector('#staffTab button[data-bs-target="#tab-basic"]');
        if(firstTabEl) {
            const firstTab = new bootstrap.Tab(firstTabEl);
            firstTab.show();
        }

        if (staff) {
            this.state.currentEditId = staff.empId;
            if(this.modalTitle) this.modalTitle.innerText = "編輯人員";
            document.getElementById('staff-empId').value = staff.empId;
            document.getElementById('staff-empId').disabled = true;
            document.getElementById('staff-name').value = staff.name;
            document.getElementById('staff-email').value = staff.email || '';
            document.getElementById('staff-level').value = staff.level;
            document.getElementById('staff-group').value = staff.group || '';
            document.getElementById('staff-role').value = staff.role || 'User';
            document.getElementById('staff-hireDate').value = staff.hireDate || '';
            this.updateSeniorityText(staff.hireDate);

            const attr = staff.attributes || {};
            document.getElementById('staff-pregnant').checked = attr.isPregnant || false;
            document.getElementById('staff-nursing').checked = attr.isNursing || false;
            document.getElementById('staff-special').checked = attr.isSpecial || false;
            document.getElementById('staff-canBundle').checked = attr.canBundle || false;
        } else {
            this.state.currentEditId = null;
            if(this.modalTitle) this.modalTitle.innerText = "新增人員";
            document.getElementById('staff-empId').disabled = false;
            this.updateSeniorityText('');
            document.getElementById('staff-unitId').value = sysContext.getUnitId();
        }

        this.modal.show();
    },

    handleSave: async function() {
        const data = {
            unitId: sysContext.getUnitId(),
            empId: document.getElementById('staff-empId').value.trim(),
            name: document.getElementById('staff-name').value.trim(),
            email: document.getElementById('staff-email').value.trim(),
            level: document.getElementById('staff-level').value,
            group: document.getElementById('staff-group').value,
            role: document.getElementById('staff-role').value,
            hireDate: document.getElementById('staff-hireDate').value,
            isPregnant: document.getElementById('staff-pregnant').checked,
            isNursing: document.getElementById('staff-nursing').checked,
            isSpecial: document.getElementById('staff-special').checked,
            canBundle: document.getElementById('staff-canBundle').checked
        };

        if(!data.empId || !data.name) {
            alert("編號與姓名為必填");
            return;
        }

        try {
            if (this.state.currentEditId) {
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
        if(confirm(`確定要刪除員工 ${empId} 嗎？`)) {
            try {
                await StaffService.deleteStaff(empId);
                this.loadList();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    },

    calcSeniority: function(dateStr) {
        if (!dateStr) return '-';
        const start = new Date(dateStr);
        const now = new Date();
        const diffTime = Math.abs(now - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const years = Math.floor(diffDays / 365);
        const months = Math.floor((diffDays % 365) / 30);
        
        if (years > 0) return `${years}年${months}個月`;
        return `${months}個月`;
    },

    updateSeniorityText: function(dateStr) {
        const el = document.getElementById('staff-seniority-text');
        if(el) el.innerText = `年資: ${this.calcSeniority(dateStr)}`;
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
        const file = e.target.files[0];
        if(!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const text = evt.target.result;
            const rows = text.split('\n').slice(1); // 去掉標題
            let successCount = 0;

            for(let row of rows) {
                const cols = row.split(',');
                if(cols.length >= 2) {
                    try {
                        await StaffService.addStaff({
                            unitId: sysContext.getUnitId(),
                            empId: cols[0].trim(),
                            name: cols[1].trim(),
                            level: cols[2]?.trim() || 'N',
                            group: cols[3]?.trim() || '',
                            email: cols[4]?.trim() || '',
                            hireDate: cols[5]?.trim() || null
                        });
                        successCount++;
                    } catch(err) {
                        console.error("匯入失敗:", row, err);
                    }
                }
            }
            alert(`匯入完成，成功新增 ${successCount} 筆`);
            this.loadList();
            e.target.value = ''; // 清空 input
        };
        reader.readAsText(file);
    }
};
