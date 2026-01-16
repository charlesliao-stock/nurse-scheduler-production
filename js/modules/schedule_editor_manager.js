// js/modules/schedule_editor_manager.js
// 🚀 Phase 2 完整版：資料橋接 + 拖曳調班 + 缺額監控 + 人工調整驗證 + 完整功能

const scheduleEditorManager = {
    scheduleId: null,
    data: null,      // 排班草稿資料
    unitRules: {},   // 從 Unit 讀取的規則 (含救火開關)
    shifts: [],      // 班別列表
    staffMap: {},
    assignments: {},
    usersMap: {}, 
    isLoading: false,
    
    // 拖曳暫存變數
    dragSrcUid: null,
    dragSrcDay: null,

    init: async function(id) {
        console.log("Schedule Editor Init (Phase 2):", id);
        this.scheduleId = id;

        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.cleanup();
        this.showLoading();

        try {
            // 1. 先讀取草稿，取得 unitId
            await this.loadContext(); 

            // 2. 根據 unitId 並行讀取：班別、人員、單位規則
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadUnitRules()
            ]);
            
            this.assignments = this.data.assignments || {};

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats(); // 這會同時更新底部監控列
            this.setupEvents();
            
            const menu = document.getElementById('schContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }

            console.log("✅ 排班編輯器 (P2) 初始化完成", this.unitRules);

        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const tbody = document.getElementById('schBody');
        if(tbody) tbody.innerHTML = '<tr><td colspan="20" style="padding:40px;"><i class="fas fa-spinner fa-spin"></i> 載入中...</td></tr>';
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("找不到此排班表");
        this.data = doc.data();
        this.data.staffList.forEach(s => { this.staffMap[s.uid] = s; });
        
        const titleEl = document.getElementById('schTitle'); 
        if(titleEl) {
            let statusText = this.data.status === 'published' ? '(已發布)' : '(草稿)';
            titleEl.innerHTML = `<i class="fas fa-calendar-alt"></i> 排班作業 <small>${statusText}</small>`;
        }
    },

    loadShifts: async function() {
        if(this.data.unitId) {
            const snap = await db.collection('shifts')
                .where('unitId', '==', this.data.unitId)
                .get();
            this.shifts = snap.docs.map(d => d.data());
        }
    },

    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },

    loadUnitRules: async function() {
        if(this.data.unitId) {
            const doc = await db.collection('units').doc(this.data.unitId).get();
            if(doc.exists) {
                this.unitRules = doc.data().schedulingRules || {};
            }
        }
    },

    renderToolbar: function() {
        const statusBadge = document.getElementById('schStatus'); 
        if(statusBadge) {
            const isPub = this.data.status === 'published';
            statusBadge.textContent = isPub ? '已發布' : '草稿';
            statusBadge.className = `badge ${isPub ? 'badge-success' : 'badge-warning'}`;
        }

        const rightGroup = document.getElementById('toolbarRight');
        if(rightGroup) {
            const isPublished = this.data.status === 'published';
            
            const configBtn = `<button class="btn btn-edit" onclick="scheduleEditorManager.openNeedsModal()"><i class="fas fa-cog"></i> 設定需求</button>`;
            const aiBtn = `<button class="btn" style="background:#8e44ad; color:white;" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 自動排班</button>`;
            const resetBtn = `<button class="btn btn-warning" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>`;
            const saveBtn = `<button class="btn btn-primary" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
            const pubBtn = isPublished 
                ? `<button class="btn btn-secondary" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-eye-slash"></i> 取消發布</button>`
                : `<button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-paper-plane"></i> 發布班表</button>`;

            rightGroup.innerHTML = `${configBtn} <span style="border-left:1px solid #ccc; height:20px; margin:0 5px;"></span> ${aiBtn} ${resetBtn} ${saveBtn} ${pubBtn}`;
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        if (!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthDate = new Date(year, month - 1, 0);
        const lastMonthEnd = lastMonthDate.getDate();
        const prevShowDays = 6; 
        
        // --- 表頭 (Header) ---
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa; vertical-align:middle;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa; vertical-align:middle;">姓名</th>
            <th rowspan="2" style="width:60px; vertical-align:middle;">備註</th>
            <th rowspan="2" style="width:50px; vertical-align:middle;">包班</th>
            <th rowspan="2" style="width:100px; vertical-align:middle;">偏好</th>`;
        
        for(let i=prevShowDays-1; i>=0; i--) {
            h1 += `<th class="cell-narrow" style="background:#eee; color:#666;">${lastMonthEnd - i}</th>`;
        }
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        h1 += `<th rowspan="2" style="width:40px; border-left:2px solid #ccc; color:#007bff; vertical-align:middle;">OFF</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">E</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">N</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">假日</th></tr>`;

        let h2 = `<tr>`;
        for(let i=0; i<prevShowDays; i++) h2 += `<th style="background:#eee;"></th>`;
        const weeks = ['日','一','二','三','四','五','六'];
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `</tr>`;
        thead.innerHTML = h1 + h2;

        // --- 表身 (Body) ---
        let bodyHtml = '';
        const sortedStaff = [...this.data.staffList].sort((a,b) => {
            const idA = this.usersMap[a.uid]?.employeeId || '';
            const idB = this.usersMap[b.uid]?.employeeId || '';
            return idA.localeCompare(idB);
        });

        sortedStaff.forEach(staff => {
            const uid = staff.uid;
            const userDetail = this.usersMap[uid] || {};
            const empId = userDetail.employeeId || '';
            const note = userDetail.note || ''; 
            const userAssign = this.assignments[uid] || {};
            const userPrefs = userAssign.preferences || {};
            
            let bundleHtml = userPrefs.bundleShift ? `<span class="badge badge-info">${userPrefs.bundleShift}</span>` : '-';
            let prefHtml = (userPrefs.priority_1 || userPrefs.priority_2) 
                ? `<span style="font-size:0.75rem; color:#666;">${[userPrefs.priority_1, userPrefs.priority_2].filter(x=>x).join('>')}</span>` : '-';

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:100; border-right:1px solid #ddd;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:100; font-weight:bold; border-right:1px solid #ddd; white-space:nowrap;">${staff.name}</td>
                <td style="font-size:0.8rem; color:#666;">${note}</td>
                <td>${bundleHtml}</td>
                <td>${prefHtml}</td>`;
            
            // 上個月的班 (不可拖曳)
            for(let i=prevShowDays-1; i>=0; i--) {
                const d = lastMonthEnd - i;
                const val = userAssign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-narrow" style="background:#f9f9f9; color:#999;">${val}</td>`;
            }

            // 本月的班 (可拖曳)
            for(let d=1; d<=daysInMonth; d++) {
                const val = userAssign[`current_${d}`] || '';
                // 檢查是否鎖定 (預休)
                const isLocked = (val === 'REQ_OFF' || (typeof val === 'string' && val.startsWith('!')));
                const draggableAttr = isLocked ? '' : 'draggable="true"';
                const classNames = isLocked ? 'cell-clickable' : 'cell-clickable cell-draggable';
                
                bodyHtml += `<td class="${classNames}" 
                            data-uid="${uid}" data-day="${d}"
                            ${draggableAttr}
                            style="cursor:${isLocked?'default':'grab'};">
                            ${this.renderCellContent(val)}</td>`;
            }

            // 統計格
            bodyHtml += `<td id="stat_off_${uid}" style="border-left:2px solid #ccc; font-weight:bold; color:#007bff;">0</td>
                         <td id="stat_E_${uid}">0</td>
                         <td id="stat_N_${uid}">0</td>
                         <td id="stat_hol_${uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        this.bindEvents();
    },

    updateRealTimeStats: function() {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const prevShowDays = 6;
        const dailyNeeds = this.data.dailyNeeds || {};

        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};

        // 計算統計
        this.data.staffList.forEach(s => {
            let off=0, E=0, N=0, hol=0;
            const uid = s.uid;
            const userAssign = this.assignments[uid] || {};
            
            for(let d=1; d<=daysInMonth; d++) {
                const val = userAssign[`current_${d}`];
                const date = new Date(year, month-1, d);
                const isW = (date.getDay()===0||date.getDay()===6);
                
                if(val==='OFF'||val==='REQ_OFF') {
                    off++; if(isW) hol++;
                } else if(val && val.includes('E')) E++;
                else if(val && val.includes('N')) N++;

                if(val && val !== 'OFF' && val !== 'REQ_OFF') {
                    if(!countMap[d][val]) countMap[d][val] = 0;
                    countMap[d][val]++;
                }
            }
            const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
            set(`stat_off_${uid}`, off); set(`stat_E_${uid}`, E);
            set(`stat_N_${uid}`, N); set(`stat_hol_${uid}`, hol);
        });

        // 渲染 tfoot
        let fHtml = '';
        const targetShifts = this.shifts.map(s => s.code);
        
        targetShifts.forEach((code, idx) => {
            fHtml += `<tr class="stat-monitor-row">`;
            
            if(idx === 0) {
                fHtml += `<td colspan="5" rowspan="${targetShifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle; background:#f8f9fa;">每日缺額監控</td>`;
            }

            for(let i=0; i<prevShowDays; i++) fHtml += `<td style="background:#f0f0f0;"></td>`;

            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][code] || 0;
                const jsDay = new Date(year, month-1, d).getDay(); 
                const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1; 
                const need = dailyNeeds[`${code}_${needKeyIndex}`] || 0;

                let statusClass = '';
                if(need > 0) {
                    if(actual < need) statusClass = 'stat-cell-shortage';
                    else if(actual > need) statusClass = 'stat-cell-over';
                    else statusClass = 'stat-cell-ok';
                }

                const display = (need > 0) ? `${actual}/${need}` : (actual > 0 ? actual : '-');
                fHtml += `<td class="${statusClass}">${display}</td>`;
            }
            
            fHtml += `<td colspan="4" style="background:#f0f0f0; border-left:2px solid #ccc;">${code}</td></tr>`;
        });
        
        tfoot.innerHTML = fHtml;
    },

    renderCellContent: function(val) {
        if (!val) return '';
        if (val === 'OFF') return '<span style="color:#bdc3c7; font-weight:bold;">OFF</span>';
        if (val === 'REQ_OFF') return '<span class="badge badge-success">休</span>';
        
        const isString = typeof val === 'string';
        if (isString && val.startsWith('!')) {
            return `<span style="color:red; font-size:0.8rem;"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        }

        const shift = this.shifts.find(s => s.code === val);
        const bg = shift ? shift.color : '#3498db';
        return `<span class="badge" style="background:${bg}; color:white;">${val}</span>`;
    },

    // --- 事件綁定：右鍵選單 + 拖曳 ---
    bindEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day);
                return false;
            });

            cell.addEventListener('dragstart', (e) => {
                this.dragSrcUid = cell.dataset.uid;
                this.dragSrcDay = cell.dataset.day;
                cell.classList.add('cell-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            cell.addEventListener('dragend', (e) => {
                cell.classList.remove('cell-dragging');
                document.querySelectorAll('.cell-drag-over').forEach(el => el.classList.remove('cell-drag-over'));
            });

            cell.addEventListener('dragover', (e) => {
                if (e.preventDefault) e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                cell.classList.add('cell-drag-over');
                return false;
            });

            cell.addEventListener('drop', (e) => {
                if (e.stopPropagation) e.stopPropagation();
                
                const targetUid = cell.dataset.uid;
                const targetDay = cell.dataset.day;

                if (this.dragSrcDay !== targetDay) {
                    return false; 
                }
                
                if (this.dragSrcUid !== targetUid) {
                    this.swapShift(this.dragSrcUid, targetUid, targetDay);
                }
                return false;
            });
        });
    },

    // 🆕 規則驗證：檢查人工調整是否違反 11 小時規則
    /**
     * @param {string} uid 人員ID
     * @param {number} day 日期 (1-31)
     * @param {string} newCode 新班別代號
     * @returns {Object} { valid: boolean, msg: string }
     */
    validateShiftChange: function(uid, day, newCode) {
        if (!newCode || newCode === 'OFF' || newCode === 'REQ_OFF') {
            return { valid: true };
        }

        const parseTime = (str) => {
            if(!str) return 0;
            const [h, m] = str.split(':').map(Number);
            return h + (m||0)/60;
        };

        const getShiftDef = (code) => {
            if(!code || code === 'OFF' || code === 'REQ_OFF') return null;
            return this.shifts.find(s => s.code === code);
        };

        const checkGap = (prevCode, currCode) => {
            if(!prevCode || !currCode) return true;
            const prev = getShiftDef(prevCode);
            const curr = getShiftDef(currCode);
            if(!prev || !curr) return true; 

            const pStart = parseTime(prev.startTime);
            const pEnd = parseTime(prev.endTime);
            const cStart = parseTime(curr.startTime);

            // 前一天結束時間 (相對前一天00:00)
            let prevEndTimeAbs = pEnd;
            if (pEnd <= pStart) prevEndTimeAbs += 24; // 跨夜

            // 今天開始時間 (相對前一天00:00，所以+24)
            let currStartTimeAbs = cStart + 24;

            const gap = currStartTimeAbs - prevEndTimeAbs;
            return gap >= 11;
        };

        // 1. 檢查與「前一天」的間隔
        let prevShiftCode = null;
        if (day > 1) {
            prevShiftCode = this.assignments[uid][`current_${day-1}`];
        } else {
            const lastMonthEnd = new Date(this.data.year, this.data.month - 1, 0).getDate();
            prevShiftCode = this.assignments[uid][`last_${lastMonthEnd}`];
        }

        if (prevShiftCode && !checkGap(prevShiftCode, newCode)) {
            return { valid: false, msg: `與前一天班別 (${prevShiftCode}) 間隔不足 11 小時` };
        }

        // 2. 檢查與「後一天」的間隔
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        if (day < daysInMonth) {
            const nextShiftCode = this.assignments[uid][`current_${parseInt(day)+1}`];
            if (nextShiftCode && !checkGap(newCode, nextShiftCode)) {
                return { valid: false, msg: `與後一天班別 (${nextShiftCode}) 間隔不足 11 小時` };
            }
        }

        return { valid: true };
    },

    swapShift: function(uid1, uid2, day) {
        const key = `current_${day}`;
        const val1 = this.assignments[uid1]?.[key];
        const val2 = this.assignments[uid2]?.[key];

        const isLocked = (v) => (v === 'REQ_OFF' || (typeof v === 'string' && v.startsWith('!')));
        if (isLocked(val1) || isLocked(val2)) {
            alert("鎖定或預休的班別無法交換");
            return;
        }

        // 🆕 規則驗證 (雙向檢查)
        const check1 = this.validateShiftChange(uid1, day, val2);
        if (!check1.valid) {
            if (!confirm(`人員1 (交換後): ${check1.msg}。\n確定要強制交換嗎？`)) return;
        }

        const check2 = this.validateShiftChange(uid2, day, val1);
        if (!check2.valid) {
            if (!confirm(`人員2 (交換後): ${check2.msg}。\n確定要強制交換嗎？`)) return;
        }

        if(!this.assignments[uid1]) this.assignments[uid1] = {};
        if(!this.assignments[uid2]) this.assignments[uid2] = {};

        this.assignments[uid1][key] = val2;
        this.assignments[uid2][key] = val1;

        this.refreshCell(uid1, day);
        this.refreshCell(uid2, day);
        this.updateRealTimeStats();
    },

    setShift: function(code) {
        if (!this.targetCell) return;
        const { uid, d } = this.targetCell;

        // 🆕 規則驗證
        const check = this.validateShiftChange(uid, d, code);
        if (!check.valid) {
            if (!confirm(`警告：${check.msg}。\n確定要強制設定嗎？`)) {
                document.getElementById('schContextMenu').style.display = 'none';
                return;
            }
        }

        const key = `current_${d}`;
        if(!this.assignments[uid]) this.assignments[uid] = {};
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;

        this.refreshCell(uid, d);
        document.getElementById('schContextMenu').style.display = 'none';
        this.updateRealTimeStats();
    },

    refreshCell: function(uid, day) {
        const cell = document.querySelector(`td[data-uid="${uid}"][data-day="${day}"]`);
        const val = this.assignments[uid][`current_${day}`];
        if(cell) cell.innerHTML = this.renderCellContent(val);
    },

    // 🌟 AI 排班 (完整邏輯)
    runAI: async function() {
        if (typeof SchedulerFactory === 'undefined') {
            alert("AI 模組未載入"); return;
        }

        if (!confirm("確定執行 AI 排班?(將覆蓋現有草稿)")) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            const lastMonthData = {};
            const year = this.data.year;
            const month = this.data.month;
            const lastMonthDate = new Date(year, month - 1, 0);
            const lastMonthEnd = lastMonthDate.getDate();
            
            this.data.staffList.forEach(s => {
                const userAssign = this.assignments[s.uid] || {};
                lastMonthData[s.uid] = {
                    lastShift: userAssign[`last_${lastMonthEnd}`] || 'OFF'
                };
                for (let i = 0; i < 6; i++) {
                    const d = lastMonthEnd - i;
                    lastMonthData[s.uid][`last_${d}`] = userAssign[`last_${d}`] || 'OFF';
                }
            });

            const staffListForAI = this.data.staffList.map(s => {
                const userAssign = this.assignments[s.uid] || {};
                return {
                    id: s.uid, 
                    uid: s.uid, 
                    name: s.name,
                    prefs: userAssign.preferences || {},
                    packageType: userAssign.preferences?.bundleShift || null,
                    schedulingParams: this.extractPreRequests(s.uid)
                };
            });

            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                shiftCodes: this.shifts.map(s => s.code),
                shifts: this.shifts, 
                ...this.unitRules, 
                ...(this.data.settings || {})
            };

            console.log("🚀 啟動 AI 排班", rules);

            const scheduler = SchedulerFactory.create(
                'V2', 
                staffListForAI, 
                this.data.year, 
                this.data.month, 
                lastMonthData, 
                rules
            );
            
            const aiResult = scheduler.run();
            
            this.applyAIResult(aiResult);
            this.renderMatrix();
            this.updateRealTimeStats();
            
            await this.saveDraft(true);
            alert("✅ AI 排班完成!");

        } catch (e) {
            console.error("❌ AI 執行失敗:", e);
            alert("AI 執行失敗: " + e.message);
            this.renderMatrix();
        } finally {
            this.isLoading = false;
        }
    },

    extractPreRequests: function(uid) {
        const userAssign = this.assignments[uid] || {};
        const preRequests = {};
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `current_${d}`;
            const val = userAssign[key];
            if (val === 'REQ_OFF' || (typeof val === 'string' && val.startsWith('!'))) {
                const dateStr = this.getDateStr(d);
                preRequests[dateStr] = val;
            }
        }
        return preRequests;
    },

    applyAIResult: function(aiResult) {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.assignments[uid]) this.assignments[uid] = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                const curr = this.assignments[uid][key];
                if (curr === 'REQ_OFF' || (curr && curr.startsWith('!'))) continue;
                delete this.assignments[uid][key];
            }
        });
        
        Object.keys(aiResult).forEach(dateStr => {
            const parts = dateStr.split('-');
            const day = parseInt(parts[2], 10);
            if (isNaN(day)) return;
            const daySchedule = aiResult[dateStr];
            Object.keys(daySchedule).forEach(shiftCode => {
                let staffIds = daySchedule[shiftCode];
                if (staffIds instanceof Set) staffIds = Array.from(staffIds);
                staffIds.forEach(uid => {
                    if (!this.assignments[uid]) this.assignments[uid] = {};
                    const key = `current_${day}`;
                    const existing = this.assignments[uid][key];
                    if (existing === 'REQ_OFF' || (existing && existing.startsWith('!'))) return;
                    this.assignments[uid][key] = shiftCode;
                });
            });
        });
    },

    getDateStr: function(day) {
        const year = this.data.year;
        const month = this.data.month;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },

    saveDraft: async function(silent = false) {
        try {
            if (!silent) this.isLoading = true;
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (!silent) alert("✅ 草稿已儲存");
        } catch (e) { console.error(e); if(!silent)alert("儲存失敗"); }
        finally { if (!silent) this.isLoading = false; }
    },
    
    // 補齊：發布與取消發布
    publishSchedule: async function() {
        if(!confirm("確定要發布班表？發布後員工將可看見。")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("班表已發布！");
        } catch(e) { alert("發布失敗: " + e.message); }
    },

    unpublishSchedule: async function() {
        if(!confirm("確定要取消發布？")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'draft',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("已取消發布，回復為草稿狀態。");
        } catch(e) { alert("取消失敗: " + e.message); }
    },

    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        if (!menu) return;
        
        let list = menu.querySelector('ul');
        if(!list) { list = document.createElement('ul'); menu.appendChild(list); }
        list.innerHTML = `<li style="background:#f8f9fa; font-weight:bold; cursor:default;">${d}日 設定</li>`;
        
        this.shifts.forEach(s => {
            list.innerHTML += `<li onclick="scheduleEditorManager.setShift('${s.code}')"><span style="color:${s.color}">●</span> ${s.code}</li>`;
        });
        list.innerHTML += `<hr style="margin:5px 0;">`;
        list.innerHTML += `<li onclick="scheduleEditorManager.setShift('OFF')">OFF (排休)</li>`;
        list.innerHTML += `<li onclick="scheduleEditorManager.setShift(null)" style="color:red;">清除</li>`;

        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    resetSchedule: async function() {
        if (!confirm("確定要重置班表？這將清除所有已排定的班別，但會保留預休(REQ_OFF)與鎖定狀態。")) return;
        this.isLoading = true;
        try {
            const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
            this.data.staffList.forEach(staff => {
                const uid = staff.uid;
                if (!this.assignments[uid]) return;
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    const curr = this.assignments[uid][key];
                    if (curr === 'REQ_OFF' || (typeof curr === 'string' && curr.startsWith('!'))) continue;
                    delete this.assignments[uid][key];
                }
            });
            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(true);
            alert("✅ 班表已重置");
        } catch (e) {
            console.error("❌ 重置失敗:", e);
            alert("重置失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    cleanup: function() { document.getElementById('schContextMenu').style.display='none'; },
    
    setupEvents: function() { 
        document.addEventListener('click', () => { 
            const m = document.getElementById('schContextMenu'); 
            if(m) m.style.display='none'; 
        }); 
    },
    
    openNeedsModal: function() {
        alert("功能開發中：設定每日人力需求");
    }
};
