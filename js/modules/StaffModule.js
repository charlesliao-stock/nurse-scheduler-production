import { StaffService } from "../services/StaffService.js";
import { UnitService } from "../services/UnitService.js";
import { sysContext, PERMISSIONS_OPTS } from "../core/SystemContext.js";

export const StaffModule = {
    // 狀態管理
    state: {
        allStaff: [],
        displayStaff: [],
        sortField: 'empId',
        sortAsc: true,
        currentEditId: null,
        unitMap: {} // 用來儲存 unitId -> unitName 的對照表 (ALL 模式用)
    },

    /**
     * 初始化模組
     */
    init: async function() {
        this.tbody = document.getElementById('staff-table-body');
        // 防呆：如果 DOM 還沒載入，直接返回
        if (!this.tbody) return;

        this.modalEl = document.getElementById('addStaffModal');
        this.modalTitle = document.getElementById('staffModalTitle');
        if (this.modalEl) {
            this.modal = new bootstrap.Modal(this.modalEl);
        }
        
        // 檢查權限：決定是否顯示操作按鈕
        const canManage = sysContext.hasPermission(PERMISSIONS_OPTS.MANAGE_STAFF);
        
        // 綁定按鈕與事件
        const btnAdd = document.getElementById('btn-add-staff');
        const btnImport = document.getElementById('btn-import-staff');
        const btnDownload = document.getElementById('btn-download-template');

        if (!canManage) {
            // 無權限則隱藏按鈕
            if(btnAdd) btnAdd.classList.add('d-none');
            if(btnImport) btnImport.classList.add('d-none');
            if(btnDownload) btnDownload.classList.add('d-none');
        } else {
            // 有權限則綁定事件
            if(btnAdd) {
                btnAdd.classList.remove('d-none');
                btnAdd.onclick = () => this.handleAddClick();
            }
            if(btnImport) {
                btnImport.classList.remove('d-none');
                btnImport.onclick = () => document.getElementById('file-import-staff').click();
            }
            if(btnDownload) {
                btnDownload.classList.remove('d-none');
                btnDownload.onclick = () => this.downloadTemplate();
            }
            
            const fileInput = document.getElementById('file-import-staff');
            if (fileInput) fileInput.onchange = (e) => this.handleImport(e);

            const btnSave = document.getElementById('btn-save-staff-submit');
            if (btnSave) btnSave.onclick = () => this.handleSave();
        }

        // 搜尋與排序 (所有人都能用)
        const searchInput = document.getElementById('staff-search-input');
        if (searchInput) searchInput.oninput = (e) => this.handleSearch(e.target.value);
        
        document.querySelectorAll('th.sortable').forEach(th => {
            th.onclick = () => this.handleSort(th.getAttribute('data-sort'));
        });

        // 綁定年資計算
        const hireDateInput = document.getElementById('staff-hireDate');
        if (hireDateInput) hireDateInput.onchange = (e) => this.updateSeniorityText(e.target.value);

        // 特殊規則顯示切換 (連動 Radio Button)
        const specialCheck = document.getElementById('staff-special');
        if (specialCheck) {
            specialCheck.onchange = (e) => {
                const opts = document.getElementById('staff-special-options');
                if(opts) e.target.checked ? opts.classList.remove('d-none') : opts.classList.add('d-none');
            };
        }

        // 初始化下拉選單與列表
        this.initDropdowns();
        await this.loadList();
    },

    /**
     * 點擊新增按鈕
     */
    handleAddClick: function() {
        const activeUnitId = sysContext.getActiveUnitId();
        
        // 修正邏輯：
        // 1. 如果是系統管理員，無論有無選擇單位，都允許開啟視窗 (會進入 openModal 判斷是否落入未分發)
        // 2. 如果是一般管理者，必須先選擇特定單位才能新增
        if (!activeUnitId && !sysContext.isSystemAdmin()) {
            alert("請先於左上角選擇一個單位。");
            return;
        }
        this.openModal();
    },

    /**
     * 初始化工具列的下拉選單
     */
    initDropdowns: function() {
        const unitId = sysContext.getActiveUnitId();
        const unitName = sysContext.getUnitName();
        
        const filterSelect = document.getElementById('staff-filter-unit');
        
        if(filterSelect) {
            let text = "未選擇";
            if (unitId === 'ALL') text = "所有單位";
            else if (unitId === 'UNASSIGNED') text = "未分發";
            else if (unitId) text = unitName;
            
            filterSelect.innerHTML = `<option selected>${text}</option>`;
            filterSelect.disabled = true; 
        }
        
        // 預設更新 Modal 內的下拉 (如果是特定單位模式)
        if (unitId && unitId !== 'ALL' && unitId !== 'UNASSIGNED') {
            this.refreshUnitOptions();
        }
    },

    /**
     * 讀取 Context 設定並刷新組別與職稱下拉選單 (針對單一單位)
     */
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

    /**
     * 從資料庫載入人員列表
     */
    loadList: async function() {
        const unitId = sysContext.getActiveUnitId();
        
        // 修正：系統管理員若未選單位 (null)，視同 ALL 模式或提示選擇
        // 但為了 UI 體驗，如果完全未選，我們可以不顯示資料或顯示全部，這裡維持原樣提示比較清楚
        if (!unitId && !sysContext.isSystemAdmin()) {
            this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5"><i class="bi bi-arrow-up-circle"></i> 請先選擇單位以檢視資料</td></tr>';
            return;
        }
        
        // 系統管理員未選時，若要預設顯示全部，可將 unitId 設為 'ALL' (視需求而定)
        // 這裡假設未選單位時，系統管理員可能想看到空白或全部，我們暫時不做強制轉換，
        // 依賴 SystemContext 的 activeUnitId 狀態。如果 activeUnitId 是 null，Service 會回傳空陣列。

        try {
            // 如果是 ALL 或 UNASSIGNED，先抓取所有單位的名稱對照表，以便顯示中文名稱
            if (unitId === 'ALL' || unitId === 'UNASSIGNED') {
                const units = await UnitService.getAllUnits();
                this.state.unitMap = {};
                units.forEach(u => this.state.unitMap[u.id] = u.name);
            } else if (unitId) {
                // 單一單位模式
                this.state.unitMap = { [unitId]: sysContext.getUnitName() };
            }

            // 若 unitId 為 null (管理員剛進來)，getStaffList 會回傳空，這裡可以接受
            this.state.allStaff = await StaffService.getStaffList(unitId);
            this.applyFilterAndSort();
        } catch (e) {
            console.error("[StaffModule] loadList Error:", e);
            if(this.tbody) this.tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">載入失敗: ' + e.message + '</td></tr>';
        }
    },

    /**
     * 開啟 Modal (新增或編輯)
     */
    openModal: async function(staff = null) {
        const form = document.getElementById('add-staff-form');
        if(form) form.reset();
        
        const activeUnitId = sysContext.getActiveUnitId();
        const unitSelect = document.getElementById('staff-unitId');
        
        // 🌟 修正重點：處理單位選擇邏輯
        // 判斷是否處於全域模式 (未選單位、全部單位、未分發區)
        const isGlobalMode = !activeUnitId || activeUnitId === 'ALL' || activeUnitId === 'UNASSIGNED';

        if (isGlobalMode) {
            // 模式 A: 開放選擇所有單位 (若未選則落入未分發)
            unitSelect.disabled = false;
            const units = await UnitService.getAllUnits();
            
            // 插入「未分發人員」選項，並設為 value=""
            let html = '<option value="">(未分發人員)</option>';
            units.forEach(u => html += `<option value="${u.id}">${u.name}</option>`);
            unitSelect.innerHTML = html;
            
            // 如果是新增模式，預設選中「未分發」
            if (!staff) unitSelect.value = "";

        } else {
            // 模式 B: 鎖定當前單位
            unitSelect.disabled = true;
            unitSelect.innerHTML = `<option value="${activeUnitId}" selected>${sysContext.getUnitName()}</option>`;
            this.refreshUnitOptions(); 
        }

        // 🌟 更新角色下拉選單
        const roleSelect = document.getElementById('staff-role');
        if (roleSelect) {
            roleSelect.innerHTML = `
                <option value="User">一般使用者 (User)</option>
                <option value="Scheduler">單位排班者 (Scheduler)</option>
                <option value="UnitAdmin">單位管理者 (Unit Admin)</option>
                <option value="SystemAdmin" class="text-danger fw-bold">系統管理者 (System Admin)</option>
            `;
        }

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
            const originalIdInput = document.getElementById('staff-original-empId');
            if(originalIdInput) originalIdInput.value = staff.empId;
            
            if(this.modalTitle) this.modalTitle.innerText = "編輯人員";
            document.getElementById('staff-empId').value = staff.empId;
            document.getElementById('staff-name').value = staff.name;
            
            // 回填單位 (如果是全域模式，選單已有所有選項；如果是鎖定模式，已被鎖定)
            // 若該員是未分發 (unitId為空)，value="" 剛好對應 (未分發人員)
            if(unitSelect) unitSelect.value = staff.unitId || "";
            
            // 回填職稱 (若下拉選單無此值，動態加入以免消失)
            const titleInput = document.getElementById('staff-title');
            if (staff.title && titleInput && ![...titleInput.options].some(o => o.value === staff.title)) {
                const opt = new Option(staff.title, staff.title);
                titleInput.add(opt);
            }
            if(titleInput) titleInput.value = staff.title || '';

            document.getElementById('staff-email').value = staff.email || '';
            document.getElementById('staff-password').value = staff.password || '123456';
            document.getElementById('staff-level').value = staff.level;
            
            // 回填組別
            const groupInput = document.getElementById('staff-group');
            if (staff.group && groupInput && ![...groupInput.options].some(o => o.value === staff.group)) {
                const opt = new Option(staff.group, staff.group);
                groupInput.add(opt);
            }
            if(groupInput) groupInput.value = staff.group || '';

            if(roleSelect) roleSelect.value = staff.role || 'User';
            
            document.getElementById('staff-hireDate').value = staff.hireDate || '';
            this.updateSeniorityText(staff.hireDate);

            const attr = staff.attributes || {};
            document.getElementById('staff-pregnant').checked = attr.isPregnant || false;
            document.getElementById('staff-nursing').checked = attr.isNursing || false;
            document.getElementById('staff-canBundle').checked = attr.canBundle || false;
            
            // 特殊屬性回填
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
            if(roleSelect) roleSelect.value = 'User';
            this.updateSeniorityText('');
        }

        if(this.modal) this.modal.show();
    },

    /**
     * 儲存人員資料
     */
    handleSave: async function() {
        const unitId = document.getElementById('staff-unitId').value;
        // 修正：移除對 unitId 的強制檢查，允許空字串 (代表未分發)
        // if(!unitId) { alert("請選擇所屬單位"); return; }

        const specialChecked = document.getElementById('staff-special').checked;
        let specialType = 'dayOnly';
        const rbNoNight = document.getElementById('special-noNight');
        if(rbNoNight && rbNoNight.checked) specialType = 'noNight';

        const data = {
            unitId: unitId, // 空字串即為未分發
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
            
            // 提示訊息區分
            const msg = unitId ? "儲存成功" : "儲存成功 (人員已列入未分發區)";
            alert(msg);
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

    // --- 輔助函式 ---

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

        // 檢查權限
        const canManage = sysContext.hasPermission(PERMISSIONS_OPTS.MANAGE_STAFF);

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
            
            // 顯示單位名稱 (ALL 模式下從 unitMap 查找)
            const displayUnitName = this.state.unitMap[s.unitId] || s.unitId || '<span class="text-danger fw-bold">未分發</span>';
            
            // 角色中文
            const roleMap = { 'SystemAdmin': '系統管理', 'UnitAdmin': '單位管理', 'Scheduler': '排班者', 'User': '一般' };
            const roleName = roleMap[s.role] || s.role;

            const tr = document.createElement('tr');
            let actionBtns = '';
            
            if (canManage) {
                actionBtns = `
                    <button class="btn btn-sm btn-outline-primary btn-edit me-1"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger btn-del"><i class="bi bi-trash"></i></button>
                `;
            } else {
                actionBtns = '<span class="text-muted small">無權限</span>';
            }

            tr.innerHTML = `
                <td>${displayUnitName}</td>
                <td>${s.empId}</td>
                <td class="fw-bold">${s.name}</td>
                <td>${s.title || '-'}</td>
                <td><span class="badge bg-light text-dark border">${s.level}</span></td>
                <td>${s.group || '-'}</td>
                <td>${roleName}</td>
                <td class="small text-muted">${seniority}</td>
                <td>${badges}</td>
                <td class="text-center">${actionBtns}</td>
            `;

            if (canManage) {
                tr.querySelector('.btn-edit').onclick = () => this.openModal(s);
                tr.querySelector('.btn-del').onclick = () => this.handleDelete(s.empId);
            }

            this.tbody.appendChild(tr);
        });
    },

    calcSeniority: function(dateStr) {
        if (!dateStr) return '-';
        const start = new Date(dateStr);
        const now = new Date();
        const diffTime = now - start;
        
        if (diffTime < 0) return '尚未到職';

        const years = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365.25));
        return years > 0 ? `${years}年` : `未滿1年`;
    },

    updateSeniorityText: function(dateStr) {
        const el = document.getElementById('staff-seniority-text');
        if(el) {
            el.innerText = `年資: ${this.calcSeniority(dateStr)}`;
        }
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
        if(!activeUnitId || activeUnitId === 'ALL') { 
            alert("批次匯入請先選擇特定單位，以確保資料正確歸屬。"); 
            e.target.value=''; 
            return; 
        }

        const file = e.target.files[0];
        if(!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const text = evt.target.result;
            const rows = text.split('\n').slice(1);
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
                    } catch(err) {
                        console.error("匯入失敗:", row, err);
                    }
                }
            }
            alert(`匯入完成，成功新增 ${successCount} 筆`);
            this.loadList();
            e.target.value = '';
        };
        reader.readAsText(file);
    }
};
