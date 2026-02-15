// js/modules/pre_schedule_matrix_manager.js

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
            
            await this.checkStaffStatusChanges();
            
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
            /* 預休 (REQ_OFF) - 黃色底 */
            .cell-req-off {
                background: #fff3cd !important;
                color: #856404 !important;
                font-weight: bold;
                border: 2px solid #f39c12 !important;
            }
            /* 系統排休 (OFF) - 白底 */
            .cell-off {
                background: #fff !important;
                color: #95a5a6 !important;
            }
            /* 指定班別 - 藍色底 */
            .cell-specific-shift {
                background: #d6eaf8 !important;
                color: #1565c0 !important;
                font-weight: bold;
                border: 2px solid #3498db !important;
            }
            /* 希望避開 - 紅色底 */
            .cell-avoid-shift {
                background: #fadbd8 !important;
                color: #c0392b !important;
                font-weight: bold;
                border: 2px solid #e74c3c !important;
            }
        `;
        document.head.appendChild(styleElement);
    },

    checkStaffStatusChanges: async function() {
        if (!this.data || !this.data.staffList || this.data.staffList.length === 0) return;
        
        const changes = {
            statusChanged: []
        };
        
        const currentStaffList = this.data.staffList;
        
        currentStaffList.forEach(staff => {
            const uid = staff.uid;
            const latestUser = this.usersMap[uid];
            
            if (latestUser) {
                const oldParams = staff.schedulingParams || {};
                const newParams = latestUser.schedulingParams || {};
                
                const statusChanges = this.compareSchedulingParams(oldParams, newParams);
                if (statusChanges.length > 0) {
                    changes.statusChanged.push({
                        uid: uid,
                        name: staff.name,
                        empId: staff.empId,
                        changes: statusChanges,
                        newParams: newParams
                    });
                }
            }
        });
        
        if (changes.statusChanged.length > 0) {
            const shouldUpdate = await this.showStatusChangesModal(changes);
            
            if (shouldUpdate) {
                await this.updateStaffStatus(changes.statusChanged);
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

    showStatusChangesModal: function(changes) {
        return new Promise((resolve) => {
            const modalHtml = `
            <div id="statusChangesModal" style="display:flex; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5); align-items:center; justify-content:center;">
                <div style="background:white; padding:30px; border-radius:12px; width:600px; max-height:80vh; overflow-y:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                    <h3 style="margin:0 0 10px 0; color:#2c3e50;">
                        <i class="fas fa-user-edit" style="color:#f39c12;"></i> 人員狀態變更通知
                    </h3>
                    <p style="color:#666; margin-bottom:25px; font-size:0.95rem;">
                        偵測到現有人員的排班狀態（孕/哺/PGY/獨立性）有變更，是否要同步更新？
                    </p>
                    
                    <div style="border:2px solid #f39c12; border-radius:8px; padding:15px; margin-bottom:20px;">
                        <h4 style="margin:0 0 10px 0; color:#f39c12;">
                            <i class="fas fa-sync-alt"></i> 狀態變更 (${changes.statusChanged.length} 位)
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
                    
                    <div style="display:flex; gap:15px; justify-content:flex-end;">
                        <button id="btnCancelStatusSync" style="padding:10px 20px; border:1px solid #95a5a6; background:#fff; border-radius:4px; cursor:pointer; font-size:1rem;">
                            <i class="fas fa-times"></i> 暫不更新
                        </button>
                        <button id="btnConfirmStatusSync" style="padding:10px 20px; border:none; background:#3498db; color:white; border-radius:4px; cursor:pointer; font-size:1rem; font-weight:bold;">
                            <i class="fas fa-sync-alt"></i> 同步更新
                        </button>
                    </div>
                </div>
            </div>`;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            document.getElementById('btnConfirmStatusSync').onclick = () => {
                document.getElementById('statusChangesModal').remove();
                resolve(true);
            };
            
            document.getElementById('btnCancelStatusSync').onclick = () => {
                document.getElementById('statusChangesModal').remove();
                resolve(false);
            };
        });
    },

    updateStaffStatus: async function(statusChanges) {
        try {
            const updatedStaffList = [...this.data.staffList];
            
            statusChanges.forEach(change => {
                const staffIdx = updatedStaffList.findIndex(s => s.uid === change.uid);
                if (staffIdx !== -1) {
                    updatedStaffList[staffIdx].schedulingParams = change.newParams;
                }
            });
            
            await db.collection('pre_schedules').doc(this.docId).update({
                staffList: updatedStaffList,
                lastStatusSyncAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.data.staffList = updatedStaffList;
            console.log('✅ 人員狀態已同步更新');
            
        } catch (error) {
            console.error('❌ 更新人員狀態失敗:', error);
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
            const shifts = await DataLoader.loadShifts(uid);
            this.shifts = shifts.filter(s => s.isPreScheduleAvailable);
        }
    },
    
    loadUsers: async function() { 
        const unitId = this.data?.unitId;
        const usersMap = await DataLoader.loadUsersMap(unitId);
        this.usersMap = usersMap;
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

    /**
     * 🔥 修改：支援人力的上月班表查詢（用員工編號全域查詢）
     */
    loadLastMonthSchedule: async function() {
        const { unitId, year, month, staffList } = this.data;
        let lastYear = year;
        let lastMonth = month - 1;
        
        if (lastMonth === 0) {
            lastMonth = 12;
            lastYear--;
        }

        this.lastMonthAssignments = {};
        this.lastMonthDays = new Date(lastYear, lastMonth, 0).getDate();
        
        // ❶ 先從本單位載入
        const unitSnap = await db.collection('schedules')
            .where('unitId', '==', unitId)
            .where('year', '==', lastYear)
            .where('month', '==', lastMonth)
            .where('status', '==', 'published')
            .limit(1)
            .get();

        if (!unitSnap.empty) {
            const lastData = unitSnap.docs[0].data();
            this.lastMonthAssignments = lastData.assignments || {};
            console.log(`✅ 已載入本單位上個月 (${lastYear}-${lastMonth}) 已發布班表`);
        }
        
        // ❷ 針對支援人力，用員工編號全域查詢
        const supportStaff = (staffList || []).filter(s => s.isSupport);
        
        if (supportStaff.length > 0) {
            console.log(`🔍 偵測到 ${supportStaff.length} 位支援人力，用員工編號查詢上月班表...`);
            
            for (let staff of supportStaff) {
                const uid = staff.uid;
                const empId = staff.empId;
                
                // 如果本單位已經有這個人的班表，跳過
                if (this.lastMonthAssignments[uid]) continue;
                
                // 用員工編號全域查詢
                const allSchedulesSnap = await db.collection('schedules')
                    .where('year', '==', lastYear)
                    .where('month', '==', lastMonth)
                    .where('status', '==', 'published')
                    .get();
                
                let found = false;
                for (let doc of allSchedulesSnap.docs) {
                    const scheduleData = doc.data();
                    const staffInSchedule = (scheduleData.staffList || []).find(s => s.empId === empId);
                    
                    if (staffInSchedule && scheduleData.assignments && scheduleData.assignments[uid]) {
                        this.lastMonthAssignments[uid] = scheduleData.assignments[uid];
                        console.log(`  ✅ ${staff.name} (${empId}) 找到上月班表於單位: ${scheduleData.unitId}`);
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    console.warn(`  ⚠️ ${staff.name} (${empId}) 找不到上月班表`);
                }
            }
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
        h1 += `<th colspan="5" style="background:#e8f4fd; font-size:0.8rem; border:1px solid #bbb;">統計</th></tr>`;

        let h2 = `<tr>`;
        const weeks = ['日','一','二','三','四','五','六'];
        
        const lastMonthDays = this.lastMonthDays || 31;
        for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
            h2 += `<th class="cell-narrow" style="background:#eee; font-size:0.7rem; border:1px solid #bbb;">${d}</th>`;
        }
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="${color}; font-size:0.7rem; border:1px solid #bbb;">${weeks[w]}</th>`;
        }
        h2 += `<th class="cell-narrow" style="font-size:0.7rem; border:1px solid #bbb;">休</th><th class="cell-narrow" style="font-size:0.7rem; border:1px solid #bbb;">假</th><th class="cell-narrow" style="font-size:0.7rem; border:1px solid #bbb;">指定</th><th class="cell-narrow" style="font-size:0.7rem; border:1px solid #bbb;">其他</th><th class="cell-narrow" style="font-size:0.7rem; border:1px solid #bbb;">總</th></tr>`;
        
        thead.innerHTML = h1 + h2;

        const staffList = this.data.staffList || [];
        staffList.forEach(staff => {
            const uid = staff.uid;
            const tr = document.createElement('tr');
            
            let rowHtml = `
                <td style="position:sticky; left:0; z-index:100; background:#fff; border:1px solid #bbb;">${staff.empId}</td>
                <td style="position:sticky; left:60px; z-index:100; background:#fff; border:1px solid #bbb; font-weight:bold;">${staff.name}</td>
                <td style="position:sticky; left:140px; z-index:100; background:#fff; border:1px solid #bbb; text-align:center;">${this.getStaffStatusBadges(uid)}</td>
                <td style="text-align:center; border:1px solid #bbb;">
                    <button class="btn btn-sm" onclick="matrixManager.openPrefModal('${uid}', '${staff.name}')" style="padding:2px 5px; font-size:0.75rem; background:#f39c12; color:white; border:none; border-radius:3px;">
                        <i class="fas fa-heart"></i>
                    </button>
                </td>
            `;

            for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
                const key = `last_${d}`;
                const val = this.historyCorrections[uid]?.[key] || this.lastMonthAssignments[uid]?.[`current_${d}`] || this.lastMonthAssignments[uid]?.[d] || 'OFF';
                rowHtml += `<td class="cell-history" oncontextmenu="matrixManager.showHistoryMenu(event, '${uid}', ${d}); return false;" style="background:#f9f9f9; color:#777; border:1px solid #bbb; cursor:pointer;">${val}</td>`;
            }

            const assign = this.localAssignments[uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                let cellClass = '';
                let displayVal = '';
                
                // 🆕 處理預休 (REQ_OFF) - 改為顯示 FF
                if (val === 'REQ_OFF') {
                    cellClass = 'cell-req-off';
                    displayVal = 'FF';
                } 
                // 🆕 處理系統排休 (OFF)
                else if (val === 'OFF') {
                    cellClass = 'cell-off';
                    displayVal = 'FF';
                }
                // 🆕 處理希望避開 (!)
                else if (val && val.startsWith('!')) {
                    cellClass = 'cell-avoid-shift';
                    const shiftCode = val.substring(1);
                    displayVal = `勿${shiftCode}`;
                }
                // 🆕 處理指定班別
                else if (val && val !== '') {
                    cellClass = 'cell-specific-shift';
                    displayVal = val;
                }
                // 空白格子
                else {
                    cellClass = '';
                    displayVal = '';
                }
                
                // 🆕 左鍵直接設 REQ_OFF，右鍵打開功能表
                rowHtml += `<td class="${cellClass}" onclick="matrixManager.toggleReqOff('${uid}', '${key}')" oncontextmenu="matrixManager.showShiftMenu(event, '${uid}', '${key}'); return false;" style="border:1px solid #bbb; cursor:pointer;">${displayVal}</td>`;
            }

            rowHtml += `
                <td id="stat-off-${uid}" style="font-weight:bold; color:#27ae60; border:1px solid #bbb;">0</td>
                <td id="stat-holiday-${uid}" style="color:#e67e22; border:1px solid #bbb;">0</td>
                <td id="stat-specific-${uid}" style="color:#3498db; border:1px solid #bbb;">0</td>
                <td id="stat-other-${uid}" style="color:#95a5a6; border:1px solid #bbb;">0</td>
                <td id="stat-total-${uid}" style="font-weight:bold; border:1px solid #bbb;">0</td>
            `;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    updateStats: function() {
        const staffList = this.data.staffList || [];
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();

        staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.localAssignments[uid] || {};
            let offCount = 0;
            let holidayCount = 0;
            let specificCount = 0;
            let otherCount = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                
                // 🆕 預休 (REQ_OFF) 和系統排休 (OFF)
                if (val === 'OFF' || val === 'REQ_OFF') {
                    offCount++;
                }
                // 🆕 希望避開 (!)
                else if (val && val.startsWith('!')) {
                    specificCount++;
                }
                // 🆕 指定班別
                else if (val && val !== '') {
                    const shift = this.shifts.find(s => s.code === val);
                    if (shift) {
                        if (shift.type === 'holiday') {
                            holidayCount++;
                        } else {
                            // 這是同仁指定的班別
                            specificCount++;
                        }
                    } else {
                        // 找不到對應班別，計入其他
                        otherCount++;
                    }
                }
            }

            const elOff = document.getElementById(`stat-off-${uid}`);
            const elHoliday = document.getElementById(`stat-holiday-${uid}`);
            const elSpecific = document.getElementById(`stat-specific-${uid}`);
            const elOther = document.getElementById(`stat-other-${uid}`);
            const elTotal = document.getElementById(`stat-total-${uid}`);

            if(elOff) elOff.textContent = offCount;
            if(elHoliday) elHoliday.textContent = holidayCount;
            if(elSpecific) elSpecific.textContent = specificCount;
            if(elOther) elOther.textContent = otherCount;
            if(elTotal) elTotal.textContent = offCount + holidayCount + specificCount + otherCount;
        });
    },

    /**
     * 🆕 左鍵點擊：切換預休狀態
     */
    toggleReqOff: function(uid, key) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        
        const currentVal = this.localAssignments[uid][key];
        
        // 如果當前是預休，則清除；否則設為預休
        if (currentVal === 'REQ_OFF') {
            delete this.localAssignments[uid][key];
        } else {
            this.localAssignments[uid][key] = 'REQ_OFF';
        }
        
        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        this.updateCellOnly(uid, key);
        this.updateStats();
    },

    /**
     * 🆕 只更新單一格子，避免重複渲染整個表格
     */
    updateCellOnly: function(uid, key) {
        const val = this.localAssignments[uid]?.[key] || '';
        let cellClass = '';
        let displayVal = '';
        
        // 🆕 預休改為顯示 FF
        if (val === 'REQ_OFF') {
            cellClass = 'cell-req-off';
            displayVal = 'FF';
        } else if (val === 'OFF') {
            cellClass = 'cell-off';
            displayVal = 'FF';
        } else if (val && val.startsWith('!')) {
            cellClass = 'cell-avoid-shift';
            const shiftCode = val.substring(1);
            displayVal = `勿${shiftCode}`;
        } else if (val && val !== '') {
            cellClass = 'cell-specific-shift';
            displayVal = val;
        }
        
        // 找到對應的 td 元素並更新
        const staffList = this.data.staffList || [];
        const staffIndex = staffList.findIndex(s => s.uid === uid);
        if (staffIndex === -1) return;
        
        const tbody = document.getElementById('matrixBody');
        const row = tbody.children[staffIndex];
        if (!row) return;
        
        // 計算格子位置：4 個固定欄位 + 6 個上月欄位 + 當前日期
        const dayMatch = key.match(/current_(\d+)/);
        if (!dayMatch) return;
        const day = parseInt(dayMatch[1]);
        const cellIndex = 4 + 6 + (day - 1);
        
        const cell = row.children[cellIndex];
        if (cell) {
            cell.className = cellClass;
            cell.textContent = displayVal;
        }
    },

    /**
     * 🆕 右鍵點擊：顯示功能表
     */
    showShiftMenu: function(event, uid, key) {
        event.preventDefault();
        const cell = event.target;
        const menu = document.getElementById('customContextMenu');
        
        let html = `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', null); matrixManager.hideMenu();">清除</div>`;
        html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'REQ_OFF'); matrixManager.hideMenu();" style="color:#f39c12; font-weight:bold;"><i class="fas fa-user-clock"></i> 預排休假 (REQ_OFF)</div>`;
        html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF'); matrixManager.hideMenu();" style="color:#27ae60; font-weight:bold;"><i class="fas fa-bed"></i> 系統排休 (OFF)</div>`;
        
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '${s.code}'); matrixManager.hideMenu();">${s.code} - ${s.name}</div>`;
        });
        
        menu.innerHTML = html;
        this.positionMenu(cell, menu);
    },

    showHistoryMenu: function(event, uid, day) {
        event.preventDefault();
        const cell = event.target;
        const menu = document.getElementById('customContextMenu');
        
        let html = `<div style="padding:5px 10px; background:#eee; font-size:0.7rem; color:#666;">修正上月紀錄</div>`;
        html += `<div class="menu-item" onclick="matrixManager.setHistoryShift('${uid}', ${day}, 'OFF'); matrixManager.hideMenu();">OFF</div>`;
        this.shifts.forEach(s => {
            if (s.code !== 'OFF') {
                html += `<div class="menu-item" onclick="matrixManager.setHistoryShift('${uid}', ${day}, '${s.code}'); matrixManager.hideMenu();">${s.code}</div>`;
            }
        });
        
        menu.innerHTML = html;
        this.positionMenu(cell, menu);
    },

    positionMenu: function(cell, menu) {
        const rect = cell.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom;
        
        menu.style.display = 'block';
        if (left + 150 > window.innerWidth) left = window.innerWidth - 160;
        if (top + 300 > window.innerHeight) top = rect.top - menu.offsetHeight;
        
        menu.style.position = 'fixed';
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';
    },

    /**
     * 🆕 隱藏功能表
     */
    hideMenu: function() {
        const menu = document.getElementById('customContextMenu');
        if (menu) {
            menu.style.display = 'none';
            menu.style.visibility = 'hidden';
        }
    },

    setShift: function(uid, key, val) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if(val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        // 🆕 只更新單一格子，不重新渲染整個表格
        this.updateCellOnly(uid, key);
        this.updateStats();
    },

    setHistoryShift: function(uid, day, val) {
        const key = `last_${day}`;
        if (!this.historyCorrections[uid]) this.historyCorrections[uid] = {};
        if (val === null) delete this.historyCorrections[uid][key];
        else this.historyCorrections[uid][key] = val;

        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        
        // 🆕 歷史記錄需要重新渲染，因為格子位置不同
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

calculateAvgOff: function() {
    const staffCount = this.staffList.length;
    if (staffCount === 0) return 0;
    
    const daysInMonth = this.daysInMonth;
    let totalAvailableOff = 0;
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${this.year}-${String(this.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(this.year, this.month - 1, day);
        const jsDay = dateObj.getDay();
        const dayOfWeek = (jsDay === 0) ? 6 : jsDay - 1;
        
        let dailyNeedCount = 0;
        
        if (this.specificNeeds[dateStr]) {
            Object.values(this.specificNeeds[dateStr]).forEach(count => {
                dailyNeedCount += (parseInt(count) || 0);
            });
        } else {
            this.activeShifts.forEach(s => {
                const key = `${s.code}_${dayOfWeek}`;
                dailyNeedCount += (this.dailyNeeds[key] || 0);
            });
        }
        
        totalAvailableOff += Math.max(0, staffCount - dailyNeedCount);
    }
    
    return totalAvailableOff / staffCount;
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

    /**
     * 🔥 修改：優化 lastMonthData 組裝邏輯
     */
executeSchedule: async function() {
    if(!confirm("確定執行排班? 將鎖定預班並建立正式草稿。")) return;
    this.isLoading = true; 
    this.showLoading();
    
    try {
        // 🔥 計算平均 OFF
        const avgOff = this.calculateAvgOff();
        console.log(`   📊 計算平均休假天數: ${avgOff.toFixed(1)} 天`);
        
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
            const finalLastShift = (lastDayCorrected !== undefined) ? lastDayCorrected : lastDayOriginal;

            lastMonthData[uid] = {
                lastShift: finalLastShift
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
        console.log('📅 lastMonthData:', lastMonthData);
        console.log(`📊 avgOff: ${avgOff.toFixed(1)} 天`);

        // 🔥 加入 avgOff 到 scheduleData
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
            schedulingParams: {
                avgOff: avgOff
            },
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
        // 🆕 全域點擊關閉功能表
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && !menu.contains(e.target)) {
                this.hideMenu();
            }
        });
        
        window.addEventListener('beforeunload', (e) => {
            if (this.pendingSave) {
                e.preventDefault();
                e.returnValue = '您有未儲存的變更，確定要離開嗎？';
            }
        });
    },

    cleanup: function() { 
        this.hideMenu();
        window.removeEventListener('beforeunload', null);
    }
};
