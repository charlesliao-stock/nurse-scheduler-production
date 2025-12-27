// js/router.js

const router = {
    // 設定路徑與 view 檔案的對應 (不含 .html)
    // key: URL 路徑
    // value: views 資料夾下的檔名
    routes: {
        '/admin/dashboard': 'dashboard',       // 儀表板
        '/staff/list': 'staff',                // 人員列表 (唯讀或一般檢視)
        '/admin/staff': 'staff',               // 人員管理
        '/admin/units': 'units',               // 單位管理
        '/admin/shifts': 'shifts',             // 班別管理
        '/admin/groups': 'groups',             // 組別管理
        '/admin/menus': 'menus',               // 選單管理
        '/admin/pre_schedules': 'pre_schedules',         // [Phase 1] 預班管理列表
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix' // [Phase 2] 排班矩陣大表
    },

    // 載入頁面主邏輯
    load: async function(path) {
        // 1. 解析路徑與參數 (例如: /admin/pre_schedule_matrix?id=123)
        // split('?') 分割出 純路徑 與 查詢字串
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        // 解析參數
        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id'); // 取得 id 參數

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
            // 2. Fetch 抓取 HTML 檔案
            const response = await fetch(`views/${viewName}.html`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const html = await response.text();
            
            // 3. 塞入 HTML
            container.innerHTML = html;

            // 4. 初始化該頁面的 JS 模組 (將 id 傳入)
            this.initModule(viewName, id);

        } catch (error) {
            console.error("載入 View 失敗:", error);
            container.innerHTML = `<div style="padding:20px; color:red;">
                <h3>載入頁面失敗</h3>
                <p>${error.message}</p>
                <small>請確認您是否使用 Local Server (如 Live Server) 執行。</small>
            </div>`;
        }
    },

    // 啟動對應模組的邏輯
    initModule: function(viewName, id) {
        // 1. 儀表板
        if (viewName === 'dashboard') {
            console.log("Dashboard loaded");
        }
        // 2. 人員管理
        else if (viewName === 'staff') {
            if (typeof staffManager !== 'undefined') staffManager.init();
        } 
        // 3. 單位管理
        else if (viewName === 'units') {
            if (typeof unitManager !== 'undefined') unitManager.init();
        }
        // 4. 班別管理
        else if (viewName === 'shifts') {
            if (typeof shiftManager !== 'undefined') shiftManager.init();
        }
        // 5. 組別管理
        else if (viewName === 'groups') {
            if (typeof groupManager !== 'undefined') groupManager.init();
        }
        // 6. 選單管理
        else if (viewName === 'menus') {
            if (typeof menuManager !== 'undefined') menuManager.init();
        }
        // 7. 預班管理 (列表與設定)
        else if (viewName === 'pre_schedules') {
            if (typeof preScheduleManager !== 'undefined') preScheduleManager.init();
        }
        // 8. [新增] 預班排班矩陣 (需傳入 ID)
        else if (viewName === 'pre_schedule_matrix') {
            if (typeof matrixManager !== 'undefined') {
                if (id) {
                    matrixManager.init(id);
                } else {
                    alert("錯誤：未指定預班表 ID");
                    history.back();
                }
            } else {
                console.error("錯誤: matrixManager 尚未載入，請檢查 index.html");
            }
        }
    }
};
