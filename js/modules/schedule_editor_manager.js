// js/modules/schedule_editor_manager.js
// 🚀 最終完整修正版：整合 X,Y,Z,A,B 配額分析儀表板 + 精確 H 值連動 + 完整 AI 參數傳遞

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    shifts: [], 
    assignments: {}, 
    unitRules: {}, 
    staffMap: {}, 
    usersMap: {}, 
    isLoading: false,
    lastMonthData: {}, 
    lastMonthDays: 31,
    lastScoreResult: null,
    contextMenuHandler: null,

    init: async function(id) { 
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        
        if (!app.currentUser) { 
            alert("請先登入"); 
            return; 
        }
        
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法編輯排班表</p>
                </div>
            `;
            return;
        }
        
        this.showLoading();
        
        try {
            const schDoc = await db.collection('schedules').doc(id).get();
            if (!schDoc.exists) {
                alert("找不到此排班表");
                return;
            }
            
            const schData = schDoc.data();
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if (activeUnitId !== schData.unitId) {
                    document.getElementById('content-area').innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-lock"></i>
                            <h3>權限不足</h3>
                            <p>您無權編輯其他單位的排班表</p>
                        </div>
                    `;
                    return;
                }
            }
            
            this.data = schData;
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthSchedule()
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
            }
            
            this.assignments = this.data.assignments || {};
            this.data.staffList.forEach(s => { 
                if (s.uid) {
                    s.uid = s.uid.trim();
                    this.staffMap[s.uid] = s; 
                }
            });

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.bindEvents();
            this.initContextMenu();
            
        } catch (e) { 
            console.error("❌ 初始化失敗:", e);
        } finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
        }
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts')
            .where('unitId', '==', this.data.unitId)
            .orderBy('startTime')
            .get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(d => this.usersMap[d.id] = d.data());
    },

    loadUnitRules: async function() {
        const doc = await db.collection('units').doc(this.data.unitId).get();
        this.unitRules = doc.data()?.schedulingRules || {};
    },

    loadLastMonthSchedule: async function() {
        const { year, month } = this.data;
        let ly = year, lm = month - 1;
        if (lm === 0) { lm = 12; ly--; }
        this.lastMonthDays = new Date(ly, lm, 0).getDate();

        const snap = await db.collection('schedules')
            .where('unitId', '==', this.data.unitId)
            .where('year', '==', ly)
            .where('month', '==', lm)
            .where('status', '==', 'published')
            .limit(1)
            .get();

        this.lastMonthData = !snap.empty ? snap.docs[0].data().assignments || {} : {};
    },

    getStaffStatusBadges: function(uid) {
        const user = this.usersMap[uid];
        if (!user) return '';
        const badges = [];
        const params = user.schedulingParams || {};
        if (params.isPregnant) badges.push('<span class="status-badge" style="background:#ff9800; color:white;">孕</span>');
        if (params.isBreastfeeding) badges.push('<span class="status-badge" style="background:#4caf50; color:white;">哺</span>');
        if (params.isPGY) badges.push('<span class="status-badge" style="background:#2196f3; color:white;">P</span>');
        if (params.independence === 'dependent') badges.push('<span class="status-badge" style="background:#9c27b0; color:white;">D</span>');
        return badges.join('');
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const { year, month } = this.data;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px; position:sticky; left:140px; z-index:110; background:#f8f9fa;">狀態</th>
            <th rowspan="2" style="width:60px;">偏好</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem;">上月月底</th>`;
        
        for(let d=1; d<=daysInMonth; d++) h1 += `<th>${d}</th>`;
        h1 += `<th colspan="4" style="background:#e8f4fd;">統計</th></tr><tr>`;

        for(let d = this.lastMonthDays - 5; d <= this.lastMonthDays; d++) {
            h1 += `<th style="background:#f5f5f5; font-size:0.7rem; color:#999;">${d}</th>`;
        }
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = ['日','一','二','三','四','五','六'][date.getDay()];
            h1 += `<th style="font-size:0.8rem;">${w}</th>`;
        }
        h1 += `<th>總OFF</th><th>假OFF</th><th>E</th><th>N</th></tr>`;
        thead.innerHTML = h1;

        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid, ua = this.assignments[uid] || {}, user = this.usersMap[uid] || {};
            const badges = this.getStaffStatusBadges(uid);
            const prefs = staff.prefs || ua.preferences || {};
            let prefDisp = prefs.bundleShift ? `包${prefs.bundleShift}` : '-';

            bodyHtml += `<tr>
                <td style="position:sticky; left:0; background:#fff;">${user.employeeId || ''}</td>
                <td style="position:sticky; left:60px; background:#fff;">${staff.name}</td>
                <td style="position:sticky; left:140px; background:#fff;">${badges}</td>
                <td>${prefDisp}</td>`;
            
            const lastData = this.lastMonthData[uid] || {};
            for(let d = this.lastMonthDays - 5; d <= this.lastMonthDays; d++) {
                const v = lastData[`last_${d}`];
                bodyHtml += `<td style="font-size:0.7rem;">${v === 'OFF' ? 'FF' : (v || '-')}</td>`;
            }

            let off=0, req=0, e=0, n=0;
            for(let d=1; d<=daysInMonth; d++) {
                const val = ua[`current_${d}`];
                let txt = val || '', cls = 'cell-clickable';
                if(val === 'OFF') { off++; txt='FF'; cls+=' cell-off'; }
                else if(val === 'REQ_OFF') { off++; req++; txt='V'; cls+=' cell-req-off'; }
                else if(val === 'E') e++; 
                else if(val === 'N') n++;
                bodyHtml += `<td class="${cls}" data-uid="${uid}" data-day="${d}" oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">${txt}</td>`;
            }
            bodyHtml += `<td>${off}</td><td>${req}</td><td>${e}</td><td>${n}</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    runAI: async function() {
        this.showLoading();
        const checkResult = await this.analyzeBundleQuota();
        this.showBundleCheckModal(checkResult);
        const loader = document.getElementById('globalLoader');
        if(loader) loader.remove();
    },

    analyzeBundleQuota: async function() {
        const { year, month } = this.data;
        const daysInMonth = new Date(year, month, 0).getDate();
        let H = 8.0; 
        
        try {
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if (preDoc.exists) {
                const preData = preDoc.data();
                H = parseFloat(this.calculateAvgOff(preData, this.shifts)) || 8.0;
            }
        } catch (e) { console.warn("無法取得預班 H 值，改用預設 8.0"); }

        const demand = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const w = (new Date(year, month-1, d).getDay() + 6) % 7;
            this.shifts.forEach(s => {
                if (!demand[s.code]) demand[s.code] = 0;
                demand[s.code] += this.data.specificNeeds?.[ds]?.[s.code] ?? this.data.dailyNeeds?.[`${s.code}_${w}`] ?? 0;
            });
        }

        const result = {};
        ['E', 'N'].forEach(code => {
            const bundle = this.data.staffList.filter(s => (s.packageType || s.prefs?.bundleShift) === code);
            const volunteers = this.data.staffList.filter(s => !bundle.includes(s) && [s.prefs?.favShift, s.prefs?.favShift2].includes(code));
            
            const X = demand[code] || 0;
            const Y = bundle.length;
            const Z = volunteers.length;
            const A = Math.floor(daysInMonth - H);
            let B = Z > 0 ? (X - (Y * A)) / Z : 0;

            let status = 'green', msg = '預估負載適中。非包班人員負擔合理。';
            if (B < 0) { status = 'red'; msg = '配置邏輯錯誤。包班總量已超過總需求。'; }
            else if (B === 0 && Y > 0) { status = 'yellow'; msg = '包班人力充裕，志願者預計無班可排。'; }
            else if (B > 5) { status = 'yellow'; msg = '志願者負擔偏重，請留意花班風險。'; }
            else if (B > 8) { status = 'red'; msg = '嚴重缺口，極大機率違反 11 小時休息規則。'; }

            result[code] = { X, Y, Z, A, B: B.toFixed(1), bundle, volunteers, status, msg };
        });
        return { analysis: result, H };
    },

    showBundleCheckModal: function(res) {
        const { analysis, H } = res;
        const colors = { green: '#2ecc71', yellow: '#f1c40f', red: '#e74c3c' };
        let html = `<div id="bundleCheckModal" style="position:fixed; z-index:10000; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(3px);">
            <div style="background:white; padding:30px; border-radius:15px; width:800px; max-height:90vh; overflow-y:auto; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
                <div style="display:flex; justify-content:space-between; margin-bottom:20px; border-bottom:2px solid #eee; padding-bottom:10px;">
                    <h3 style="margin:0;">📊 AI 排班前配額預估分析</h3>
                    <span style="background:#f8f9fa; padding:4px 12px; border-radius:20px; font-size:0.9rem;">平均放假基準 H = ${H} 天</span>
                </div>`;

        ['E', 'N'].forEach(c => {
            const d = analysis[c];
            html += `<div style="border:1px solid #ddd; border-radius:10px; margin-bottom:20px; overflow:hidden;">
                <div style="background:${c==='E'?'#3498db':'#9b59b6'}; color:white; padding:10px 20px; font-weight:bold; display:flex; justify-content:space-between;">
                    <span>${c==='E'?'小夜':'大夜'} (需求 X = ${d.X} 班)</span>
                    <span style="background:white; color:${colors[d.status]}; padding:1px 8px; border-radius:4px; font-size:0.8rem;">負載狀態</span>
                </div>
                <div style="padding:15px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:10px;">
                        <div style="background:#f9f9f9; padding:10px; border-left:4px solid #95a5a6;">包班 (Y=${d.Y} 人) 每人配額 A = <b>${d.A}</b> 班</div>
                        <div style="background:#f9f9f9; padding:10px; border-left:4px solid ${colors[d.status]};">志願 (Z=${d.Z} 人) 每人配額 B = <b>${d.B}</b> 班</div>
                    </div>
                    <div style="background:${colors[d.status]}15; color:${colors[d.status]}; padding:10px; border-radius:5px; margin-bottom:10px; font-size:0.9rem;">
                        <i class="fas fa-info-circle"></i> <b>建議：</b>${d.msg}
                    </div>
                    <details style="font-size:0.85rem; color:#666;">
                        <summary style="cursor:pointer;">👥 查看名單 (包班: ${d.bundle.length} / 志願: ${d.volunteers.length})</summary>
                        <div style="padding-top:10px;">
                            <b>包班：</b>${d.bundle.map(s=>s.name).join(', ') || '無'}<br>
                            <b>志願：</b>${d.volunteers.map(s=>s.name).join(', ') || '無'}
                        </div>
                    </details>
                </div>
            </div>`;
        });

        html += `<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
            <button onclick="document.getElementById('bundleCheckModal').remove()" style="padding:10px 20px; border-radius:5px; border:1px solid #ccc; background:white;">返回調整</button>
            <button onclick="scheduleEditorManager.confirmExecuteAI()" style="padding:10px 25px; border-radius:5px; border:none; background:#2ecc71; color:white; font-weight:bold;">確認執行 AI 排班</button>
        </div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    confirmExecuteAI: function() {
        const m = document.getElementById('bundleCheckModal'); 
        if(m) m.remove();
        this.executeAI();
    },

    executeAI: async function() {
        this.showLoading();
        try {
            const { year, month } = this.data;
            const staffListForAI = this.data.staffList.map(s => {
                const ua = this.assignments[s.uid] || {}, user = this.usersMap[s.uid] || {}, up = user.schedulingParams || {};
                const preReq = {};
                for(let d=1; d<=31; d++) {
                    if(ua[`current_${d}`] === 'REQ_OFF') {
                        preReq[`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = 'REQ_OFF';
                    }
                }
                return {
                    id: s.uid, uid: s.uid, name: s.name, group: s.group,
                    preferences: s.prefs || ua.preferences || {},
                    schedulingParams: { ...preReq, ...up } 
                };
            });

            const rules = { 
                dailyNeeds: this.data.dailyNeeds || {}, 
                specificNeeds: this.data.specificNeeds || {}, 
                groupLimits: this.data.groupLimits || {}, 
                shifts: this.shifts, 
                shiftCodes: this.shifts.map(s => s.code), 
                ...this.unitRules, 
                ...(this.data.settings || {})
            };

            const scheduler = SchedulerFactory.create('V2', staffListForAI, year, month, this.lastMonthData, rules);
            const aiResult = scheduler.run();
            this.applyAIResult(aiResult);
            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore();
            await this.saveDraft(true);
            alert("AI 排班完成!");
        } catch (e) { alert("AI 失敗: " + e.message); }
        finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader'); 
            if(loader) loader.remove(); 
        }
    },

    applyAIResult: function(res) {
        const days = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(s => {
            const uid = s.uid.trim();
            if(!this.assignments[uid]) this.assignments[uid] = {};
            for(let d=1; d<=days; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') {
                    delete this.assignments[uid][`current_${d}`];
                }
            }
        });
        Object.keys(res).forEach(dateStr => {
            const d = parseInt(dateStr.split('-')[2]);
            Object.keys(res[dateStr]).forEach(code => {
                res[dateStr][code].forEach(uid => {
                    if (this.assignments[uid] && this.assignments[uid][`current_${d}`] !== 'REQ_OFF') {
                        this.assignments[uid][`current_${d}`] = code;
                    }
                });
            });
        });
    },

    calculateAvgOff: function(data, shifts) {
        const count = data.staffList?.length || 1;
        let totalOff = 0;
        const days = new Date(data.year, data.month, 0).getDate();
        for (let d = 1; d <= days; d++) {
            const ds = `${data.year}-${String(data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const w = (new Date(data.year, data.month-1, d).getDay() + 6) % 7;
            let need = 0;
            if (data.specificNeeds?.[ds]) {
                Object.values(data.specificNeeds[ds]).forEach(v => need += parseInt(v));
            } else {
                shifts.forEach(s => need += (data.dailyNeeds?.[`${s.code}_${w}`] || 0));
            }
            totalOff += Math.max(0, count - need);
        }
        return (totalOff / count).toFixed(1);
    },

    saveDraft: async function(silent) {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ 
                assignments: this.assignments, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
            if (!silent) alert("✅ 草稿已儲存");
        } catch (e) { console.error("❌ 儲存失敗:", e); }
    },

    renderToolbar: function() {
        const r = document.getElementById('toolbarRight');
        document.getElementById('schTitle').innerText = `${this.data.year}/${this.data.month} 排班`;
        const badge = document.getElementById('schStatus');
        badge.innerText = this.data.status === 'published' ? '已發布' : '草稿';
        badge.style.background = this.data.status === 'published' ? '#2ecc71' : '#f39c12';
        r.innerHTML = this.data.status === 'draft' 
            ? `<button class="btn btn-primary" onclick="scheduleEditorManager.runAI()"><i class="fas fa-magic"></i> AI 自動排班</button>
               <button class="btn" style="background:#95a5a6;" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>
               <button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-check"></i> 確認發布</button>`
            : `<button class="btn" style="background:#e67e22;" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-times"></i> 取消發布</button>`;
    },

    getDateStr: function(day) { 
        return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; 
    },
    
    showLoading: function() { 
        if(!document.getElementById('globalLoader')) {
            document.body.insertAdjacentHTML('beforeend', '<div id="globalLoader" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:99999; display:flex; justify-content:center; align-items:center;"><div style="background:white; padding:20px; border-radius:8px;">載入中...</div></div>'); 
        }
    },

    updateRealTimeStats: function() {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        const { year, month } = this.data;
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};
        const specificNeeds = this.data.specificNeeds || {}; 
        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};
        this.data.staffList.forEach(s => {
            const assign = this.assignments[s.uid] || {};
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
            if(idx === 0) fHtml += `<td colspan="4" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; background:#f8f9fa; position:sticky; left:0; z-index:10;">每日缺額監控</td>`;
            for(let i=0; i<6; i++) fHtml += `<td style="background:#f0f0f0;"></td>`; 
            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][s.code] || 0;
                const ds = this.getDateStr(d);
                const jsDay = new Date(year, month-1, d).getDay(); 
                const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1; 
                let need = (specificNeeds[ds] && specificNeeds[ds][s.code] !== undefined) ? specificNeeds[ds][s.code] : (dailyNeeds[`${s.code}_${needKeyIndex}`] || 0);
                let cls = need > 0 ? (actual < need ? 'stat-cell-shortage' : (actual > need ? 'stat-cell-over' : 'stat-cell-ok')) : '';
                fHtml += `<td class="${cls}">${need > 0 ? `${actual}/${need}` : (actual > 0 ? actual : '-')}</td>`;
            }
            fHtml += `<td colspan="4" style="background:#f0f0f0;"></td><td style="background:#f0f0f0; font-weight:bold;">${s.code}</td></tr>`;
        });
        tfoot.innerHTML = fHtml;
    },

    renderScoreBoardContainer: function() {
        const container = document.getElementById('matrixContainer');
        if (!container || document.getElementById('scoreDashboard')) return;
        const html = `
        <div id="scoreDashboard" style="background:#fff; padding:10px 20px; border-bottom:1px solid #ddd; display:flex; align-items:center; gap:20px;">
            <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="scheduleEditorManager.showDetailedScore()">
                <div style="position:relative; width:50px; height:50px; border-radius:50%; background:#ecf0f1;" id="scoreCircleBg">
                    <div style="width:42px; height:42px; background:#fff; border-radius:50%; position:absolute; top:4px; left:4px; display:flex; justify-content:center; align-items:center;">
                        <span id="scoreValue" style="font-size:1rem; font-weight:bold; color:#2c3e50;">-</span>
                    </div>
                </div>
                <div><h4 style="margin:0; font-size:0.9rem;">評分 (詳情)</h4></div>
            </div>
        </div>`;
        container.parentElement.insertBefore(this.createElementFromHTML(html), container);
    },

    createElementFromHTML: function(h) { const d=document.createElement('div'); d.innerHTML=h.trim(); return d.firstChild; },
    updateScheduleScore: function() { 
        if (typeof scoringManager === 'undefined') return;
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        document.getElementById('scoreValue').innerText = Math.round(res.total);
        this.lastScoreResult = res; 
    },

    showDetailedScore: function() {
        const res = this.lastScoreResult; if(!res) return;
        let h = `<h4>總分: ${res.total.toFixed(1)}</h4>`;
        document.getElementById('scoreDetailContent').innerHTML = h;
        document.getElementById('scoreDetailModal').style.display = 'block';
    },

    initContextMenu: function() {
        if (!document.getElementById('schContextMenu')) {
            const m = document.createElement('div');
            m.id = 'schContextMenu'; m.className = 'context-menu';
            m.innerHTML = '<ul style="list-style:none; margin:0; padding:10px; min-width:120px;"></ul>';
            document.body.appendChild(m);
        }
    },

    showContextMenu: function(e, uid, day) {
        const menu = document.getElementById('schContextMenu'), ul = menu.querySelector('ul');
        ul.innerHTML = '';
        const current = this.assignments[uid]?.[`current_${day}`];
        if(current === 'REQ_OFF') {
            ul.innerHTML = `<li onclick="scheduleEditorManager.clearCell('${uid}',${day})">清除預假</li>`;
        } else {
            ul.innerHTML = `<li onclick="scheduleEditorManager.setOff('${uid}',${day})">設為 FF</li>`;
            this.shifts.forEach(s => {
                ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}',${day},'${s.code}')">${s.name} (${s.code})</li>`;
            });
            if(current) ul.innerHTML += `<li onclick="scheduleEditorManager.clearCell('${uid}',${day})">清除</li>`;
        }
        menu.style.display = 'block'; menu.style.left = e.pageX + 'px'; menu.style.top = e.pageY + 'px';
    },

    setOff: function(u, d) { this.assignments[u][`current_${d}`] = 'OFF'; this.refreshUI(); },
    setShift: function(u, d, c) { this.assignments[u][`current_${d}`] = c; this.refreshUI(); },
    clearCell: function(u, d) { if(this.assignments[u][`current_${d}`] !== 'REQ_OFF') delete this.assignments[u][`current_${d}`]; this.refreshUI(); },
    refreshUI: function() { this.renderMatrix(); this.updateRealTimeStats(); this.updateScheduleScore(); },
    bindEvents: function() { document.addEventListener('click', () => { const m = document.getElementById('schContextMenu'); if(m) m.style.display='none'; }); },

    publishSchedule: async function() {
        if(!confirm("確定發布？")) return;
        await db.collection('schedules').doc(this.scheduleId).update({ status: 'published', publishedAt: firebase.firestore.FieldValue.serverTimestamp() });
        this.data.status = 'published'; this.renderToolbar(); alert("已發布");
    },

    unpublishSchedule: async function() {
        if(!confirm("取消發布?")) return;
        await db.collection('schedules').doc(this.scheduleId).update({ status: 'draft' });
        this.data.status = 'draft'; this.renderToolbar(); alert("已取消");
    },

    resetSchedule: async function() {
        if(!confirm("確定重置並重新載入預班資料？")) return;
        this.showLoading();
        try {
            let source = {};
            if (this.data.sourceId) {
                const doc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
                if (doc.exists) source = doc.data().assignments || {};
            }
            const days = new Date(this.data.year, this.data.month, 0).getDate();
            this.data.staffList.forEach(s => {
                const pre = source[s.uid] || {};
                this.assignments[s.uid] = { preferences: pre.preferences || {} };
                for (let d = 1; d <= days; d++) if (pre[`current_${d}`]) this.assignments[s.uid][`current_${d}`] = pre[`current_${d}`];
            });
            this.refreshUI(); await this.saveDraft(true);
        } finally { document.getElementById('globalLoader').remove(); }
    }
};
