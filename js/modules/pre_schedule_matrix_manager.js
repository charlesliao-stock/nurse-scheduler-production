// js/modules/pre_schedule_matrix_manager.js
// 🔧 完整版 v5：
// - 顯示 FF、新增狀態欄（孕/哺/P/D）+ 人員與狀態同步檢查
// - 新增志願重複檢查（動態過濾）
// - 新增包班與志願衝突檢查（4小時內同系列）
// - 新增人員同步後偏好驗證

const matrixManager = {
    docId: null, 
    data: null, 
    shifts: [], 
    localAssignments: {}, 
    usersMap: {}, 
    isLoading: false,
    historyCorrections: {},
    lastMonthAssignments: {},
    lastMonthDays: 31,

    init: async function(id) { 
        if(!id) { 
            alert("預班表 ID 遺失"); 
            return; 
        }
        
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法編輯預班表</p>
                </div>
            `;
            return;
        }
        
        this.docId = id; 
        this.isLoading = true;
        
        try {
            this.showLoading();
            
            const preDoc = await db.collection('pre_schedules').doc(id).get();
            if (!preDoc.exists) {
                alert("找不到此預班表");
                return;
            }
            
            const preData = preDoc.data();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if (activeUnitId !== preData.unitId) {
                    document.getElementById('content-area').innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-lock"></i>
                            <h3>權限不足</h3>
                            <p>您無權編輯其他單位的預班表</p>
                        </div>
                    `;
                    return;
                }
            }
            
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadScheduleData()
            ]);
            
            // 🆕 檢查人員與狀態變更
            await this.checkStaffAndStatusChanges();
            
            this.restoreTableStructure(); 
            this.updateTitle();
            this.renderMatrix(); 
            this.updateStats(); 
            this.setupEvents();
            
        } catch(e) { 
            console.error("❌ 載入失敗:", e); 
            alert("載入失敗: " + e.message); 
        } 
        finally { 
            this.isLoading = false; 
        }
    },

    // 🆕 檢查人員與狀態變更
    checkStaffAndStatusChanges: async function() {
        if (!this.data || !this.data.unitId) return;
        
        // 1. 從 users 集合取得該單位最新的人員清單
        const snapshot = await db.collection('users')
            .where('unitId', '==', this.data.unitId)
            .where('isActive', '==', true)
            .get();
        
        const currentUsers = {};
        snapshot.forEach(doc => {
            const user = doc.data();
            currentUsers[doc.id] = {
                uid: doc.id,
                empId: user.employeeId,
                name: user.displayName,
                level: user.level,
                groupId: user.groupId,
                schedulingParams: user.schedulingParams || {}
            };
        });
        
        // 2. 比對 staffList 的變更
        const oldStaffMap = {};
        (this.data.staffList || []).forEach(staff => {
            oldStaffMap[staff.uid] = staff;
        });
        
        const changes = {
            added: [],      // 新增的人員
            removed: [],    // 移除的人員（已停用）
            statusChanged: [] // 狀態變更的人員
        };
        
        // 檢查新增的人員
        Object.keys(currentUsers).forEach(uid => {
            if (!oldStaffMap[uid]) {
                changes.added.push({
                    uid: uid,
                    name: currentUsers[uid].name,
                    empId: currentUsers[uid].empId
                });
            }
        });
        
        // 檢查移除的人員
        Object.keys(oldStaffMap).forEach(uid => {
            if (!currentUsers[uid]) {
                changes.removed.push({
                    uid: uid,
                    name: oldStaffMap[uid].name,
                    empId: oldStaffMap[uid].empId || this.usersMap[uid]?.employeeId
                });
            }
        });
        
        // 檢查狀態變更
        Object.keys(currentUsers).forEach(uid => {
            if (oldStaffMap[uid]) {
                const oldParams = oldStaffMap[uid].schedulingParams || {};
                const newParams = currentUsers[uid].schedulingParams || {};
                
                const statusChanges = this.compareSchedulingParams(oldParams, newParams);
                if (statusChanges.length > 0) {
                    changes.statusChanged.push({
                        uid: uid,
                        name: currentUsers[uid].name,
                        empId: currentUsers[uid].empId,
                        changes: statusChanges
                    });
                }
            }
        });
        
        // 3. 如果有變更，顯示確認視窗
        if (changes.added.length > 0 || changes.removed.length > 0 || changes.statusChanged.length > 0) {
            const shouldUpdate = await this.showStaffChangesModal(changes);
            
            if (shouldUpdate) {
                await this.updateStaffList(currentUsers);
            }
        }
    },

    // 🆕 比對排班參數變更
    compareSchedulingParams: function(oldParams, newParams) {
        const changes = [];
        const today = new Date();
        
        // 檢查懷孕狀態
        const oldPregnant = oldParams.isPregnant && oldParams.pregnantExpiry && new Date(oldParams.pregnantExpiry) >= today;
        const newPregnant = newParams.isPregnant && newParams.pregnantExpiry && new Date(newParams.pregnantExpiry) >= today;
        
        if (oldPregnant !== newPregnant) {
            changes.push(newPregnant ? '新增「孕」狀態' : '移除「孕」狀態');
        }
        
        // 檢查哺乳狀態
        const oldBreastfeeding = oldParams.isBreastfeeding && oldParams.breastfeedingExpiry && new Date(oldParams.breastfeedingExpiry) >= today;
        const newBreastfeeding = newParams.isBreastfeeding && newParams.breastfeedingExpiry && new Date(newParams.breastfeedingExpiry) >= today;
        
        if (oldBreastfeeding !== newBreastfeeding) {
            changes.push(newBreastfeeding ? '新增「哺」狀態' : '移除「哺」狀態');
        }
        
        // 檢查 PGY 狀態
        const oldPGY = oldParams.isPGY && oldParams.pgyExpiry && new Date(oldParams.pgyExpiry) >= today;
        const newPGY = newParams.isPGY && newParams.pgyExpiry && new Date(newParams.pgyExpiry) >= today;
        
        if (oldPGY !== newPGY) {
            changes.push(newPGY ? '新增「PGY」狀態' : '移除「PGY」狀態');
        }
        
        // 檢查獨立性狀態
        const oldDependent = oldParams.independence === 'dependent';
        const newDependent = newParams.independence === 'dependent';
        
        if (oldDependent !== newDependent) {
            changes.push(newDependent ? '變更為「未獨立」' : '變更為「獨立」');
        }
        
        return changes;
    },

    // 🆕 顯示人員變更確認視窗
    showStaffChangesModal: function(changes) {
        return new Promise((resolve) => {
            const modalHtml = `
            <div id="staffChangesModal" style="display:flex; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5); align-items:center; justify-content:center;">
                <div style="background:white; padding:30px; border-radius:12px; width:700px; max-height:85vh; overflow-y:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                    <h3 style="margin:0 0 10px 0; color:#2c3e50;">
                        <i class="fas fa-sync-alt" style="color:#3498db;"></i> 人員與狀態變更通知
                    </h3>
                    <p style="color:#666; margin-bottom:25px; font-size:0.95rem;">
                        偵測到人員名單或狀態有變更，是否要同步更新預班表？
                    </p>
                    
                    ${changes.added.length > 0 ? `
                    <div style="border:2px solid #27ae60; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <h4 style="margin:0 0 10px 0; color:#27ae60;">
                            <i class="fas fa-user-plus"></i> 新增人員 (${changes.added.length} 位)
                        </h4>
                        <ul style="margin:0; padding-left:20px; line-height:1.8;">
                            ${changes.added.map(p => `<li><strong>${p.empId}</strong> - ${p.name}</li>`).join('')}
                        </ul>
                        <div style="margin-top:10px; padding:10px; background:#d4edda; border-radius:4px; font-size:0.9rem;">
                            <i class="fas fa-info-circle"></i> 新增人員將自動加入預班表，初始狀態為空白
                        </div>
                    </div>
                    ` : ''}
                    
                    ${changes.removed.length > 0 ? `
                    <div style="border:2px solid #e74c3c; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <h4 style="margin:0 0 10px 0; color:#e74c3c;">
                            <i class="fas fa-user-minus"></i> 移除人員 (${changes.removed.length} 位)
                        </h4>
                        <ul style="margin:0; padding-left:20px; line-height:1.8;">
                            ${changes.removed.map(p => `<li><strong>${p.empId}</strong> - ${p.name}</li>`).join('')}
                        </ul>
                        <div style="margin-top:10px; padding:10px; background:#f8d7da; border-radius:4px; font-size:0.9rem;">
                            <i class="fas fa-exclamation-triangle"></i> 這些人員已停用，其預班資料將保留但不會顯示在表格中
                        </div>
                    </div>
                    ` : ''}
                    
                    ${changes.statusChanged.length > 0 ? `
                    <div style="border:2px solid #f39c12; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <h4 style="margin:0 0 10px 0; color:#f39c12;">
                            <i class="fas fa-user-edit"></i> 狀態變更 (${changes.statusChanged.length} 位)
                        </h4>
                        <ul style="margin:0; padding-left:20px; line-height:1.8;">
                            ${changes.statusChanged.map(p => `
                                <li>
                                    <strong>${p.empId}</strong> - ${p.name}
                                    <ul style="margin-top:5px; color:#666; font-size:0.9rem;">
                                        ${p.changes.map(c => `<li>${c}</li>`).join('')}
                                    </ul>
                                </li>
                            `).join('')}
                        </ul>
                        <div style="margin-top:10px; padding:10px; background:#fff3cd; border-radius:4px; font-size:0.9rem;">
                            <i class="fas fa-info-circle"></i> 狀態變更會影響排班規則（如夜班限制、獨立性等）
                        </div>
                    </div>
                    ` : ''}
                    
                    <div style="background:#e8f4fd; border-left:4px solid #3498db; padding:15px; border-radius:4px; margin-bottom:20px;">
                        <strong style="color:#2c3e50;">建議操作：</strong>
                        <ul style="margin:10px 0 0 0; padding-left:20px; line-height:1.6;">
                            <li>點擊「同步更新」將套用以上變更</li>
                            <li>已設定的預班資料將保留</li>
                            <li>新增人員需要手動設定其預班與偏好</li>
                            <li>移除人員的資料仍會保留在系統中</li>
                        </ul>
                    </div>
                    
                    <div style="display:flex; gap:15px; justify-content:flex-end;">
                        <button id="btnCancelSync" style="padding:10px 20px; border:1px solid #95a5a6; background:#fff; border-radius:4px; cursor:pointer; font-size:1rem;">
                            <i class="fas fa-times"></i> 暫不更新
                        </button>
                        <button id="btnConfirmSync" style="padding:10px 20px; border:none; background:#3498db; color:white; border-radius:4px; cursor:pointer; font-size:1rem; font-weight:bold;">
                            <i class="fas fa-sync-alt"></i> 同步更新
                        </button>
                    </div>
                </div>
            </div>`;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            document.getElementById('btnConfirmSync').onclick = () => {
                document.getElementById('staffChangesModal').remove();
                resolve(true);
            };
            
            document.getElementById('btnCancelSync').onclick = () => {
                document.getElementById('staffChangesModal').remove();
                resolve(false);
            };
        });
    },

    // 🆕 更新人員清單（含偏好驗證）
    updateStaffList: async function(currentUsers) {
        try {
            // 1. 建立新的 staffList
            const newStaffList = [];
            Object.keys(currentUsers).forEach(uid => {
                const user = currentUsers[uid];
                
                newStaffList.push({
                    uid: uid,
                    empId: user.empId,
                    name: user.name,
                    level: user.level || 'N',
                    group: user.groupId || '',
                    schedulingParams: user.schedulingParams
                });
            });
            
            // 🔥 2. 檢查所有人員的偏好是否仍然有效
            const invalidPrefs = [];
            
            newStaffList.forEach(staff => {
                const assign = this.localAssignments[staff.uid];
                if (assign?.preferences) {
                    const prefs = assign.preferences;
                    const allPrefs = [prefs.favShift, prefs.favShift2, prefs.favShift3].filter(Boolean);
                    
                    allPrefs.forEach(pref => {
                        const shiftExists = this.shifts.some(s => s.code === pref);
                        if (!shiftExists) {
                            invalidPrefs.push({ 
                                uid: staff.uid, 
                                name: staff.name, 
                                empId: staff.empId,
                                shift: pref 
                            });
                        }
                    });
                }
            });
            
            // 3. 更新到 Firestore
            await db.collection('pre_schedules').doc(this.docId).update({
                staffList: newStaffList,
                lastSyncAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // 4. 更新本地資料
            this.data.staffList = newStaffList;
            
            console.log('✅ 人員清單已同步更新');
            
            // 🔥 5. 如果有無效偏好，顯示警告
            if (invalidPrefs.length > 0) {
                const warnMsg = invalidPrefs.map(p => 
                    `${p.empId} ${p.name}: 志願「${p.shift}」已不存在`
                ).join('\n');
                
                alert(`⚠️ 以下人員的志願班別已失效，請重新設定偏好：\n\n${warnMsg}`);
            }
            
        } catch (error) {
            console.error('❌ 更新人員清單失敗:', error);
            alert('更新失敗: ' + error.message);
        }
    },

    showLoading: function() { 
        const tbody = document.getElementById('matrixBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="35" style="text-align:center; padding:20px;">載入中...</td></tr>'; 
        }
    },
    
    updateTitle: function() {
        if (!this.data) return;
        const title = document.getElementById('matrixTitle');
        const status = document.getElementById('matrixStatus');
        
        if (title) {
            title.textContent = `${this.data.year} 年 ${this.data.month} 月 預班管理`;
        }
        if (status) {
            const statusMap = { 'open': '開放中', 'closed': '已鎖定' };
            const statusColor = this.data.status === 'open' ? '#2ecc71' : '#95a5a6';
            status.textContent = statusMap[this.data.status] || '未知';
            status.style.background = statusColor;
        }
    },
    
    loadShifts: async function() { 
        if(!this.docId) return;
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(doc.exists) {
            const uid = doc.data().unitId;
            const snap = await db.collection('shifts')
                .where('unitId','==',uid)
                .orderBy('startTime')
                .get();
            this.shifts = snap.docs.map(d => d.data()).filter(s => s.isPreScheduleAvailable);
        }
    },
    
    loadUsers: async function() { 
        const snap = await db.collection('users').get(); 
        snap.forEach(d => this.usersMap[d.id] = d.data()); 
    },
    
    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        this.data = doc.data();
        
        this.localAssignments = this.data.assignments || {};
        this.historyCorrections = this.data.historyCorrections || {}; 
        
        console.log("Loaded localAssignments:", Object.keys(this.localAssignments).length, "users");
        
        if(!this.data.specificNeeds) {
            this.data.specificNeeds = {};
        }
        
        await this.loadLastMonthSchedule();
    },

    loadLastMonthSchedule: async function() {
        const { unitId, year, month } = this.data;
        let lastYear = year;
        let lastMonth = month - 1;
        
        if (lastMonth === 0) {
            lastMonth = 12;
            lastYear--;
        }

        const snap = await db.collection('schedules')
            .where('unitId', '==', unitId)
            .where('year', '==', lastYear)
            .where('month', '==', lastMonth)
            .where('status', '==', 'published')
            .limit(1)
            .get();

        this.lastMonthAssignments = {};
        this.lastMonthDays = new Date(lastYear, lastMonth, 0).getDate();
        
        if (!snap.empty) {
            const lastData = snap.docs[0].data();
            this.lastMonthAssignments = lastData.assignments || {};
            console.log(`✅ 已載入上個月 (${lastYear}-${lastMonth}) 已發布班表`);
        } else {
            console.warn(`⚠️ 找不到上個月 (${lastYear}-${lastMonth}) 的已發布班表`);
        }
    },

    restoreTableStructure: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        if (thead) thead.innerHTML = '';
        if (tbody) tbody.innerHTML = '';
        if (tfoot) tfoot.innerHTML = '';
    },

    getStaffStatusBadges: function(uid) {
        const user = this.usersMap[uid];
        if (!user) return '';
        
        const badges = [];
        const params = user.schedulingParams || {};
        const today = new Date();
        
        if (params.isPregnant && params.pregnantExpiry) {
            const expiry = new Date(params.pregnantExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#ff9800; color:white;">孕</span>');
            }
        }
        
        if (params.isBreastfeeding && params.breastfeedingExpiry) {
            const expiry = new Date(params.breastfeedingExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#4caf50; color:white;">哺</span>');
            }
        }
        
        if (params.isPGY && params.pgyExpiry) {
            const expiry = new Date(params.pgyExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#2196f3; color:white;">P</span>');
            }
        }
        
        if (params.independence === 'dependent') {
            badges.push('<span class="status-badge" style="background:#9c27b0; color:white;">協</span>');
        }
        
        return badges.join('');
    },

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px; position:sticky; left:140px; z-index:110; background:#f8f9fa;">狀態</th>
            <th rowspan="2" style="width:50px;">偏好</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem;">上月月底 (可修)</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        h1 += `<th colspan="4" style="background:#e8f4fd; font-size:0.8rem;">統計</th></tr>`;

        let h2 = `<tr>`;
        const weeks = ['日','一','二','三','四','五','六'];
        
        const lastMonthDays = this.lastMonthDays || 31;
        for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
            h2 += `<th class="cell-narrow" style="background:#f5f5f5; font-size:0.7rem; color:#666;">${d}</th>`;
        }

        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `<th style="width:40px; background:#f0f7ff; font-size:0.75rem;">總OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">假OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">小夜</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">大夜</th></tr>`;
        thead.innerHTML = h1 + h2;

        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.localAssignments[uid] || {};
            const empId = this.usersMap[uid]?.employeeId || staff.empId;

            const prefs = assign.preferences || {};
            let prefDisplay = '';
            if (prefs.bundleShift) prefDisplay += `<div style="font-weight:bold; font-size:0.85rem;">包${prefs.bundleShift}</div>`;
            
            let favs = [];
            if (prefs.favShift) favs.push(prefs.favShift);
            if (prefs.favShift2) favs.push(prefs.favShift2);
            if (prefs.favShift3) favs.push(prefs.favShift3);
            if (favs.length > 0) prefDisplay += `<div style="font-size:0.75rem; color:#666;">${favs.join('->')}</div>`;

            const statusBadges = this.getStaffStatusBadges(uid);

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:10;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10;">${staff.name}</td>
                <td style="position:sticky; left:140px; background:#fff; z-index:10; text-align:center; line-height:1.2;">
                    ${statusBadges || '<span style="color:#ccc;">-</span>'}
                </td>
                <td style="cursor:pointer; text-align:center; line-height:1.3; padding:4px 2px;" onclick="matrixManager.openPrefModal('${uid}','${staff.name}')">
                    ${prefDisplay || '<i class="fas fa-cog" style="color:#ccc;"></i>'}
                </td>`;
            
            const lastAssign = this.lastMonthAssignments[uid] || {};
            for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
                const historyKey = `last_${d}`;
                const originalVal = lastAssign[`current_${d}`] || lastAssign[d] || '';
                const correctedVal = this.historyCorrections[uid]?.[historyKey];
                
                const displayVal = (correctedVal !== undefined) ? correctedVal : originalVal;
                
                const bgStyle = (correctedVal !== undefined) 
                    ? 'background:#fff3cd; color:#333; font-weight:bold;' 
                    : 'background:#fafafa; color:#999;';

                bodyHtml += `<td class="cell-clickable prev-month-cell" 
                                 data-uid="${uid}" 
                                 data-day="${d}" 
                                 data-type="history"
                                 style="${bgStyle} font-size:0.85rem; text-align:center; cursor:pointer;">
                                 ${displayVal === 'OFF' ? 'FF' : displayVal}
                             </td>`;
            }

            let totalOff = 0;
            let holidayOff = 0;
            let eveningCount = 0;
            let nightCount = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable" data-uid="${uid}" data-day="${d}" data-type="current">${this.renderCellContent(val)}</td>`;
                
                if (val === 'REQ_OFF') {
                    totalOff++;
                    const date = new Date(year, month-1, d);
                    const w = date.getDay();
                    if (w === 0 || w === 6) holidayOff++;
                } else if (val === 'E') eveningCount++;
                else if (val === 'N') nightCount++;
            }

            bodyHtml += `<td style="background:#f9f9f9; font-weight:bold; text-align:center;">${totalOff}</td>
                         <td style="background:#f9f9f9; color:red; text-align:center;">${holidayOff}</td>
                         <td style="background:#f9f9f9; text-align:center;">${eveningCount}</td>
                         <td style="background:#f9f9f9; text-align:center;">${nightCount}</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        let footHtml = '';
        this.shifts.forEach((s, idx) => {
            footHtml += `<tr>`;
            if(idx === 0) footHtml += `<td colspan="10" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle;">每日人力<br>監控 (點擊調整)</td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const jsDay = new Date(year, month-1, d).getDay(); 
                const dayIdx = (jsDay === 0) ? 6 : jsDay - 1; 
                
                let need = 0;
                let isTemp = false;
                
                if (this.data.specificNeeds[dateStr] && this.data.specificNeeds[dateStr][s.code] !== undefined) {
                    need = this.data.specificNeeds[dateStr][s.code];
                    isTemp = true;
                } else {
                    need = this.data.dailyNeeds[`${s.code}_${dayIdx}`] || 0;
                }

                const style = isTemp ? 'background:#fff3cd; border:2px solid #f39c12;' : '';
                footHtml += `<td id="stat_cell_${s.code}_${d}" style="cursor:pointer; ${style}" 
                                onclick="matrixManager.handleNeedClick('${dateStr}', '${s.code}', ${need})">
                                <span class="stat-actual">-</span> / <span class="stat-need" style="font-weight:bold;">${need}</span>
                             </td>`;
            }
            footHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
            footHtml += `</tr>`;
        });
        tfoot.innerHTML = footHtml;
        
        setTimeout(() => this.updateStats(), 0);
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return 'FF';
        if(val === 'REQ_OFF') return '<span class="badge" style="background:#fff3cd; color:#856404; border:1px solid #ffeeba;">預休</span>';
        if(typeof val === 'string' && val.startsWith('!')) return `<span style="color:red; font-size:0.8rem;">!${val.replace('!','')}</span>`;
        return val;
    },

    handleNeedClick: async function(dateStr, shiftCode, currentNeed) {
        const newNeed = prompt(`調整 ${dateStr} [${shiftCode}] 需求人數：`, currentNeed);
        if (newNeed === null) return;
        const val = parseInt(newNeed);
        if (isNaN(val) || val < 0) return;

        if (!this.data.specificNeeds[dateStr]) this.data.specificNeeds[dateStr] = {};
        this.data.specificNeeds[dateStr][shiftCode] = val;

        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                specificNeeds: this.data.specificNeeds,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const schSnap = await db.collection('schedules').where('sourceId', '==', this.docId).get();
            if (!schSnap.empty) {
                await db.collection('schedules').doc(schSnap.docs[0].id).update({ specificNeeds: this.data.specificNeeds });
            }
            this.renderMatrix();
        } catch(e) { console.error(e); alert("更新失敗"); }
    },

    updateStats: function() {
        const counts = {}; 
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        for(let d=1; d<=daysInMonth; d++) {
            counts[d] = {};
            this.shifts.forEach(s => counts[d][s.code] = 0);
        }
        Object.values(this.localAssignments).forEach(assign => {
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val && val !== 'OFF' && val !== 'REQ_OFF' && !val.startsWith('!')) {
                    if(counts[d][val] !== undefined) counts[d][val]++;
                }
            }
        });
        for(let d=1; d<=daysInMonth; d++) {
            this.shifts.forEach(s => {
                const cell = document.getElementById(`stat_cell_${s.code}_${d}`);
                if(cell) {
                    const actualSpan = cell.querySelector('.stat-actual');
                    const needSpan = cell.querySelector('.stat-need');
                    const actual = counts[d][s.code];
                    const need = parseInt(needSpan.innerText);
                    if(actualSpan) actualSpan.innerText = actual;
                    if(actual < need) cell.classList.add('text-danger');
                    else cell.classList.remove('text-danger');
                }
            });
        }
    },

    getDateStr: function(d) { return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; },
    
    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day, cell.dataset.type);
            });

            cell.addEventListener('click', (e) => {
                e.preventDefault();
                const uid = cell.dataset.uid;
                const day = cell.dataset.day;
                const type = cell.dataset.type;

                if (type === 'history') {
                    const currentVal = this.historyCorrections[uid]?.[`last_${day}`];
                    const newVal = (currentVal === 'OFF') ? null : 'OFF';
                    this.setHistoryShift(uid, day, newVal);
                } else {
                    const key = `current_${day}`;
                    const currentVal = this.localAssignments[uid]?.[key];
                    const newVal = (currentVal === 'REQ_OFF') ? null : 'REQ_OFF';
                    this.setShift(uid, key, newVal);
                }
            });
        });

        document.addEventListener('click', () => {
            const menu = document.getElementById('customContextMenu');
            if (menu) menu.style.display = 'none';
        }, { once: false });
    },

    handleRightClick: function(e, uid, day, type) {
        const menu = document.getElementById('customContextMenu');
        const options = document.getElementById('contextMenuOptions');
        
        const isHistory = (type === 'history');
        const funcName = isHistory ? 'matrixManager.setHistoryShift' : 'matrixManager.setShift';
        const dateDisplay = isHistory ? `(上月) ${day}日` : `${this.data.month}月${day}日`;
        const targetKey = isHistory ? day : `current_${day}`; 

        let html = `
            <div class="menu-header" style="padding:8px 12px; font-weight:bold; background:#f0f0f0; border-bottom:1px solid #ddd;">
                ${dateDisplay}
            </div>
            <ul style="list-style:none; padding:0; margin:0;">
                <li onclick="${funcName}('${uid}','${targetKey}','${isHistory ? 'OFF' : 'REQ_OFF'}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #eee;">
                    <i class="fas fa-bed" style="width:20px; color:#27ae60;"></i> ${isHistory ? 'FF (休)' : '排休 (FF)'}
                </li>
        `;
        
        html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">指定班別</li>`;
        this.shifts.forEach(s => {
            const shiftColor = s.color || '#333';
            html += `
                <li onclick="${funcName}('${uid}','${targetKey}','${s.code}')" style="padding:8px 12px; cursor:pointer;">
                    <span style="font-weight:bold; color:${shiftColor};">${s.code}</span> - ${s.name}
                </li>`;
        });

        if (!isHistory) {
            html += `<li style="padding:5px 12px; font-size:0.8rem; color:#999; background:#fafafa;">希望避開</li>`;
            this.shifts.forEach(s => {
                html += `
                    <li onclick="${funcName}('${uid}','${targetKey}','!${s.code}')" style="padding:8px 12px; cursor:pointer; color:#c0392b;">
                        <i class="fas fa-ban" style="width:20px;"></i> 勿排 ${s.code}
                    </li>`;
            });
        }

        html += `
            <li style="border-top:1px solid #eee;"></li>
            <li onclick="${funcName}('${uid}','${targetKey}',null)" style="padding:8px 12px; cursor:pointer; color:#7f8c8d;">
                <i class="fas fa-eraser" style="width:20px;"></i> 清除設定
            </li>
        </ul>`;
        
        options.innerHTML = html;
        
        menu.style.display = 'block';
        menu.style.visibility = 'hidden';
        menu.offsetHeight;
        
        const menuWidth = menu.offsetWidth || 200;
        const menuHeight = menu.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let left = e.clientX + 5;
        let top = e.clientY + 5;
        
        if (left + menuWidth > viewportWidth) {
            left = viewportWidth - menuWidth - 5;
        }
        
        if (top + menuHeight > viewportHeight) {
            top = viewportHeight - menuHeight - 5;
        }

        menu.style.position = 'fixed';
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';
    },

    setShift: function(uid, key, val) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if(val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        db.collection('pre_schedules').doc(this.docId).update({
            [`assignments.${uid}.${key}`]: val === null ? firebase.firestore.FieldValue.delete() : val
        });
        this.renderMatrix();
        this.updateStats();
    },

    setHistoryShift: function(uid, day, val) {
        const key = `last_${day}`;
        if (!this.historyCorrections[uid]) this.historyCorrections[uid] = {};
        if (val === null) delete this.historyCorrections[uid][key];
        else this.historyCorrections[uid][key] = val;

        db.collection('pre_schedules').doc(this.docId).update({
            [`historyCorrections.${uid}.${key}`]: val === null ? firebase.firestore.FieldValue.delete() : val
        });
        this.renderMatrix();
    },

    // 🆕 工具函式：解析時間為小時數
    parseTime: function(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m || 0) / 60;
    },

    // 🆕 工具函式：判斷兩個班別是否為同系列（4小時內）
    isSameShiftFamily: function(shift1, shift2) {
        if (!shift1 || !shift2) return false;
        
        const t1 = this.parseTime(shift1.startTime);
        const t2 = this.parseTime(shift2.startTime);
        
        // 計算時差（考慮跨日）
        let diff = Math.abs(t1 - t2);
        if (diff > 12) diff = 24 - diff; // 跨日修正 (22:00 vs 00:00 = 2h)
        
        return diff <= 4; // 4小時內視為同系列
    },

    // 🆕 工具函式：根據包班過濾可選班別
    filterShiftsByBundle: function(bundleShiftCode, allowThreeShifts) {
        // 若允許3種志願，或無包班，不過濾
        if (allowThreeShifts || !bundleShiftCode) {
            return this.shifts.filter(s => s.code !== 'OFF');
        }
        
        const bundleData = this.shifts.find(s => s.code === bundleShiftCode);
        if (!bundleData) return this.shifts.filter(s => s.code !== 'OFF');
        
        return this.shifts.filter(s => {
            if (s.code === 'OFF') return false;
            if (s.code === bundleShiftCode) return true; // 包班本身可選
            
            // 檢查是否為同系列班別（4小時內）
            return this.isSameShiftFamily(bundleData, s);
        });
    },

    openPrefModal: function(uid, name) { 
        document.getElementById('prefTargetUid').value = uid;
        document.getElementById('prefTargetName').innerText = `人員：${name}`;
        
        const assign = this.localAssignments[uid] || {};
        const prefs = assign.preferences || {};
        
        const bundleSelect = document.getElementById('editBundleShift');
        let bundleHtml = '<option value="">無 (不包班)</option>';
        this.shifts.forEach(s => {
            if (s.isBundleAvailable) {
                bundleHtml += `<option value="${s.code}" ${prefs.bundleShift === s.code ? 'selected' : ''}>${s.code} (${s.name})</option>`;
            }
        });
        bundleSelect.innerHTML = bundleHtml;

        const renderPrefs = () => {
            const currentBundle = bundleSelect.value;
            const allowThreeShifts = this.data.settings?.allowThreeShifts === true;

            // 🔥 修正：先從 DOM 讀取當前選擇的值（如果存在）
            const currentPref1El = document.getElementById('editFavShift');
            const currentPref2El = document.getElementById('editFavShift2');
            const currentPref3El = document.getElementById('editFavShift3');

            // 優先使用 DOM 中的值（使用者剛選的），其次才用記憶體中的值
            const pref1 = currentPref1El?.value || prefs.favShift || '';
            const pref2 = currentPref2El?.value || prefs.favShift2 || '';
            const pref3 = currentPref3El?.value || prefs.favShift3 || '';
            
            // 🔥 根據包班過濾可選班別
            let availableShifts = this.filterShiftsByBundle(currentBundle, allowThreeShifts);
            
            const prefContainer = document.getElementById('editPrefContainer');
            let prefHtml = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第一志願</span>
                    <select id="editFavShift" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${availableShifts.map(s => `<option value="${s.code}" ${pref1 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第二志願</span>
                    <select id="editFavShift2" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${availableShifts.filter(s => s.code !== pref1).map(s => `<option value="${s.code}" ${pref2 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
            
            if (allowThreeShifts) {
                prefHtml += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第三志願</span>
                    <select id="editFavShift3" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${availableShifts.filter(s => s.code !== pref1 && s.code !== pref2).map(s => `<option value="${s.code}" ${pref3 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                `;
            }
            
            prefContainer.innerHTML = prefHtml;
            
            // 🔥 監聽志願變更，動態更新下一個志願的選項
            const pref1Select = document.getElementById('editFavShift');
            const pref2Select = document.getElementById('editFavShift2');
            
            if (pref1Select) {
                pref1Select.onchange = () => renderPrefs();
            }
            
            if (pref2Select) {
                pref2Select.onchange = () => renderPrefs();
            }
        };

        bundleSelect.onchange = renderPrefs;
        renderPrefs();

        document.getElementById('prefModal').classList.add('show');
    },
    
    closePrefModal: function() { document.getElementById('prefModal').classList.remove('show'); },
    
    savePreferences: async function() { 
        const uid = document.getElementById('prefTargetUid').value;
        if (!uid) return;

        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if (!this.localAssignments[uid].preferences) this.localAssignments[uid].preferences = {};

        const prefs = this.localAssignments[uid].preferences;
        
        // 🔥 收集偏好設定
        const bundleShift = document.getElementById('editBundleShift').value;
        const pref1 = document.getElementById('editFavShift').value;
        const pref2 = document.getElementById('editFavShift2').value;
        const pref3El = document.getElementById('editFavShift3');
        const pref3 = pref3El ? pref3El.value : '';
        
        // 🔥 驗證 1：志願不可重複
        const prefsList = [pref1, pref2, pref3].filter(p => p !== '');
        const uniquePrefs = new Set(prefsList);
        
        if (prefsList.length !== uniquePrefs.size) {
            alert('⚠️ 各志願不可重複，請重新選擇');
            return;
        }
        
        // 🔥 驗證 2：包班衝突檢查（僅在 allowThreeShifts = false 時）
        const allowThreeShifts = this.data.settings?.allowThreeShifts === true;
        
        if (!allowThreeShifts && bundleShift) {
            const bundleData = this.shifts.find(s => s.code === bundleShift);
            
            if (bundleData) {
                const invalidPrefs = prefsList.filter(p => {
                    if (p === bundleShift) return false; // 包班本身可選
                    const prefData = this.shifts.find(s => s.code === p);
                    return !this.isSameShiftFamily(bundleData, prefData);
                });
                
                if (invalidPrefs.length > 0) {
                    alert(`⚠️ 包班 ${bundleShift} 時，志願僅能選擇同系列班別（開始時間前後4小時內）\n不符班別：${invalidPrefs.join(', ')}`);
                    return;
                }
            }
        }
        
        // 🔥 儲存偏好
        prefs.bundleShift = bundleShift;
        prefs.favShift = pref1;
        prefs.favShift2 = pref2;
        if (allowThreeShifts) {
            prefs.favShift3 = pref3;
        }

        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                [`assignments.${uid}.preferences`]: prefs
            });
            this.closePrefModal();
            this.renderMatrix();
            this.updateStats();
            alert("✅ 偏好設定已儲存");
        } catch(e) {
            console.error(e);
            alert("❌ 儲存失敗");
        }
    },
    
    saveData: async function() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                historyCorrections: this.historyCorrections,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            alert("✅ 草稿已儲存");
        } catch(e) {
            console.error("儲存失敗:", e);
            alert("❌ 儲存失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    executeSchedule: async function() {
        if(!confirm("確定執行排班? 將鎖定預班並建立正式草稿。")) return;
        this.isLoading = true; this.showLoading();
        try {
            const initialAssignments = {};
            if (this.localAssignments) {
                Object.keys(this.localAssignments).forEach(uid => {
                    initialAssignments[uid] = JSON.parse(JSON.stringify(this.localAssignments[uid]));
                });
            }

            const lastMonthData = {};
            const allUids = new Set([
                ...Object.keys(this.localAssignments), 
                ...Object.keys(this.lastMonthAssignments || {}),
                ...Object.keys(this.historyCorrections || {})
            ]);

            allUids.forEach(uid => {
                const userAssign = this.lastMonthAssignments[uid] || {};
                const lastDay = this.lastMonthDays || 31;
                
                const lastDayCorrected = this.historyCorrections[uid]?.[`last_${lastDay}`];
                const lastDayOriginal = userAssign[`current_${lastDay}`] || userAssign[lastDay] || 'OFF';

                lastMonthData[uid] = {
                    lastShift: (lastDayCorrected !== undefined) ? lastDayCorrected : lastDayOriginal
                };
                
                for (let i = 0; i < 6; i++) {
                    const d = lastDay - i;
                    const originalVal = userAssign[`current_${d}`] || userAssign[d] || 'OFF';
                    const correctedVal = this.historyCorrections[uid]?.[`last_${d}`];
                    lastMonthData[uid][`last_${d}`] = (correctedVal !== undefined) ? correctedVal : originalVal;
                }
            });

            const staffListForSchedule = (this.data.staffList || []).map(staff => {
                const uid = staff.uid || staff.id;
                const assign = this.localAssignments[uid] || {};
                const prefs = assign.preferences || {};
                
                return {
                    ...staff,
                    prefs: prefs, 
                    schedulingParams: assign
                };
            });

            const scheduleData = {
                unitId: this.data.unitId, year: this.data.year, month: this.data.month,
                sourceId: this.docId, status: 'draft',
                staffList: staffListForSchedule,
                assignments: initialAssignments,
                lastMonthData: lastMonthData,
                dailyNeeds: this.data.dailyNeeds || {},
                specificNeeds: this.data.specificNeeds || {}, 
                groupLimits: this.data.groupLimits || {},
                bundleLimits: this.data.bundleLimits || {},
                settings: this.data.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            batch.update(db.collection('pre_schedules').doc(this.docId), { status: 'closed', assignments: this.localAssignments });
            const newSchRef = db.collection('schedules').doc();
            batch.set(newSchRef, scheduleData);

            await batch.commit();
            alert("✅ 執行成功! 轉跳中...");
            window.location.hash = `/admin/schedule_editor?id=${newSchRef.id}`;
        } catch(e) { console.error(e); alert("❌ 失敗: "+e.message); this.renderMatrix(); } 
        finally { this.isLoading = false; }
        },

setupEvents: function() { },
cleanup: function() { document.getElementById('customContextMenu').style.display='none'; }
};
