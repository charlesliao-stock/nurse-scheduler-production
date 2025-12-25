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

        // 檢查是否選取單位
        const container = document.getElementById('unit-management-container');
        if (!activeUnitId) {
            if(container) container.innerHTML = '<div class="alert alert-warning text-center mt-5">請先選擇單位</div>';
            return;
        }

        // --- 初始化 B. 參數設定 (原 SettingsModule) ---
        this.state.titles = config?.titles || [];
        this.state.groups = config?.groups || [];

        this.listTitles = document.getElementById('list-titles');
        this.listGroups = document.getElementById('list-groups');

        document.getElementById('btn-add-title').onclick = () => this.addItem('title');
        document.getElementById('btn-add-group').onclick = () => this.addItem('group');
        document.getElementById('btn-save-params').onclick = () => this.saveParams();
        
        // --- 初始化 A. 基本資料 ---
        document.getElementById('mgmt-unit-id').value = activeUnitId;
        document.getElementById('mgmt-unit-name').value = sysContext.getUnitName();
        document.getElementById('mgmt-admin-name').value = sysContext.getUserName();

        document.getElementById('unit-info-form').onsubmit = (e) => {
            e.preventDefault();
            this.saveBasicInfo();
        };

        this.renderParamsList();
    },

    // --- 參數列表邏輯 ---
    renderParamsList: function() {
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
            // 更新 Context
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
            // 呼叫 Service 更新名稱 (需確認 UnitService 有此方法)
            await UnitService.updateUnitBasicInfo(unitId, newName);
            
            // 手動更新 Context 中的名稱，以免需要重整
            if(sysContext.unitConfig) sysContext.unitConfig.name = newName;
            
            // 嘗試更新上方選單顯示 (如果是系統管理員，下拉選單文字可能不會變，除非重整，但這可接受)
            alert("✅ 基本資料已更新！");
        } catch (error) {
            alert("❌ 更新失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    }
};

window.UnitManagementModule = UnitManagementModule;
