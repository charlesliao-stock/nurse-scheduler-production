// js/modules/schedule_editor_manager.js

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
    
    lastAIRunTime: 0,
    aiRunCooldown: 3000,

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
            
            if (this.data.lastMonthData && Object.keys(this.data.lastMonthData).length > 0) {
                this.lastMonthData = this.data.lastMonthData;
                
                const sampleUid = Object.keys(this.lastMonthData)[0];
                if (sampleUid) {
                    const dayKeys = Object.keys(this.lastMonthData[sampleUid])
                        .filter(k => k.startsWith('last_'));
                    if (dayKeys.length > 0) {
                        const days = dayKeys.map(k => parseInt(k.replace('last_', '')));
                        this.lastMonthDays = Math.max(...days);
                    }
                }
                
                console.log(`✅ 使用預班傳入的上月資料 (${Object.keys(this.lastMonthData).length} 位人員, 上月有 ${this.lastMonthDays} 天)`);
            } else {
                console.log('⚠️ 預班未提供上月資料');
            }
            
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules()
            ]);
            
            if (!this.lastMonthData || Object.keys(this.lastMonthData).length === 0) {
                console.log('⚠️ 無預班資料，嘗試載入上月已發布班表');
                await this.loadLastMonthSchedule();
            }
            
            this.data.staffList.forEach(s => { if (s.uid) this.staffMap[s.uid.trim()] = s; });

            if ((!this.data.assignments || Object.keys(this.data.assignments).length === 0) && this.data.sourceId) {
                console.log("🚀 初次轉入：自動從預班表導入初始資料");
                await this.importFromPreSchedule();
            } else {
                this.assignments = this.data.assignments || {};
            }
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
            }

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.bindEvents();
            this.initContextMenu();
            this.addCellStyles();
        } catch (e) { 
            console.error("❌ 初始化失敗:", e); 
        } finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
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

    importFromPreSchedule: async function() {
        try {
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if (!preDoc.exists) return;
            const preData = preDoc.data();
            const sourceAssign = preData.assignments || {};
            const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
            
            console.log('🔍 開始從預班表導入資料...');
            
            this.assignments = {};
            let totalPreScheduleDays = 0;
            
            this.data.staffList.forEach(s => {
                const uid = s.uid.trim();
                const pre = sourceAssign[uid] || {};
                
                this.assignments[uid] = { 
                    preferences: pre.preferences || {} 
                };
                
                let staffPreDays = 0;
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    if (pre[key]) {
                        this.assignments[uid][key] = pre[key];
                        if (pre[key] !== 'OFF') {
                            staffPreDays++;
                            totalPreScheduleDays++;
                            console.log(`  📋 導入預班: ${s.name} 第${d}日 = ${pre[key]}`);
                        }
                    }
                }
                
                if (staffPreDays > 0) {
                    console.log(`  ✅ ${s.name}: ${staffPreDays} 天預班`);
                }
            });
            
            console.log(`✅ 已從預班表導入 ${Object.keys(this.assignments).length} 位人員資料，共 ${totalPreScheduleDays} 天預班`);
            
            await db.collection('schedules').doc(this.scheduleId).update({ 
                assignments: this.assignments 
            });
        } catch (e) { 
            console.error("導入失敗:", e); 
        }
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
            .limit(1).get();
        
        if (!snap.empty) {
            const lastData = snap.docs[0].data();
            const lastAssignments = lastData.assignments || {};
            
            this.lastMonthData = {};
            Object.keys(lastAssignments).forEach(uid => {
                const ua = lastAssignments[uid];
                this.lastMonthData[uid] = {
                    lastShift: ua[`current_${this.lastMonthDays}`] || 'OFF'
                };
                
                for (let i = 0; i < 6; i++) {
                    const d = this.lastMonthDays - i;
                    this.lastMonthData[uid][`last_${d}`] = ua[`current_${d}`] || 'OFF';
                }
            });
            
            console.log(`📅 已從已發布班表載入上月資料 (${ly}/${lm})`);
        } else {
            this.lastMonthData = {};
            console.log(`📅 找不到上月已發布班表 (${ly}/${lm})`);
        }
    },

    renderToolbar: function() {
        const right = document.getElementById('toolbarRight');
        if(!right) return;
        document.getElementById('schTitle').innerText = `${this.data.year}/${this.data.month} 排班`;
        const badge = document.getElementById('schStatus');
        const isPublished = this.data.status === 'published';
        badge.innerText = isPublished ? '已發布' : '草稿';
        badge.style.background = isPublished ? '#2ecc71' : '#f39c12';
        
        right.innerHTML = !isPublished 
            ? `<button class="btn btn-primary" onclick="scheduleEditorManager.runAI()"><i class="fas fa-magic"></i> AI 自動排班</button>
               <button class="btn" style="background:#95a5a6;" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>
               <button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-check"></i> 確認發布</button>`
            : `<button class="btn" style="background:#e67e22;" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-times"></i> 取消發布</button>`;
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead'), 
              tbody = document.getElementById('schBody'), 
              tfoot = document.getElementById('schFoot');
        const { year, month } = this.data, 
              days = new Date(year, month, 0).getDate(), 
              lastD = this.lastMonthDays || 31;
        
        let h = `<tr>
            <th rowspan="2" style="border:1px solid #bbb;">職編</th>
            <th rowspan="2" style="border:1px solid #bbb;">姓名</th>
            <th rowspan="2" style="border:1px solid #bbb;">狀態</th>
            <th rowspan="2" style="border:1px solid #bbb;">偏好</th>
            <th colspan="6" style="background:#eee; border:1px solid #bbb;">上月月底</th>`;
        for(let d=1; d<=days; d++) h += `<th style="border:1px solid #bbb;">${d}</th>`;
        h += `<th colspan="4" style="border:1px solid #bbb;">統計</th></tr><tr>`;
        
        for(let d=lastD-5; d<=lastD; d++) {
            h += `<th style="background:#f5f5f5; color:#999; font-size:0.7rem; border:1px solid #bbb;">${d}</th>`;
        }
        for(let d=1; d<=days; d++) {
            h += `<th style="font-size:0.8rem; border:1px solid #bbb;">${['日','一','二','三','四','五','六'][new Date(year, month-1, d).getDay()]}</th>`;
        }
        h += `<th style="border:1px solid #bbb;">總OFF</th><th style="border:1px solid #bbb;">假OFF</th><th style="border:1px solid #bbb;">E</th><th style="border:1px solid #bbb;">N</th></tr>`;
        thead.innerHTML = h;

        let bHtml = '';
        this.data.staffList.forEach(s => {
            const uid = s.uid, 
                  ua = this.assignments[uid] || {}, 
                  user = this.usersMap[uid] || {};
            const badges = this.getStaffStatusBadges(uid);
            
            const prefs = ua.preferences || {};
            let prefDisplay = '';
            
            if (prefs.bundleShift) {
                prefDisplay += `<div style="font-weight:bold; font-size:0.85rem; color:#e67e22;">包${prefs.bundleShift}</div>`;
            }
            
            let favs = [];
            if (prefs.favShift) favs.push(prefs.favShift);
            if (prefs.favShift2) favs.push(prefs.favShift2);
            if (prefs.favShift3) favs.push(prefs.favShift3);
            if (favs.length > 0) {
                prefDisplay += `<div style="font-size:0.75rem; color:#666; margin-top:2px;">${favs.join(' → ')}</div>`;
            }
            
            if (!prefDisplay) {
                prefDisplay = '<span style="color:#ccc;">-</span>';
            }
            
            bHtml += `<tr>
                <td style="border:1px solid #bbb;">${user.employeeId||''}</td>
                <td style="border:1px solid #bbb;">${s.name}${s.isSupport ? '<br><span style="color:#27ae60; font-size:0.7rem;">(支援)</span>' : ''}</td>
                <td style="text-align:center; border:1px solid #bbb;">${badges || '<span style="color:#ccc;">-</span>'}</td>
                <td style="text-align:center; line-height:1.3; padding:4px 2px; border:1px solid #bbb;">${prefDisplay}</td>`;
            
            const lm = this.lastMonthData[uid] || {};
            for(let d=lastD-5; d<=lastD; d++) {
                const v = lm[`last_${d}`];
                bHtml += `<td style="font-size:0.7rem; background:#f9f9f9; color:#999; text-align:center; border:1px solid #bbb;">${v==='OFF'?'FF':(v||'-')}</td>`;
            }
            
            let off=0, req=0, e=0, n=0;
            for(let d=1; d<=days; d++) {
                const v = ua[`current_${d}`];
                let txt = v || '', cls = 'cell-clickable';
                let cellStyle = 'border:1px solid #bbb;';

                if(v === 'OFF') { 
                    off++; 
                    txt = 'FF'; 
                    cls += ' cell-off';
                    cellStyle += 'background:#fff;';
                } else if(v === 'REQ_OFF') { 
                    off++; 
                    req++; 
                    txt = 'FF'; 
                    cls += ' cell-req-off';
                    cellStyle += 'background:#fff3cd; color:#856404; font-weight:bold;';
                } else {
                    const shift = this.shifts.find(sh => sh.code === v);
                    if(shift && shift.color) {
                        cellStyle += `color: ${shift.color}; font-weight: bold;`;
                    }
                    if(v === 'E') e++;
                    else if(v === 'N') n++;
                }
                
                bHtml += `<td class="${cls}" style="${cellStyle}" oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">${txt}</td>`;
            }
            
            bHtml += `<td style="text-align:center; border:1px solid #bbb;">${off}</td>
                      <td style="text-align:center; color:red; border:1px solid #bbb;">${req}</td>
                      <td style="text-align:center; border:1px solid #bbb;">${e}</td>
                      <td style="text-align:center; border:1px solid #bbb;">${n}</td>`;
            bHtml += `</tr>`;
        });
        tbody.innerHTML = bHtml;

        if (tfoot) {
            let footHtml = '';
            this.shifts.forEach((s, idx) => {
                footHtml += `<tr>`;
                if(idx === 0) {
                    footHtml += `<td colspan="10" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle; background:#f8f9fa; border:1px solid #bbb;">每日人力<br>監控</td>`;
                }
                
                for(let d=1; d<=days; d++) {
                    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    const jsDay = new Date(year, month-1, d).getDay(); 
                    const dayIdx = (jsDay === 0) ? 6 : jsDay - 1; 
                    
                    let need = 0;
                    let isTemp = false;
                    
                    if (this.data.specificNeeds && this.data.specificNeeds[dateStr] && this.data.specificNeeds[dateStr][s.code] !== undefined) {
                        need = this.data.specificNeeds[dateStr][s.code];
                        isTemp = true;
                    } else if (this.data.dailyNeeds) {
                        need = this.data.dailyNeeds[`${s.code}_${dayIdx}`] || 0;
                    }

                    const style = isTemp ? 'background:#fff3cd; border:1px solid #f39c12;' : 'border:1px solid #bbb;';
                    footHtml += `<td id="stat_cell_${s.code}_${d}" style="text-align:center; font-size:0.8rem; ${style}">
                                    <span class="stat-actual">-</span>/<span class="stat-need" style="font-weight:bold;">${need}</span>
                                 </td>`;
                }
                footHtml += `<td colspan="4" style="background:#f0f0f0; border:1px solid #bbb;"></td>`;
                footHtml += `</tr>`;
            });
            tfoot.innerHTML = footHtml;
            
            setTimeout(() => this.updateRealTimeStats(), 0);
        }
    },

    loadShifts: async function() { 
        const shifts = await DataLoader.loadShifts(this.data.unitId);
        this.shifts = shifts.filter(s => s.isScheduleAvailable !== false);
        console.log(`✅ 排班編輯器載入 ${this.shifts.length} 個可用班別:`, this.shifts.map(s => s.code));
    },
    
    loadUsers: async function() { 
        // 改為按單位載入使用者，提升效能
        const usersMap = await DataLoader.loadUsersMap(this.data.unitId);
        this.usersMap = usersMap || {};
    },
    
    loadUnitRules: async function() { 
        const rules = await DataLoader.loadSchedulingRules(this.data.unitId);
        this.unitRules = rules || {}; 
    },
    
    getStaffStatusBadges: function(uid) { 
        const p = this.usersMap[uid]?.schedulingParams || {}; 
        const b = []; 
        if (p.isPregnant) b.push('<span class="status-badge" style="background:#ff9800;">孕</span>'); 
        if (p.isBreastfeeding) b.push('<span class="status-badge" style="background:#4caf50;">哺</span>'); 
        if (p.isPGY) b.push('<span class="status-badge" style="background:#2196f3;">P</span>'); 
        if (p.independence === 'dependent') b.push('<span class="status-badge" style="background:#9c27b0;">D</span>'); 
        return b.join(''); 
    },
    
    showLoading: function() { 
        if(!document.getElementById('globalLoader')) {
            document.body.insertAdjacentHTML('beforeend', '<div id="globalLoader" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:99999; display:flex; justify-content:center; align-items:center;"><div style="background:white; padding:20px; border-radius:8px;">載入中...</div></div>');
        }
    },
    
    updateRealTimeStats: function() { 
        const { year, month } = this.data;
        const days = new Date(year, month, 0).getDate();
        const counts = {};

        for(let d=1; d<=days; d++) {
            counts[d] = {};
            this.shifts.forEach(s => counts[d][s.code] = 0);
        }

        Object.values(this.assignments).forEach(ua => {
            for(let d=1; d<=days; d++) {
                const v = ua[`current_${d}`];
                if(v && v !== 'OFF' && v !== 'REQ_OFF' && counts[d][v] !== undefined) {
                    counts[d][v]++;
                }
            }
        });

        for(let d=1; d<=days; d++) {
            this.shifts.forEach(s => {
                const cell = document.getElementById(`stat_cell_${s.code}_${d}`);
                if(cell) {
                    const actualSpan = cell.querySelector('.stat-actual');
                    const needSpan = cell.querySelector('.stat-need');
                    const actual = counts[d][s.code];
                    const need = parseInt(needSpan.innerText) || 0;
                    
                    if(actualSpan) actualSpan.innerText = actual;
                    
                    if(actual < need) {
                        cell.style.color = 'red';
                        cell.style.fontWeight = 'bold';
                    } else {
                        cell.style.color = '';
                        cell.style.fontWeight = '';
                    }
                }
            });
        }
    },
    
    renderScoreBoardContainer: function() { 
        const toolbar = document.getElementById('editorToolbar');
        if (!toolbar) return;
        if (document.getElementById('scoreBoard')) return;
        const scoreHtml = `
            <div id="scoreBoard" style="display:flex; align-items:center; gap:10px; background:#f8f9fa; padding:5px 15px; border-radius:20px; border:1px solid #eee; margin-left:15px;">
                <span style="font-size:0.85rem; color:#666;"><i class="fas fa-chart-line"></i> 排班評分</span>
                <b id="scoreValue" style="font-size:1.1rem; color:#2c3e50;">--</b>
                <button class="btn btn-sm" onclick="scheduleEditorManager.showScoreDetail()" style="padding:2px 8px; font-size:0.75rem; background:none; color:#3498db; border:none; text-decoration:underline;">詳情</button>
            </div>
        `;
        const title = document.getElementById('schTitle');
        if (title) title.insertAdjacentHTML('afterend', scoreHtml);
    },

    showScoreDetail: function() {
        if (!this.lastScoreResult) return;
        alert("當前排班總分: " + this.lastScoreResult.total + "\n(詳細評分報告功能開發中)");
    },

    updateScheduleScore: function() { 
        if (typeof scoringManager === 'undefined') return; 
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month); 
        const scoreEl = document.getElementById('scoreValue');
        if (scoreEl) scoreEl.innerText = Math.round(res.total); 
        this.lastScoreResult = res; 
    },

    publishSchedule: async function() {
        if(!confirm("確定要發布此班表嗎？發布後員工將可查看。")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ 
                status: 'published', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("發布成功！");
        } catch(e) { 
            alert("發布失敗: " + e.message); 
        }
    },

    unpublishSchedule: async function() {
        if(!confirm("確定要取消發布嗎？")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ 
                status: 'draft', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("已恢復為草稿狀態。");
        } catch(e) { 
            alert("操作失敗: " + e.message); 
        }
    },

    resetSchedule: async function() {
        if(!confirm("確定要重置班表嗎？這將清除所有手動調整的班別。")) return;
        this.showLoading();
        try {
            await this.importFromPreSchedule();
            this.renderMatrix();
            this.updateScheduleScore();
            alert("班表已重置。");
        } catch(e) { 
            alert("重置失敗: " + e.message); 
        } finally { 
            const l = document.getElementById('globalLoader'); 
            if(l) l.remove(); 
        }
    },

    runAI: async function() {
        const now = Date.now();
        if (now - this.lastAIRunTime < this.aiRunCooldown) {
            const remaining = Math.ceil((this.aiRunCooldown - (now - this.lastAIRunTime)) / 1000);
            alert(`⏰ 請稍候 ${remaining} 秒後再執行 AI 排班\n\n(避免過度消耗 Firebase 配額)`);
            return;
        }
        
        if(!confirm("啟動 AI 自動排班？這將覆蓋目前的排班結果。")) return;
        
        this.lastAIRunTime = now;
        this.showLoading();
        
        console.log('🤖 AI 排班開始執行，時間:', new Date().toLocaleTimeString());
        
        try {
            if(typeof SchedulerFactory === 'undefined') throw new Error("排班引擎未載入");
            
            const staffListWithId = this.data.staffList.map(s => {
                const uid = s.uid || s.id;
                const userAssign = this.assignments[uid] || {};
                
                const combinedParams = {
                    ...(this.usersMap[uid]?.schedulingParams || {}),
                    ...(s.schedulingParams || {})
                };
                
                const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    if (userAssign[key]) {
                        combinedParams[key] = userAssign[key];
                    }
                }
                
                return {
                    ...s,
                    id: uid,
                    schedulingParams: combinedParams,
                    preferences: userAssign.preferences || {}
                };
            });
            
            console.log('🔍 傳入 AI 排班的人員資料範例:');
            if (staffListWithId.length > 0) {
                const sample = staffListWithId[0];
                console.log({
                    name: sample.name,
                    id: sample.id,
                    schedulingParams: sample.schedulingParams,
                    preferences: sample.preferences
                });
                
                const preScheduleDays = Object.keys(sample.schedulingParams || {})
                    .filter(k => k.startsWith('current_') && sample.schedulingParams[k] !== 'OFF')
                    .concat(Object.keys(sample.preferences || {}).filter(k => k.startsWith('current_') && sample.preferences[k] !== 'OFF'));
                
                console.log('包含預班資料的天數:', preScheduleDays.length, preScheduleDays.slice(0, 5));
            }
            
const rules = { 
    ...this.unitRules, 
    shifts: this.shifts,
    dailyNeeds: this.data.dailyNeeds || {},
    specificNeeds: this.data.specificNeeds || {},
    avgOff: this.data.schedulingParams?.avgOff || 9,  // 🔥 加入 avgOff
    daysInMonth: new Date(this.data.year, this.data.month, 0).getDate()  // 🔥 加入天數
};

console.log(`   📊 使用 avgOff: ${rules.avgOff.toFixed(1)} 天`);
            
            const scheduler = SchedulerFactory.create('V3', staffListWithId, this.data.year, this.data.month, this.lastMonthData, rules);
            const result = scheduler.run();
            
            console.log("🤖 AI 排班結果樣本:", result[Object.keys(result)[0]]);
            
            const newAssignments = {};
            this.data.staffList.forEach(s => {
                const uid = s.uid.trim();
                const oldAssign = this.assignments[uid] || {};
                newAssignments[uid] = { preferences: (oldAssign.preferences || {}) };
                
                for(let d=1; d<=new Date(this.data.year, this.data.month, 0).getDate(); d++) {
                    const key = `current_${d}`;
                    const oldValue = oldAssign[key];
                    
                    if (oldValue === 'REQ_OFF') {
                        newAssignments[uid][key] = 'REQ_OFF';
                        console.log(`  🔒 保留預休: ${s.name} 第${d}日 = REQ_OFF`);
                        continue;
                    }
                    
                    const ds = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    let shift = 'OFF';
                    
                    if (result[ds]) {
                        for(let code in result[ds]) {
                            if(result[ds][code].includes(uid)) { 
                                shift = code; 
                                break; 
                            }
                        }
                    }
                    
                    newAssignments[uid][key] = shift;
                }
            });
            
            console.log("📊 轉換後的 assignments 樣本:", Object.keys(newAssignments)[0], newAssignments[Object.keys(newAssignments)[0]]);
            
            this.assignments = newAssignments;
            
            await db.collection('schedules').doc(this.scheduleId).update({ 
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('✅ AI 排班完成，僅寫入 Firebase 1 次');
            
            this.renderMatrix();
            this.updateScheduleScore();
            alert("AI 排班完成！");
            
        } catch(e) { 
            console.error("❌ AI 排班錯誤:", e);
            alert("AI 排班失敗: " + e.message); 
        } finally { 
            const l = document.getElementById('globalLoader'); 
            if(l) l.remove(); 
        }
    },

    initContextMenu: function() {},
    showContextMenu: function(e, u, d) {},
    bindEvents: function() { 
        document.addEventListener('click', () => { 
            const m = document.getElementById('schContextMenu'); 
            if(m) m.style.display='none'; 
        }); 
    }
};
