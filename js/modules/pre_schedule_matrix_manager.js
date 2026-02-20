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
        } finally {
            this.isLoading = false;
        }
    },

    addCellStyles: function() {
        if (document.getElementById('schedule-cell-styles')) return;
        const styleElement = document.createElement('style');
        styleElement.id = 'schedule-cell-styles';
        styleElement.textContent = `
            /* 預休 (REQ_OFF) - 黃色底 */
            .cell-req-off { background: #fff3cd !important; color: #856404 !important; font-weight: bold; border: 2px solid #f39c12 !important; }
            /* 系統排休 (OFF) - 白底 */
            .cell-off { background: #fff !important; color: #95a5a6 !important; }
            /* 指定班別 - 藍色底 */
            .cell-specific-shift { background: #d6eaf8 !important; color: #1565c0 !important; font-weight: bold; border: 2px solid #3498db !important; }
            /* 希望避開 - 紅色底 */
            .cell-avoid-shift { background: #fadbd8 !important; color: #c0392b !important; font-weight: bold; border: 2px solid #e74c3c !important; }
        `;
        document.head.appendChild(styleElement);
    },

    checkStaffStatusChanges: async function() {
        if (!this.data || !this.data.staffList || this.data.staffList.length === 0) return;
        const changes = { statusChanged: [] };
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
                <div id="statusChangesModal" class="modal show" style="display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); position:fixed; top:0; left:0; right:0; bottom:0; z-index:9999;">
                    <div class="modal-content" style="background:#fff; padding:20px; border-radius:8px; max-width:500px; width:90%; max-height:80vh; overflow-y:auto;">
                        <h3>人員狀態變更通知</h3>
                        <p>偵測到現有人員的排班狀態（孕/哺/PGY/獨立性）有變更，是否要同步更新？</p>
                        <hr>
                        <h4>狀態變更 (${changes.statusChanged.length} 位)</h4>
                        <ul style="list-style:none; padding:0;">
                            ${changes.statusChanged.map(p => `
                                <li style="margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:5px;">
                                    <strong>${p.empId} ${p.name}</strong>
                                    <ul style="color:#e67e22; font-size:0.9rem;">
                                        ${p.changes.map(c => `<li>${c}</li>`).join('')}
                                    </ul>
                                </li>
                            `).join('')}
                        </ul>
                        <div style="text-align:right; margin-top:20px;">
                            <button id="btnCancelStatusSync" class="btn btn-secondary">暫不更新</button>
                            <button id="btnConfirmStatusSync" class="btn btn-primary" style="margin-left:10px;">同步更新</button>
                        </div>
                    </div>
                </div>
            `;
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
        if (tbody) tbody.innerHTML = '<tr><td colspan="50" style="text-align:center; padding:20px;">載入中...</td></tr>';
    },

    updateTitle: function() {
        if (!this.data) return;
        const title = document.getElementById('matrixTitle');
        const status = document.getElementById('matrixStatus');
        if (title) title.textContent = `${this.data.year} 年 ${this.data.month} 月 預班管理`;
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
            const unitId = doc.data().unitId;
            const shifts = await DataLoader.loadShifts(unitId);
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
        if(!this.data.specificNeeds) this.data.specificNeeds = {};
        await this.loadLastMonthSchedule();
    },

    loadLastMonthSchedule: async function() {
        const { unitId, year, month, staffList } = this.data;
        let lastYear = year;
        let lastMonth = month - 1;
        if (lastMonth === 0) { lastMonth = 12; lastYear--; }

        this.lastMonthAssignments = {};
        this.lastMonthDays = new Date(lastYear, lastMonth, 0).getDate();

        const unitSnap = await db.collection('schedules')
            .where('unitId', '==', unitId)
            .where('year', '==', lastYear)
            .where('month', '==', lastMonth)
            .where('status', '==', 'published')
            .limit(1).get();

        if (!unitSnap.empty) {
            const lastData = unitSnap.docs[0].data();
            this.lastMonthAssignments = lastData.assignments || {};
        }

        const supportStaff = (staffList || []).filter(s => s.isSupport);
        if (supportStaff.length > 0) {
            for (let staff of supportStaff) {
                const uid = staff.uid;
                if (this.lastMonthAssignments[uid]) continue;
                const allSchedulesSnap = await db.collection('schedules')
                    .where('year', '==', lastYear)
                    .where('month', '==', lastMonth)
                    .where('status', '==', 'published').get();

                for (let doc of allSchedulesSnap.docs) {
                    const schData = doc.data();
                    if (schData.assignments && schData.assignments[uid]) {
                        this.lastMonthAssignments[uid] = schData.assignments[uid];
                        break;
                    }
                }
            }
        }
    },

    restoreTableStructure: function() {
        ['thead', 'tbody', 'tfoot'].forEach(tag => {
            const el = document.getElementById(`matrix${tag.charAt(0).toUpperCase() + tag.slice(1)}`);
            if (el) el.innerHTML = '';
        });
    },

    getStaffStatusBadges: function(uid) {
        const user = this.usersMap[uid];
        if (!user) return '';
        const badges = [];
        const params = user.schedulingParams || {};
        const today = new Date();
        if (params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today) badges.push(' 孕 ');
        if (params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today) badges.push(' 哺 ');
        if (params.isPGY && params.pgyExpiry && new Date(params.pgyExpiry) >= today) badges.push(' P ');
        if (params.independence === 'dependent') badges.push(' 協 ');
        return badges.join('');
    },

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const { year, month } = this.data;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weeks = ['日','一','二','三','四','五','六'];
        const lastMonthDays = this.lastMonthDays || 31;

        let h1 = `<tr><th rowspan="2">職編</th><th rowspan="2">姓名</th><th rowspan="2">狀態</th><th rowspan="2">偏好</th><th colspan="6">上月月底</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            h1 += `<th style="${w===0||w===6?'color:red':''}">${d}</th>`;
        }
        h1 += `<th colspan="5">統計</th></tr><tr>`;
        for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) h1 += `<th>${d}</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            h1 += `<th style="${w===0||w===6?'color:red':''}">${weeks[w]}</th>`;
        }
        h1 += `<th>休</th><th>假</th><th>指</th><th>其</th><th>總</th></tr>`;
        thead.innerHTML = h1;

        const staffList = this.data.staffList || [];
        staffList.forEach(staff => {
            const uid = staff.uid;
            const tr = document.createElement('tr');
            let rowHtml = `<td>${staff.empId}</td><td>${staff.name}</td><td>${this.getStaffStatusBadges(uid)}</td>
                <td><button onclick="matrixManager.openPrefModal('${uid}', '${staff.name}')" class="btn btn-sm btn-outline-info">偏好</button></td>`;
            
            for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
                const val = this.historyCorrections[uid]?.[`last_${d}`] || this.lastMonthAssignments[uid]?.[`current_${d}`] || this.lastMonthAssignments[uid]?.[d] || 'OFF';
                rowHtml += `<td class="history-cell" oncontextmenu="matrixManager.showHistoryMenu(event, '${uid}', ${d})">${val}</td>`;
            }

            const assign = this.localAssignments[uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                let cellClass = '';
                let displayVal = '';
                if (val === 'REQ_OFF' || val === 'OFF') { cellClass = val === 'REQ_OFF' ? 'cell-req-off' : 'cell-off'; displayVal = 'FF'; }
                else if (val && val.startsWith('!')) { cellClass = 'cell-avoid-shift'; displayVal = `勿${val.substring(1)}`; }
                else if (val) { cellClass = 'cell-specific-shift'; displayVal = val; }
                
                rowHtml += `<td class="${cellClass}" onclick="matrixManager.toggleReqOff('${uid}', '${key}')" oncontextmenu="matrixManager.showShiftMenu(event, '${uid}', '${key}')">${displayVal}</td>`;
            }
            rowHtml += `<td id="stat-off-${uid}">0</td><td id="stat-holiday-${uid}">0</td><td id="stat-specific-${uid}">0</td><td id="stat-other-${uid}">0</td><td id="stat-total-${uid}">0</td>`;
            tr.innerHTML = rowHtml;
            tbody.appendChild(tr);
        });
    },

    updateStats: function() {
        const staffList = this.data.staffList || [];
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.localAssignments[uid] || {};
            let off=0, holiday=0, specific=0, other=0;
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if (val === 'OFF' || val === 'REQ_OFF') off++;
                else if (val && val.startsWith('!')) specific++;
                else if (val) {
                    const s = this.shifts.find(x => x.code === val);
                    if (s) { if (s.type === 'holiday') holiday++; else specific++; }
                    else other++;
                }
            }
            document.getElementById(`stat-off-${uid}`).textContent = off;
            document.getElementById(`stat-holiday-${uid}`).textContent = holiday;
            document.getElementById(`stat-specific-${uid}`).textContent = specific;
            document.getElementById(`stat-other-${uid}`).textContent = other;
            document.getElementById(`stat-total-${uid}`).textContent = off+holiday+specific+other;
        });
    },

    toggleReqOff: function(uid, key) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const currentVal = this.localAssignments[uid][key];
        this.setShift(uid, key, currentVal === 'REQ_OFF' ? null : 'REQ_OFF');
    },

    updateCellOnly: function(uid, key) {
        const val = this.localAssignments[uid]?.[key] || '';
        let cellClass = '', displayVal = '';
        if (val === 'REQ_OFF' || val === 'OFF') { cellClass = val === 'REQ_OFF' ? 'cell-req-off' : 'cell-off'; displayVal = 'FF'; }
        else if (val && val.startsWith('!')) { cellClass = 'cell-avoid-shift'; displayVal = `勿${val.substring(1)}`; }
        else if (val) { cellClass = 'cell-specific-shift'; displayVal = val; }

        const staffIndex = (this.data.staffList || []).findIndex(s => s.uid === uid);
        if (staffIndex === -1) return;
        const day = parseInt(key.match(/current_(\d+)/)[1]);
        const cell = document.getElementById('matrixBody').children[staffIndex].children[4+6+(day-1)];
        if (cell) { cell.className = cellClass; cell.textContent = displayVal; }
    },

    showShiftMenu: function(event, uid, key) {
        event.preventDefault();
        const menu = document.getElementById('customContextMenu');
        let html = `<div class="menu-item" onclick="matrixManager.setShift('${uid}','${key}',null)">清除</div>
            <div class="menu-item" onclick="matrixManager.setShift('${uid}','${key}','REQ_OFF')">預排休假 (REQ_OFF)</div>
            <div class="menu-item" onclick="matrixManager.setShift('${uid}','${key}','OFF')">系統排休 (OFF)</div>`;
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}','${key}','${s.code}')">${s.code} - ${s.name}</div>
                <div class="menu-item" style="color:#c0392b" onclick="matrixManager.setShift('${uid}','${key}','!${s.code}')">勿 ${s.code}</div>`;
        });
        menu.innerHTML = html;
        this.positionMenu(event.target, menu);
    },

    showHistoryMenu: function(event, uid, day) {
        event.preventDefault();
        const menu = document.getElementById('customContextMenu');
        let html = `<div class="menu-header">修正上月紀錄</div><div class="menu-item" onclick="matrixManager.setHistoryShift('${uid}',${day},'OFF')">OFF</div>`;
        this.shifts.forEach(s => { if(s.code!=='OFF') html += `<div class="menu-item" onclick="matrixManager.setHistoryShift('${uid}',${day},'${s.code}')">${s.code}</div>`; });
        menu.innerHTML = html;
        this.positionMenu(event.target, menu);
    },

    positionMenu: function(cell, menu) {
        const rect = cell.getBoundingClientRect();
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        let left = rect.left, top = rect.bottom;
        if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
        if (top + 300 > window.innerHeight) top = rect.top - menu.offsetHeight;
        menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.visibility = 'visible';
    },

    hideMenu: function() {
        const menu = document.getElementById('customContextMenu');
        if (menu) { menu.style.display = 'none'; menu.style.visibility = 'hidden'; }
    },

    // ✅ 核心：修正 setShift 加入 11 小時與孕哺夜班檢查
    setShift: function(uid, key, val) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};

        // 規則驗證（只針對真正的班別，排除 OFF/REQ_OFF/!勿/清除）
        if (val && val !== 'OFF' && val !== 'REQ_OFF' && !val.startsWith('!')) {
            // 1. 孕婦/哺乳夜班阻擋 (22:00-06:00)
            const staffEntry = (this.data.staffList || []).find(s => s.uid === uid);
            const params = staffEntry?.schedulingParams || {};
            const today = new Date();
            const isPregnant = params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today;
            const isBreastfeeding = params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today;

            if (isPregnant || isBreastfeeding) {
                const shiftDef = this.shifts.find(s => s.code === val);
                if (shiftDef && this.isNightTimeShift(shiftDef)) {
                    alert(`⛔ 無法設定預班
原因：${isPregnant?'孕婦':'哺乳期'}不可排夜間班（時段重疊 22:00–06:00）

硬規則不可違反。`);
                    return;
                }
            }

            // 2. 11 小時休息間隔驗證
            const gapViolation = this.check11HourGap(uid, key, val);
            if (gapViolation) {
                alert(`⛔ 無法設定預班
原因：${gapViolation}

硬規則不可違反，請調整相鄰班別後再試。`);
                return;
            }
        }

        if(val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;

        this.pendingSave = true;
        this.updateUnsavedIndicator(true);
        this.updateCellOnly(uid, key);
        this.updateStats();
    },

    // ✅ Helper: 11 小時間隔檢查
    check11HourGap: function(uid, key, newShiftCode) {
        const dayMatch = key.match(/current_(\d+)/);
        if (!dayMatch) return null;
        const day = parseInt(dayMatch[1]);

        const shiftTimeMap = {};
        this.shifts.forEach(s => {
            if (s.startTime && s.endTime) {
                const parseT = t => { const [h,m] = t.split(':').map(Number); return h + m/60; };
                shiftTimeMap[s.code] = { start: parseT(s.startTime), end: parseT(s.endTime) };
            }
        });

        const newInfo = shiftTimeMap[newShiftCode];
        if (!newInfo) return null;

        const isWork = s => s && s !== 'OFF' && s !== 'REQ_OFF' && !s.startsWith('!');

        // 往前檢查
        let prevShift = (day === 1) 
            ? (this.historyCorrections[uid]?.[`last_${this.lastMonthDays}`] || this.lastMonthAssignments[uid]?.[`current_${this.lastMonthDays}`] || 'OFF')
            : this.localAssignments[uid]?.[`current_${day-1}`];

        if (isWork(prevShift)) {
            const prevInfo = shiftTimeMap[prevShift];
            if (prevInfo) {
                let gap = newInfo.start - prevInfo.end;
                if (gap < 0) gap += 24;
                if (gap < 11) return `與前一天 ${prevShift} 班距離不足 11 小時 (${gap.toFixed(1)}h)`;
            }
        }

        // 往後檢查
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        if (day < daysInMonth) {
            const nextShift = this.localAssignments[uid]?.[`current_${day+1}`];
            if (isWork(nextShift)) {
                const nextInfo = shiftTimeMap[nextShift];
                if (nextInfo) {
                    let gap = nextInfo.start - newInfo.end;
                    if (gap < 0) gap += 24;
                    if (gap < 11) return `與後一天 ${nextShift} 班距離不足 11 小時 (${gap.toFixed(1)}h)`;
                }
            }
        }
        return null;
    },

    // ✅ Helper: 判斷是否為夜間班 (時段重疊 22:00-06:00)
    isNightTimeShift: function(shiftDef) {
        if (!shiftDef.startTime || !shiftDef.endTime) return false;
        const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const start = toMin(shiftDef.startTime);
        let end = toMin(shiftDef.endTime);
        if (end <= start) end += 1440;
        const forbidStart = 22 * 60;
        const forbidEnd = 1440 + 6 * 60;
        return !(end <= forbidStart || start >= forbidEnd);
    },

    setHistoryShift: function(uid, day, val) {
        const key = `last_${day}`;
        if (!this.historyCorrections[uid]) this.historyCorrections[uid] = {};
        if (val === null) delete this.historyCorrections[uid][key];
        else this.historyCorrections[uid][key] = val;
        this.pendingSave = true; this.updateUnsavedIndicator(true); this.renderMatrix();
    },

    saveData: async function() {
        if (this.isLoading || !this.pendingSave) return;
        this.isLoading = true;
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                historyCorrections: this.historyCorrections,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.pendingSave = false; this.updateUnsavedIndicator(false); alert("✅ 草稿已儲存");
        } catch(e) { alert("❌ 儲存失敗: " + e.message); } finally { this.isLoading = false; }
    },

    updateUnsavedIndicator: function(has) {
        let el = document.getElementById('unsavedIndicator');
        if (has && !el) {
            const title = document.getElementById('matrixTitle');
            if (title) title.insertAdjacentHTML('afterend', '<span id="unsavedIndicator" style="color:#e67e22; font-size:0.9rem; margin-left:10px;">(有未儲存變更)</span>');
        } else if (!has && el) el.remove();
    },

    openPrefModal: function(uid, name) {
        document.getElementById('prefTargetUid').value = uid;
        document.getElementById('prefTargetName').innerText = `人員：${name}`;
        const assign = this.localAssignments[uid] || {};
        const prefs = assign.preferences || {};
        
        const bundleSelect = document.getElementById('editBundleShift');
        let bundleHtml = '<option value="">無 (不包班)</option>';
        this.shifts.forEach(s => { if (s.isBundleAvailable) bundleHtml += `<option value="${s.code}" ${prefs.bundleShift===s.code?'selected':''}>${s.code} (${s.name})</option>`; });
        bundleSelect.innerHTML = bundleHtml;

        const renderPrefs = () => {
            const fav1 = document.getElementById('editFavShift')?.value || prefs.favShift || '';
            const fav2 = document.getElementById('editFavShift2')?.value || prefs.favShift2 || '';
            const staff = (this.data.staffList || []).find(s => s.uid === uid) || {};
            const params = staff.schedulingParams || {};
            const today = new Date();
            const isPregnant = (params.isPregnant && new Date(params.pregnantExpiry) >= today) || (params.isBreastfeeding && new Date(params.breastfeedingExpiry) >= today);

            const filtered = this.shifts.filter(s => {
                if (s.code === 'OFF') return false;
                if (isPregnant && this.isNightTimeShift(s)) return false;
                return true;
            });

            document.getElementById('editPrefContainer').innerHTML = `
                <div class="form-group">第一志願 <select id="editFavShift" class="form-control"><option value="">無</option>${filtered.map(s=>`<option value="${s.code}" ${fav1===s.code?'selected':''}>${s.code}</option>`).join('')}</select></div>
                <div class="form-group">第二志願 <select id="editFavShift2" class="form-control"><option value="">無</option>${filtered.map(s=>`<option value="${s.code}" ${fav2===s.code?'selected':''}>${s.code}</option>`).join('')}</select></div>
            `;
        };
        bundleSelect.onchange = renderPrefs;
        renderPrefs();
        document.getElementById('prefModal').classList.add('show');
    },

    savePreferences: function() {
        const uid = document.getElementById('prefTargetUid').value;
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        this.localAssignments[uid].preferences = {
            bundleShift: document.getElementById('editBundleShift').value,
            favShift: document.getElementById('editFavShift').value,
            favShift2: document.getElementById('editFavShift2').value
        };
        this.pendingSave = true; this.updateUnsavedIndicator(true);
        document.getElementById('prefModal').classList.remove('show');
        this.updateStats();
    },

    closePrefModal: function() { document.getElementById('prefModal').classList.remove('show'); },

    setupEvents: function() {
        document.addEventListener('click', (e) => { if (!e.target.closest('#customContextMenu')) this.hideMenu(); });
        window.onbeforeunload = () => this.pendingSave ? "未儲存變更" : null;
    }
};
console.log('✅ pre_schedule_matrix_manager 已更新 (含 11小時檢查 + 孕哺夜班精確阻擋)');
