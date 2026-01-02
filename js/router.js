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
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix',
        '/staff/pre_schedule_list': 'staff_pre_schedule_list', 
        '/staff/pre_schedule': 'staff_pre_schedule',
        '/admin/schedule_rules': 'schedule_rules',
        '/admin/schedule_list': 'schedule_list',
        '/admin/schedule_matrix': 'schedule_matrix'
    },

    currentView: null,
    currentManager: null, // [新增] 追蹤當前的 Manager 實體
    isLoading: false,

    load: async function(path) {
        if(this.isLoading) return;

        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        if(this.currentView === viewName && !queryString) return;

        if (!viewName) { 
            console.warn("404 Not Found"); 
            return; 
        }

        // [修正] 1. 切換前清理舊資源
        if (this.currentManager && typeof this.currentManager.cleanup === 'function') {
            console.log(`🧹 Cleaning up: ${this.currentView}`);
            try {
                this.currentManager.cleanup();
            } catch (e) {
                console.error("Cleanup Error:", e);
            }
        }
        this.currentManager = null;

        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router: ${cleanPath} -> ${viewName}, ID: ${id}`);

        const container = document.getElementById('content-area');
        if(!container) return;

        this.isLoading = true;
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:10px;"></i><br>資料載入中...</div>';

        try {
            const response = await fetch(`views/${viewName}.html`);
            const html = await response.text();
            container.innerHTML = html;
            this.currentView = viewName;

            // [修正] 2. 初始化並儲存 Manager 實體
            this.currentManager = this.initModule(viewName, id);

        } catch (error) {
            console.error("View Load Error:", error);
            container.innerHTML = `<div style="color:red; padding:20px;">載入失敗: ${error.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    initModule: function(viewName, id) {
        let manager = null;

        // 對照表映射
        if (viewName === 'staff' && typeof staffManager !== 'undefined') manager = staffManager;
        else if (viewName === 'units' && typeof unitManager !== 'undefined') manager = unitManager;
        else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') manager = shiftManager;
        else if (viewName === 'groups' && typeof groupManager !== 'undefined') manager = groupManager;
        else if (viewName === 'menus' && typeof menuManager !== 'undefined') manager = menuManager;
        else if (viewName === 'pre_schedules' && typeof preScheduleManager !== 'undefined') manager = preScheduleManager;
        else if (viewName === 'pre_schedule_matrix' && typeof matrixManager !== 'undefined') manager = matrixManager;
        else if (viewName === 'staff_pre_schedule_list' && typeof staffPreScheduleListManager !== 'undefined') manager = staffPreScheduleListManager;
        else if (viewName === 'staff_pre_schedule' && typeof staffPreScheduleManager !== 'undefined') manager = staffPreScheduleManager;
        else if (viewName === 'schedule_rules' && typeof scheduleRuleManager !== 'undefined') manager = scheduleRuleManager;
        else if (viewName === 'schedule_list' && typeof scheduleListManager !== 'undefined') manager = scheduleListManager;
        else if (viewName === 'schedule_matrix' && typeof scheduleEditorManager !== 'undefined') manager = scheduleEditorManager;

        // 統一執行 init
        if (manager && typeof manager.init === 'function') {
            manager.init(id);
        }

        return manager;
    },

    reset: function() {
        // 登出或重置時也要清理
        if (this.currentManager && typeof this.currentManager.cleanup === 'function') {
            this.currentManager.cleanup();
        }
        this.currentManager = null;
        this.currentView = null;
        this.isLoading = false;
        console.log("Router reset.");
    }
};
