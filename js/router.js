// js/router.js (優化版)

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

    currentView: null, // 追蹤當前頁面
    isLoading: false, // 防止重複載入

    load: async function(path) {
        // 防止重複載入相同頁面
        if(this.isLoading) {
            console.log("頁面載入中，請稍候...");
            return;
        }

        // 分離路徑與參數
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        // 如果路徑相同且無參數，不重複載入
        if(this.currentView === viewName && !queryString) {
            console.log(`頁面 ${viewName} 已載入，跳過`);
            return;
        }

        // 解析參數
        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router loading: ${cleanPath} -> View: ${viewName} (ID: ${id})`);

        if (!viewName) {
            console.error(`找不到路徑 ${cleanPath} 對應的頁面`);
            this.show404();
            return;
        }

        const container = document.getElementById('content-area');
        if(!container) {
            console.error("找不到內容容器 #content-area");
            return;
        }

        this.isLoading = true;
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:10px;"></i><br>資料載入中...</div>';

        try {
            const response = await fetch(`views/${viewName}.html`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 無法載入頁面`);
            }
            
            const html = await response.text();
            container.innerHTML = html;

            this.currentView = viewName;
            this.initModule(viewName, id);

        } catch (error) {
            console.error("載入 View 失敗:", error);
            container.innerHTML = `
                <div style="padding:40px; text-align:center;">
                    <i class="fas fa-exclamation-triangle" style="font-size:3rem; color:#e74c3c; margin-bottom:15px;"></i>
                    <h3 style="color:#e74c3c;">載入失敗</h3>
                    <p style="color:#666;">${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">
                        <i class="fas fa-redo"></i> 重新整理
                    </button>
                </div>
            `;
        } finally {
            this.isLoading = false;
        }
    },

    initModule: function(viewName, id) {
        console.log(`初始化模組: ${viewName}`);
        
        try {
            if (viewName === 'dashboard') {
                console.log("Dashboard loaded");
            } 
            else if (viewName === 'staff' && typeof staffManager !== 'undefined') {
                staffManager.init();
            } 
            else if (viewName === 'units' && typeof unitManager !== 'undefined') {
                unitManager.init();
            } 
            else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') {
                shiftManager.init();
            } 
            else if (viewName === 'groups' && typeof groupManager !== 'undefined') {
                groupManager.init();
            } 
            else if (viewName === 'menus' && typeof menuManager !== 'undefined') {
                menuManager.init();
            } 
            else if (viewName === 'pre_schedules' && typeof preScheduleManager !== 'undefined') {
                preScheduleManager.init();
            } 
            else if (viewName === 'pre_schedule_matrix') {
                if (typeof matrixManager !== 'undefined') {
                    if (id) {
                        matrixManager.init(id);
                    } else {
                        alert("錯誤：無效的預班表 ID");
                        window.location.hash = '/admin/pre_schedules';
                    }
                } else {
                    console.error("matrixManager 模組未載入");
                }
            }
            else {
                console.warn(`未找到 ${viewName} 對應的管理器`);
            }
        } catch(error) {
            console.error(`模組初始化失敗 (${viewName}):`, error);
            alert(`頁面初始化失敗: ${error.message}`);
        }
    },

    show404: function() {
        const container = document.getElementById('content-area');
        if(!container) return;
        
        container.innerHTML = `
            <div style="padding:60px; text-align:center;">
                <i class="fas fa-map-marked-alt" style="font-size:4rem; color:#95a5a6; margin-bottom:20px;"></i>
                <h2 style="color:#2c3e50;">404 - 頁面不存在</h2>
                <p style="color:#666; margin:20px 0;">您要訪問的頁面不存在或已被移除</p>
                <button class="btn btn-primary" onclick="window.location.hash='/admin/dashboard'">
                    <i class="fas fa-home"></i> 返回首頁
                </button>
            </div>
        `;
    },

    // 清除當前頁面狀態（用於登出時）
    reset: function() {
        this.currentView = null;
        this.isLoading = false;
    }
};
