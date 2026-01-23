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
        '/admin/schedule_rules': 'schedule_rules', // <--- 這裡原本可能少了逗號
        
        // --- [新增] 員工個人功能 ---
        '/staff/schedule': 'staff_schedule',          // 對應 staff_schedule.html
        '/staff/exchange_list': 'shift_exchange_list', // 對應 shift_exchange_list.html
        
        // --- 系統統計 ---
        '/admin/system_statistics': 'system_statistics' // 對應 system_statistics.html
    },

    currentView: null,
    isLoading: false,

    load: async function(path) {
        if(this.isLoading) return;

        // 處理路徑與參數
        const [cleanPath, queryString] = path.split('?');
        const viewName = this.routes[cleanPath];
        
        if (!viewName) {
            console.warn("找不到路徑對應的視圖:", cleanPath);
            return;
        }

        if(this.currentView === viewName && !queryString) return;

        const urlParams = new URLSearchParams(queryString);
        const id = urlParams.get('id');

        console.log(`Router: ${cleanPath} -> ${viewName} (ID: ${id})`);
        this.isLoading = true;

        try {
            // 1. 載入 HTML 視圖
            const response = await fetch(`views/${viewName}.html`);
            if(!response.ok) throw new Error(`HTTP ${response.status}`);
            const html = await response.text();
            
            document.getElementById('content-area').innerHTML = html;
            this.currentView = viewName;

            // 2. 初始化對應的 Manager (包含新功能)
            if (viewName === 'dashboard' && typeof dashboardManager !== 'undefined') dashboardManager.init();
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

            // --- [新增] 新功能的初始化 ---
            else if (viewName === 'staff_schedule') {
                // 我的班表與統計
                if(typeof staffScheduleManager !== 'undefined') staffScheduleManager.init();
            }
            else if (viewName === 'shift_exchange_list') {
                // 換班申請列表 (若有獨立 Manager 則在此初始化，目前共用 shiftExchangeManager)
                if(typeof shiftExchangeManager !== 'undefined') shiftExchangeManager.init();
            }
            else if (viewName === 'system_statistics') {
                // 系統統計
                if(typeof systemStatisticsManager !== 'undefined') systemStatisticsManager.init();
            }

        } catch (e) {
            console.error("View Load Error:", e);
            document.getElementById('content-area').innerHTML = `<div style="padding:20px; color:red;">載入頁面失敗: ${e.message}</div>`;
        } finally {
            this.isLoading = false;
        }
    },

    reset: function() {
        this.currentView = null;
    }
};
