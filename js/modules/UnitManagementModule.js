import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const UnitManagementModule = {
    state: {
        titles: [],
        groups: []
    },

    init: async function() {
        const activeUnitId = sysContext.getActiveUnitId();
        const container = document.getElementById('unit-management-container');
        
        // 🌟 分區核心：未選單位時的處理
        if (!activeUnitId) {
            // 仍然允許使用「新增單位」按鈕 (系統管理員)，但隱藏下方的編輯區
            const tabContent = document.querySelector('.tab-content');
            if(tabContent) {
                tabContent.innerHTML = '<div class="alert alert-info text-center mt-5"><i class="bi bi-info-circle"></i> 請先從左上角選擇一個單位進行管理，或點擊右上角「新增單位」。</div>';
            }
            // 綁定新增單位按鈕 (若有權限)
            this.bindCreateButton();
            return;
        }

        // 讀取當前單位的設定
        const config = sysContext.getUnitConfig();
        this.state.titles = config?.titles || [];
        this.state.groups = config?.groups || [];

        // DOM 綁定
        this.listTitles = document.getElementById('list-titles');
        this.listGroups = document.getElementById('list-groups');

        // 綁定按鈕
        document.getElementById('btn-add-title')?.addEventListener('click', () => this.addItem('title'));
        document.getElementById('btn-add-group')?.addEventListener('click', () => this.addItem('group'));
        document.getElementById('btn-save-params')?.addEventListener('click', () => this.saveParams());
        
        this.bindCreateButton();

        // --- 初始化基本資料 ---
        const idInput = document.getElementById('mgmt-unit-id');
        const nameInput = document.getElementById('mgmt-unit-name');
        const adminInput = document.getElementById('mgmt-admin-name');
        const infoForm = document.getElementById('unit-info-form');

        if(idInput) idInput.value = activeUnitId;
        if(nameInput) nameInput.value = sysContext.getUnitName();
        if(adminInput) adminInput.value = "單位管理者"; // 暫時

        if(infoForm) {
            infoForm.onsubmit = (e) => {
                e.preventDefault();
                this.saveBasicInfo();
            };
        }

        this.renderParamsList();
    },

    bindCreateButton: function() {
        // 處理新增按鈕權限
        const btnCreate = document.getElementById('btn-create-new-unit');
        const isSystemAdmin = sysContext.isSystemAdmin();
        if (isSystemAdmin && btnCreate) {
            btnCreate.classList.remove('d-none');
            btnCreate.onclick = () => this.openCreateModal();
        }
        
        // Modal 事件
        this.createModal = new bootstrap.Modal(document.getElementById('createUnitModal'));
        document.getElementById('btn-confirm-create-unit')?.addEventListener('click', () => this.handleCreateUnit());
    },

    // --- 參數列表邏輯 ---
    renderParamsList: function() {
        if(!this.listTitles) return;
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
            // 🌟 寫入：針對 Active Unit 儲存
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
            alert("✅ 基本資料已更新！");
        } catch (error) {
            alert("❌ 更新失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    },

    // --- 新增單位邏輯 ---
    openCreateModal: function() {
        document.getElementById('create-unit-form').reset();
        this.createModal.show();
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
