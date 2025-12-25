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

    /**
     * 初始化模組
     */
    init: async function() {
        // DOM 綁定
        this.tbody = document.getElementById('staff-table-body');
        
        // 防呆：如果 DOM 還沒載入（例如切換太快），直接返回
        if (!this.tbody) return;

        this.modalEl = document.getElementById('addStaffModal');
        this.modalTitle = document.getElementById('staffModalTitle');
        // 確保 Modal 元素存在才初始化
        if (this.modalEl) {
            this.modal = new bootstrap.Modal(this.modalEl);
        }
        
        // 綁定按鈕與事件 (使用 ?. 防止按鈕不存在)
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        document.getElementById('staff-search-input')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        document.getElementById('btn-download-template')?.addEventListener('click', () => this.downloadTemplate());
        document.getElementById('btn-import-staff')?.addEventListener('click', () => document.getElementById('file-import-staff').click());
        document.getElementById('file-import-staff')?.addEventListener('change', (e) => this.handleImport(e));

        // 綁定表頭排序
        document.querySelectorAll('th.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.onclick = () => { 
                const field = th.getAttribute('data-sort');
                this.handleSort(field);
            };
        });

        // 綁定年資計算
        document.getElementById('staff-hireDate')?.addEventListener('change', (e) => {
            this.updateSeniorityText(e.target.value);
        });

        // 特殊規則顯示切換 (連動 Radio Button 顯示)
        document.getElementById('staff-special')?.addEventListener('change', (e) => {
            const optionsDiv = document.getElementById('staff-special-options');
            if(optionsDiv) {
                if(e.target.checked) optionsDiv.classList.remove('d-none');
                else optionsDiv.classList.add('d-none');
            }
        });

        // 初始化下拉選單
        this.initDropdowns();

        // 載入資料
        await this.loadList();
    },

    /**
     * 初始化下拉選單 (單位、組別、職稱)
     */
    initDropdowns: function() {
        // 1. 初始化單位選單 (可選自己單位)
        const unitId = sysContext.getUnitId();
        const unitName = sysContext.getUnitName();
        
        const filterSelect = document.getElementById('staff-filter-unit');
        const modalSelect = document.getElementById('staff-unitId');
        
        const opt = `<option value="${unitId}" selected>${unitName}</option>`;
        if(filterSelect) filterSelect.innerHTML = opt;
        if(modalSelect) modalSelect.innerHTML = opt;

        // 2. 根據當前單位，填入組別與職稱
        this.refreshUnitOptions();
    },

    /**
     * 讀取 Context 設定並刷新組別與職稱下拉選單
     */
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

    /**
     * 從資料庫載入人員列表
     */
    loadList: async function() {
        try {
            const unitId = sysContext.getUnitId();
            // 呼叫 Service 取得資料
            this.state.allStaff = await StaffService.getStaffList(unitId);
            // 進行預設排序與渲染
            this.applyFilterAndSort();
        } catch (e) {
            console.error("[StaffModule] loadList Error:", e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗: ' + e.message + '</td></tr>';
        }
    },

    /**
     * 處理搜尋
     */
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

    /**
     * 處理排序
     */
    handleSort: function(field) {
        if (this.state.sortField === field) {
            this.state.sortAsc = !this.state.sortAsc;
        } else {
            this.state.sortField = field;
            this.state.sortAsc = true;
        }
        this.applyFilterAndSort(false);
    },

    /**
     * 應用篩選與排序邏輯，並呼叫渲染
     */
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

    /**
     * 渲染表格內容
     */
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
            
            // 特殊標籤
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

    /**
     * 開啟 Modal (新增或編輯)
     */
    openModal: function(staff = null) {
        const form = document.getElementById('add-staff-form');
        if(form) form.reset();
        
        this.refreshUnitOptions(); // 確保下拉選單是最新的

        // 切換回第一個 Tab
        const firstTabEl = document.querySelector('#staffTab button[data-bs-target="#tab-basic"]');
        if(firstTabEl) {
            const firstTab = new bootstrap.Tab(firstTabEl);
            firstTab.show();
        }

        const specialOptionsDiv = document.getElementById('staff-special-options');
        if(specialOptionsDiv) specialOptionsDiv.classList.add('d-none');

        if (staff) {
            // 編輯模式
            this.state.currentEditId = staff.empId;
            // 紀錄原始 ID 以便比對是否修改
            const originalIdInput = document.getElementById('staff-original-empId');
            if(originalIdInput) originalIdInput.value = staff.empId;
            
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
            
            // 特殊邏輯回填
            if(attr.isSpecial) {
                document.getElementById('staff-special').checked = true;
                if(specialOptionsDiv) specialOptionsDiv.classList.remove('d-none');
                
                if(attr.specialType === 'noNight') {
                    const rb = document.getElementById('special-noNight');
                    if(rb) rb.checked = true;
                } else {
                    const rb = document.getElementById('special-dayOnly');
                    if(rb) rb.checked = true;
                }
            }

        } else {
            // 新增模式
            this.state.currentEditId = null;
            const originalIdInput = document.getElementById('staff-original-empId');
            if(originalIdInput) originalIdInput.value = "";
            
            if(this.modalTitle) this.modalTitle.innerText = "新增人員";
            this.updateSeniorityText('');
            document.getElementById('staff-unitId').value = sysContext.getUnitId();
        }

        if(this.modal) this.modal.show();
    },

    /**
     * 儲存人員資料
     */
    handleSave: async function() {
        const specialChecked = document.getElementById('staff-special').checked;
        // 取得 Radio button 值
        let specialType = 'dayOnly';
        const rbNoNight = document.getElementById('special-noNight');
        if(rbNoNight && rbNoNight.checked) specialType = 'noNight';

        const data = {
            unitId: document.getElementById('staff-unitId').value,
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
            // 檢查是否修改了員工編號 (ID)
            const oldIdInput = document.getElementById('staff-original-empId');
            const oldId = oldIdInput ? oldIdInput.value : null;
            
            if (this.state.currentEditId && oldId && oldId !== data.empId) {
                // ID 已變更：刪除舊的 -> 建立新的
                if(!confirm(`您修改了員工編號 (${oldId} -> ${data.empId})，這將視為建立新資料。確定嗎？`)) return;
                
                await StaffService.deleteStaff(oldId); // 刪舊
                await StaffService.addStaff(data);     // 建新
            } else if (this.state.currentEditId) {
                // ID 沒變：正常更新
                await StaffService.updateStaff(this.state.currentEditId, data);
            } else {
                // 新增模式
                await StaffService.addStaff(data);
            }

            if(this.modal) this.modal.hide();
            this.loadList();
            alert("儲存成功");
        } catch (error) {
            alert("失敗: " + error.message);
        }
    },

    /**
     * 刪除人員
     */
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

    /**
     * 計算年資字串
     */
    calcSeniority: function(dateStr) {
        if (!dateStr) return '-';
        const start = new Date(dateStr);
        const now = new Date();
        const diffTime = now - start;
        
        if (diffTime < 0) return '尚未到職';

        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const years = Math.floor(diffDays / 365);
        const months = Math.floor((diffDays % 365) / 30);
        
        if (years > 0) return `${years}年${months}個月`;
        return `${months}個月`;
    },

    updateSeniorityText: function(dateStr) {
        const el = document.getElementById('staff-seniority-text');
        if(el) {
            el.innerText = `年資: ${this.calcSeniority(dateStr)}`;
        }
    },

    /**
     * 下載 CSV 範例
     */
    downloadTemplate: function() {
        const csvContent = "\uFEFF員工編號,姓名,層級(N/N1/N2/N3/N4),組別,Email,到職日(YYYY-MM-DD)\nA001,王小美,N1,A,user1@test.com,2020-01-01";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "人員匯入範例.csv";
        link.click();
    },

    /**
     * 處理 CSV 匯入
     */
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
