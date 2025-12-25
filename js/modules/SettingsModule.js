import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const SettingsModule = {
    state: {
        titles: [],
        groups: []
    },

    init: async function() {
        // 載入當前設定 (從 Context 讀取，若無則預設)
        const config = sysContext.unitConfig || {};
        this.state.titles = config.titles || ['護理師'];
        this.state.groups = config.groups || ['A', 'B'];

        // DOM 綁定
        this.listTitles = document.getElementById('list-titles');
        this.listGroups = document.getElementById('list-groups');
        
        document.getElementById('btn-add-title').onclick = () => this.addItem('title');
        document.getElementById('btn-add-group').onclick = () => this.addItem('group');
        document.getElementById('btn-save-settings').onclick = () => this.save();

        this.render();
    },

    render: function() {
        // 渲染職稱列表
        this.listTitles.innerHTML = this.state.titles.map((t, index) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${t}
                <button class="btn btn-sm btn-outline-danger border-0" onclick="SettingsModule.remove('title', ${index})">
                    <i class="bi bi-x-lg"></i>
                </button>
            </li>
        `).join('');

        // 渲染組別列表
        this.listGroups.innerHTML = this.state.groups.map((g, index) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${g}
                <button class="btn btn-sm btn-outline-danger border-0" onclick="SettingsModule.remove('group', ${index})">
                    <i class="bi bi-x-lg"></i>
                </button>
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
        this.render();
    },

    remove: function(type, index) {
        if(type === 'title') this.state.titles.splice(index, 1);
        else this.state.groups.splice(index, 1);
        this.render();
    },

    save: async function() {
        const btn = document.getElementById('btn-save-settings');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '儲存中...';

        try {
            const unitId = sysContext.getUnitId();
            // 寫入資料庫
            await UnitService.updateUnitSettings(unitId, {
                titles: this.state.titles,
                groups: this.state.groups
            });
            
            // 更新本地 Context (重要：這樣切換回人員管理時才能讀到新的選項)
            if(sysContext.unitConfig) {
                sysContext.unitConfig.titles = this.state.titles;
                sysContext.unitConfig.groups = this.state.groups;
            }

            alert("✅ 設定已儲存！");
        } catch (error) {
            alert("❌ 儲存失敗: " + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    }
};

window.SettingsModule = SettingsModule;
