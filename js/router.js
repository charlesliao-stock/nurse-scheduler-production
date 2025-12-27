// js/router.js

const router = {
    // 設定路徑與 view 檔案的對應 (不含 .html)
    routes: {
        '/admin/dashboard': 'dashboard',       
        '/staff/list': 'staff',                
        '/admin/staff': 'staff',               
        '/admin/units': 'units',               
        '/admin/shifts': 'shifts',             
        '/admin/groups': 'groups',             
        '/admin/menus': 'menus',               
        '/admin/pre_schedules': 'pre_schedules',         // 預班列表
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix' // [關鍵] 排班大表路由
    },

    // 載入頁面主邏輯
    load: async function(path) {
        // 解析路徑與參數 (例如: /admin/pre_schedule_matrix?id=123)
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        // 解析 ID 參數
        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router loading: ${cleanPath} -> View: ${viewName} (ID: ${id})`);

        if (!viewName) {
            console.warn("找不到路徑:", path);
            document.getElementById('content-area').innerHTML = `
                <div style="padding:40px; text-align:center; color:#666;">
                    <h2>404 找不到頁面</h2>
                    <p>路徑: ${path}</p>
                </div>`;
            return;
        }

        const container = document.getElementById('content-area');
        container.innerHTML = '<div style="padding:20px; color:#666;">資料載入中...</div>';

        try {
            const response = await fetch(`views/${viewName}.html`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const html = await response.text();
            container.innerHTML = html;

            // 初始化模組 (傳入 ID)
            this.initModule(viewName, id);

        } catch (error) {
            console.error("載入 View 失敗:", error);
            container.innerHTML = `<div style="padding:20px; color:red;">
                <h3>載入頁面失敗</h3>
                <p>${error.message}</p>
                <small>請確認檔案 views/${viewName}.html 是否存在。</small>
            </div>`;
        }
    },

    // 啟動對應模組的邏輯
    initModule: function(viewName, id) {
        if (viewName === 'dashboard') {
            console.log("Dashboard loaded");
        }
        else if (viewName === 'staff') {
            if (typeof staffManager !== 'undefined') staffManager.init();
        } 
        else if (viewName === 'units') {
            if (typeof unitManager !== 'undefined') unitManager.init();
        }
        else if (viewName === 'shifts') {
            if (typeof shiftManager !== 'undefined') shiftManager.init();
        }
        else if (viewName === 'groups') {
            if (typeof groupManager !== 'undefined') groupManager.init();
        }
        else if (viewName === 'menus') {
            if (typeof menuManager !== 'undefined') menuManager.init();
        }
        else if (viewName === 'pre_schedules') {
            if (typeof preScheduleManager !== 'undefined') preScheduleManager.init();
        }
        // [關鍵] 初始化矩陣模組
        else if (viewName === 'pre_schedule_matrix') {
            if (typeof matrixManager !== 'undefined') {
                if (id) {
                    matrixManager.init(id);
                } else {
                    alert("錯誤：未指定預班表 ID");
                    history.back(); // 若無 ID 則返回上一頁
                }
            } else {
                console.error("錯誤: matrixManager 尚未載入，請檢查 index.html");
            }
        }
    }
};
