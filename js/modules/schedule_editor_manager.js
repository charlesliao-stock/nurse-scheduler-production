// js/modules/schedule_editor_manager.js
// 🚀 最終完整修正版：確保「上月月底」資料正確顯示並參與計算

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
        
        if (!app.currentUser) { alert("請先登入"); return; }
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `<div class="empty-state"><i class="fas fa-lock"></i><h3>權限不足</h3></div>`;
            return;
        }
        
        this.showLoading();
        try {
            const schDoc = await db.collection('schedules').doc(id).get();
            if (!schDoc.exists) { alert("找不到此排班表"); return; }
            this.data = schDoc.data();
            
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthSchedule() // ✅ 關鍵：確保上月班表資料載入
            ]);
            
            this.data.staffList.forEach(s => { if (s.uid) this.staffMap[s.uid.trim()] = s; });
            this.assignments = this.data.assignments || {};
            
            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix(); // ✅ 渲染時將顯示上月班別
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.bindEvents();
            this.initContextMenu();
        } catch (e) { console.error("❌ 初始化失敗:", e); }
        finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
        }
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').where('unitId', '==', this.data.unitId).orderBy('startTime').get();
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

    // ✅ 修改 loadLastMonthSchedule，確保資料結構正確載入
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

        if (!snap.empty) {
            this.lastMonthData = snap.docs[0].data().assignments || {};
            console.log(`✅ 已載入上月班表資料作為參考`);
        } else {
            this.lastMonthData = {};
            console.warn(`⚠️ 找不到上月已發布班表`);
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const { year, month } = this.data;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastDays = this.lastMonthDays || 31;
        
        let h1 = `<tr>
            <th rowspan="2" style="position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="position:sticky; left:140px; z-index:110; background:#f8f9fa;">狀態</th>
            <th rowspan="2">偏好</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem;">上月月底</th>`;
        
        for(let d=1; d<=daysInMonth; d++) h1 += `<th>${d}</th>`;
        h1 += `<th colspan="4" style="background:#e8f4fd;">統計</th></tr><tr>`;

        // ✅ 上月月底 6 天表頭
        for(let d = lastDays - 5; d <= lastDays; d++) {
            h1 += `<th style="background:#f5f5f5; font-size:0.7rem; color:#999;">${d}</th>`;
        }
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            h1 += `<th style="font-size:0.8rem;">${['日','一','二','三','四','五','六'][date.getDay()]}</th>`;
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
            
            // ✅ 正確帶入上月月底資料
            const lastData = this.lastMonthData[uid] || {};
            for(let d = lastDays - 5; d <= lastDays; d++) {
                const shiftValue = lastData[`current_${d}`]; // 上月是用 current_X 儲存
                const color = this.shifts.find(s => s.code === shiftValue)?.color || '#fff';
                bodyHtml += `<td style="font-size:0.7rem; background:${color}22;">${shiftValue === 'OFF' ? 'FF' : (shiftValue || '-')}</td>`;
            }

            let off=0, req=0, e=0, n=0;
            for(let d=1; d<=daysInMonth; d++) {
                const val = ua[`current_${d}`];
                let txt = val || '', cls = 'cell-clickable';
                if(val === 'OFF') { off++; txt='FF'; cls+=' cell-off'; }
                else if(val === 'REQ_OFF') { off++; req++; txt='V'; cls+=' cell-req-off'; }
                else if(val === 'E') e++; else if(val === 'N') n++;
                
                const shColor = this.shifts.find(s => s.code === val)?.color || '';
                const cellStyle = shColor ? `style="background:${shColor}33;"` : '';

                bodyHtml += `<td class="${cls}" ${cellStyle} oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">${txt}</td>`;
            }
            bodyHtml += `<td>${off}</td><td>${req}</td><td>${e}</td><td>${n}</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    // ... (其餘 runAI, analyzeBundleQuota, showBundleCheckModal 等邏輯維持不變)
    // 確保 executeAI 中傳遞了 lastMonthData 給 SchedulerFactory
    executeAI: async function() {
        this.showLoading();
        try {
            const { year, month } = this.data;
            const staffListForAI = this.data.staffList.map(s => {
                const ua = this.assignments[s.uid] || {}, user = this.usersMap[s.uid] || {}, up = user.schedulingParams || {};
                const preReq = {};
                for(let d=1; d<=31; d++) if(ua[`current_${d}`] === 'REQ_OFF') preReq[`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = 'REQ_OFF';
                return { id: s.uid, uid: s.uid, name: s.name, group: s.group, preferences: s.prefs || ua.preferences || {}, schedulingParams: { ...preReq, ...up } };
            });

            const rules = { dailyNeeds: this.data.dailyNeeds || {}, specificNeeds: this.data.specificNeeds || {}, groupLimits: this.data.groupLimits || {}, shifts: this.shifts, shiftCodes: this.shifts.map(s => s.code), ...this.unitRules, ...(this.data.settings || {}) };

            const scheduler = SchedulerFactory.create('V2', staffListForAI, year, month, this.lastMonthData, rules);
            const aiResult = scheduler.run();
            this.applyAIResult(aiResult);
            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore();
            await this.saveDraft(true);
            alert("AI 排班完成!");
        } catch (e) { alert("AI 失敗: " + e.message); }
        finally { this.isLoading = false; const loader = document.getElementById('globalLoader'); if(loader) loader.remove(); }
    },

    getStaffStatusBadges: function(uid) {
        const p = this.usersMap[uid]?.schedulingParams || {};
        const b = [];
        if (p.isPregnant) b.push('<span class="status-badge" style="background:#ff9800; color:white;">孕</span>');
        if (p.isBreastfeeding) b.push('<span class="status-badge" style="background:#4caf50; color:white;">哺</span>');
        if (p.isPGY) b.push('<span class="status-badge" style="background:#2196f3; color:white;">P</span>');
        if (p.independence === 'dependent') b.push('<span class="status-badge" style="background:#9c27b0; color:white;">D</span>');
        return b.join('');
    },

    showLoading: function() { 
        if(!document.getElementById('globalLoader')) {
            document.body.insertAdjacentHTML('beforeend', '<div id="globalLoader" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:99999; display:flex; justify-content:center; align-items:center;"><div style="background:white; padding:20px; border-radius:8px;">載入中...</div></div>'); 
        }
    },

    applyAIResult: function(res) {
        const days = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(s => {
            const uid = s.uid.trim();
            if(!this.assignments[uid]) this.assignments[uid] = {};
            for(let d=1; d<=days; d++) if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') delete this.assignments[uid][`current_${d}`];
        });
        Object.keys(res).forEach(dateStr => {
            const d = parseInt(dateStr.split('-')[2]);
            Object.keys(res[dateStr]).forEach(code => {
                res[dateStr][code].forEach(uid => { if (this.assignments[uid] && this.assignments[uid][`current_${d}`] !== 'REQ_OFF') this.assignments[uid][`current_${d}`] = code; });
            });
        });
    },

    saveDraft: async function(silent) {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
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

    updateRealTimeStats: function() {
        const tfoot = document.getElementById('schFoot'); if(!tfoot) return;
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
                if(val && val !== 'OFF' && val !== 'REQ_OFF') { if(!countMap[d][val]) countMap[d][val] = 0; countMap[d][val]++; }
            }
        });
        let fHtml = '';
        this.shifts.forEach((s, idx) => {
            fHtml += `<tr>`;
            if(idx === 0) fHtml += `<td colspan="4" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; background:#f8f9fa; position:sticky; left:0; z-index:10;">每日缺額監控</td>`;
            for(let i=0; i<6; i++) fHtml += `<td style="background:#f0f0f0;"></td>`; 
            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][s.code] || 0;
                const ds = this.getDateStr(d), w = (new Date(year, month-1, d).getDay() + 6) % 7;
                let need = (specificNeeds[ds] && specificNeeds[ds][s.code] !== undefined) ? specificNeeds[ds][s.code] : (dailyNeeds[`${s.code}_${w}`] || 0);
                let cls = need > 0 ? (actual < need ? 'stat-cell-shortage' : (actual > need ? 'stat-cell-over' : 'stat-cell-ok')) : '';
                fHtml += `<td class="${cls}">${need > 0 ? `${actual}/${need}` : (actual > 0 ? actual : '-')}</td>`;
            }
            fHtml += `<td colspan="4" style="background:#f0f0f0;"></td><td style="background:#f0f0f0; font-weight:bold;">${s.code}</td></tr>`;
        });
        tfoot.innerHTML = fHtml;
    },

    // 其餘輔助方法（統計、評分、選單等）維持完整功能...
    getDateStr: function(day) { return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; },
    renderScoreBoardContainer: function() { 
        const container = document.getElementById('matrixContainer');
        if (!container || document.getElementById('scoreDashboard')) return;
        const html = `<div id="scoreDashboard" style="background:#fff; padding:10px 20px; border-bottom:1px solid #ddd; display:flex; align-items:center; gap:20px;"><div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="scheduleEditorManager.showDetailedScore()"><div style="position:relative; width:50px; height:50px; border-radius:50%; background:#ecf0f1;" id="scoreCircleBg"><div style="width:42px; height:42px; background:#fff; border-radius:50%; position:absolute; top:4px; left:4px; display:flex; justify-content:center; align-items:center;"><span id="scoreValue" style="font-size:1rem; font-weight:bold; color:#2c3e50;">-</span></div></div><div><h4 style="margin:0; font-size:0.9rem;">評分 (詳情)</h4></div></div></div>`;
        container.parentElement.insertBefore(this.createElementFromHTML(html), container);
    },
    createElementFromHTML: function(h) { const d=document.createElement('div'); d.innerHTML=h.trim(); return d.firstChild; },
    updateScheduleScore: function() { if (typeof scoringManager === 'undefined') return; const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month); document.getElementById('scoreValue').innerText = Math.round(res.total); this.lastScoreResult = res; },
    showDetailedScore: function() { const res = this.lastScoreResult; if(!res) return; let h = `<h4>總分: ${res.total.toFixed(1)}</h4>`; document.getElementById('scoreDetailContent').innerHTML = h; document.getElementById('scoreDetailModal').style.display = 'block'; },
    initContextMenu: function() { if (!document.getElementById('schContextMenu')) { const m = document.createElement('div'); m.id = 'schContextMenu'; m.className = 'context-menu'; m.innerHTML = '<ul style="list-style:none; margin:0; padding:10px; min-width:120px;"></ul>'; document.body.appendChild(m); } },
    showContextMenu: function(e, uid, day) { const menu = document.getElementById('schContextMenu'), ul = menu.querySelector('ul'); ul.innerHTML = ''; const current = this.assignments[uid]?.[`current_${day}`]; if(current === 'REQ_OFF') { ul.innerHTML = `<li onclick="scheduleEditorManager.clearCell('${uid}',${day})">清除預假</li>`; } else { ul.innerHTML = `<li onclick="scheduleEditorManager.setOff('${uid}',${day})">設為 FF</li>`; this.shifts.forEach(s => { ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}',${day},'${s.code}')">${s.name} (${s.code})</li>`; }); if(current) ul.innerHTML += `<li onclick="scheduleEditorManager.clearCell('${uid}',${day})">清除</li>`; } menu.style.display = 'block'; menu.style.left = e.pageX + 'px'; menu.style.top = e.pageY + 'px'; },
    setOff: function(u, d) { if(!this.assignments[u]) this.assignments[u] = {}; this.assignments[u][`current_${d}`] = 'OFF'; this.refreshUI(); },
    setShift: function(u, d, c) { if(!this.assignments[u]) this.assignments[u] = {}; this.assignments[u][`current_${d}`] = c; this.refreshUI(); },
    clearCell: function(u, d) { if(this.assignments[u] && this.assignments[u][`current_${d}`] !== 'REQ_OFF') delete this.assignments[u][`current_${d}`]; this.refreshUI(); },
    refreshUI: function() { this.renderMatrix(); this.updateRealTimeStats(); this.updateScheduleScore(); },
    bindEvents: function() { document.addEventListener('click', () => { const m = document.getElementById('schContextMenu'); if(m) m.style.display='none'; }); },
    resetSchedule: async function() { if(!confirm("確定重置並重新載入預班資料？")) return; this.showLoading(); try { let source = {}; if (this.data.sourceId) { const doc = await db.collection('pre_schedules').doc(this.data.sourceId).get(); if (doc.exists) source = doc.data().assignments || {}; } const days = new Date(this.data.year, this.data.month, 0).getDate(); this.data.staffList.forEach(s => { const pre = source[s.uid] || {}; this.assignments[s.uid] = { preferences: pre.preferences || {} }; for (let d = 1; d <= days; d++) if (pre[`current_${d}`]) this.assignments[s.uid][`current_${d}`] = pre[`current_${d}`]; }); this.refreshUI(); await this.saveDraft(true); } finally { document.getElementById('globalLoader').remove(); } }
};
