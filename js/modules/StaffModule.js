import { StaffService } from "../services/StaffService.js";
import { sysContext } from "../core/SystemContext.js";
import { ViewLoader } from "../core/ViewLoader.js"; // 引入 Loader

export const StaffModule = {
    state: { /* ...保持不變... */ },

    // 🌟 修改：init 改為 async，並接收 containerId
    init: async function(containerId) {
        // 1. 先載入 HTML
        const loaded = await ViewLoader.load(containerId, 'views/staff.html');
        if (!loaded) return;

        // 2. HTML 注入後，才能綁定 DOM
        this.tbody = document.getElementById('staff-table-body');
        
        // 綁定 Modal
        const modalEl = document.getElementById('addStaffModal');
        if (modalEl) {
            this.modal = new bootstrap.Modal(modalEl);
            this.modalTitle = document.getElementById('staffModalTitle');
        }

        // 綁定事件 (跟之前一樣，但要確保元素存在)
        this.bindEvents();

        // 3. 載入資料
        this.initUnitSelect();
        await this.loadList();
    },

    bindEvents: function() {
        // 把原本放在 init 裡的 addEventListener 搬來這裡
        const btnAdd = document.getElementById('btn-add-staff');
        if(btnAdd) btnAdd.onclick = () => this.openModal();

        const btnSave = document.getElementById('btn-save-staff-submit');
        if(btnSave) btnSave.onclick = () => this.handleSave();
        
        // ... 其他綁定 (搜尋、匯入等) ...
    },

    // ... 其他函式 (loadList, render, openModal...) 保持不變 ...
    // ... 記得 initUnitSelect 裡的 DOM ID 也要對應 views/staff.html ...
};
