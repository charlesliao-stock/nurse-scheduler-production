// js/router.js

const router = {
    // 路由對照表：路徑 -> 檔案位置
    routes: {
        '/admin/dashboard': 'views/dashboard.html',
        '/admin/staff': 'views/staff.html',
        '/admin/units': 'views/units.html', // [新增] 單位管理
        '/404': 'views/404.html'
    },

    // 載入頁面主邏輯
    load: async function(path) {
        console.log("Router loading:", path);

        // 1. 檢查路徑是否存在，不存在則導向 404
        const file = this.routes[path];
        if (!file) {
            console.error("找不到路徑:", path);
            // 如果您有做 404 頁面可導向，這裡先簡單 alert 或 return
            // this.load('/404'); 
            return;
        }

        try {
            // 2. 抓取 HTML 檔案內容
            const response = await fetch(file);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const html = await response.text();

            // 3. 將內容塞入主容器
            document.getElementById('content-area').innerHTML = html;

            // 4. [關鍵] 根據路徑，初始化對應的模組 (JS)
            this.initModule(path);

        } catch (error) {
            console.error("頁面載入失敗:", error);
            document.getElementById('content-area').innerHTML = `<h3>載入失敗</h3><p>${error.message}</p>`;
        }
    },

    // 初始化模組判定
    initModule: function(path) {
        switch (path) {
            case '/admin/dashboard':
                // 如果有 dashboardManager 就呼叫 init
                // if(dashboardManager) dashboardManager.init();
                break;

            case '/admin/staff':
                if (typeof staffManager !== 'undefined') {
                    staffManager.init();
                }
                break;

            case '/admin/units': // [新增] 單位管理初始化
                if (typeof unitManager !== 'undefined') {
                    unitManager.init();
                } else {
                    console.error("unitManager is not defined. Did you include unit_manager.js in index.html?");
                }
                break;
                
            default:
                console.log("No specific module init for this path.");
        }
    }
};
