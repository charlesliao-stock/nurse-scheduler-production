import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";

export const StaffModule = {
    // ... (state 保持不變) ...
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

        this.modal = new bootstrap.Modal(document.getElementById('addStaffModal'));
        this.modalTitle = document.getElementById('staffModalTitle');
        
        // 綁定事件
        document.getElementById('btn-add-staff')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-save-staff-submit')?.addEventListener('click', () => this.handleSave());
        // ... (搜尋、排序、匯入等保持不變) ...

        // 🌟 新增：特殊規則顯示切換
        document.getElementById('staff-special')?.addEventListener('change', (e) => {
            const optionsDiv = document.getElementById('staff-special-options');
            if(e.target.checked) optionsDiv.classList.remove('d-none');
            else optionsDiv.classList.add('d-none');
        });

        // 初始化下拉選單
        this.initDropdowns();

        await this.loadList();
    },

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

    // 🌟 新增：讀取 Context 設定並刷新下拉選單
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

    // ... (loadList, handleSearch, handleSort, calcSeniority 保持不變) ...

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
            
            // 特殊標籤顯示細節
            if (attr.isSpecial) {
                const typeText = attr.specialType === 'dayOnly' ? '限白' : '限早';
                badges += `<span class="badge bg-info text-dark me-1">特:${typeText}</span>`;
            }
            if (attr.canBundle) badges += '<span class="badge bg-success me-1">包</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${s.empId}</td>
                <td class="fw-bold">${s.name}</td>
                <td>${s.title || '-'}</td>
                <td><span class="badge bg-light text-dark border">${s.level}</span></td>
                <td>${s.group || '-'}</td>
                <td>${s.role === 'Admin' ? '管理' : '一般'}</td>
                <td>${badges}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary btn-edit"><i class="bi bi-pencil"></i></button>
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
        this.refreshUnitOptions(); // 確保下拉選單是最新的

        // 切回第一分頁
        const firstTabEl = document.querySelector('#staffTab button[data-bs-target="#tab-basic"]');
        if(firstTabEl) { const t = new bootstrap.Tab(firstTabEl); t.show(); }

        const specialOptionsDiv = document.getElementById('staff-special-options');
        specialOptionsDiv.classList.add('d-none');

        if (staff) {
            this.state.currentEditId = staff.empId;
            // 紀錄原始 ID 以便比對是否修改
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
            
            // 特殊邏輯
            if(attr.isSpecial) {
                document.getElementById('staff-special').checked = true;
                specialOptionsDiv.classList.remove('d-none');
                if(attr.specialType === 'noNight') {
                    document.getElementById('special-noNight').checked = true;
                } else {
                    document.getElementById('special-dayOnly').checked = true;
                }
            }

        } else {
            this.state.currentEditId = null;
            document.getElementById('staff-original-empId').value = "";
            if(this.modalTitle) this.modalTitle.innerText = "新增人員";
            this.updateSeniorityText('');
            document.getElementById('staff-unitId').value = sysContext.getUnitId();
        }
        this.modal.show();
    },

    handleSave: async function() {
        const specialChecked = document.getElementById('staff-special').checked;
        // 取得 Radio button 值
        let specialType = 'dayOnly';
        if(document.getElementById('special-noNight').checked) specialType = 'noNight';

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
            specialType: specialChecked ? specialType : null, // 只有啟用特殊時才存類型
            canBundle: document.getElementById('staff-canBundle').checked
        };

        if(!data.empId || !data.name) {
            alert("編號與姓名為必填");
            return;
        }

        try {
            // 🌟 檢查是否修改了員工編號 (ID)
            const oldId = document.getElementById('staff-original-empId').value;
            
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
    
    updateSeniorityText: function(dateStr) {
        // ... (保持不變) ...
        const el = document.getElementById('staff-seniority-text');
        if(el) {
            if(!dateStr) el.innerText = "年資: -";
            else {
                // 簡單計算
                const diff = new Date() - new Date(dateStr);
                const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
                const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30));
                el.innerText = `年資: ${years}年${months}個月`;
            }
        }
    }
};
