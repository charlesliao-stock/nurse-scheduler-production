// js/modules/schedule_editor_manager.js
// 🚀 Phase 2 完整版：資料橋接 + 拖曳調班 + 缺額監控 + 人工調整驗證

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    unitRules: {},
    shifts: [],
    staffMap: {},
    assignments: {},
    usersMap: {}, 
    isLoading: false,
    
    dragSrcUid: null,
    dragSrcDay: null,

    init: async function(id) {
        console.log("Schedule Editor Init (Phase 2):", id);
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
            this.updateRealTimeStats();
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

    // --- 介面渲染省略 (保持與原版相同) ---
    renderToolbar: function() { /* ...原版代碼... */ 
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
    
    renderMatrix: function() { /* ...原版代碼... */
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        if (!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthDate = new Date(year, month - 1, 0);
        const lastMonthEnd = lastMonthDate.getDate();
        const prevShowDays = 6; 
        
        // Header
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

        // Body
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

            // 統計
            bodyHtml += `<td id="stat_off_${uid}" style="border-left:2px solid #ccc; font-weight:bold; color:#007bff;">0</td>
                         <td id="stat_E_${uid}">0</td>
                         <td id="stat_N_${uid}">0</td>
                         <td id="stat_hol_${uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        this.bindEvents();
    },

    updateRealTimeStats: function() { /* ...原版代碼 (統計與監控)... */
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const prevShowDays = 6;
        const dailyNeeds = this.data.dailyNeeds || {};
        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};

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

        let fHtml = '';
        const targetShifts = this.shifts.map(s => s.code);
        targetShifts.forEach((code, idx) => {
            const shiftName = this.shifts.find(s => s.code === code)?.name || code;
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

    renderCellContent: function(val) { /* ...原版代碼... */
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

    bindEvents: function() { /* ...原版代碼 (拖曳與右鍵)... */
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
                if (this.dragSrcDay !== targetDay) return false; 
                if (this.dragSrcUid !== targetUid) {
                    this.swapShift(this.dragSrcUid, targetUid, targetDay);
                }
                return false;
            });
        });
    },

    // 🆕 修正重點 4：人工調整時的規則檢查
    
    /**
     * 檢查單一變動是否違反 11 小時規則
     * @param {string} uid 人員ID
     * @param {number} day 日期 (1-31)
     * @param {string} newCode 新班別代號
     * @returns {Object} { valid: boolean, msg: string }
     */
    validateShiftChange: function(uid, day, newCode) {
        // 如果是 OFF 或刪除，通常不違反間隔 (休息更多)，除非有特殊需求，這裡暫時放行
        if (!newCode || newCode === 'OFF' || newCode === 'REQ_OFF') {
            return { valid: true };
        }

        // 輔助：解析時間字串轉小時數
        const parseTime = (str) => {
            if(!str) return 0;
            const [h, m] = str.split(':').map(Number);
            return h + (m||0)/60;
        };

        // 輔助：取得班別定義
        const getShiftDef = (code) => {
            if(!code || code === 'OFF' || code === 'REQ_OFF') return null;
            return this.shifts.find(s => s.code === code);
        };

        const checkGap = (prevCode, currCode) => {
            if(!prevCode || !currCode) return true;
            
            const prev = getShiftDef(prevCode);
            const curr = getShiftDef(currCode);
            
            if(!prev || !curr) return true; // 視為 OFF 或無定義

            const pStart = parseTime(prev.startTime);
            const pEnd = parseTime(prev.endTime);
            const cStart = parseTime(curr.startTime);

            // 前一天結束時間 (相對於前一天00:00)
            let prevEndTimeAbs = pEnd;
            if (pEnd <= pStart) {
                prevEndTimeAbs += 24; // 跨夜
            }

            // 今天開始時間 (相對於前一天00:00，所以+24)
            let currStartTimeAbs = cStart + 24;

            const gap = currStartTimeAbs - prevEndTimeAbs;
            
            if (gap < 11) {
                return false;
            }
            return true;
        };

        // 1. 檢查與「前一天」的間隔
        // 需取得昨天的班別
        let prevShiftCode = null;
        if (day > 1) {
            prevShiftCode = this.assignments[uid][`current_${day-1}`];
        } else {
            // 第一天，讀取 last_lastMonthEnd
            // 這裡簡化讀取 DOM 或 data 中的 last_X
            const lastMonthEnd = new Date(this.data.year, this.data.month - 1, 0).getDate();
            prevShiftCode = this.assignments[uid][`last_${lastMonthEnd}`];
        }

        if (prevShiftCode && !checkGap(prevShiftCode, newCode)) {
            return { valid: false, msg: `與前一天班別 (${prevShiftCode}) 間隔不足 11 小時` };
        }

        // 2. 檢查與「後一天」的間隔
        // 如果改了今天，可能會影響明天
        // 今天的結束時間 vs 明天的開始時間
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

        // 鎖定檢查
        const isLocked = (v) => (v === 'REQ_OFF' || (typeof v === 'string' && v.startsWith('!')));
        if (isLocked(val1) || isLocked(val2)) {
            alert("鎖定或預休的班別無法交換");
            return;
        }

        // 🆕 規則驗證 (雙向檢查)
        // 1. 檢查 uid1 換成 val2 是否合法
        const check1 = this.validateShiftChange(uid1, day, val2);
        if (!check1.valid) {
            if (!confirm(`人員1 (交換後): ${check1.msg}。\n確定要強制交換嗎？`)) return;
        }

        // 2. 檢查 uid2 換成 val1 是否合法
        const check2 = this.validateShiftChange(uid2, day, val1);
        if (!check2.valid) {
            if (!confirm(`人員2 (交換後): ${check2.msg}。\n確定要強制交換嗎？`)) return;
        }

        // 執行交換
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

    // ... (其他既有函數保持不變: refreshCell, runAI, saveDraft 等) ...
    refreshCell: function(uid, day) {
        const cell = document.querySelector(`td[data-uid="${uid}"][data-day="${day}"]`);
        const val = this.assignments[uid][`current_${day}`];
        if(cell) cell.innerHTML = this.renderCellContent(val);
    },
    
    // AI 相關
    runAI: async function() { /* ...原版代碼... */ },
    extractPreRequests: function(uid) { /* ...原版代碼... */ },
    applyAIResult: function(aiResult) { /* ...原版代碼... */ },
    getDateStr: function(day) { /* ...原版代碼... */ },
    
    saveDraft: async function(silent = false) { /* ...原版代碼... */ },
    
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
    
    resetSchedule: async function() { /* ...原版代碼... */ },
    publishSchedule: async function() { /* ...原版代碼... */ },
    unpublishSchedule: async function() { /* ...原版代碼... */ },
    cleanup: function() { document.getElementById('schContextMenu').style.display='none'; },
    setupEvents: function() { document.addEventListener('click', () => { 
        const m = document.getElementById('schContextMenu'); if(m) m.style.display='none'; 
    }); },
    openNeedsModal: function() { /* ... */ }
};
