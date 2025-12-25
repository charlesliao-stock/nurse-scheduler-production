import { UnitService } from "../services/UnitService.js";
import { sysContext } from "../core/SystemContext.js";

export const SettingsModule = {
    state: {
        titles: [],
        groups: []
    },

    init: async function() {
        // 1. 從 Context 取得當前單位的設定 (這是動態的，來自 DB)
        const config = sysContext.getUnitConfig();
        
        if (!config) {
            alert("請先選擇單位");
            return;
        }

        // 若資料庫無資料，給予空陣列，絕不寫死預設值
        this.state.titles = config.titles || [];
        this.state.groups = config.groups || [];

        // DOM 綁定
        this.listTitles = document.getElementById('list-titles');
        this.listGroups = document.getElementById('list-groups');
        
        // 綁定事件
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
        
        // 加入陣列
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
            const unitId = sysContext.getActiveUnitId();
            
            // 1. 寫入資料庫
            await UnitService.updateUnitSettings(unitId, {
                titles: this.state.titles,
                groups: this.state.groups
            });
            
            // 2. 🌟 關鍵：立即更新本地 Context
            // 這樣切換回「人員管理」時，下拉選單才會立刻變更，不需要 F5
            sysContext.updateLocalSettings({
                titles: this.state.titles,
                groups: this.state.groups
            });

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
