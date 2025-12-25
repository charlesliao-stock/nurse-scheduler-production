import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const UnitManagementModule = {
    state: {
        titles: [],
        groups: []
    },

    init: async function() {
        const config = sysContext.getUnitConfig();
        const activeUnitId = sysContext.getActiveUnitId();
        const isSystemAdmin = sysContext.isSystemAdmin(); // 取得權限狀態
        
        // 1. 綁定「新增單位」按鈕 (這個按鈕即使沒選單位也會顯示)
        this.bindCreateButton();

        // 檢查是否選取單位
        const container = document.getElementById('unit-management-container');
        if (!activeUnitId) {
            // 若沒選單位，把下方 Tab 內容隱藏或替換為提示，但保留上面的新增按鈕
            const tabContent = document.querySelector('.tab-content');
            if(tabContent) {
                tabContent.innerHTML = '<div class="alert alert-info text-center mt-5"><i class="bi bi-info-circle"></i> 請先從左上角選擇一個單位進行管理，或點擊右上角「新增單位」。</div>';
            }
            return;
        }

        // --- 初始化參數設定 ---
        this.state.titles = config?.titles || [];
        this.state.groups = config?.groups || [];

        this.listTitles = document.getElementById('list-titles');
        this.listGroups = document.getElementById('list-groups');

        const btnAddTitle = document.getElementById('btn-add-title');
        if (btnAddTitle) btnAddTitle.onclick = () => this.addItem('title');

        const btnAddGroup = document.getElementById('btn-add-group');
        if (btnAddGroup) btnAddGroup.onclick = () => this.addItem('group');

        const btnSaveParams = document.getElementById('btn-save-params');
        if (btnSaveParams) btnSaveParams.onclick = () => this.saveParams();
        
        // --- 初始化基本資料 ---
        const idInput = document.getElementById('mgmt-unit-id');
        const nameInput = document.getElementById('mgmt-unit-name');
        const adminInput = document.getElementById('mgmt-admin-name');
        const infoForm = document.getElementById('unit-info-form');

        if(idInput) idInput.value = activeUnitId;
        if(nameInput) nameInput.value = sysContext.getUnitName();
        if(adminInput) adminInput.value = sysContext.getUserName();

        if(infoForm) {
            infoForm.onsubmit = (e) => {
                e.preventDefault();
                this.saveBasicInfo();
            };
        }

        // 🌟 2. 綁定「刪除單位」按鈕 (只有系統管理員且已選單位時才顯示)
        const btnDelete = document.getElementById('btn-delete-unit');
        if (isSystemAdmin && btnDelete) {
            btnDelete.classList.remove('d-none');
            btnDelete.onclick = () => this.handleDeleteUnit();
        }

        this.renderParamsList();
    },

    bindCreateButton: function() {
        // 處理新增按鈕權限與綁定
        const btnCreate = document.getElementById('btn-create-new-unit');
        const isSystemAdmin = sysContext.isSystemAdmin();
        
        if (isSystemAdmin && btnCreate) {
            btnCreate.classList.remove('d-none');
            btnCreate.onclick = () => this.openCreateModal();
        }
        
        // 防呆：確保 Modal 元素存在才初始化
        const modalEl = document.getElementById('createUnitModal');
        if (modalEl) {
            this.createModal = new bootstrap.Modal(modalEl);
            
            const btnConfirm = document.getElementById('btn-confirm-create-unit');
            if (btnConfirm) btnConfirm.onclick = () => this.handleCreateUnit();
        }
    },

    // --- 參數列表邏輯 ---
    renderParamsList: function() {
        if(!this.listTitles || !this.listGroups) return;

        this.listTitles.innerHTML = this.state.titles.map((t, index) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${t}
                <button class="btn btn-sm text-danger border-0" onclick="UnitManagementModule.remove('title', ${index})"><i class="bi bi-x-lg"></i></button>
            </li>
        `).join('');

        this.listGroups.innerHTML = this.state.groups.map((g, index) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${g}
                <button class="btn btn-sm text-danger border-0" onclick="UnitManagementModule.remove('group', ${index})"><i class="bi bi-x-lg"></i></button>
            </li>
        `).join('');
    },

    addItem: function(type) {
        const inputId = type === 'title' ? 'input-new-title' : 'input-new-group';
        const input = document.getElementById(inputId);
        const val = input.value.trim();
        if(!val) return;
        
        if(type === 'title') this.state.titles.push(val);
        else this.state.groups.push(val);
        
        input.value = '';
        this.renderParamsList();
    },

    remove: function(type, index) {
        if(type === 'title') this.state.titles.splice(index, 1);
        else this.state.groups.splice(index, 1);
        this.renderParamsList();
    },

    // --- 儲存邏輯 ---
    saveParams: async function() {
        const btn = document.getElementById('btn-save-params');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '儲存中...';

        try {
            const unitId = sysContext.getActiveUnitId();
            await UnitService.updateUnitSettings(unitId, {
                titles: this.state.titles,
                groups: this.state.groups
            });
            sysContext.updateLocalSettings({
                titles: this.state.titles,
                groups: this.state.groups
            });
            alert("✅ 參數設定已儲存！");
        } catch (error) {
            alert("❌ 儲存失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    },

    saveBasicInfo: async function() {
        const btn = document.getElementById('btn-save-unit-info');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '儲存中...';

        const newName = document.getElementById('mgmt-unit-name').value.trim();
        if(!newName) { alert("單位名稱不可為空"); return; }

        try {
            const unitId = sysContext.getActiveUnitId();
            await UnitService.updateUnitBasicInfo(unitId, newName);
            if(sysContext.unitConfig) sysContext.unitConfig.name = newName;
            alert("✅ 基本資料已更新！(請重整以更新選單名稱)");
        } catch (error) {
            alert("❌ 更新失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    },

    // --- 🌟 新增：刪除單位邏輯 ---
    handleDeleteUnit: async function() {
        const unitId = sysContext.getActiveUnitId();
        const unitName = document.getElementById('mgmt-unit-name').value;
        
        const confirmMsg = `⚠️ 危險操作！\n\n您確定要刪除單位「${unitName} (${unitId})」嗎？\n\n注意：這將會移除該單位的所有設定，且無法復原。`;
        
        if (confirm(confirmMsg)) {
            // 二次確認防呆
            const input = prompt(`請輸入單位代號 "${unitId}" 以確認刪除：`);
            if(input !== unitId) {
                alert("代號輸入錯誤，已取消刪除。");
                return;
            }

            try {
                await UnitService.deleteUnit(unitId);
                alert("✅ 單位已刪除。");
                window.location.reload(); // 重整以清除狀態
            } catch (error) {
                alert("刪除失敗: " + error.message);
            }
        }
    },

    // --- 新增單位邏輯 ---
    openCreateModal: function() {
        const form = document.getElementById('create-unit-form');
        if (form) form.reset();
        
        if (this.createModal) this.createModal.show();
    },

    handleCreateUnit: async function() {
        const id = document.getElementById('new-unit-id').value.trim();
        const name = document.getElementById('new-unit-name').value.trim();
        
        if (!id || !name) { alert("必填欄位未填"); return; }

        const btn = document.getElementById('btn-confirm-create-unit');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '建立中...';

        try {
            const userId = sysContext.getCurrentUserId();
            // 呼叫 Service，帶入 false 參數，代表不綁定管理者
            await UnitService.createUnit(userId, id, name, false);
            alert(`✅ 單位「${name}」建立成功！`);
            this.createModal.hide();
            window.location.reload();
        } catch (error) {
            alert("建立失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    }
};

window.UnitManagementModule = UnitManagementModule;
