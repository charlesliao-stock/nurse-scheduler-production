// js/router.js

const router = {
    routes: {
        '/admin/dashboard': 'dashboard',       
        '/staff/list': 'staff',                
        '/admin/staff': 'staff',               
        '/admin/units': 'units',               
        '/admin/shifts': 'shifts',             
        '/admin/groups': 'groups',             
        '/admin/menus': 'menus',               
        '/admin/pre_schedules': 'pre_schedules',         // 管理者：預班管理
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix', 
        '/staff/pre_schedule_list': 'staff_pre_schedule_list', // [新增] 使用者：預班列表
        '/staff/pre_schedule': 'staff_pre_schedule'      // 使用者：填寫介面
    },

    currentView: null,
    isLoading: false,

    load: async function(path) {
        if(this.isLoading) return;

        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        if(this.currentView === viewName && !queryString) return;

        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router: ${cleanPath} -> ${viewName}, ID: ${id}`);

        if (!viewName) { 
            console.warn("404 Not Found"); 
            return; 
        }

        const container = document.getElementById('content-area');
        if(!container) return;

        this.isLoading = true;
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:10px;"></i><br>資料載入中...</div>';

        try {
            const response = await fetch(`views/${viewName}.html`);
            const html = await response.text();
            container.innerHTML = html;
            this.currentView = viewName;

            this.initModule(viewName, id);

        } catch (error) {
            console.error("View Load Error:", error);
            container.innerHTML = `<div style="color:red; padding:20px;">載入失敗: ${error.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    initModule: function(viewName, id) {
        if (viewName === 'dashboard') { /* ... */ }
        else if (viewName === 'staff' && typeof staffManager !== 'undefined') staffManager.init();
        else if (viewName === 'units' && typeof unitManager !== 'undefined') unitManager.init();
        else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') shiftManager.init();
        else if (viewName === 'groups' && typeof groupManager !== 'undefined') groupManager.init();
        else if (viewName === 'menus' && typeof menuManager !== 'undefined') menuManager.init();
        
        else if (viewName === 'pre_schedules') { 
            if(typeof preScheduleManager !== 'undefined') preScheduleManager.init(); 
        }
        else if (viewName === 'pre_schedule_matrix') { 
            if(typeof matrixManager !== 'undefined') matrixManager.init(id); 
        }
        // [新增] 使用者列表
        else if (viewName === 'staff_pre_schedule_list') {
            if(typeof staffPreScheduleListManager !== 'undefined') staffPreScheduleListManager.init();
        }
        // 使用者填寫頁
        else if (viewName === 'staff_pre_schedule') {
            if(typeof staffPreScheduleManager !== 'undefined') staffPreScheduleManager.init(id);
        }
    }
};
