import { StaffService } from "../services/StaffService.js";
import { UnitService } from "../services/UnitService.js"; // 引入 UnitService 取得單位列表
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    state: {
        allStaff: [],
        displayStaff: [],
        sortField: 'empId',
        sortAsc: true,
        currentEditId: null,
        unitMap: {} // 用來儲存 unitId -> unitName 的對照表 (ALL 模式用)
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
        const btnAdd = document.getElementById('btn-add-staff');
        if (btnAdd) btnAdd.onclick = () => this.handleAddClick();

        const btnSave = document.getElementById('btn-save-staff-submit');
        if (btnSave) btnSave.onclick = () => this.handleSave();

        const searchInput = document.getElementById('staff-search-input');
        if (searchInput) searchInput.oninput = (e) => this.handleSearch(e.target.value);
        
        const btnDownload = document.getElementById('btn-download-template');
        if (btnDownload) btnDownload.onclick = () => this.downloadTemplate();

        const btnImport = document.getElementById('btn-import-staff');
        if (btnImport) btnImport.onclick = () => document.getElementById('file-import-staff').click();

        const fileInput = document.getElementById('file-import-staff');
        if (fileInput) fileInput.onchange = (e) => this.handleImport(e);

        document.querySelectorAll('th.sortable').forEach(th => {
            th.onclick = () => this.handleSort(th.getAttribute('data-sort'));
        });

        const hireDateInput = document.getElementById('staff-hireDate');
        if (hireDateInput) hireDateInput.onchange = (e) => this.updateSeniorityText(e.target.value);

        const specialCheck = document.getElementById('staff-special');
        if (specialCheck) {
            specialCheck.onchange = (e) => {
                const opts = document.getElementById('staff-special-options');
                if(opts) e.target.checked ? opts.classList.remove('d-none') : opts.classList.add('d-none');
            };
        }

        // 初始化
        this.initDropdowns();
        await this.loadList();
    },

    handleAddClick: function() {
        // 在 ALL 模式下允許新增，因為我們會在 Modal 裡開放單位選擇
        const activeUnitId = sysContext.getActiveUnitId();
        if (!activeUnitId) {
            alert("請先選擇一個單位，或選擇「所有單位」。");
            return;
        }
        this.openModal();
    },

    initDropdowns: function() {
        const unitId = sysContext.getActiveUnitId();
        const unitName = sysContext.getUnitName();
        
        // 更新列表上方的篩選器顯示 (僅供參考，實際控制權在 Sidebar)
        const filterSelect = document.getElementById('staff-filter-unit');
        if(filterSelect) {
            let text = "未選擇";
            if (unitId === 'ALL') text = "所有單位";
            else if (unitId === 'UNASSIGNED') text = "未分發";
            else if (unitId) text = unitName;
            
            filterSelect.innerHTML = `<option selected>${text}</option>`;
            filterSelect.disabled = true; 
        }
        
        // 預設更新 Modal 內的下拉 (如果是特定單位)
        this.refreshUnitOptions();
    },

    refreshUnitOptions: function() {
        // 這主要是給特定單位用的，如果是 ALL 模式，Modal 打開時會另外處理
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
            // 如果是 ALL 或 UNASSIGNED，我們需要先抓取所有單位的名稱對照表
            if (unitId === 'ALL' || unitId === 'UNASSIGNED') {
                const units = await UnitService.getAllUnits();
                this.state.unitMap = {};
                units.forEach(u => this.state.unitMap[u.id] = u.name);
            } else {
                // 單一單位模式
                this.state.unitMap = { [unitId]: sysContext.getUnitName() };
            }

            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error(e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗: ' + e.message + '</td></tr>';
        }
    },

    openModal: async function(staff = null) {
        document.getElementById('add-staff-form').reset();
        
        const activeUnitId = sysContext.getActiveUnitId();
        const unitSelect = document.getElementById('staff-unitId');
        
        // 🌟 處理 Modal 內的單位選擇邏輯
        if (activeUnitId === 'ALL' || activeUnitId === 'UNASSIGNED') {
            // 模式 A: 開放選擇所有單位
            unitSelect.disabled = false;
            const units = await UnitService.getAllUnits();
            let html = '<option value="">請選擇單位...</option>';
            units.forEach(u => html += `<option value="${u.id}">${u.name}</option>`);
            unitSelect.innerHTML = html;
            
            // 如果是編輯模式，回填該員的單位
            if (staff && staff.unitId) unitSelect.value = staff.unitId;

        } else {
            // 模式 B: 鎖定當前單位
            unitSelect.disabled = true;
            unitSelect.innerHTML = `<option value="${activeUnitId}" selected>${sysContext.getUnitName()}</option>`;
            this.refreshUnitOptions(); // 載入該單位的組別/職稱
        }

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
            // 職稱與組別若是跨單位編輯，可能無法完美對應(因為下拉選單沒載入該單位設定)，暫時保留原始值顯示
            // 若要完美支援跨單位編輯組別，需要動態 fetch 該單位的 config，這裡先簡化處理
            
            // 嘗試回填
            const titleInput = document.getElementById('staff-title');
            // 若下拉選單沒有該選項，臨時加入
            if (![...titleInput.options].some(o => o.value === staff.title) && staff.title) {
                const opt = new Option(staff.title, staff.title);
                titleInput.add(opt);
            }
            titleInput.value = staff.title || '';

            document.getElementById('staff-email').value = staff.email || '';
            document.getElementById('staff-password').value = staff.password || '123456';
            document.getElementById('staff-level').value = staff.level;
            
            const groupInput = document.getElementById('staff-group');
            if (![...groupInput.options].some(o => o.value === staff.group) && staff.group) {
                const opt = new Option(staff.group, staff.group);
                groupInput.add(opt);
            }
            groupInput.value = staff.group || '';

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
        if(!unitId) { alert("請選擇所屬單位"); return; }

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
        if(this.state.sortField === field) {
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
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">無資料</td></tr>';
            return;
        }
        
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
            
            // 🌟 顯示正確的單位名稱 (從 map 查找，若找不到則顯示 ID)
            const displayUnitName = this.state.unitMap[s.unitId] || s.unitId || '<span class="text-danger">未分發</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${displayUnitName}</td>
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

    calcSeniority: function(d) { 
        if(!d) return '-'; 
        const diff = new Date() - new Date(d);
        const y = Math.floor(diff/31557600000);
        return y > 0 ? `${y}年` : `未滿1年`;
    },

    updateSeniorityText: function(d) { 
        const el = document.getElementById('staff-seniority-text'); 
        if(el) el.innerText=`年資: ${this.calcSeniority(d)}`; 
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
        
        // 匯入時如果是 ALL 模式，會比較麻煩，這裡簡單擋一下，要求先選單位
        if(!activeUnitId || activeUnitId === 'ALL') { 
            alert("批次匯入請先選擇特定單位，以確保資料正確歸屬。"); 
            e.target.value=''; 
            return; 
        }

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
                            unitId: activeUnitId,
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
