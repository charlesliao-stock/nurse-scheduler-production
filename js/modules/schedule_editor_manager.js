// js/modules/schedule_editor_manager.js
// 🚀 Phase 2 完整版：OFF統計 + 動態班別選單 + 即時規則驗證 + AI/儲存完整邏輯

const scheduleEditorManager = {
    scheduleId: null,
    data: null,      // 排班草稿資料
    unitRules: {},   // 單位規則
    shifts: [],      // 班別列表
    staffMap: {},
    assignments: {},
    usersMap: {}, 
    isLoading: false,
    
    // 拖曳暫存
    dragSrcUid: null,
    dragSrcDay: null,

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;

        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.cleanup();
        this.showLoading();

        try {
            await this.loadContext(); 
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadUnitRules()
            ]);
            
            this.assignments = this.data.assignments || {};

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats(); // 計算 OFF 與缺額
            this.setupEvents();
            
            // 初始化右鍵選單容器
            let menu = document.getElementById('schContextMenu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'schContextMenu';
                menu.className = 'context-menu';
                document.body.appendChild(menu);
            }

            console.log("✅ 排班編輯器初始化完成");

        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const tbody = document.getElementById('schBody');
        if(tbody) tbody.innerHTML = '<tr><td colspan="20" style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> 載入中...</td></tr>';
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
                .orderBy('startTime') 
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
            const aiBtn = `<button class="btn" style="background:#8e44ad; color:white;" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 自動排班</button>`;
            const resetBtn = `<button class="btn btn-warning" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>`;
            const saveBtn = `<button class="btn btn-primary" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
            const pubBtn = isPublished 
                ? `<button class="btn btn-secondary" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-eye-slash"></i> 取消發布</button>`
                : `<button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-paper-plane"></i> 發布班表</button>`;

            rightGroup.innerHTML = `${aiBtn} ${resetBtn} ${saveBtn} ${pubBtn}`;
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
        const prevShowDays = 3; 
        
        // --- Header ---
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px;">包班</th>`;
        
        for(let i=prevShowDays-1; i>=0; i--) {
            h1 += `<th class="cell-narrow" style="background:#eee; color:#999;">${lastMonthEnd - i}</th>`;
        }
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        // OFF 統計欄位
        h1 += `<th rowspan="2" style="width:50px; border-left:2px solid #ccc; color:#2c3e50;">休假<br>(OFF)</th>
               <th rowspan="2" style="width:50px;">時數</th></tr>`;

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

        // --- Body ---
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
            const userAssign = this.assignments[uid] || {};
            const userPrefs = userAssign.preferences || {};
            
            let bundleHtml = userPrefs.bundleShift ? `<span class="badge badge-info">${userPrefs.bundleShift}</span>` : '-';

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:100; border-right:1px solid #ddd;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:100; font-weight:bold; border-right:1px solid #ddd; white-space:nowrap;">${staff.name}</td>
                <td>${bundleHtml}</td>`;
            
            // 上個月
            for(let i=prevShowDays-1; i>=0; i--) {
                const d = lastMonthEnd - i;
                const val = userAssign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-narrow" style="background:#f9f9f9; color:#999;">${val}</td>`;
            }

            // 本月
            for(let d=1; d<=daysInMonth; d++) {
                const val = userAssign[`current_${d}`] || '';
                const isLocked = (val === 'REQ_OFF' || (typeof val === 'string' && val.startsWith('!')));
                const draggableAttr = isLocked ? '' : 'draggable="true"';
                const classNames = isLocked ? 'cell-clickable' : 'cell-clickable cell-draggable';
                
                bodyHtml += `<td class="${classNames}" 
                            data-uid="${uid}" data-day="${d}"
                            ${draggableAttr}
                            style="cursor:${isLocked?'default':'grab'};">
                            ${this.renderCellContent(val)}</td>`;
            }

            // 統計欄位
            bodyHtml += `<td id="stat_off_${uid}" style="border-left:2px solid #ccc; font-weight:bold; color:#007bff;">0</td>
                         <td id="stat_hours_${uid}">0</td></tr>`;
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
        const prevShowDays = 3;
        const dailyNeeds = this.data.dailyNeeds || {};

        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};

        // 1. 計算人員 OFF 數與工時
        this.data.staffList.forEach(s => {
            let offCount = 0;
            let totalHours = 0;
            const uid = s.uid;
            const userAssign = this.assignments[uid] || {};
            
            for(let d=1; d<=daysInMonth; d++) {
                const val = userAssign[`current_${d}`];
                
                // OFF 與 REQ_OFF 都算休假
                if(val === 'OFF' || val === 'REQ_OFF') {
                    offCount++;
                } 
                
                if(val && val !== 'OFF' && val !== 'REQ_OFF') {
                    if(!countMap[d][val]) countMap[d][val] = 0;
                    countMap[d][val]++;

                    const shiftDef = this.shifts.find(sh => sh.code === val);
                    if (shiftDef) totalHours += (shiftDef.hours || 8);
                }
            }
            
            const offEl = document.getElementById(`stat_off_${uid}`);
            if(offEl) offEl.textContent = offCount;
            
            const hoursEl = document.getElementById(`stat_hours_${uid}`);
            if(hoursEl) hoursEl.textContent = totalHours;
        });

        // 2. 渲染底部缺額監控
        let fHtml = '';
        const targetShifts = this.shifts.map(s => s.code);
        
        targetShifts.forEach((code, idx) => {
            fHtml += `<tr class="stat-monitor-row">`;
            
            if(idx === 0) {
                fHtml += `<td colspan="3" rowspan="${targetShifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle; background:#f8f9fa;">每日缺額<br>監控</td>`;
            }

            for(let i=0; i<prevShowDays; i++) fHtml += `<td style="background:#f0f0f0;"></td>`;

            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][code] || 0;
                const date = new Date(year, month-1, d);
                const jsDay = date.getDay(); // 0=Sun
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
            
            fHtml += `<td colspan="2" style="background:#f0f0f0; border-left:2px solid #ccc; text-align:center;">${code}</td></tr>`;
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
        return `<span class="badge" style="background:${bg}; color:white; min-width:25px;">${val}</span>`;
    },

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
                e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                cell.classList.add('cell-drag-over');
            });

            cell.addEventListener('drop', (e) => {
                e.stopPropagation();
                const targetUid = cell.dataset.uid;
                const targetDay = cell.dataset.day;
                if (this.dragSrcDay !== targetDay) return false; 
                if (this.dragSrcUid !== targetUid) {
                    this.swapShift(this.dragSrcUid, targetUid, targetDay);
                }
                return false;
            });
        });
    },

    // 修正 2: 動態班別選單
    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        if (!menu) return;
        
        let html = `<ul>`;
        html += `<li class="menu-header">設定 ${d} 日班別</li>`;
        
        this.shifts.forEach(s => {
            html += `<li onclick="scheduleEditorManager.setShift('${s.code}')">
                <span class="color-dot" style="background:${s.color}"></span> ${s.code} (${s.name})
            </li>`;
        });
        
        html += `<hr>`;
        html += `<li onclick="scheduleEditorManager.setShift('OFF')">OFF (排休)</li>`;
        html += `<li onclick="scheduleEditorManager.setShift(null)" style="color:#e74c3c;">清除</li>`;
        html += `</ul>`;

        menu.innerHTML = html;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    // 修正 3: 驗證邏輯
    validateShiftChange: function(uid, day, newCode) {
        if (!newCode || newCode === 'OFF' || newCode === 'REQ_OFF') return { valid: true };

        const parseTime = (str) => {
            if(!str) return 0;
            const [h, m] = str.split(':').map(Number);
            return h + (m||0)/60;
        };

        const getShiftDef = (code) => {
            if(!code || code === 'OFF' || code === 'REQ_OFF') return null;
            return this.shifts.find(s => s.code === code);
        };

        // 1. 檢查與「前一天」的間隔
        let prevShiftCode = null;
        if (day > 1) {
            prevShiftCode = this.assignments[uid][`current_${day-1}`];
        } else {
            const lastMonthEnd = new Date(this.data.year, this.data.month - 1, 0).getDate();
            prevShiftCode = this.assignments[uid][`last_${lastMonthEnd}`];
        }

        if (prevShiftCode && prevShiftCode !== 'OFF' && prevShiftCode !== 'REQ_OFF') {
            const prev = getShiftDef(prevShiftCode);
            const curr = getShiftDef(newCode);
            if (prev && curr) {
                let prevEnd = parseTime(prev.endTime);
                if (parseTime(prev.endTime) <= parseTime(prev.startTime)) prevEnd += 24; 
                let currStart = parseTime(curr.startTime) + 24; 
                const gap = currStart - prevEnd;
                
                if (gap < 11 && this.unitRules.hard?.minGap11) {
                    return { valid: false, msg: `違反「11小時光間隔」：\n前班(${prevShiftCode})結束與本班(${newCode})開始僅間隔 ${gap.toFixed(1)} 小時。` };
                }
            }
        }

        // 2. 檢查連續上班
        if (this.unitRules.policy?.limitConsecutive) {
            let cons = 1; 
            for(let i=1; i<=10; i++) {
                const checkDay = parseInt(day) - i;
                let s = null;
                if(checkDay > 0) s = this.assignments[uid][`current_${checkDay}`];
                if(!s || s === 'OFF' || s === 'REQ_OFF') break;
                cons++;
            }
            if (cons > (this.unitRules.policy.maxConsDays || 6)) {
                return { valid: false, msg: `違反「連續上班限制」：\n此安排將導致連續上班 ${cons} 天 (上限 ${this.unitRules.policy.maxConsDays} 天)。` };
            }
        }

        return { valid: true };
    },

    setShift: function(code) {
        if (!this.targetCell) return;
        const { uid, d } = this.targetCell;

        const check = this.validateShiftChange(uid, d, code);
        if (!check.valid) {
            if (!confirm(`⚠️ 警告：${check.msg}\n\n確定要強制設定嗎？`)) {
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

    swapShift: function(uid1, uid2, day) {
        const key = `current_${day}`;
        const val1 = this.assignments[uid1]?.[key];
        const val2 = this.assignments[uid2]?.[key];

        const check1 = this.validateShiftChange(uid1, day, val2);
        if (!check1.valid) {
            if (!confirm(`人員1 (交換後): ${check1.msg}\n確定要繼續嗎？`)) return;
        }

        const check2 = this.validateShiftChange(uid2, day, val1);
        if (!check2.valid) {
            if (!confirm(`人員2 (交換後): ${check2.msg}\n確定要繼續嗎？`)) return;
        }

        if(!this.assignments[uid1]) this.assignments[uid1] = {};
        if(!this.assignments[uid2]) this.assignments[uid2] = {};

        this.assignments[uid1][key] = val2;
        this.assignments[uid2][key] = val1;

        this.refreshCell(uid1, day);
        this.refreshCell(uid2, day);
        this.updateRealTimeStats();
    },

    refreshCell: function(uid, day) {
        const cell = document.querySelector(`td[data-uid="${uid}"][data-day="${day}"]`);
        const val = this.assignments[uid][`current_${day}`];
        if(cell) cell.innerHTML = this.renderCellContent(val);
    },

    // --- 完整還原的 AI 與儲存邏輯 ---

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
            
            // 準備上月資料
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

            // 準備人員資料
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

            // 合併規則
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                shiftCodes: this.shifts.map(s => s.code),
                shifts: this.shifts, 
                ...this.unitRules, 
                ...(this.data.settings || {})
            };

            console.log("🚀 啟動 AI 排班", rules);

            // 執行 V2
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
