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
        
        // --- 預班階段 ---
        '/admin/pre_schedules': 'pre_schedules',         
        '/admin/pre_schedule_matrix': 'pre_schedule_matrix',
        '/staff/pre_schedule_list': 'staff_pre_schedule_list', 
        '/staff/pre_schedule': 'staff_pre_schedule',
        
        // --- 正式排班階段 ---
        '/admin/score_settings': 'score_settings',
        '/admin/schedule_list': 'schedule_list',
        '/admin/schedule_editor': 'schedule_matrix',
        '/admin/schedule_rules': 'schedule_rules'

        '/staff/schedule': 'staff_schedule',          // 對應 staff_schedule.html
        '/staff/exchange_list': 'shift_exchange_list', // 對應 shift_exchange_list.html
    },

    currentView: null,
    isLoading: false,

    load: async function(path) {
        if(this.isLoading) return;

        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        if(this.currentView === viewName && !queryString) return;

        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router: ${cleanPath} -> ${viewName}, ID: ${id}`);

        if (!viewName) { 
            console.warn("404 Not Found: " + cleanPath); 
            if(cleanPath === '' || cleanPath === '/') this.load('/admin/dashboard');
            return; 
        }

        const container = document.getElementById('content-area');
        if(!container) return;

        this.isLoading = true;
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin"></i> 載入中...</div>';

        try {
            // [關鍵修正] 改為 'views/' (加上 s)
            const response = await fetch(`views/${viewName}.html`);
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} (Path: views/${viewName}.html)`);
            const html = await response.text();
            container.innerHTML = html;
            
            this.currentView = viewName;
            this.initModule(viewName, id);

        } catch (error) {
            console.error("Load View Error:", error);
            container.innerHTML = `<div style="padding:40px; text-align:center; color:red;">
                <h3>載入失敗</h3>
                <p>找不到檔案: views/${viewName}.html</p>
                <small>${error.message}</small>
            </div>`;
        } finally {
            this.isLoading = false;
        }
    },

    initModule: function(viewName, id) {
        if (viewName === 'dashboard') { }
        else if (viewName === 'staff' && typeof staffManager !== 'undefined') staffManager.init();
        else if (viewName === 'units' && typeof unitManager !== 'undefined') unitManager.init();
        else if (viewName === 'shifts' && typeof shiftManager !== 'undefined') shiftManager.init();
        else if (viewName === 'groups' && typeof groupManager !== 'undefined') groupManager.init();
        else if (viewName === 'menus' && typeof menuManager !== 'undefined') menuManager.init();
        
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

        else if (viewName === 'schedule_list') {
            if(typeof scheduleListManager !== 'undefined') scheduleListManager.init();
        }
        else if (viewName === 'schedule_matrix') { 
            if(typeof scheduleEditorManager !== 'undefined') scheduleEditorManager.init(id);
        }
        else if (viewName === 'schedule_rules') {
            if(typeof scheduleRuleManager !== 'undefined') scheduleRuleManager.init();
        }
        else if (viewName === 'score_settings') {
            if(typeof scoreSettingsManager !== 'undefined') scoreSettingsManager.init();
        }
        else if (viewName === 'staff_schedule') {
            if(typeof staffScheduleManager !== 'undefined') staffScheduleManager.init();
        }
// exchange_list 的 init 在 HTML 內或另建 manager
    },

    reset: function() {
        this.currentView = null;
    }
};
