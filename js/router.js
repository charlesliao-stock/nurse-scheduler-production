// js/router.js

const router = {
    // 設定路徑與 view 檔案的對應 (不含 .html)
    routes: {
        '/admin/dashboard': 'dashboard',
        '/staff/list': 'staff',
        '/admin/users': 'staff' // 複用同一個頁面
    },

    // 載入頁面
    load: async function(path) {
        // 1. 查找對應的 view 名稱
        const viewName = this.routes[path];
        if (!viewName) {
            console.warn("找不到路徑:", path);
            document.getElementById('content-area').innerHTML = "<h2>404 找不到頁面</h2>";
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

            // 4. 初始化該頁面的 JS 模組
            this.initModule(viewName);

        } catch (error) {
            console.error("載入 View 失敗:", error);
            container.innerHTML = `<div style="padding:20px; color:red;">載入頁面失敗: ${error.message}<br>請確認您是否使用 Local Server 執行。</div>`;
        }
    },

    // 啟動模組邏輯
    initModule: function(viewName) {
        if (viewName === 'staff') {
            if (typeof staffManager !== 'undefined') {
                staffManager.init();
            } else {
                console.error("staffManager 尚未載入");
            }
        } 
        else if (viewName === 'dashboard') {
            console.log("Dashboard loaded");
        }
    }
};
