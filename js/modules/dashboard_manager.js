// js/modules/dashboard_manager.js

const dashboardManager = {
    items: [],
    
    init: async function() {
        console.log("Dashboard Manager Init");
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        
        container.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> 正在載入儀表板...</div>';
        
        await this.loadItems();
        await this.renderDashboard();
    },

    loadItems: async function() {
        try {
            const activeRole = app.impersonatedRole || app.userRole;
            const snapshot = await db.collection('system_dashboard_items')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();
            
            this.items = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => {
                    const roles = item.allowedRoles || [];
                    return roles.length === 0 || roles.includes(activeRole);
                });
        } catch (e) {
            console.error("Load Dashboard Items Error:", e);
        }
    },

    renderDashboard: async function() {
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        
        if(this.items.length === 0) {
            container.innerHTML = '<div style="padding:40px; text-align:center; color:#999;">目前沒有可顯示的儀表板項目，請聯繫管理員設定。</div>';
            return;
        }

        container.innerHTML = '<div id="dashboard-grid" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 30px;"></div>';
        const grid = document.getElementById('dashboard-grid');

        // 先渲染卡片骨架
        this.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card dashboard-card';
            card.style.cssText = `flex: 1; min-width: 250px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-left: 5px solid ${item.color || '#3498db'}; cursor: pointer; transition: transform 0.2s;`;
            card.onclick = () => { if(item.path) location.hash = item.path; };
            card.onmouseover = () => card.style.transform = 'translateY(-5px)';
            card.onmouseout = () => card.style.transform = 'translateY(0)';
            
            card.innerHTML = `
                <div style="font-size: 0.9rem; color: #7f8c8d; font-weight: bold;"><i class="${item.icon || 'fas fa-cube'}"></i> ${item.label}</div>
                <div style="font-size: 2rem; font-weight: bold; color: #2c3e50; margin: 10px 0;" id="val_${item.id}">...</div>
                <div style="font-size: 0.8rem; color: ${item.color || '#3498db'};">查看詳情 <i class="fas fa-arrow-right"></i></div>
            `;
            grid.appendChild(card);
        });

        // 非同步加載數據
        this.items.forEach(item => {
            this.fetchDataForSource(item.dataSource, `val_${item.id}`);
        });
    },

    fetchDataForSource: async function(source, elementId) {
        const el = document.getElementById(elementId);
        if(!el) return;

        try {
            let value = '-';
            const unitId = app.getUnitId();
            const uid = app.getUid();
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;

            switch(source) {
                // --- 一般使用者 ---
                case 'my_schedule_status':
                    const schSnap = await db.collection('schedules')
                        .where('year', '==', year)
                        .where('month', '==', month)
                        .where('unitId', '==', app.userUnitId)
                        .where('status', '==', 'published')
                        .get();
                    value = schSnap.empty ? '未發布' : '已發布';
                    break;
                
                case 'my_pending_exchanges':
                    const exchSnap = await db.collection('shift_requests')
                        .where('targetId', '==', uid)
                        .where('status', '==', 'pending_target')
                        .get();
                    value = exchSnap.size;
                    break;

                case 'my_active_pre_schedule':
                    const preSnap = await db.collection('pre_schedules')
                        .where('status', '==', 'open')
                        .get();
                    // 前端過濾參與者
                    const myPres = preSnap.docs.filter(doc => {
                        const d = doc.data();
                        return (d.unitId === app.userUnitId) || (d.staffList || []).some(s => s.uid === uid);
                    });
                    value = myPres.length;
                    break;

                // --- 單位管理者 ---
                case 'unit_staff_count':
                    const staffSnap = await db.collection('users')
                        .where('unitId', '==', unitId)
                        .where('isActive', '==', true)
                        .get();
                    value = staffSnap.size;
                    break;

                case 'unit_pending_approvals':
                    const appvSnap = await db.collection('shift_requests')
                        .where('unitId', '==', unitId)
                        .where('status', '==', 'pending_manager')
                        .get();
                    value = appvSnap.size;
                    break;

                // --- 系統管理者 ---
                case 'sys_total_staff_count':
                    const allStaffSnap = await db.collection('users').where('isActive', '==', true).get();
                    value = allStaffSnap.size;
                    break;

                case 'sys_total_unit_count':
                    const unitSnap = await db.collection('units').get();
                    value = unitSnap.size;
                    break;

                case 'sys_total_schedules':
                    const allSchSnap = await db.collection('schedules').get();
                    value = allSchSnap.size;
                    break;

                case 'sys_avg_vacancy_rate':
                case 'sys_avg_adjustment_rate':
                case 'sys_avg_exchange_rate':
                case 'sys_score_min':
                case 'sys_score_max':
                case 'sys_score_avg':
                    // 這些指標需要從已發布的班表中聚合
                    const statsSnap = await db.collection('schedules').where('status', '==', 'published').get();
                    if(statsSnap.empty) { value = '0%'; break; }
                    
                    let total = 0, count = 0, min = 100, max = 0;
                    statsSnap.forEach(doc => {
                        const d = doc.data();
                        let val = 0;
                        if(source === 'sys_avg_vacancy_rate') val = d.vacancyRate || 0;
                        else if(source === 'sys_avg_adjustment_rate') val = d.adjustmentRate || 0;
                        else if(source === 'sys_avg_exchange_rate') val = d.exchangeRate || 0;
                        else if(source.startsWith('sys_score')) val = d.currentScore || 0;
                        
                        total += val;
                        count++;
                        if(val < min) min = val;
                        if(val > max) max = val;
                    });
                    
                    if(source === 'sys_score_min') value = min.toFixed(1);
                    else if(source === 'sys_score_max') value = max.toFixed(1);
                    else if(source === 'sys_score_avg') value = (total/count).toFixed(1);
                    else value = (total/count).toFixed(1) + '%';
                    break;

                default:
                    value = 'N/A';
            }
            
            el.textContent = value;
        } catch (e) {
            console.error(`Fetch data error for ${source}:`, e);
            el.textContent = 'ERR';
        }
    }
};
