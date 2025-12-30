// js/modules/schedule_editor_manager.js
const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {}, 
    assignments: {},
    tempOptions: [], 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) return;
        
        await this.loadContext();
        await scheduleManager.loadContext(id, 'schedules'); 

        this.renderMatrix();
        this.updateRealTimeStats();
        this.setupEvents();
    },

    loadContext: async function() {
        try {
            const doc = await db.collection('schedules').doc(this.scheduleId).get();
            if (!doc.exists) throw new Error("班表不存在");
            this.data = doc.data();
            this.assignments = this.data.assignments || {};

            const shiftsSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            this.updateStatusUI();
            
        } catch(e) { console.error(e); alert("載入失敗: " + e.message); }
    },

    updateStatusUI: function() {
        const st = this.data.status;
        const badge = document.getElementById('schStatus');
        const btnPublish = document.getElementById('btnPublish');
        const btnSave = document.getElementById('btnSave');
        const btnAI = document.getElementById('btnAI');
        const btnReset = document.getElementById('btnReset'); 

        if(badge) {
            badge.textContent = st === 'published' ? '已發布' : '草稿';
            badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;
        }
        const isLocked = (st === 'published');
        if(btnSave) btnSave.disabled = isLocked;
        if(btnAI) btnAI.disabled = isLocked;
        if(btnReset) btnReset.disabled = isLocked;
        if(btnPublish) {
            btnPublish.textContent = isLocked ? '撤回發布' : '發布班表';
            btnPublish.className = isLocked ? 'btn btn-secondary' : 'btn btn-success';
            btnPublish.onclick = () => this.togglePublish();
        }
    },

    resetSchedule: async function() {
        const newAssignments = await scheduleManager.resetToSource();
        if (newAssignments) {
            this.assignments = newAssignments;
            this.renderMatrix();
            this.updateRealTimeStats();
            this.saveDraft(true);
        }
    },

    togglePublish: async function() {
        const isPublished = (this.data.status === 'published');
        const action = isPublished ? '撤回' : '發布';
        if(!confirm(`確定要${action}此班表嗎？`)) return;
        try {
            const newStatus = isPublished ? 'draft' : 'published';
            await db.collection('schedules').doc(this.scheduleId).update({
                status: newStatus, assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = newStatus; this.updateStatusUI(); alert(`已${action}！`);
        } catch(e) { alert("操作失敗: " + e.message); }
    },

    runAI: async function() {
        if(!confirm("系統將運算 4 種排班方案供您選擇。\n這可能需要幾秒鐘，確定執行？")) return;
        
        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        modal.classList.add('show');
        container.innerHTML = '<div style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI 正在平行運算多重宇宙...</div>';

        setTimeout(async () => {
            try {
                const allStaff = this._prepareStaffDataForAI();
                const lastMonthData = this._prepareLastMonthData();
                const rules = this.data.rules || {};
                if (this.data.dailyNeeds) rules.dailyNeeds = this.data.dailyNeeds;

                const runner = new ScheduleBatchRunner(allStaff, this.data.year, this.data.month, lastMonthData, rules);
                this.tempOptions = runner.runAll();
                
                this.renderAiOptions();

            } catch(e) { 
                console.error(e);
                container.innerHTML = `<div style="color:red; padding:20px;">運算失敗: ${e.message}</div>`; 
            }
        }, 100);
    },

    _prepareStaffDataForAI: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        return this.data.staffList.map(u => {
            const uid = u.uid;
            const assign = this.assignments[uid] || {};
            const pref = assign.preferences || {};
            const params = u.schedulingParams || {};

            let pkgType = null;
            if (pref.bundleShift && pref.bundleShift !== '') pkgType = pref.bundleShift; 
            else if (params.canBundleShifts && params.bundleShift) pkgType = params.bundleShift;
            
            if (pkgType) console.log(`[AI Data] ${u.name} 識別為包班: ${pkgType}`);

            const aiPrefs = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const currentVal = assign[`current_${d}`];
                
                if (currentVal === 'REQ_OFF' || (currentVal && currentVal.startsWith('!'))) {
                    aiPrefs[dateStr] = 'REQ_OFF'; 
                } else if (pref.priority_1) {
                     if(!aiPrefs[dateStr]) aiPrefs[dateStr] = {};
                     aiPrefs[dateStr] = { 1: pref.priority_1 };
                }
            }

            return {
                id: uid,
                name: u.name,
                packageType: pkgType,
                prefs: aiPrefs,
                isPregnant: params.isPregnant
            };
        });
    },

    _prepareLastMonthData: function() {
        const result = {};
        for (const [uid, stat] of Object.entries(scheduleManager.stats)) {
            result[uid] = {
                lastShiftCode: stat.lastShiftCode || 'OFF',
                consecutiveDays: stat.consecutiveDays || 0
            };
        }
        return result;
    },

    renderAiOptions: function() {
        const c = document.getElementById('aiOptionsContainer'); 
        c.innerHTML = '';
        if (this.tempOptions.length === 0) { c.innerHTML = '無結果'; return; }

        this.tempOptions.forEach((o, i) => {
            const isError = !!o.error;
            const gap = o.metrics.gapCount;
            const gapClass = gap === 0 ? 'text-success' : 'text-danger';
            const isRec = o.info.code === 'V3';

            c.innerHTML += `
                <div class="ai-option-card" style="${isRec ? 'border:2px solid #3498db; background:#f0f9ff;' : ''}">
                    <div style="font-weight:bold; font-size:1.1rem; display:flex; justify-content:space-between;">
                        <span>${o.info.name}</span>
                        ${isRec ? '<span class="badge bg-primary">推薦</span>' : ''}
                    </div>
                    ${isError 
                        ? `<p style="color:red;">失敗: ${o.error}</p>` 
                        : `<div style="margin:10px 0; font-size:0.9rem;">
                             人力缺口: <span style="font-weight:bold; ${gap === 0 ? 'color:green' : 'color:red'}">${gap}</span>
                           </div>`
                    }
                    <div style="text-align:right; margin-top:10px;">
                        <button class="btn btn-sm btn-info" onclick="scheduleEditorManager.previewOption(${i})" ${isError?'disabled':''}>預覽</button>
                        <button class="btn btn-sm btn-primary" onclick="scheduleEditorManager.applyAiOption(${i})" ${isError?'disabled':''}>採用</button>
                    </div>
                </div>
            `;
        });
    },

    previewOption: function(i) {
        const opt = this.tempOptions[i];
        if(!opt || opt.error) return;
        
        // 僅更新畫面，不影響 assignments 存檔
        const originalAssignments = JSON.parse(JSON.stringify(this.assignments));
        this.applyToLocalData(opt.schedule);
        this.renderMatrix(); 
        this.updateRealTimeStats();
        
        // 還原資料以防誤存 (或者標記目前為預覽狀態)
        this.assignments = originalAssignments; 
        document.getElementById('schTitle').innerHTML = `${this.data.year}/${this.data.month} - <span style="color:blue">預覽：${opt.info.name}</span>`;
    },

    applyToLocalData: function(scheduleData) {
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        Object.keys(this.assignments).forEach(uid => {
            for(let d=1; d<=dim; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') 
                    delete this.assignments[uid][`current_${d}`];
            }
        });
        
        Object.entries(scheduleData).forEach(([dateStr, shifts]) => {
            const day = parseInt(dateStr.split('-')[2]);
            ['N','E','D'].forEach(code => {
                if(shifts[code]) shifts[code].forEach(uid => {
                    if(!this.assignments[uid]) this.assignments[uid]={};
                    if(this.assignments[uid][`current_${day}`]!=='REQ_OFF')
                        this.assignments[uid][`current_${day}`] = code;
                });
            });
        });
    },

    applyAiOption: function(i) {
        if(this.tempOptions[i]) {
            this.applyToLocalData(this.tempOptions[i].schedule);
            document.getElementById('aiResultModal').classList.remove('show');
            this.renderMatrix(); 
            this.updateRealTimeStats();
            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            alert(`已套用策略：${this.tempOptions[i].info.name}`);
        }
    },

    // 其他原有函式保持不變...
    renderMatrix: function() { 
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();

        let h1 = `<tr><th rowspan="2" class="sticky-col name-col">姓名</th><th rowspan="2" class="sticky-col attr-col">註</th><th colspan="6" class="header-last">上月</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            const c = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${c}">${d}</th>`;
        }
        h1 += `<th colspan="4">統計</th></tr>`;
        
        let h2 = `<tr>`;
        for(let i=5; i>=0; i--) h2 += `<th class="cell-last-month cell-narrow">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) h2 += `<th></th>`;
        h2 += `<th>O</th><th>假</th><th>N</th><th>E</th></tr>`;
        thead.innerHTML = h1 + h2;

        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            const assign = this.assignments[u.uid] || {};
            const params = u.schedulingParams || {};
            let icons = '';
            if(params.canBundleShifts) icons+='<span style="color:blue;">包</span>';
            
            bodyHtml += `<tr data-uid="${u.uid}">
                <td class="sticky-col name-col">${u.name}</td>
                <td class="sticky-col attr-col">${icons}</td>`;
            
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                bodyHtml += `<td class="cell-last-month">${assign[`last_${d}`]||''}</td>`;
            }
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                let disp = val || '';
                let style = '';
                if(val === 'REQ_OFF') { disp='休'; style='color:green;font-weight:bold;'; }
                else if(val === 'N') style='color:red;font-weight:bold;';
                else if(val === 'E') style='color:orange;font-weight:bold;';
                else if(val === 'D') style='color:black;font-weight:bold;';
                
                bodyHtml += `<td class="cell-clickable" style="${style}" onclick="scheduleEditorManager.handleCellClick('${u.uid}',${d})" oncontextmenu="scheduleEditorManager.handleRightClick(event,'${u.uid}',${d})">${disp}</td>`;
            }
            bodyHtml += `<td id="stat_off_${u.uid}">0</td><td id="stat_hol_${u.uid}">0</td><td id="stat_n_${u.uid}">0</td><td id="stat_e_${u.uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
        this.renderFooter(daysInMonth);
    },
    renderFooter: function(dim) { 
        const tfoot = document.getElementById('schFoot');
        let html = '<tr><td colspan="8" style="text-align:right">缺口:</td>';
        const dailyNeeds = this.data.dailyNeeds || {};
        for(let d=1; d<=dim; d++) {
             const date = new Date(this.data.year, this.data.month-1, d);
             const dayIdx = date.getDay()===0?6:date.getDay()-1;
             let txt = [];
             this.shifts.forEach(s => {
                 const need = dailyNeeds[`${s.code}_${dayIdx}`] || 0;
                 let have = 0;
                 Object.values(this.assignments).forEach(a => { if(a[`current_${d}`]===s.code) have++; });
                 if(need>have) txt.push(`${s.code}:${need-have}`);
             });
             const style = txt.length>0 ? 'background:#ffebee;color:red;font-size:0.7em;' : '';
             html += `<td style="${style}">${txt.join('<br>')}</td>`;
        }
        html += '<td colspan="4"></td></tr>';
        tfoot.innerHTML = html;
    },
    updateRealTimeStats: function() { 
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(u => {
            let off=0, n=0, e=0, hol=0;
            for(let d=1; d<=dim; d++) {
                const v = this.assignments[u.uid]?.[`current_${d}`];
                if(v==='OFF'||!v) off++;
                else if(v==='REQ_OFF') { off++; hol++; }
                else if(v==='N') n++;
                else if(v==='E') e++;
            }
            const set=(k,v)=> { const el=document.getElementById(k); if(el) el.textContent=v; };
            set(`stat_off_${u.uid}`, off); set(`stat_hol_${u.uid}`, hol);
            set(`stat_n_${u.uid}`, n); set(`stat_e_${u.uid}`, e);
        });
    },
    setupEvents: function() { 
        document.addEventListener('click', e => {
            const m = document.getElementById('schContextMenu');
            if(m && !m.contains(e.target)) m.style.display='none';
        });
    },
    handleCellClick: function(uid, d) { },
    handleRightClick: function(e, uid, d) { 
        e.preventDefault(); 
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu'); 
        if(menu) { menu.style.display='block'; menu.style.left=e.pageX+'px'; menu.style.top=e.pageY+'px'; }
    },
    setShift: function(code) { 
        if(this.targetCell) {
            const {uid, d} = this.targetCell;
            if(!this.assignments[uid]) this.assignments[uid] = {};
            if(code===null) delete this.assignments[uid][`current_${d}`];
            else this.assignments[uid][`current_${d}`] = code;
            this.renderMatrix(); this.updateRealTimeStats();
            document.getElementById('schContextMenu').style.display='none';
        }
    }
};
