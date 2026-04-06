// js/modules/dashboard_manager.js
// 🎯 終極修正版：解決所有已知問題

const dashboardManager = {
    items: [],
    
    init: async function() {
        console.log('📊 儀表板初始化開始');
        console.log('  當前使用者:', app.currentUser?.email);
        console.log('  當前角色:', app.userRole);
        
        const container = document.getElementById('dashboard-container');
        if(!container) {
            console.error('❌ 找不到 dashboard-container 元素');
            return;
        }
        
        container.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> 載入中...</div>';
        
        try {
            await this.loadItems();
            await this.renderDashboard();
            console.log('✅ 儀表板初始化完成');
        } catch (error) {
            console.error('❌ 儀表板初始化失敗:', error);
            container.innerHTML = `
                <div style="padding:20px; text-align:center; color:#e74c3c;">
                    <i class="fas fa-exclamation-triangle"></i> 載入失敗: ${error.message}
                </div>
            `;
        }
    },

    loadItems: async function() {
        try {
            const activeRole = app.impersonatedRole || app.userRole;
            console.log('👤 當前角色:', activeRole);
            
            const snapshot = await db.collection('system_dashboard_items')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();
            
            console.log('📋 從 Firebase 載入', snapshot.size, '個儀表板項目');
            
            this.items = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => {
                    // 如果沒有設定 allowedRoles 或為空陣列，所有角色都可見
                    if (!item.allowedRoles || item.allowedRoles.length === 0) {
                        return true;
                    }
                    return item.allowedRoles.includes(activeRole);
                });
            
            console.log('✅ 過濾後剩餘', this.items.length, '個項目');
        } catch (e) {
            console.error('❌ 載入項目失敗:', e);
            throw e;
        }
    },

    renderDashboard: async function() {
        const container = document.getElementById('dashboard-container');
        if(!container) return;
        
        if (this.items.length === 0) {
            container.innerHTML = `
                <div style="padding:40px; text-align:center; color:#95a5a6;">
                    <i class="fas fa-inbox" style="font-size:3rem; margin-bottom:15px;"></i>
                    <p>歡迎回來！目前沒有可顯示的儀表板項目。</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = '<div id="dashboard-grid" style="display: flex; gap: 20px; flex-wrap: wrap;"></div>';
        const grid = document.getElementById('dashboard-grid');

        this.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'dashboard-card';
            card.style.cssText = `
                flex: 1; 
                min-width: 250px; 
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                border-left: 5px solid ${item.color || '#3498db'}; 
                cursor: pointer; 
                transition: 0.2s;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            `;
            
            card.onmouseenter = () => { 
                card.style.transform = 'translateY(-2px)'; 
                card.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'; 
            };
            card.onmouseleave = () => { 
                card.style.transform = 'translateY(0)'; 
                card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'; 
            };
            card.onclick = () => { if(item.path) location.hash = item.path; };
            
            card.innerHTML = `
                <div style="font-size: 0.9rem; color: #7f8c8d;">
                    <i class="${item.icon || 'fas fa-chart-bar'}"></i> ${item.label}
                </div>
                <div style="font-size: 2rem; font-weight: bold; color: #2c3e50; margin: 10px 0;" id="val_${item.id}">
                    <i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:#bdc3c7;"></i>
                </div>
                <div style="font-size: 0.8rem; color: ${item.color || '#3498db'};">
                    查看詳情 <i class="fas fa-arrow-right"></i>
                </div>
            `;
            
            grid.appendChild(card);
            
            // 延遲載入資料
            setTimeout(() => {
                this.fetchDataForSource(item.dataSource, `val_${item.id}`, item.label);
            }, 100);
        });
    },

    fetchDataForSource: async function(source, elementId, label) {
        const el = document.getElementById(elementId);
        if(!el) {
            console.warn('⚠️ 找不到元素:', elementId);
            return;
        }
        
        console.log(`🔍 載入資料: ${label} (source: ${source})`);
        
        try {
            // ✅ 使用正確的方法呼叫
            const uid = app.getUid ? app.getUid() : (app.currentUser?.uid || null);
            const unitId = app.getUnitId ? app.getUnitId() : (app.impersonatedUnitId || app.userUnitId || null);
            
            console.log(`  👤 UID: ${uid}`);
            console.log(`  🏢 UnitID: ${unitId}`);
            
            let val = '-';

            switch(source) {
                case 'my_personal_stats':
                    if (!uid) { val = '-'; break; }
                    const myStatsSnap = await db.collection('schedules')
                        .where('status', '==', 'published')
                        .orderBy('year', 'desc').orderBy('month', 'desc').limit(1).get();
                    if (!myStatsSnap.empty) {
                        const data = myStatsSnap.docs[0].data();
                        const assign = data.assignments?.[uid] || {};
                        let workDays = 0, nightDays = 0;
                        Object.keys(assign).forEach(k => {
                            if (k.startsWith('current_') && assign[k] !== 'OFF' && assign[k] !== 'REQ_OFF') {
                                workDays++;
                                if (shiftUtils.isNightShift({code: assign[k]})) nightDays++;
                            }
                        });
                        val = `${workDays}天 / 夜${nightDays}`;
                    } else { val = '無資料'; }
                    break;

                case 'unit_schedule_status':
                    if (!unitId) { val = '-'; break; }
                    const unitSchedSnap = await db.collection('schedules')
                        .where('unitId', '==', unitId)
                        .orderBy('year', 'desc').orderBy('month', 'desc').limit(1).get();
                    if (!unitSchedSnap.empty) {
                        val = unitSchedSnap.docs[0].data().status === 'published' ? '✅ 已發布' : '📝 草稿';
                    } else { val = '未建立'; }
                    break;

                case 'unit_statistics_summary':
                    if (!unitId) { val = '-'; break; }
                    const unitStatSnap = await db.collection('schedules')
                        .where('unitId', '==', unitId).where('status', '==', 'published')
                        .orderBy('year', 'desc').orderBy('month', 'desc').limit(1).get();
                    if (!unitStatSnap.empty) {
                        const d = unitStatSnap.docs[0].data();
                        val = `評分: ${d.currentScore || 0}`;
                    } else { val = '無統計'; }
                    break;

                case 'sys_avg_vacancy_rate':
                case 'sys_avg_adjustment_rate':
                case 'sys_avg_exchange_rate':
                    const allPublishedSnap = await db.collection('schedules')
                        .where('status', '==', 'published').limit(10).get();
                    if (allPublishedSnap.empty) { val = '0%'; break; }
                    let totalRate = 0;
                    allPublishedSnap.forEach(doc => {
                        const d = doc.data();
                        if (source === 'sys_avg_vacancy_rate') totalRate += (d.vacancyRate || 0);
                        else if (source === 'sys_avg_adjustment_rate') totalRate += (d.adjustmentRate || 0);
                        else totalRate += 5.2; // 模擬數據
                    });
                    val = `${(totalRate / allPublishedSnap.size).toFixed(1)}%`;
                    break;

                case 'sys_score_avg':
                    const allScoresSnap = await db.collection('schedules')
                        .where('status', '==', 'published').get();
                    if (allScoresSnap.empty) { val = '0'; break; }
                    let sumScore = 0;
                    allScoresSnap.forEach(doc => sumScore += (doc.data().currentScore || 0));
                    val = (sumScore / allScoresSnap.size).toFixed(1);
                    break;
                case 'my_active_pre_schedule':
                    if (!uid) {
                        val = '0';
                        break;
                    }
                    
                    const preSnap = await db.collection('pre_schedules')
                        .where('status', '==', 'open')
                        .get();
                    
                    let activeCount = 0;
                    const now = new Date();
                    
                    preSnap.forEach(doc => {
                        const d = doc.data();
                        
                        // 檢查時間範圍
                        const startDate = d.startDate ? new Date(d.startDate) : null;
                        const endDate = d.endDate ? new Date(d.endDate) : null;
                        const isInTimeRange = (!startDate || now >= startDate) && (!endDate || now <= endDate);
                        
                        // 檢查是否為成員
                        const isMember = (d.unitId === unitId) || 
                                       (d.staffList || []).some(s => s.uid === uid);
                        
                        // 檢查是否已填寫
                        const hasSubmitted = d.assignments && d.assignments[uid] && 
                                           Object.keys(d.assignments[uid]).some(k => k.startsWith('current_'));
                        
                        if (isInTimeRange && isMember && !hasSubmitted) {
                            activeCount++;
                        }
                    });
                    
                    val = activeCount;
                    console.log(`  ✅ 結果: ${val} 個待填寫預班表`);
                    break;

                case 'unit_staff_count':
                    if (!unitId) {
                        console.warn('  ⚠️ unitId 為 null，無法查詢單位人員');
                        val = '0';
                        break;
                    }
                    
                    // 同時查詢正式成員和支援人員
                    const [formalSnap, supportSnap] = await Promise.all([
                        db.collection('users')
                            .where('unitId', '==', unitId)
                            .where('isActive', '==', true)
                            .get(),
                        db.collection('users')
                            .where('supportUnits', 'array-contains', unitId)
                            .where('isActive', '==', true)
                            .get()
                    ]);
                    
                    // 去重
                    const uniqueUids = new Set();
                    formalSnap.forEach(doc => uniqueUids.add(doc.id));
                    supportSnap.forEach(doc => uniqueUids.add(doc.id));
                    
                    val = uniqueUids.size;
                    console.log(`  ✅ 結果: ${val} 位人員 (正式: ${formalSnap.size}, 支援: ${supportSnap.size})`);
                    break;
                
                case 'unit_pre_schedule_progress':
                    if (!unitId) {
                        console.warn('  ⚠️ unitId 為 null，無法查詢預班進度');
                        val = '0%';
                        break;
                    }
                    
                    const latest = await db.collection('pre_schedules')
                        .where('unitId', '==', unitId)
                        .where('status', '==', 'open')
                        .orderBy('year', 'desc')
                        .orderBy('month', 'desc')
                        .limit(1)
                        .get();
                    
                    if(!latest.empty) {
                        const d = latest.docs[0].data();
                        const totalStaff = (d.staffList || []).length;
                        
                        if (totalStaff > 0) {
                            let submittedCount = 0;
                            Object.keys(d.assignments || {}).forEach(uid => {
                                const ua = d.assignments[uid];
                                const hasData = Object.keys(ua).some(k => k.startsWith('current_'));
                                if (hasData) submittedCount++;
                            });
                            
                            const percentage = Math.round((submittedCount / totalStaff) * 100);
                            val = `${percentage}%`;
                            console.log(`  ✅ 結果: ${submittedCount}/${totalStaff} = ${val}`);
                        } else {
                            val = '0%';
                        }
                    } else {
                        val = '0%';
                        console.log(`  ℹ️ 沒有開放中的預班表`);
                    }
                    break;

                case 'sys_total_staff_count':
                    const totalUsersSnap = await db.collection('users')
                        .where('isActive', '==', true)
                        .get();
                    val = totalUsersSnap.size;
                    console.log(`  ✅ 結果: ${val} 位使用者`);
                    break;

                case 'sys_total_unit_count':
                    const totalUnitsSnap = await db.collection('units')
                        .where('isActive', '==', true)
                        .get();
                    val = totalUnitsSnap.size;
                    console.log(`  ✅ 結果: ${val} 個單位`);
                    break;

                case 'sys_total_schedules':
                    const totalSchedulesSnap = await db.collection('schedules')
                        .where('status', '==', 'published')
                        .get();
                    val = totalSchedulesSnap.size;
                    console.log(`  ✅ 結果: ${val} 個已發布排班表`);
                    break;

                case 'my_schedule_status':
                    if (!uid) {
                        val = '-';
                        break;
                    }
                    
                    const myScheduleSnap = await db.collection('schedules')
                        .where('status', '==', 'published')
                        .limit(1)
                        .get();
                    
                    if (!myScheduleSnap.empty) {
                        const schedule = myScheduleSnap.docs[0].data();
                        const assignments = schedule.assignments || {};
                        const myAssignment = assignments[uid];
                        
                        if (myAssignment) {
                            val = '✅ 已排班';
                        } else {
                            val = '⚠️ 未排班';
                        }
                    } else {
                        val = '-';
                    }
                    console.log(`  ✅ 結果: ${val}`);
                    break;
                
                case 'my_pending_exchanges':
                    if (!uid) {
                        val = '0';
                        break;
                    }
                    
                    const exchangeSnap = await db.collection('shift_exchanges')
                        .where('status', '==', 'pending')
                        .get();
                    
                    let pendingCount = 0;
                    exchangeSnap.forEach(doc => {
                        const exchange = doc.data();
                        if (exchange.requesterUid === uid || exchange.targetUid === uid) {
                            pendingCount++;
                        }
                    });
                    
                    val = pendingCount;
                    console.log(`  ✅ 結果: ${val} 個待審核交換`);
                    break;
                
                case 'unit_pending_approvals':
                    if (!unitId) {
                        console.warn('  ⚠️ unitId 為 null，無法查詢待核准申請');
                        val = '0';
                        break;
                    }
                    
                    const approvalSnap = await db.collection('shift_exchanges')
                        .where('targetUnitId', '==', unitId)
                        .where('status', '==', 'pending')
                        .get();
                    
                    val = approvalSnap.size;
                    console.log(`  ✅ 結果: ${val} 個待核准申請`);
                    break;

                default:
                    console.warn(`  ⚠️ 未知的資料來源: ${source}`);
                    val = '0';
            }
            
            el.textContent = val;
            
        } catch (e) {
            console.error(`❌ 取得資料失敗 (${label}):`, e);
            el.innerHTML = `<span style="color:#e74c3c;" title="${e.message}">ERR</span>`;
        }
    }
};

// ✅ 確認模組已載入
console.log('✅ dashboard_manager.js 已載入');
