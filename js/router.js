// js/router.js
const router = {
    // 定義路徑與 View 的對應關係
    routes: {
        '/admin/dashboard': 'dashboard',
        '/staff/list': 'staff',
        '/admin/users': 'staff' // 假設這兩個路徑都用同一個 view
    },

    // 載入頁面核心功能
    load: async function(path) {
        const viewName = this.routes[path];
        if (!viewName) {
            console.error("找不到路徑對應的 View:", path);
            return;
        }

        const container = document.getElementById('content-area');
        
        // 1. 顯示載入中...
        container.innerHTML = '<div style="padding:20px;">正在載入頁面...</div>';

        try {
            // 2. 使用 fetch 去抓 views 資料夾底下的 html 檔
            const response = await fetch(`views/${viewName}.html`);
            if (!response.ok) throw new Error("頁面載入失敗");
            
            // 3. 取得 HTML 文字
            const html = await response.text();
            
            // 4. 塞入容器
            container.innerHTML = html;

            // 5. [關鍵] 初始化該頁面的 JS 邏輯
            // 因為 HTML 是剛塞進去的，JS 現在才抓得到 DOM 元素
            this.initModule(viewName);

        } catch (error) {
            container.innerHTML = `<div style="color:red; padding:20px;">錯誤: ${error.message}</div>`;
        }
    },

    // 根據頁面名稱，啟動對應的 JS 模組
    initModule: function(viewName) {
        if (viewName === 'staff') {
            // 呼叫 staff_manager.js 的初始化
            if (typeof staffManager !== 'undefined') {
                staffManager.init();
            }
        } 
        else if (viewName === 'dashboard') {
            // 未來 dashboard 也有自己的 init
            console.log("儀表板載入完成");
        }
    }
};
