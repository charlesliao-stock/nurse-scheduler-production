// js/router.js

const router = {
    // 設定路徑與 view 檔案的對應 (不含 .html)
    // key: URL 路徑
    // value: views 資料夾下的檔名
    routes: {
        '/admin/dashboard': 'dashboard',
        '/staff/list': 'staff',
        '/admin/staff': 'staff',   // 複用同一個頁面
        '/admin/units': 'units',   // [新增] 單位管理
        '/admin/shifts': 'shifts'  // [新增] 班別管理
    },

    // 載入頁面主邏輯
    load: async function(path) {
        // 1. 查找對應的 view 名稱
        const viewName = this.routes[path];
        
        console.log(`Router loading path: ${path} -> view: ${viewName}`);

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

            // 4. 初始化該頁面的 JS 模組
            this.initModule(viewName);

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
    initModule: function(viewName) {
        // 1. 人員管理
        if (viewName === 'staff') {
            if (typeof staffManager !== 'undefined') {
                staffManager.init();
            } else {
                console.error("錯誤: staffManager 尚未載入，請檢查 index.html");
            }
        } 
        // 2. 儀表板
        else if (viewName === 'dashboard') {
            console.log("Dashboard loaded");
        }
        // 3. 單位管理
        else if (viewName === 'units') {
            if (typeof unitManager !== 'undefined') {
                unitManager.init();
            } else {
                console.error("錯誤: unitManager 尚未載入，請檢查 index.html");
            }
        }
        // 4. [新增] 班別管理
        else if (viewName === 'shifts') {
            if (typeof shiftManager !== 'undefined') {
                shiftManager.init();
            } else {
                console.error("錯誤: shiftManager 尚未載入，請檢查 index.html");
            }
        }
    }
};
