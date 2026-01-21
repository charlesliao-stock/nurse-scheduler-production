// js/modules/schedule_editor_manager.js
// 🚀 完整版：評分、即時統計(含臨時需求)、發布檢查、資料傳遞修正

const scheduleEditorManager = {
    scheduleId: null, data: null, shifts: [], assignments: {}, 
    unitRules: {}, staffMap: {}, usersMap: {}, isLoading: false,
    dragSrcUid: null, dragSrcDay: null,

    init: async function(id) { 
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.showLoading();
        try {
            await this.loadContext(); 
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthSchedule() // [新增] 載入上月班表
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
            }
            
            // [修正] 資料驗證：確保 assignments 物件存在
            if (!this.data.assignments || typeof this.data.assignments !== 'object') {
                console.warn("Assignments data is missing or invalid. Initializing empty object.");
                this.data.assignments = {};
            }
            this.assignments = this.data.assignments;
            
            // [修正] 驗證 staffList
            if (!this.data.staffList || !Array.isArray(this.data.staffList)) {
                throw new Error("人員名單 (StaffList) 資料損毀，無法載入排班表。");
            }

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.setupEvents();
            
            let menu = document.getElementById('schContextMenu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'schContextMenu';
                menu.className = 'context-menu';
                document.body.appendChild(menu);
            }
        } catch (e) { 
            console.error(e);
            document.getElementById('schBody').innerHTML = `<tr><td colspan="20" style="color:red; text-align:center; padding:20px;">初始化失敗: ${e.message}</td></tr>`;
        }
        finally { this.isLoading = false; }
    },

    renderScoreBoardContainer: function() {
        const container = document.getElementById('matrixContainer');
        const parent = container.parentElement; 
        if(document.getElementById('scoreDashboard')) return;

        const html = `
        <div id="scoreDashboard" style="background:#fff; padding:10px 20px; border-bottom:1px solid #ddd; display:flex; align-items:center; gap:20px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="position:relative; width:50px; height:50px; border-radius:50%; background:#ecf0f1; display:flex; justify-content:center; align-items:center;" id="scoreCircleBg">
                    <div style="width:42px; height:42px; background:#fff; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:2;">
                        <span id="scoreValue" style="font-size:1rem; font-weight:bold; color:#2c3e50;">-</span>
                    </div>
                </div>
                <div>
                    <h4 style="margin:0; font-size:0.9rem;">評分</h4>
                    <div id="scoreCompareBadge" style="font-size:0.75rem; color:#999; background:#f5f5f5; padding:2px 6px; border-radius:4px;">AI原始</div>
                </div>
            </div>
            <div style="flex:1; display:flex; gap:15px; justify-content:flex-end;">
                ${['效率','疲勞','滿意','公平','成本'].map((l,i)=>`
                    <div style="text-align:center;">
                        <div style="font-size:0.75rem; color:#999;">${l}</div>
                        <div id="scoreVal_${['eff','fat','sat','fai','cos'][i]}" style="font-weight:bold;">-</div>
                    </div>`).join('')}
            </div>
        </div>`;
        parent.insertBefore(this.createElementFromHTML(html), container);
    },
    createElementFromHTML: function(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; },

    updateScheduleScore: function() {
        if (typeof scoringManager === 'undefined') return;
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        // 將 1-5 分轉換為 0-100 百分比顯示
        const score = Math.round(res.total * 20 * 10) / 10;

        document.getElementById('scoreValue').innerText = score;
        document.getElementById('scoreCircleBg').style.background = `conic-gradient(#3498db 0% ${score}%, #ecf0f1 ${score}% 100%)`;
        
        ['eff','fat','sat','fai','cos'].forEach(k => {
            const map = { eff:'efficiency', fat:'fatigue', sat:'satisfaction', fai:'fairness', cos:'cost' };
            const val = res.breakdown[map[k]];
            document.getElementById(`scoreVal_${k}`).innerText = (typeof val === 'number') ? (Math.round(val * 20 * 10) / 10) : '-';
        });

        const badge = document.getElementById('scoreCompareBadge');
        if (scoringManager.aiBaseScore === null) {
            scoringManager.setBase(score);
            badge.innerHTML = 'AI 原始';
            badge.style.color = '#7f8c8d'; badge.style.background='#f5f5f5';
        } else {
            const diff = (score - scoringManager.aiBaseScore).toFixed(1);
            if (diff > 0) { badge.innerHTML = `▲ ${diff}%`; badge.style.color='#27ae60'; badge.style.background='#eafaf1'; }
            else if (diff < 0) { badge.innerHTML = `▼ ${Math.abs(diff)}%`; badge.style.color='#e74c3c'; badge.style.background='#fdedec'; }
            else { badge.innerHTML = '持平'; badge.style.color='#7f8c8d'; badge.style.background='#f5f5f5'; }
        }
    },

    updateRealTimeStats: function() {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};
        const specificNeeds = this.data.specificNeeds || {}; 

        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};

        this.data.staffList.forEach(s => {
            const uid = s.uid;
            const assign = this.assignments[uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val && val !== 'OFF' && val !== 'REQ_OFF') {
                    if(!countMap[d][val]) countMap[d][val] = 0;
                    countMap[d][val]++;
                }
            }
        });

        let fHtml = '';
        this.shifts.forEach((s, idx) => {
            fHtml += `<tr class="stat-monitor-row">`;
            if(idx === 0) fHtml += `<td colspan="3" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; background:#f8f9fa; position:sticky; left:0; z-index:10;">每日缺額<br>監控</td>`;
            // 補足「包班」與「上月月底 6 天」的空白格
            for(let i=0; i<7; i++) fHtml += `<td style="background:#f0f0f0;"></td>`; 

            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][s.code] || 0;
                const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const jsDay = new Date(year, month-1, d).getDay(); 
                const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1; 
                
                let need = 0;
                if (specificNeeds[dateStr] && specificNeeds[dateStr][s.code] !== undefined) {
                    need = specificNeeds[dateStr][s.code];
                } else {
                    need = dailyNeeds[`${s.code}_${needKeyIndex}`] || 0;
                }

                let statusClass = '';
                if(need > 0) {
                    if(actual < need) statusClass = 'stat-cell-shortage';
                    else if(actual > need) statusClass = 'stat-cell-over';
                    else statusClass = 'stat-cell-ok';
                }
                const display = (need > 0) ? `${actual}/${need}` : (actual > 0 ? actual : '-');
                fHtml += `<td class="${statusClass}">${display}</td>`;
            }
            // 補足右側 4 個統計欄位的空白格
            fHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
            fHtml += `<td style="background:#f0f0f0; font-weight:bold;">${s.code}</td></tr>`;
        });
        tfoot.innerHTML = fHtml;
    },

    checkShortages: function() {
        const list = [];
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};
        const specificNeeds = this.data.specificNeeds || {};
        
        const countMap = {};
        this.data.staffList.forEach(s => {
            const assign = this.assignments[s.uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val && val !== 'OFF' && val !== 'REQ_OFF') {
                    const key = `${d}_${val}`;
                    if(!countMap[key]) countMap[key] = 0;
                    countMap[key]++;
                }
            }
        });

        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const jsDay = new Date(this.data.year, this.data.month-1, d).getDay();
            const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1;

            this.shifts.forEach(s => {
                const actual = countMap[`${d}_${s.code}`] || 0;
                let need = 0;
                if (specificNeeds[dateStr] && specificNeeds[dateStr][s.code] !== undefined) {
                    need = specificNeeds[dateStr][s.code];
                } else {
                    need = dailyNeeds[`${s.code}_${needKeyIndex}`] || 0;
                }

                if (actual < need) {
                    list.push(`${this.data.month}/${d} (${s.code}): 缺 ${need - actual} 人`);
                }
            });
        }
        return list;
    },

    publishSchedule: async function() {
        const shortages = this.checkShortages();
        if (shortages.length > 0) {
            const msg = `⚠️ 無法發布：偵測到人力缺口\n\n${shortages.slice(0, 5).join('\n')}\n${shortages.length>5?'...等共'+shortages.length+'處':''}\n\n是否強制發布？`;
            if (!confirm(msg)) return;
        } else {
            if(!confirm("確定要發布班表？")) return;
        }

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

    runAI: async function() {
        if (typeof SchedulerFactory === 'undefined') { alert("AI 模組未載入"); return; }
        if (!confirm("確定執行 AI 排班? (覆蓋草稿)")) return;
        
        this.isLoading = true; this.showLoading();
        try {
            const lastMonthData = {};
            const year = this.data.year;
            const month = this.data.month;
            const lastMonthEnd = new Date(year, month - 1, 0).getDate();
            
            this.data.staffList.forEach(s => {
                const ua = this.assignments[s.uid] || {};
                lastMonthData[s.uid] = { lastShift: ua[`last_${lastMonthEnd}`] || 'OFF' };
                for (let i = 0; i < 6; i++) {
                    const d = lastMonthEnd - i;
                    lastMonthData[s.uid][`last_${d}`] = ua[`last_${d}`] || 'OFF';
                }
            });

            const staffListForAI = this.data.staffList.map(s => {
                const ua = this.assignments[s.uid] || {};
                const preReq = {};
                for(let d=1; d<=31; d++) {
                    const k = `current_${d}`;
                    if(ua[k] === 'REQ_OFF') preReq[this.getDateStr(d)] = 'REQ_OFF';
                }
                
                const userDetail = this.usersMap[s.uid];
                const group = userDetail ? userDetail.groupId : '';

                return {
                    id: s.uid, uid: s.uid, name: s.name, group: group,
                    prefs: ua.preferences || {},
                    packageType: ua.preferences?.bundleShift || null,
                    schedulingParams: preReq
                };
            });

            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                specificNeeds: this.data.specificNeeds || {}, 
                groupLimits: this.data.groupLimits || {}, 
                shiftCodes: this.shifts.map(s => s.code),
                shifts: this.shifts, 
                ...this.unitRules, 
                ...(this.data.settings || {})
            };

            const scheduler = SchedulerFactory.create('V2', staffListForAI, year, month, lastMonthData, rules);
            const aiResult = scheduler.run();
            this.applyAIResult(aiResult);
            this.renderMatrix();
            this.updateRealTimeStats();
            
            scoringManager.setBase(null);
            this.updateScheduleScore();

            await this.saveDraft(true);
            alert("AI 排班完成!");
        } catch (e) { console.error(e); alert("AI 失敗: " + e.message); this.renderMatrix(); }
        finally { this.isLoading = false; }
    },

    showLoading: function() { document.getElementById('schBody').innerHTML='<tr><td colspan="20">載入中...</td></tr>'; },
    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("資料不存在");
        this.data = doc.data();
        this.data.staffList.forEach(s => { this.staffMap[s.uid] = s; });
    },
    loadShifts: async function() {
        const snap = await db.collection('shifts').where('unitId', '==', this.data.unitId).orderBy('startTime').get();
        this.shifts = snap.docs.map(d => d.data());
    },
    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },
    loadUnitRules: async function() {
        const doc = await db.collection('units').doc(this.data.unitId).get();
        this.unitRules = doc.data().schedulingRules || {};
    },
    // [新增] 載入上月班表資料
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
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weeks = ['日','一','二','三','四','五','六'];
        
        // [修正] 增加上月最後 6 天與右側統計欄位
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px;">包班</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem;">上月月底</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th style="${color}">${d}</th>`;
        }
        h1 += `<th colspan="4" style="background:#e8f4fd;">統計</th></tr>`;

        let h2 = `<tr>`;
        // 上月最後 6 天日期
        const lastMonthDays = this.lastMonthDays || 31;
        for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
            h2 += `<th style="background:#f5f5f5; font-size:0.7rem; color:#999;">${d}</th>`;
        }
        // 本月星期
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `<th style="width:40px; background:#f0f7ff; font-size:0.75rem;">總OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">假OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">小夜</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">大夜</th></tr>`;
        
        thead.innerHTML = h1 + h2;

        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const ua = this.assignments[uid] || {};
            const empId = this.usersMap[uid]?.employeeId || '';
            
            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff;">${staff.name}</td>
                <td>${ua.preferences?.bundleShift || '-'}</td>`;
            
            // [新增] 渲染上月最後 6 天班表
            const lastAssign = this.lastMonthAssignments[uid] || {};
            for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
                const val = lastAssign[`current_${d}`] || lastAssign[d] || ''; 
                bodyHtml += `<td style="background:#fafafa; color:#999; font-size:0.85rem;">${val}</td>`;
            }

            // 統計變數
            let totalOff = 0;
            let holidayOff = 0;
            let eveningCount = 0;
            let nightCount = 0;

            for(let d=1; d<=daysInMonth; d++) {
                const val = ua[`current_${d}`] || '';
                const isLocked = (val==='REQ_OFF');
                const dragAttr = isLocked ? '' : 'draggable="true"';
                bodyHtml += `<td class="cell-clickable ${isLocked?'':'cell-draggable'}" data-uid="${uid}" data-day="${d}" ${dragAttr} oncontextmenu="scheduleEditorManager.handleRightClick(event, '${uid}', '${d}'); return false;">${this.renderCellContent(val)}</td>`;
                
                // 計算統計
                if (val === 'OFF' || val === 'REQ_OFF') {
                    totalOff++;
                    const date = new Date(year, month-1, d);
                    const w = date.getDay();
                    if (w === 0 || w === 6) holidayOff++;
                } else if (val === 'E') {
                    eveningCount++;
                } else if (val === 'N') {
                    nightCount++;
                }
            }

            // [新增] 右側統計欄位
            bodyHtml += `<td style="background:#f9f9f9; font-weight:bold;">${totalOff}</td>
                         <td style="background:#f9f9f9; color:red;">${holidayOff}</td>
                         <td style="background:#f9f9f9;">${eveningCount}</td>
                         <td style="background:#f9f9f9;">${nightCount}</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
        this.bindEvents();
    },
    
    renderCellContent: function(val) {
        if (!val) return '';
        if (val === 'OFF') return '<span style="color:#bbb;">OFF</span>';
        if (val === 'REQ_OFF') return '<span class="badge badge-success">休</span>';
        return `<span class="badge badge-primary">${val}</span>`;
    },
    
    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        let html = `<ul><li class="menu-header">設定 ${d} 日</li>`;
        this.shifts.forEach(s => {
            html += `<li onclick="scheduleEditorManager.setShift('${s.code}')">${s.code}</li>`;
        });
        html += `<li onclick="scheduleEditorManager.setShift('OFF')">OFF</li><li onclick="scheduleEditorManager.setShift(null)">清除</li></ul>`;
        menu.innerHTML = html;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        e.preventDefault();
    },
    
    setShift: function(code) {
        const { uid, d } = this.targetCell;
        const key = `current_${d}`;
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;
        
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        document.getElementById('schContextMenu').style.display = 'none';
    },
    
    bindEvents: function() {
        document.addEventListener('click', () => { 
            const m = document.getElementById('schContextMenu'); if(m) m.style.display='none'; 
        });
    },
    
    applyAIResult: function(res) {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(s => {
            const uid = s.uid;
            if(!this.assignments[uid]) this.assignments[uid] = {};
            for(let d=1; d<=daysInMonth; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') delete this.assignments[uid][`current_${d}`];
            }
        });
        Object.keys(res).forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]);
            const daySch = res[dateStr];
            Object.keys(daySch).forEach(code => {
                daySch[code].forEach(uid => {
                    if(this.assignments[uid][`current_${day}`] !== 'REQ_OFF')
                        this.assignments[uid][`current_${day}`] = code;
                });
            });
        });
    },
    
    getDateStr: function(d) { return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; },
    
    saveDraft: async function(silent) {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if(!silent) alert("儲存成功");
        } catch(e) { alert("儲存失敗"); }
    },
    
    unpublishSchedule: async function() {
        if(!confirm("取消發布?")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'draft',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("已取消");
        } catch(e) { alert("失敗"); }
    },

    resetSchedule: async function() {
        if(!confirm("重置?")) return;
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.assignments[uid]) return;
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                if (this.assignments[uid][key] !== 'REQ_OFF') delete this.assignments[uid][key];
            }
        });
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        await this.saveDraft(true);
        alert("已重置");
    },
    
    setupEvents: function() { }
};
