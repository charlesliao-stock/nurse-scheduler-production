// js/modules/pre_schedule_matrix_manager.js
// 🎯 視覺強化 + 記憶體優化完整版

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
    
    // ✅ 未儲存變更追蹤
    pendingSave: false,

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
            
            // ✅ 一次性載入所有資料
            const preDoc = await db.collection('pre_schedules').doc(id).get();
            if (!preDoc.exists) {
                alert("找不到此預班表");
                return;
            }
            
            const preData = preDoc.data();
            
            // 權限檢查
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
            
            await this.checkStaffAndStatusChanges();
            
            this.restoreTableStructure(); 
            this.updateTitle();
            this.renderMatrix(); 
            this.updateStats(); 
            this.setupEvents();
            this.addCellStyles();
            
            console.log('✅ 預班表載入完成，視覺樣式已套用');
            
        } catch(e) { 
            console.error("❌ 載入失敗:", e); 
            alert("載入失敗: " + e.message); 
        } 
        finally { 
            this.isLoading = false; 
        }
    },

    addCellStyles: function() {
        if (document.getElementById('schedule-cell-styles')) return;
        
        const styleElement = document.createElement('style');
        styleElement.id = 'schedule-cell-styles';
        styleElement.textContent = `
            .cell-req-off {
                background: #fff3cd !important;
                color: #856404 !important;
                font-weight: bold;
            }
            .cell-off {
                background: #fff !important;
            }
        `;
        document.head.appendChild(styleElement);
    },

    checkStaffAndStatusChanges: async function() {
        if (!this.data || !this.data.unitId) return;
        
        const oldStaffMap = {};
        (this.data.staffList || []).forEach(staff => {
            oldStaffMap[staff.uid] = staff;
        });

        const snapshot = await db.collection('users')
            .where('isActive', '==', true)
            .get();
        
        const currentUsers = {};
        snapshot.forEach(doc => {
            const user = doc.data();
            const isFormalMember = user.unitId === this.data.unitId;
            const isSupportMember = Array.isArray(user.supportUnits) && user.supportUnits.includes(this.data.unitId);
            
            if (isFormalMember || isSupportMember) {
                currentUsers[doc.id] = {
                    uid: doc.id,
                    empId: user.employeeId,
                    name: user.displayName,
                    level: user.level,
                    groupId: user.groupId,
                    schedulingParams: user.schedulingParams || {},
                    isSupport: isSupportMember && !isFormalMember
                };
            }
        });
        
        (this.data.staffList || []).forEach(staff => {
            if (!currentUsers[staff.uid]) {
                const userDoc = snapshot.docs.find(d => d.id === staff.uid);
                if (userDoc) {
                    const user = userDoc.data();
                    currentUsers[staff.uid] = {
                        uid: staff.uid,
                        empId: user.employeeId || staff.empId,
                        name: user.displayName || staff.name,
                        level: user.level || staff.level,
                        groupId: user.groupId || staff.groupId,
                        schedulingParams: user.schedulingParams || staff.schedulingParams || {},
                        isSupport: staff.isSupport || false
                    };
                }
            }
        });
        
        const changes = {
            added: [],
            removed: [],
            statusChanged: []
        };
        
        Object.keys(currentUsers).forEach(uid => {
            if (!oldStaffMap[uid]) {
                changes.added.push({
                    uid: uid,
                    name: currentUsers[uid].name,
                    empId: currentUsers[uid].empId,
                    isSupport: currentUsers[uid].isSupport
                });
            }
        });
        
        Object.keys(oldStaffMap).forEach(uid => {
            if (!currentUsers[uid]) {
                changes.removed.push({
                    uid: uid,
                    name: oldStaffMap[uid].name,
                    empId: oldStaffMap[uid].empId || this.usersMap[uid]?.employeeId
                });
            }
        });
        
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
        
        if (changes.added.length > 0 || changes.removed.length > 0 || changes.statusChanged.length > 0) {
            const shouldUpdate = await this.showStaffChangesModal(changes);
            
            if (shouldUpdate) {
                await this.updateStaffList(currentUsers);
            }
        }
    },

    compareSchedulingParams: function(oldParams, newParams) {
        const changes = [];
        const today = new Date();
        
        const oldPregnant = oldParams.isPregnant && oldParams.pregnantExpiry && new Date(oldParams.pregnantExpiry) >= today;
        const newPregnant = newParams.isPregnant && newParams.pregnantExpiry && new Date(newParams.pregnantExpiry) >= today;
        
        if (oldPregnant !== newPregnant) {
            changes.push(newPregnant ? '新增「孕」狀態' : '移除「孕」狀態');
        }
        
        const oldBreastfeeding = oldParams.isBreastfeeding && oldParams.breastfeedingExpiry && new Date(oldParams.breastfeedingExpiry) >= today;
        const newBreastfeeding = newParams.isBreastfeeding && newParams.breastfeedingExpiry && new Date(newParams.breastfeedingExpiry) >= today;
        
        if (oldBreastfeeding !== newBreastfeeding) {
            changes.push(newBreastfeeding ? '新增「哺」狀態' : '移除「哺」狀態');
        }
        
        const oldPGY = oldParams.isPGY && oldParams.pgyExpiry && new Date(oldParams.pgyExpiry) >= today;
        const newPGY = newParams.isPGY && newParams.pgyExpiry && new Date(newParams.pgyExpiry) >= today;
        
        if (oldPGY !== newPGY) {
            changes.push(newPGY ? '新增「PGY」狀態' : '移除「PGY」狀態');
        }
        
        const oldDependent = oldParams.independence === 'dependent';
        const newDependent = newParams.independence === 'dependent';
        
        if (oldDependent !== newDependent) {
            changes.push(newDependent ? '變更為「未獨立」' : '變更為「獨立」');
        }
        
        return changes;
    },

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
                            ${changes.added.map(p => `<li><strong>${p.empId}</strong> - ${p.name} ${p.isSupport ? '<span style="color:#27ae60; font-size:0.8rem;">(支援)</span>' : ''}</li>`).join('')}
                        </ul>
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
                    </div>
                    ` : ''}
                    
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

    updateStaffList: async function(currentUsers) {
        try {
            const newStaffList = [];
            Object.keys(currentUsers).forEach(uid => {
                const user = currentUsers[uid];
                const existingStaff = (this.data.staffList || []).find(s => s.uid === uid);
                
                newStaffList.push({
                    uid: uid,
                    empId: user.empId,
                    name: user.name,
                    level: user.level || 'N',
                    group: existingStaff ? (existingStaff.group || '') : (user.groupId || ''),
                    schedulingParams: user.schedulingParams,
                    isSupport: user.isSupport || false
                });
            });
            
            await db.collection('pre_schedules').doc(this.docId).update({
                staffList: newStaffList,
                lastSyncAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.data.staffList = newStaffList;
            console.log('✅ 人員清單已同步更新');
            
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
        
        this.localAssignments = JSON.parse(JSON.stringify(this.data.assignments || {}));
        this.historyCorrections = JSON.parse(JSON.stringify(this.data.historyCorrections || {}));
        
        console.log("✅ 載入 localAssignments:", Object.keys(this.localAssignments).length, "位人員");
        
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
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa; border:1px solid #bbb;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa; border:1px solid #bbb;">姓名</th>
            <th rowspan="2" style="width:50px; position:sticky; left:140px; z-index:110; background:#f8f9fa; border:1px solid #bbb;">狀態</th>
            <th rowspan="2" style="width:50px; border:1px solid #bbb;">偏好</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem; border:1px solid #bbb;">上月月底 (可修)</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}; border:1px solid #bbb;">${d}</th>`;
        }
        h1 += `<th colspan="4" style="background:#e8f4fd; font-size:0.8rem; border:1px solid #bbb;">統計</th></tr>`;

        let h2 = `<tr>`;
        const weeks = ['日','一','二','三','四','五','六'];
        
        const lastMonthDays = this.lastMonthDays || 31;
        for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
            h2 += `<th class="cell-narrow" style="background:#f5f5f5; font-size:0.7rem; color:#666; border:1px solid #bbb;">${d}</th>`;
        }

        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}; border:1px solid #bbb;">${w}</th>`;
        }
        h2 += `<th style="width:40px; background:#f0f7ff; font-size:0.75rem; border:1px solid #bbb;">總OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem; border:1px solid #bbb;">假OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem; border:1px solid #bbb;">小夜</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem; border:1px solid #bbb;">大夜</th></tr>`;
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
                <td style="position:sticky; left:0; background:#fff; z-index:10; border:1px solid #bbb;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10; border:1px solid #bbb;">
                    ${staff.name}
                    ${staff.isSupport ? '<br><span style="color:#27ae60; font-size:0.7rem; font-weight:bold;">(支援)</span>' : ''}
                </td>
                <td style="position:sticky; left:140px; background:#fff; z-index:10; text-align:center; line-height:1.2; border:1px solid #bbb;">
                    ${statusBadges || '<span style="color:#ccc;">-</span>'}
                </td>
                <td style="cursor:pointer; text-align:center; line-height:1.3; padding:4px 2px; border:1px solid #bbb;" onclick="matrixManager.openPrefModal('${uid}','${staff.name}')">
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
                                 style="${bgStyle} font-size:0.85rem; text-align:center; cursor:pointer; border:1px solid #bbb;">
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
                
                const cellClass = (val === 'REQ_OFF') ? 'cell-clickable cell-req-off' : 'cell-clickable';
                
                bodyHtml += `<td class="${cellClass}" data-uid="${uid}" data-day="${d}" data-type="current" style="border:1px solid #bbb;">
                                ${this.renderCellContent(val)}
                             </td>`;
                
                if (val === 'REQ_OFF') {
                    totalOff++;
                    const date = new Date(year, month-1, d);
                    const w = date.getDay();
                    if (w === 0 || w === 6) holidayOff++;
                } else if (val === 'E') eveningCount++;
                else if (val === 'N') nightCount++;
            }

            bodyHtml += `<td style="background:#f9f9f9; font-weight:bold; text-align:center; border:1px solid #bbb;">${totalOff}</td>
                         <td style="background:#f9f9f9; color:red; text-align:center; border:1px solid #bbb;">${holidayOff}</td>
                         <td style="background:#f9f9f9; text-align:center; border:1px solid #bbb;">${eveningCount}</td>
                         <td style="background:#f9f9f9; text-align:center; border:1px solid #bbb;">${nightCount}</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        let footHtml = '';
        this.shifts.forEach((s, idx) => {
            footHtml += `<tr>`;
            if(idx === 0) footHtml += `<td colspan="10" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle; border:1px solid #bbb;">每日人力<br>監控 (點擊調整)</td>`;
            
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

                const style = isTemp ? 'background:#fff3cd; border:2px solid #f39c12;' : 'border:1px solid #bbb;';
                footHtml += `<td id="stat_cell_${s.code}_${d}" style="cursor:pointer; ${style}" 
                                onclick="matrixManager.handleNeedClick('${dateStr}', '${s.code}', ${need})">
                                <span class="stat-actual">-</span> / <span class="stat-need" style="font-weight:bold;">${need}</span>
                             </td>`;
            }
            footHtml += `<td colspan="4" style="background:#f0f0f0; border:1px solid #bbb;"></td>`;
            footHtml += `</tr>`;
        });
        tfoot.innerHTML = footHtml;
        
        setTimeout(() => this.updateStats(), 0);
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return 'FF';
        if(val === 'REQ_OFF') return 'FF';
        
        const shift = this.shifts.find(s => s.code === val);
        if (shift && shift.color) {
            return `<span style="color:${shift.color}; font-weight:bold;">${val}</span>`;
        }
        
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
        
        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        this.renderMatrix();
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

    getDateStr: function(d) { 
        return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; 
    },
    
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
        
        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        this.renderMatrix();
        this.updateStats();
    },

    setHistoryShift: function(uid, day, val) {
        const key = `last_${day}`;
        if (!this.historyCorrections[uid]) this.historyCorrections[uid] = {};
        if (val === null) delete this.historyCorrections[uid][key];
        else this.historyCorrections[uid][key] = val;

        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        this.renderMatrix();
    },

    saveData: async function() {
        if (this.isLoading) return;
        if (!this.pendingSave) {
            alert("沒有需要儲存的變更");
            return;
        }
        
        this.isLoading = true;
        
        try {
            console.log('💾 開始儲存到 Firebase...');
            
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                historyCorrections: this.historyCorrections,
                specificNeeds: this.data.specificNeeds,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.pendingSave = false;
            this.updateUnsavedIndicator(false);
            
            console.log('✅ 儲存成功');
            alert("✅ 草稿已儲存");
            
        } catch(e) {
            console.error("❌ 儲存失敗:", e);
            alert("❌ 儲存失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    updateUnsavedIndicator: function(hasUnsaved) {
        let indicator = document.getElementById('unsavedIndicator');
        
        if (hasUnsaved) {
            if (!indicator) {
                const title = document.getElementById('matrixTitle');
                if (title) {
                    indicator = document.createElement('span');
                    indicator.id = 'unsavedIndicator';
                    indicator.style.cssText = 'color:#e67e22; font-size:0.9rem; margin-left:10px;';
                    indicator.innerHTML = '<i class="fas fa-exclamation-circle"></i> 有未儲存的變更';
                    title.parentNode.insertBefore(indicator, title.nextSibling);
                }
            }
        } else {
            if (indicator) indicator.remove();
        }
    },

    showTempMessage: function(message) {
        const existing = document.getElementById('tempMessage');
        if (existing) existing.remove();
        
        const msg = document.createElement('div');
        msg.id = 'tempMessage';
        msg.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #3498db;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10001;
            font-size: 0.9rem;
        `;
        msg.textContent = message;
        document.body.appendChild(msg);
        
        setTimeout(() => msg.remove(), 3000);
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
            const bundleShiftData = currentBundle ? this.shifts.find(s => s.code === currentBundle) : null;

            const s1 = document.getElementById('editFavShift')?.value || prefs.favShift || '';
            const s2 = document.getElementById('editFavShift2')?.value || prefs.favShift2 || '';
            const s3 = document.getElementById('editFavShift3')?.value || prefs.favShift3 || '';

            const getFilteredShifts = (currentVal, otherVals) => {
                const today = new Date();
                const staff = (this.data.staffList || []).find(s => s.uid === uid) || {};
                const params = staff.schedulingParams || {};
                const isPregnant = params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today;
                const isBreastfeeding = params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today;
                const isPGY = params.isPGY && params.pgyExpiry && new Date(params.pgyExpiry) >= today;

                const isEveningOrNightBundle = currentBundle && bundleShiftData 
                    ? shiftUtils.isEveningOrNightShift(bundleShiftData)
                    : false;

                return this.shifts.filter(s => {
                    if (s.code === 'OFF') return false;
                    
                    const isNightShift = shiftUtils.isNightShift(s);
                    const isEveningOrNightShift = shiftUtils.isEveningOrNightShift(s);
                    
                    if ((isPregnant || isBreastfeeding || isPGY) && isNightShift) return false;
                    if (isEveningOrNightBundle && isEveningOrNightShift && s.code !== currentBundle) {
                        return false;
                    }
                    if (s.code !== '' && otherVals.includes(s.code) && s.code !== currentVal) return false;

                    return true;
                });
            };
            
            const prefContainer = document.getElementById('editPrefContainer');
            let prefHtml = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第一志願</span>
                    <select id="editFavShift" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s1, [s2, s3]).map(s => `<option value="${s.code}" ${s1 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第二志願</span>
                    <select id="editFavShift2" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s2, [s1, s3]).map(s => `<option value="${s.code}" ${s2 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
            
            const allowThreeShifts = this.data.settings?.allowThreeShifts === true;
            if (allowThreeShifts) {
                prefHtml += `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="width:70px; font-size:0.9rem;">第三志願</span>
                    <select id="editFavShift3" class="form-control" style="flex:1;">
                        <option value="">無特別偏好</option>
                        ${getFilteredShifts(s3, [s1, s2]).map(s => `<option value="${s.code}" ${s3 === s.code ? 'selected' : ''}>${s.code} - ${s.name}</option>`).join('')}
                    </select>
                </div>
                `;
            }
            prefContainer.innerHTML = prefHtml;

            ['editFavShift', 'editFavShift2', 'editFavShift3'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.onchange = () => {
                        prefs.favShift = document.getElementById('editFavShift')?.value || '';
                        prefs.favShift2 = document.getElementById('editFavShift2')?.value || '';
                        if (document.getElementById('editFavShift3')) {
                            prefs.favShift3 = document.getElementById('editFavShift3').value;
                        }
                        renderPrefs();
                    };
                }
            });
        };

        bundleSelect.onchange = renderPrefs;
        renderPrefs();

        document.getElementById('prefModal').classList.add('show');
    },

    closePrefModal: function() { 
        document.getElementById('prefModal').classList.remove('show'); 
    },

    savePreferences: async function() { 
        const uid = document.getElementById('prefTargetUid').value;
        if (!uid) return;

        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if (!this.localAssignments[uid].preferences) this.localAssignments[uid].preferences = {};

        const prefs = this.localAssignments[uid].preferences;
        prefs.bundleShift = document.getElementById('editBundleShift').value;
        prefs.favShift = document.getElementById('editFavShift').value;
        prefs.favShift2 = document.getElementById('editFavShift2').value;
        const favShift3Select = document.getElementById('editFavShift3');
        if (favShift3Select) prefs.favShift3 = favShift3Select.value;

        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        this.closePrefModal();
        this.renderMatrix();
        this.updateStats();
        
        this.showTempMessage('偏好設定已更新，請記得點擊「儲存草稿」');
    },

    executeSchedule: async function() {
        if(!confirm("確定執行排班? 將鎖定預班並建立正式草稿。")) return;
        this.isLoading = true; 
        this.showLoading();
        
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
                const userAssign = this.localAssignments[uid] || {};
                const userPrefs = userAssign.preferences || {};
                
                const latestUser = this.usersMap[uid] || {};
                const latestParams = latestUser.schedulingParams || staff.schedulingParams || {};
                
                return {
                    uid: uid,
                    empId: staff.empId,
                    name: staff.name,
                    level: staff.level || 'N',
                    group: staff.group || '',
                    isSupport: staff.isSupport || false,
                    schedulingParams: latestParams,
                    preferences: {
                        bundleShift: userPrefs.bundleShift || '',
                        favShift: userPrefs.favShift || '',
                        favShift2: userPrefs.favShift2 || '',
                        favShift3: userPrefs.favShift3 || ''
                    }
                };
            });

            console.log('📋 準備轉入排班編輯器的人員清單:', staffListForSchedule);

            const scheduleData = {
                unitId: this.data.unitId, 
                year: this.data.year, 
                month: this.data.month,
                sourceId: this.docId, 
                status: 'draft',
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
            batch.update(
                db.collection('pre_schedules').doc(this.docId), 
                { 
                    status: 'closed', 
                    assignments: this.localAssignments,
                    historyCorrections: this.historyCorrections,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            );
            
            const newSchRef = db.collection('schedules').doc();
            batch.set(newSchRef, scheduleData);

            await batch.commit();
            
            console.log('✅ 排班文件已建立，ID:', newSchRef.id);
            alert("執行成功! 轉跳中...");
            window.location.hash = `/admin/schedule_editor?id=${newSchRef.id}`;
            
        } catch(e) { 
            console.error('❌ 執行排班失敗:', e); 
            alert("失敗: " + e.message); 
            this.renderMatrix(); 
        } 
        finally { 
            this.isLoading = false; 
        }
    },
    
    setupEvents: function() {
        window.addEventListener('beforeunload', (e) => {
            if (this.pendingSave) {
                e.preventDefault();
                e.returnValue = '您有未儲存的變更，確定要離開嗎？';
            }
        });
    },

    cleanup: function() { 
        document.getElementById('customContextMenu').style.display='none';
        window.removeEventListener('beforeunload', null);
    }
};
