// js/router.js

const router = {
    routes: {
        // --- 系統基礎 ---
        '/admin/dashboard': 'dashboard',       
        
        // --- 基本資料管理 ---
        '/staff/list': 'staff',                
        '/admin/staff': 'staff',               
        '/admin/units': 'units',               
        '/admin/shifts': 'shifts',             
        '/admin/groups': 'groups',             
        '/admin/menus': 'menus',               
        
        // --- 預班階段 (第一階段) ---
        '/admin/pre_schedules': 'pre_schedules',         
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix',
        '/staff/pre_schedule_list': 'staff_pre_schedule_list', 
        '/staff/pre_schedule': 'staff_pre_schedule',

        // --- [新增] 正式排班階段 (第二階段) ---
        '/admin/schedule_list': 'schedule_list',       // 排班列表
        '/admin/schedule_editor': 'schedule_matrix',   // 排班編輯器 (對應 schedule_editor_manager)
        '/admin/schedule_rules': 'schedule_rules'      // 規則設定
    },

    currentView: null,
    isLoading: false,

    load: async function(path) {
        if(this.isLoading) return;

        // 處理路徑參數 (例如 ?id=xxx)
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        // 如果是當前頁面且無參數變化，則不重載
        if(this.currentView === viewName && !queryString) return;

        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router: ${cleanPath} -> ${viewName}, ID: ${id}`);

        if (!viewName) { 
            console.warn("404 Not Found: " + cleanPath); 
            // 如果路徑為空或找不到，導回儀表板
            if(cleanPath === '' || cleanPath === '/') this.load('/admin/dashboard');
            return; 
        }

        const container = document.getElementById('content-area');
        if(!container) return;

        this.isLoading = true;
        // 顯示簡單的載入動畫
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin"></i> 載入中...</div>';

        try {
            // 1. 載入 HTML 樣板
            const response = await fetch(`${viewName}.html`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const html = await response.text();
            container.innerHTML = html;
            
            // 更新目前視圖狀態
            this.currentView = viewName;
            
            // 2. 初始化對應的 Javascript 模組
            this.initModule(viewName, id);

        } catch (error) {
            console.error("Load View Error:", error);
            container.innerHTML = `<div style="padding:40px; text-align:center; color:red;">載入失敗: ${error.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    initModule: function(viewName, id) {
        // 根據 viewName 呼叫對應 Manager 的 init 方法
        
        if (viewName === 'dashboard') { 
            // 儀表板通常不需要 init，或在此呼叫 dashboardManager.init()
        }
        // --- 基礎模組 ---
        else if (viewName === 'staff' && typeof staffManager !== 'undefined') staffManager.init();
        else if (viewName === 'units' && typeof unitManager !== 'undefined') unitManager.init();
        else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') shiftManager.init();
        else if (viewName === 'groups' && typeof groupManager !== 'undefined') groupManager.init();
        else if (viewName === 'menus' && typeof menuManager !== 'undefined') menuManager.init();
        
        // --- 預班模組 ---
        else if (viewName === 'pre_schedules') { 
            if(typeof preScheduleManager !== 'undefined') preScheduleManager.init(); 
        }
        else if (viewName === 'pre_schedule_matrix') { 
            if(typeof matrixManager !== 'undefined') matrixManager.init(id); 
        }
        else if (viewName === 'staff_pre_schedule_list') {
            if(typeof staffPreScheduleListManager !== 'undefined') staffPreScheduleListManager.init();
        }
        else if (viewName === 'staff_pre_schedule') {
            if(typeof staffPreScheduleManager !== 'undefined') staffPreScheduleManager.init(id);
        }

        // --- [新增] 排班模組 ---
        else if (viewName === 'schedule_list') {
            if(typeof scheduleListManager !== 'undefined') scheduleListManager.init();
        }
        else if (viewName === 'schedule_matrix') { 
            // 注意: 這裡是對應 schedule_editor_manager
            if(typeof scheduleEditorManager !== 'undefined') scheduleEditorManager.init(id);
        }
        else if (viewName === 'schedule_rules') {
            if(typeof scheduleRuleManager !== 'undefined') scheduleRuleManager.init();
        }
    },

    // 用於登出時清除狀態
    reset: function() {
        this.currentView = null;
    }
};
