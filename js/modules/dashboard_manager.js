// js/modules/dashboard_manager.js

const dashboardManager = {
    items: [],
    
    init: async function() {
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        container.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> 載入中...</div>';
        await this.loadItems();
        await this.renderDashboard();
    },

    loadItems: async function() {
        try {
            const activeRole = app.impersonatedRole || app.userRole;
            const snapshot = await db.collection('system_dashboard_items').where('isActive', '==', true).orderBy('order').get();
            this.items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => (item.allowedRoles || []).length === 0 || (item.allowedRoles || []).includes(activeRole));
        } catch (e) { console.error(e); }
    },

    renderDashboard: async function() {
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        container.innerHTML = '<div id="dashboard-grid" style="display: flex; gap: 20px; flex-wrap: wrap;"></div>';
        const grid = document.getElementById('dashboard-grid');

        this.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'dashboard-card';
            card.style.cssText = `flex: 1; min-width: 250px; background: white; padding: 20px; border-radius: 8px; border-left: 5px solid ${item.color}; cursor: pointer; transition: 0.2s;`;
            card.onclick = () => { if(item.path) location.hash = item.path; };
            card.innerHTML = `
                <div style="font-size: 0.9rem; color: #7f8c8d;"><i class="${item.icon}"></i> ${item.label}</div>
                <div style="font-size: 2rem; font-weight: bold; color: #2c3e50; margin: 10px 0;" id="val_${item.id}">...</div>
                <div style="font-size: 0.8rem; color: ${item.color};">查看詳情 <i class="fas fa-arrow-right"></i></div>
            `;
            grid.appendChild(card);
            this.fetchDataForSource(item.dataSource, `val_${item.id}`);
        });
    },

    fetchDataForSource: async function(source, elementId) {
        const el = document.getElementById(elementId);
        if(!el) return;
        try {
            const uid = app.getUid();
            const unitId = app.getUnitId();
            let val = '-';

            switch(source) {
                case 'my_active_pre_schedule':
                    // 調用統一狀態邏輯進行過濾
                    const preSnap = await db.collection('pre_schedules').get();
                    let activeCount = 0;
                    preSnap.forEach(doc => {
                        const d = doc.data();
                        const statusInfo = app.getPreScheduleStatus(d);
                        const isMember = (d.unitId === unitId) || (d.staffList || []).some(s => s.uid === uid);
                        const notSubmitted = !d.assignments || !d.assignments[uid];
                        
                        // 僅計算目前「開放中」且使用者尚未填寫的預班表
                        if (statusInfo.code === 'open' && isMember && notSubmitted) {
                            activeCount++;
                        }
                    });
                    val = activeCount;
                    break;

                case 'unit_staff_count':
                    const sSnap = await db.collection('users').where('unitId', '==', unitId).where('isActive', '==', true).get();
                    val = sSnap.size;
                    break;
                
                case 'unit_pre_schedule_progress':
                    const latest = await db.collection('pre_schedules').where('unitId', '==', unitId).orderBy('year','desc').orderBy('month','desc').limit(1).get();
                    if(!latest.empty) {
                        const prog = latest.docs[0].data().progress;
                        val = prog ? Math.round((prog.submitted/prog.total)*100) + '%' : '0%';
                    }
                    break;

                default: val = '0';
            }
            el.textContent = val;
        } catch (e) { el.textContent = 'ERR'; }
    }
};
