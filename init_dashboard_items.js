// 此腳本用於在瀏覽器控制台執行，初始化儀表板項目與選單

async function initDashboardSystem() {
    console.log("🚀 開始初始化儀表板系統...");

    // 1. 新增「儀表板管理」選單
    const menuData = {
        label: '儀表板管理',
        order: 95,
        path: '/admin/dashboard_items',
        icon: 'fas fa-th-large',
        allowedRoles: ['system_admin'],
        isActive: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const menuSnap = await db.collection('system_menus').where('path', '==', '/admin/dashboard_items').get();
        if (menuSnap.empty) {
            await db.collection('system_menus').add(menuData);
            console.log("✅ 已新增『儀表板管理』選單");
        } else {
            console.log("ℹ️ 『儀表板管理』選單已存在");
        }
    } catch (e) {
        console.error("❌ 新增選單失敗:", e);
    }

    // 2. 預設儀表板項目
    const defaultItems = [
        // 一般使用者
        { label: '班表檢視', dataSource: 'my_schedule_status', path: '/staff/schedule', icon: 'fas fa-calendar-alt', color: '#3498db', order: 10, allowedRoles: ['user', 'unit_manager', 'unit_scheduler', 'system_admin'] },
        { label: '待審核項目', dataSource: 'my_pending_exchanges', path: '/staff/exchange_list', icon: 'fas fa-exchange-alt', color: '#f39c12', order: 20, allowedRoles: ['user', 'unit_manager', 'unit_scheduler', 'system_admin'] },
        { label: '進行中的預班', dataSource: 'my_active_pre_schedule', path: '/staff/pre_schedule_list', icon: 'fas fa-clock', color: '#2ecc71', order: 30, allowedRoles: ['user', 'unit_manager', 'unit_scheduler', 'system_admin'] },
        
        // 單位管理者
        { label: '單位人員管理', dataSource: 'unit_staff_count', path: '/admin/staff', icon: 'fas fa-users', color: '#3498db', order: 40, allowedRoles: ['unit_manager', 'unit_scheduler', 'system_admin'] },
        { label: '待核准申請', dataSource: 'unit_pending_approvals', path: '/staff/exchange_list', icon: 'fas fa-check-circle', color: '#e74c3c', order: 50, allowedRoles: ['unit_manager', 'system_admin'] },
        
        // 系統管理者
        { label: '全院人員總數', dataSource: 'sys_total_staff_count', path: '/admin/staff', icon: 'fas fa-hospital-user', color: '#2c3e50', order: 60, allowedRoles: ['system_admin'] },
        { label: '總單位數', dataSource: 'sys_total_unit_count', path: '/admin/units', icon: 'fas fa-hospital', color: '#8e44ad', order: 70, allowedRoles: ['system_admin'] },
        { label: '總排班次數', dataSource: 'sys_total_schedules', path: '/admin/schedule_list', icon: 'fas fa-list-alt', color: '#16a085', order: 80, allowedRoles: ['system_admin'] }
    ];

    for (const item of defaultItems) {
        try {
            const itemSnap = await db.collection('system_dashboard_items').where('dataSource', '==', item.dataSource).get();
            if (itemSnap.empty) {
                await db.collection('system_dashboard_items').add({
                    ...item,
                    isActive: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log(`✅ 已新增儀表板項目: ${item.label}`);
            } else {
                console.log(`ℹ️ 儀表板項目已存在: ${item.label}`);
            }
        } catch (e) {
            console.error(`❌ 新增項目 ${item.label} 失敗:`, e);
        }
    }

    console.log("✨ 初始化完成！請重新整理頁面。");
}

// 執行初始化
// initDashboardSystem();
