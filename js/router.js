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
        '/admin/pre_schedules': 'pre_schedules',
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix'
    },

    load: async function(path) {
        // 分離路徑與參數
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        // 解析參數
        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router loading: ${cleanPath} -> View: ${viewName} (ID: ${id})`);

        if (!viewName) return;

        const container = document.getElementById('content-area');
        container.innerHTML = '<div style="padding:20px; color:#666;">資料載入中...</div>';

        try {
            const response = await fetch(`views/${viewName}.html`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const html = await response.text();
            container.innerHTML = html;

            this.initModule(viewName, id);

        } catch (error) {
            console.error("載入 View 失敗:", error);
            container.innerHTML = `<div style="padding:20px; color:red;">載入失敗: ${error.message}</div>`;
        }
    },

    initModule: function(viewName, id) {
        if (viewName === 'dashboard') console.log("Dashboard loaded");
        else if (viewName === 'staff' && typeof staffManager !== 'undefined') staffManager.init();
        else if (viewName === 'units' && typeof unitManager !== 'undefined') unitManager.init();
        else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') shiftManager.init();
        else if (viewName === 'groups' && typeof groupManager !== 'undefined') groupManager.init();
        else if (viewName === 'menus' && typeof menuManager !== 'undefined') menuManager.init();
        else if (viewName === 'pre_schedules' && typeof preScheduleManager !== 'undefined') preScheduleManager.init();
        
        // [關鍵] 初始化排班矩陣
        else if (viewName === 'pre_schedule_matrix') {
            if (typeof matrixManager !== 'undefined') {
                if (id) {
                    matrixManager.init(id);
                } else {
                    alert("錯誤：無效的預班表 ID");
                    window.location.hash = '/admin/pre_schedules';
                }
            }
        }
    }
};
