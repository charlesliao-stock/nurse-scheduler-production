// js/modules/dashboard_manager.js
// 🔧 完整修正版：支援模擬身分的即時數據統計

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

    // 1. 載入儀表板項目設定
    loadItems: async function() {
        try {
            // [修正] 取得當前模擬或真實的角色
            const activeRole = app.getRole(); 

            const snapshot = await db.collection('system_dashboard_items')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();
            
            this.items = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => {
                    const roles = item.allowedRoles || [];
                    // 如果沒有設定權限，預設所有人可見；否則檢查是否包含當前角色
                    return roles.length === 0 || roles.includes(activeRole);
                });
        } catch (e) {
            console.error("Load Dashboard Items Error:", e);
        }
    },

    // 2. 渲染儀表板
    renderDashboard: async function() {
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        
        if(this.items.length === 0) {
            container.innerHTML = '<div style="padding:40px; text-align:center; color:#999;">目前沒有可顯示的儀表板項目。</div>';
            return;
        }

        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        container.style.gap = '20px';
        container.style.padding = '20px';

        this.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'dashboard-card';
            card.style.cssText = `
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                box-shadow: 0 2px 8px rgba(0,0,0,0.05); 
                display: flex; 
                align-items: center; 
                transition: transform 0.2s;
                cursor: pointer;
            `;
            card.innerHTML = `
                <div style="background:${item.color || '#3498db'}; width:50px; height:50px; border-radius:12px; display:flex; align-items:center; justify-content:center; margin-right:15px; flex-shrink:0;">
                    <i class="${item.icon || 'fas fa-star'}" style="color:white; font-size:1.5rem;"></i>
                </div>
                <div style="flex:1;">
                    <div style="font-size:0.9rem; color:#7f8c8d; margin-bottom:5px;">${item.label}</div>
                    <div class="widget-value" style="font-size:1.4rem; font-weight:bold; color:#2c3e50;">
                        <i class="fas fa-spinner fa-spin" style="font-size:1rem; color:#ccc;"></i>
                    </div>
                </div>
                <i class="fas fa-chevron-right" style="color:#ddd;"></i>
            `;
            
            // 點擊跳轉
            card.onclick = () => {
                if(item.path) window.location.hash = item.path;
            };
            
            // 滑鼠特效
            card.onmouseenter = () => card.style.transform = 'translateY(-3px)';
            card.onmouseleave = () => card.style.transform = 'translateY(0)';

            container.appendChild(card);
            
            // 異步讀取數據
            this.updateWidgetData(item, card);
        });
    },

    // 3. 更新數據 (核心邏輯修正)
    updateWidgetData: async function(item, element) {
        try {
            let value = '前往';
            
            // [修正] 取得當前身分的關鍵 ID (支援模擬)
            const activeUnitId = app.getUnitId();
            const activeUid = app.getUid();
            
            // 根據 dataSource 執行對應查詢
            switch(item.dataSource) {
                case 'unit_staff_count':
                    // 單位總人數
                    if (activeUnitId) {
                        const snap = await db.collection('users')
                            .where('unitId', '==', activeUnitId)
                            .where('isActive', '==', true)
                            .get();
                        value = snap.size + " 人";
                    } else {
                        value = "N/A";
                    }
                    break;

                case 'my_pending_exchanges':
                    // 待我審核的換班 (Target是我)
                    if (activeUid) {
                        const snap = await db.collection('shift_requests')
                            .where('targetId', '==', activeUid)
                            .where('status', '==', 'pending_target')
                            .get();
                        // 若有待辦事項，顯示紅色強調
                        value = snap.size > 0 
                            ? `<span style="color:#e74c3c;">${snap.size} 筆待審</span>` 
                            : "無";
                    }
                    break;

                case 'unit_pending_exchanges':
                     // 單位管理者：待審核換班 (Manager審核階段)
                     if (activeUnitId) {
                        const snap = await db.collection('shift_requests')
                            .where('unitId', '==', activeUnitId)
                            .where('status', '==', 'pending_manager')
                            .get();
                        value = snap.size > 0 
                            ? `<span style="color:#e74c3c;">${snap.size} 筆待審</span>` 
                            : "無";
                     }
                     break;
                
                case 'my_schedule_status':
                    // 顯示本月班表狀態 (需計算當前月份)
                    if (activeUnitId) {
                        const now = new Date();
                        const year = now.getFullYear();
                        const month = now.getMonth() + 1;
                        const snap = await db.collection('schedules')
                            .where('unitId', '==', activeUnitId)
                            .where('year', '==', year)
                            .where('month', '==', month)
                            .limit(1)
                            .get();
                        
                        if (!snap.empty) {
                            const status = snap.docs[0].data().status;
                            value = status === 'published' ? '<span style="color:#27ae60;">已發布</span>' : '草稿';
                        } else {
                            value = '未建立';
                        }
                    }
                    break;

                case 'my_active_pre_schedule':
                     // 進行中的預班
                     if (activeUnitId) {
                        const snap = await db.collection('pre_schedules')
                            .where('unitId', '==', activeUnitId)
                            .where('status', '==', 'open')
                            .get();
                         value = snap.size > 0 ? "開放中" : "無";
                     }
                     break;

                default:
                    // 若無特定數據源，顯示預設文字
                    value = '查看';
            }
            
            // 更新畫面
            const valueEl = element.querySelector('.widget-value');
            if(valueEl) valueEl.innerHTML = value;

        } catch(e) {
            console.error(`Widget Update Error (${item.dataSource}):`, e);
            const valueEl = element.querySelector('.widget-value');
            if(valueEl) valueEl.innerText = "Err";
        }
    }
};
