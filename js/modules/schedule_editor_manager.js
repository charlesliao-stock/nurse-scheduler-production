// js/modules/schedule_editor_manager.js
// 🔥 整合 AI 排班多版本比較 + 評分系統

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
    
    // 拖曳相關
    dragSource: null,
    dragTarget: null,
    isDragging: false,
    
    // 檢查相關
    needsCheck: false,
    lastCheckResult: null,
    violationCells: new Set(),

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
            
            // 🔥 載入評分設定
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
                console.log('✅ 評分系統已載入');
            }

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.bindEvents();
            this.initContextMenu();
            this.addCellStyles();
            this.initDragAndDrop();
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
            .cell-dragging {
                opacity: 0.5;
                cursor: grabbing;
            }
            .cell-drop-target {
                background: #e3f2fd !important;
                border: 2px dashed #2196f3 !important;
            }
            .cell-violation {
                border: 2px solid #e74c3c !important;
                box-shadow: 0 0 5px rgba(231, 76, 60, 0.5);
            }
            .cell-draggable {
                cursor: grab;
            }
            .cell-not-draggable {
                cursor: not-allowed;
                opacity: 0.8;
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
               <button class="btn" style="background:#3498db; color:white;" onclick="scheduleEditorManager.checkAllRules()"><i class="fas fa-check-circle"></i> 排班規則檢查</button>
               <button class="btn" style="background:#95a5a6;" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>
               <button class="btn" style="background:#27ae60; color:white;" onclick="scheduleEditorManager.saveSchedule()"><i class="fas fa-save"></i> 儲存</button>
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
                const cellId = `cell_${uid}_${d}`;

                if(v === 'OFF') { 
                    off++; 
                    txt = 'FF'; 
                    cls += ' cell-off cell-draggable';
                    cellStyle += 'background:#fff;';
                } else if(v === 'REQ_OFF') { 
                    off++; 
                    req++; 
                    txt = 'FF'; 
                    cls += ' cell-req-off cell-not-draggable';
                    cellStyle += 'background:#fff3cd; color:#856404; font-weight:bold;';
                } else {
                    cls += ' cell-draggable';
                    const shift = this.shifts.find(sh => sh.code === v);
                    if(shift && shift.color) {
                        cellStyle += `color: ${shift.color}; font-weight: bold;`;
                    }
                    if(v === 'E') e++;
                    else if(v === 'N') n++;
                }
                
                if (this.violationCells.has(cellId)) {
                    cls += ' cell-violation';
                }
                
                bHtml += `<td id="${cellId}" class="${cls}" style="${cellStyle}" 
                    data-uid="${uid}" data-day="${d}" data-shift="${v||''}"
                    oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">${txt}</td>`;
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
        if (p.independence === 'dependent') b.push('<span class="status-badge" style="background:#9c27b0;">協</span>'); 
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
            <div id="scoreBoard" style="display:flex; align-items:center; gap:10px; background:#f8f9fa; padding:5px 15px; border-radius:20px; border:1px solid #eee; margin-left:15px; cursor:pointer;" onclick="scheduleEditorManager.showScoreDetail()">
                <span style="font-size:0.85rem; color:#666;"><i class="fas fa-chart-line"></i> 排班評分</span>
                <b id="scoreValue" style="font-size:1.1rem; color:#2c3e50;">--</b>
                <i class="fas fa-chevron-right" style="font-size:0.75rem; color:#999;"></i>
            </div>
        `;
        const title = document.getElementById('schTitle');
        if (title) title.insertAdjacentHTML('afterend', scoreHtml);
    },

    showScoreDetail: function() {
        if (!this.lastScoreResult) {
            alert('⚠️ 尚未計算評分');
            return;
        }
        
        AISchedulerComparison.showScoreDetailModal('Current', this.lastScoreResult);
    },

    updateScheduleScore: function() { 
        if (typeof scoringManager === 'undefined') return; 
        
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month); 
        const scoreEl = document.getElementById('scoreValue');
        if (scoreEl) {
            const score = Math.round(res.total);
            scoreEl.innerText = score;
            scoreEl.style.color = this.getScoreColor(score);
        }
        
        this.lastScoreResult = res; 
        console.log('📊 更新評分:', res.total);
    },
    
    getScoreColor: function(score) {
        if (score >= 80) return '#4CAF50';
        if (score >= 60) return '#FFC107';
        if (score >= 40) return '#FF9800';
        return '#f44336';
    },

    publishSchedule: async function() {
        // 發布前強制檢查
        const checkResult = this.performFullCheck();
        const hardViolations = checkResult.violations.filter(v => v.type === 'hard');
        const softViolations = checkResult.violations.filter(v => v.type === 'soft');
        
        if (hardViolations.length > 0) {
            // 有硬規則違規，禁止發布
            this.showCheckReportModal(checkResult, true);
            alert("❌ 無法發布：班表存在硬規則違規（1-5項）\n\n請修正後再發布。");
            return;
        }
        
        if (softViolations.length > 0) {
            // 有軟規則違規，警告後允許發布
            const confirmMsg = `⚠️ 班表存在軟規則違規（${softViolations.length}項）\n\n` +
                softViolations.map(v => `• ${v.person}: ${v.rule}`).join('\n') +
                `\n\n這些違規可以警告後發布，是否繼續？`;
            
            if (!confirm(confirmMsg)) {
                return;
            }
        }
        
        // 確認發布
        if(!confirm("確定要發布此班表嗎？發布後員工將可查看。")) return;
        
        try {
            // 🔥 儲存評分
            const updateData = {
                status: 'published',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            if (this.lastScoreResult) {
                updateData.scoreResult = this.lastScoreResult;
            }
            
            await db.collection('schedules').doc(this.scheduleId).update(updateData);
            this.data.status = 'published';
            this.renderToolbar();
            alert("✅ 發布成功！");
        } catch(e) { 
            alert("❌ 發布失敗: " + e.message); 
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
            this.violationCells.clear();
            this.needsCheck = false;
            this.lastCheckResult = null;
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

    saveSchedule: async function() {
        // 如果已經檢查過
        if (this.needsCheck && this.lastCheckResult) {
            const hardViolations = this.lastCheckResult.violations.filter(v => v.type === 'hard');
            
            if (hardViolations.length > 0) {
                const confirmMsg = `⚠️ 班表仍有硬規則違規（${hardViolations.length}項）\n\n確定要儲存嗎？`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }
            
            // 直接儲存
            await this.performSave();
        } else {
            // 未檢查，先檢查再儲存
            const checkResult = this.performFullCheck();
            
            if (checkResult.violations.length === 0) {
                // 無違規，直接儲存
                await this.performSave();
            } else {
                // 有違規，顯示報告並詢問
                this.showCheckReportModal(checkResult, false);
                const confirmMsg = `檢測到 ${checkResult.violations.length} 項違規\n\n是否仍要儲存？`;
                if (confirm(confirmMsg)) {
                    await this.performSave();
                }
            }
        }
    },

    performSave: async function() {
        try {
            // 🔥 儲存時記錄評分
            const updateData = {
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            if (this.lastScoreResult) {
                updateData.scoreResult = this.lastScoreResult;
            }
            
            await db.collection('schedules').doc(this.scheduleId).update(updateData);
            alert("✅ 儲存成功！");
        } catch (e) {
            alert("❌ 儲存失敗: " + e.message);
        }
    },

    runAI: async function() {
        const now = Date.now();
        if (now - this.lastAIRunTime < this.aiRunCooldown) {
            const remaining = Math.ceil((this.aiRunCooldown - (now - this.lastAIRunTime)) / 1000);
            alert(`⏰ 請稍候 ${remaining} 秒後再執行 AI 排班\n\n(避免過度消耗 Firebase 配額)`);
            return;
        }
        
        // 🔥 使用 AI 比較模組
        if (typeof AISchedulerComparison !== 'undefined') {
            try {
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
                
                const rules = { 
                    ...this.unitRules, 
                    shifts: this.shifts,
                    dailyNeeds: this.data.dailyNeeds || {},
                    specificNeeds: this.data.specificNeeds || {},
                    avgOff: this.data.schedulingParams?.avgOff || 9,
                    daysInMonth: new Date(this.data.year, this.data.month, 0).getDate()
                };
                
                AISchedulerComparison.showComparisonDialog(
                    staffListWithId,
                    this.data.year,
                    this.data.month,
                    this.lastMonthData,
                    rules,
                    (selectedSchedule, selectedStrategy, scoreDetail) => {
                        this.applyAIResult(selectedSchedule, selectedStrategy, scoreDetail);
                    }
                );
                
                this.lastAIRunTime = now;
                
            } catch (e) {
                console.error('❌ AI 排班比較失敗:', e);
                alert('AI 排班失敗: ' + e.message);
            }
        } else {
            alert('❌ AI 比較模組未載入');
        }
    },
    
    applyAIResult: async function(schedule, strategy, scoreDetail) {
        console.log(`🔍 預覽 ${strategy} 排班結果`);
        
        // 備份原始排班，以便取消預覽
        const originalAssignments = JSON.parse(JSON.stringify(this.assignments));
        
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
                    continue;
                }
                
                const ds = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                let shift = 'OFF';
                
                if (schedule[ds]) {
                    for(let code in schedule[ds]) {
                        if(schedule[ds][code].includes(uid)) { 
                            shift = code; 
                            break; 
                        }
                    }
                }
                
                newAssignments[uid][key] = shift;
            }
        });
        
        // 暫時套用預覽
        this.assignments = newAssignments;
        this.renderMatrix();
        this.updateScheduleScore();
        
        // 顯示預覽控制列
        this.showPreviewBar(strategy, async () => {
            // 確認套用
            console.log(`🎯 正式套用 ${strategy} 排班結果`);
            
            // 🔥 設定 AI 基準分
            if (typeof scoringManager !== 'undefined' && scoreDetail) {
                scoringManager.setBase(scoreDetail.total);
            }
            
            await db.collection('schedules').doc(this.scheduleId).update({ 
                assignments: this.assignments,
                aiStrategy: strategy,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.violationCells.clear();
            this.needsCheck = false;
            this.lastCheckResult = null;
            
            this.renderMatrix();
            this.updateScheduleScore();
            this.removePreviewBar();
            
            alert(`✅ 已正式套用 ${strategy} 排班結果！`);
        }, () => {
            // 取消預覽
            console.log(`↩️ 取消預覽 ${strategy}`);
            this.assignments = originalAssignments;
            this.renderMatrix();
            this.updateScheduleScore();
            this.removePreviewBar();
            
            // 重新開啟 AI 比較對話框，讓使用者可以選別的
            this.runAI();
        });
    },

    showPreviewBar: function(strategy, onConfirm, onCancel) {
        this.removePreviewBar();
        
        const bar = document.createElement('div');
        bar.id = 'ai-preview-bar';
        bar.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #2c3e50;
            color: white;
            padding: 15px 30px;
            border-radius: 50px;
            display: flex;
            align-items: center;
            gap: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            z-index: 9999;
            border: 2px solid #3498db;
        `;
        
        bar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">👀</span>
                <span style="font-weight: 600;">正在預覽：${strategy} 方案</span>
            </div>
            <div style="height: 20px; width: 1px; background: rgba(255,255,255,0.3);"></div>
            <div style="display: flex; gap: 10px;">
                <button id="preview-cancel" style="padding: 8px 20px; background: #95a5a6; color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600;">取消並重選</button>
                <button id="preview-confirm" style="padding: 8px 20px; background: #27ae60; color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600;">✅ 確定套用此方案</button>
            </div>
        `;
        
        document.body.appendChild(bar);
        
        document.getElementById('preview-confirm').onclick = onConfirm;
        document.getElementById('preview-cancel').onclick = onCancel;
    },

    removePreviewBar: function() {
        const bar = document.getElementById('ai-preview-bar');
        if (bar) bar.remove();
    },

    initContextMenu: function() {},
    showContextMenu: function(e, u, d) {},
    bindEvents: function() { 
        document.addEventListener('click', () => { 
            const m = document.getElementById('schContextMenu'); 
            if(m) m.style.display='none'; 
        }); 
    },

    // ==================== 拖曳交換功能 ====================
    
    initDragAndDrop: function() {
        const tbody = document.getElementById('schBody');
        if (!tbody) return;
        
        tbody.addEventListener('mousedown', (e) => this.handleDragStart(e));
        tbody.addEventListener('mousemove', (e) => this.handleDragMove(e));
        tbody.addEventListener('mouseup', (e) => this.handleDragEnd(e));
        document.addEventListener('mouseup', (e) => this.handleDragCancel(e));
    },

    handleDragStart: function(e) {
        const cell = e.target.closest('td[data-uid]');
        if (!cell) return;
        
        const shift = cell.dataset.shift;
        
        // REQ_OFF 不能拖曳
        if (shift === 'REQ_OFF') {
            alert("⚠️ 預班休假（REQ_OFF）無法交換");
            return;
        }
        
        // 只有 cell-draggable 可以拖曳
        if (!cell.classList.contains('cell-draggable')) {
            return;
        }
        
        e.preventDefault();
        this.isDragging = true;
        this.dragSource = {
            uid: cell.dataset.uid,
            day: parseInt(cell.dataset.day),
            shift: shift,
            element: cell
        };
        
        cell.classList.add('cell-dragging');
    },

    handleDragMove: function(e) {
        if (!this.isDragging || !this.dragSource) return;
        
        const cell = e.target.closest('td[data-uid]');
        if (!cell || !cell.classList.contains('cell-draggable')) {
            // 清除舊的 drop-target
            document.querySelectorAll('.cell-drop-target').forEach(c => {
                c.classList.remove('cell-drop-target');
            });
            return;
        }
        
        // 清除舊的 drop-target
        document.querySelectorAll('.cell-drop-target').forEach(c => {
            c.classList.remove('cell-drop-target');
        });
        
        // 標記新的 drop-target
        if (cell !== this.dragSource.element) {
            cell.classList.add('cell-drop-target');
        }
    },

    handleDragEnd: function(e) {
        if (!this.isDragging || !this.dragSource) return;
        
        const cell = e.target.closest('td[data-uid]');
        if (!cell || !cell.classList.contains('cell-draggable')) {
            this.handleDragCancel();
            return;
        }
        
        const target = {
            uid: cell.dataset.uid,
            day: parseInt(cell.dataset.day),
            shift: cell.dataset.shift
        };
        
        // 清除樣式
        this.dragSource.element.classList.remove('cell-dragging');
        document.querySelectorAll('.cell-drop-target').forEach(c => {
            c.classList.remove('cell-drop-target');
        });
        
        // 檢查是否同一格
        if (this.dragSource.uid === target.uid && this.dragSource.day === target.day) {
            this.isDragging = false;
            this.dragSource = null;
            return;
        }
        
        // 檢查是否同一天
        if (this.dragSource.day !== target.day) {
            alert("⚠️ 只能在同一天交換班別");
            this.isDragging = false;
            this.dragSource = null;
            return;
        }
        
        // 檢查是否包含 REQ_OFF
        if (target.shift === 'REQ_OFF') {
            alert("⚠️ 預班休假（REQ_OFF）無法交換");
            this.isDragging = false;
            this.dragSource = null;
            return;
        }
        
        // 執行交換檢查
        this.performSwapCheck(this.dragSource, target);
        
        this.isDragging = false;
        this.dragSource = null;
    },

    handleDragCancel: function() {
        if (!this.isDragging) return;
        
        if (this.dragSource && this.dragSource.element) {
            this.dragSource.element.classList.remove('cell-dragging');
        }
        
        document.querySelectorAll('.cell-drop-target').forEach(c => {
            c.classList.remove('cell-drop-target');
        });
        
        this.isDragging = false;
        this.dragSource = null;
    },

    performSwapCheck: function(source, target) {
        const day = source.day;
        const uid1 = source.uid;
        const uid2 = target.uid;
        const newShift1 = target.shift || 'OFF';
        const newShift2 = source.shift || 'OFF';
        
        console.log(`🔄 交換檢查: ${uid1} Day${day} (${source.shift}) ↔ ${uid2} Day${day} (${target.shift})`);
        
        // 執衁7項檢查
        const violations = [];
        
        // 檢查 uid1
        const v1 = this.check7Rules(uid1, day, newShift1);
        violations.push(...v1);
        
        // 檢查 uid2
        const v2 = this.check7Rules(uid2, day, newShift2);
        violations.push(...v2);
        
        if (violations.length === 0) {
            // 無違規，直接交換
            this.executeSwap(source, target);
            alert("✅ 交換成功！");
        } else {
            // 有違規，顯示警告
            this.showSwapWarningModal(source, target, violations);
        }
    },

    executeSwap: function(source, target) {
        const uid1 = source.uid;
        const uid2 = target.uid;
        const day = source.day;
        const key = `current_${day}`;
        
        const shift1 = target.shift || 'OFF';
        const shift2 = source.shift || 'OFF';
        
        this.assignments[uid1][key] = shift1;
        this.assignments[uid2][key] = shift2;
        
        console.log(`✅ 執行交換: ${uid1} Day${day} = ${shift1}, ${uid2} Day${day} = ${shift2}`);
        
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
    },

    showSwapWarningModal: function(source, target, violations) {
        const hardViolations = violations.filter(v => v.type === 'hard');
        const softViolations = violations.filter(v => v.type === 'soft');
        
        let modalHtml = `
        <div id="swapWarningModal" style="display:flex; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5); align-items:center; justify-content:center;">
            <div style="background:white; padding:30px; border-radius:12px; width:600px; max-height:80vh; overflow-y:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 20px 0; color:#2c3e50;">
                    ⚠️ 交換班別將產生以下問題
                </h3>`;
        
        if (hardViolations.length > 0) {
            modalHtml += `
                <div style="border:2px solid #e74c3c; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; color:#e74c3c;">
                        ❌ 硬規則違規（發布前必須修正）
                    </h4>
                    <ul style="margin:0; padding-left:20px; line-height:1.8;">
                        ${hardViolations.map(v => `<li>${v.person}: ${v.rule}${v.detail ? '<br><small style="color:#666;">' + v.detail + '</small>' : ''}</li>`).join('')}
                    </ul>
                </div>`;
        }
        
        if (softViolations.length > 0) {
            modalHtml += `
                <div style="border:2px solid #f39c12; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; color:#f39c12;">
                        ⚠️ 軟規則違規（可警告後允許）
                    </h4>
                    <ul style="margin:0; padding-left:20px; line-height:1.8;">
                        ${softViolations.map(v => `<li>${v.person}: ${v.rule}${v.detail ? '<br><small style="color:#666;">' + v.detail + '</small>' : ''}</li>`).join('')}
                    </ul>
                </div>`;
        }
        
        modalHtml += `
                <p style="color:#666; margin-bottom:20px;">
                    是否仍要交換？<br>
                    <small>（調整過程中允許暫時違規）</small>
                </p>
                <div style="display:flex; gap:15px; justify-content:flex-end;">
                    <button id="btnCancelSwap" style="padding:10px 20px; border:1px solid #95a5a6; background:#fff; border-radius:4px; cursor:pointer;">
                        取消交換
                    </button>
                    <button id="btnConfirmSwap" style="padding:10px 20px; border:none; background:#3498db; color:white; border-radius:4px; cursor:pointer; font-weight:bold;">
                        確認交換
                    </button>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        document.getElementById('btnConfirmSwap').onclick = () => {
            this.executeSwap(source, target);
            this.needsCheck = true;
            
            // 標記違規格子
            violations.forEach(v => {
                const cellId = `cell_${v.uid}_${v.day}`;
                this.violationCells.add(cellId);
            });
            
            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore();
            
            document.getElementById('swapWarningModal').remove();
            alert("✅ 交換完成（已標記違規）");
        };
        
        document.getElementById('btnCancelSwap').onclick = () => {
            document.getElementById('swapWarningModal').remove();
        };
    },

    // ==================== 7項規則檢查 ====================
    
    check7Rules: function(uid, day, newShift) {
        const violations = [];
        const staff = this.staffMap[uid];
        const staffName = staff?.name || uid;
        
        // 1. 11小時休息檢查
        const v1 = this.check11HourRest(uid, day, newShift);
        if (v1) violations.push({ type: 'hard', uid, day, person: staffName, rule: v1.rule, detail: v1.detail });
        
        // 2. 週內班別多樣性
        const v2 = this.checkWeeklyDiversity(uid, day, newShift);
        if (v2) violations.push({ type: 'hard', uid, day, person: staffName, rule: v2.rule, detail: v2.detail });
        
        // 3. 特殊身分保護
        const v3 = this.checkSpecialStatus(uid, newShift);
        if (v3) violations.push({ type: 'hard', uid, day, person: staffName, rule: v3.rule, detail: v3.detail });
        
        // 4. 兩週內OFF數量
        const v4 = this.checkTwoWeekOffs(uid, day, newShift);
        if (v4) violations.push({ type: 'hard', uid, day, person: staffName, rule: v4.rule, detail: v4.detail });
        
        // 5. OFF間隔
        const v5 = this.checkOffGap(uid, day, newShift);
        if (v5) violations.push({ type: 'hard', uid, day, person: staffName, rule: v5.rule, detail: v5.detail });
        
        // 6. 包班/志願匹配
        const v6 = this.checkPreference(uid, newShift);
        if (v6) violations.push({ type: 'soft', uid, day, person: staffName, rule: v6.rule, detail: v6.detail });
        
        // 7. 連續上班天數
        const v7 = this.checkConsecutiveWorkDays(uid, day, newShift);
        if (v7) violations.push({ type: 'soft', uid, day, person: staffName, rule: v7.rule, detail: v7.detail });
        
        return violations;
    },

    check11HourRest: function(uid, day, newShift) {
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        // 檢查前一天
        let prevShift = null;
        if (day === 1) {
            prevShift = this.lastMonthData[uid]?.lastShift;
        } else {
            prevShift = this.assignments[uid]?.[`current_${day - 1}`];
        }
        
        if (prevShift && prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
            const prevShiftData = this.shifts.find(s => s.code === prevShift);
            const newShiftData = this.shifts.find(s => s.code === newShift);
            
            if (prevShiftData && newShiftData) {
                const prevEnd = this.parseTime(prevShiftData.endTime);
                const newStart = this.parseTime(newShiftData.startTime);
                
                // 🔥 修正：計算跨日間隔
                let gap = newStart - prevEnd;
                
                // 🔥 關鍵修正：如果間隔 <= 0，一定是跨日（隔天）
                if (gap <= 0) {
                    gap += 24;
                }
                
                if (gap < 11) {
                    return {
                        rule: '11小時休息不足',
                        detail: `Day ${day-1} ${prevShift}班下班${prevShiftData.endTime} → Day ${day} ${newShift}班上班${newShiftData.startTime}（間隔${gap.toFixed(1)}小時）`
                    };
                }
            }
        }
        
        // 檢查隔天
        if (day < daysInMonth) {
            const nextShift = this.assignments[uid]?.[`current_${day + 1}`];
            
            if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
                const newShiftData = this.shifts.find(s => s.code === newShift);
                const nextShiftData = this.shifts.find(s => s.code === nextShift);
                
                if (newShiftData && nextShiftData) {
                    const newEnd = this.parseTime(newShiftData.endTime);
                    const nextStart = this.parseTime(nextShiftData.startTime);
                    
                    // 🔥 修正：計算跨日間隔
                    let gap = nextStart - newEnd;
                    
                    // 🔥 關鍵修正：如果間隔 <= 0，一定是跨日（隔天）
                    if (gap <= 0) {
                        gap += 24;
                    }
                    
                    if (gap < 11) {
                        return {
                            rule: '11小時休息不足',
                            detail: `Day ${day} ${newShift}班下班${newShiftData.endTime} → Day ${day+1} ${nextShift}班上班${nextShiftData.startTime}（間隔${gap.toFixed(1)}小時）`
                        };
                    }
                }
            }
        }
        
        return null;
    },

    checkWeeklyDiversity: function(uid, day, newShift) {
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        const weekStartDay = this.unitRules?.hard?.weekStartDay || 1;
        const weekStart = this.calculateWeekStart(day, weekStartDay);
        const weekEnd = Math.min(weekStart + 6, new Date(this.data.year, this.data.month, 0).getDate());
        
        const shifts = new Set();
        for (let d = weekStart; d <= weekEnd; d++) {
            let shift;
            if (d === day) {
                shift = newShift;
            } else {
                shift = this.assignments[uid]?.[`current_${d}`];
            }
            
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                shifts.add(shift);
            }
        }
        
        if (shifts.size > 2) {
            return {
                rule: '週內班別超過2種',
                detail: `Week (Day ${weekStart}-${weekEnd}): ${Array.from(shifts).join(', ')}（${shifts.size}種班別）`
            };
        }
        
        return null;
    },

    checkSpecialStatus: function(uid, newShift) {
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        const user = this.usersMap[uid];
        if (!user) return null;
        
        const params = user.schedulingParams || {};
        const shiftData = this.shifts.find(s => s.code === newShift);
        if (!shiftData) return null;
        
        // 孕婦/哺乳不能排大夜
        if (params.isPregnant || params.isBreastfeeding) {
            const nightStart = this.parseTime(this.unitRules?.policy?.nightStart || '22:00');
            const nightEnd = this.parseTime(this.unitRules?.policy?.nightEnd || '06:00');
            const shiftStart = this.parseTime(shiftData.startTime);
            
            const isNight = (nightStart > nightEnd) 
                ? (shiftStart >= nightStart || shiftStart <= nightEnd) 
                : (shiftStart >= nightStart && shiftStart <= nightEnd);
            
            if (isNight) {
                const status = params.isPregnant ? '孕婦' : '哺乳';
                return {
                    rule: '特殊身分違規',
                    detail: `${status}不可排大夜班（${newShift}班）`
                };
            }
        }
        
        // PGY 禁止班別
        if (params.isPGY) {
            const pgyList = this.unitRules?.policy?.protectPGY_List || [];
            if (pgyList.includes(newShift)) {
                return {
                    rule: '特殊身分違規',
                    detail: `PGY不可排${newShift}班`
                };
            }
        }
        
        return null;
    },

    checkTwoWeekOffs: function(uid, day, newShift) {
        const weekStartDay = this.unitRules?.hard?.weekStartDay || 1;
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        const weekStart = this.calculateWeekStart(day, weekStartDay);
        const weekEnd = weekStart + 6;
        
        // 檢查1：前一週 + 當週
        const prevWeekStart = weekStart - 7;
        const prevWeekEnd = weekEnd - 7;
        
        if (prevWeekStart >= 1) {
            const offs1 = this.countOffsInRange(uid, prevWeekStart, weekEnd, day, newShift);
            if (offs1 < 2) {
                return {
                    rule: '兩週內OFF不足',
                    detail: `前一週+當週 (Day ${prevWeekStart}-${weekEnd}): 只有${offs1}個OFF`
                };
            }
        }
        
        // 檢查2：當週 + 下一週
        const nextWeekStart = weekStart + 7;
        const nextWeekEnd = weekEnd + 7;
        
        if (nextWeekStart <= daysInMonth) {
            const offs2 = this.countOffsInRange(uid, weekStart, Math.min(nextWeekEnd, daysInMonth), day, newShift);
            if (offs2 < 2) {
                return {
                    rule: '兩週內OFF不足',
                    detail: `當週+下一週 (Day ${weekStart}-${Math.min(nextWeekEnd, daysInMonth)}): 只有${offs2}個OFF`
                };
            }
        }
        
        return null;
    },

    checkOffGap: function(uid, day, newShift) {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const maxGap = this.unitRules?.hard?.offGapMax || 12;
        
        // 如果新班別是OFF，不檢查
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        // 找前一個OFF
        let prevOff = null;
        for (let d = day - 1; d >= 1; d--) {
            let shift;
            if (d === day) {
                shift = newShift;
            } else {
                shift = this.assignments[uid]?.[`current_${d}`];
            }
            
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                prevOff = d;
                break;
            }
        }
        
        // 找下一個OFF
        let nextOff = null;
        for (let d = day + 1; d <= daysInMonth; d++) {
            let shift;
            if (d === day) {
                shift = newShift;
            } else {
                shift = this.assignments[uid]?.[`current_${d}`];
            }
            
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                nextOff = d;
                break;
            }
        }
        
        // 檢查間隔
        if (prevOff && nextOff) {
            const gap = nextOff - prevOff - 1;
            if (gap > maxGap) {
                return {
                    rule: 'OFF間隔超過限制',
                    detail: `Day ${prevOff} OFF → Day ${nextOff} OFF（間隔${gap}天，限制${maxGap}天）`
                };
            }
        }
        
        return null;
    },

    checkPreference: function(uid, newShift) {
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        const prefs = this.assignments[uid]?.preferences || {};
        
        // 包班檢查
        if (prefs.bundleShift) {
            if (newShift !== prefs.bundleShift) {
                return {
                    rule: '違反包班設定',
                    detail: `包${prefs.bundleShift}班，但排${newShift}班`
                };
            }
            return null;
        }
        
        // 志願檢查
        const favShifts = [];
        if (prefs.favShift) favShifts.push(prefs.favShift);
        if (prefs.favShift2) favShifts.push(prefs.favShift2);
        if (prefs.favShift3) favShifts.push(prefs.favShift3);
        
        if (favShifts.length > 0 && !favShifts.includes(newShift)) {
            return {
                rule: '違反志願設定',
                detail: `志願${favShifts.join('/')}，但排${newShift}班`
            };
        }
        
        return null;
    },

    checkConsecutiveWorkDays: function(uid, day, newShift) {
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return null;
        
        // 計算連續上班天數（包含這一天）
        let count = 1;
        
        // 往前數
        for (let d = day - 1; d >= 1; d--) {
            const shift = this.assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            count++;
        }
        
        // 檢查長假狀態
        const hasLongVacation = this.checkHasLongVacation(uid);
        const maxConsDays = hasLongVacation 
            ? (this.unitRules?.policy?.longVacationWorkLimit || 7)
            : (this.unitRules?.policy?.maxConsDays || 6);
        
        if (count > maxConsDays) {
            return {
                rule: '超過連續上班天數',
                detail: `連續上班${count}天（限制${maxConsDays}天${hasLongVacation ? '，有長假放寬' : ''}）`
            };
        }
        
        return null;
    },

    checkHasLongVacation: function(uid) {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const longVacationDays = this.unitRules?.policy?.longVacationDays || 7;
        
        let maxConsecutiveOffs = 0;
        let currentConsecutiveOffs = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = this.assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                currentConsecutiveOffs++;
                maxConsecutiveOffs = Math.max(maxConsecutiveOffs, currentConsecutiveOffs);
            } else {
                currentConsecutiveOffs = 0;
            }
        }
        
        return maxConsecutiveOffs >= longVacationDays;
    },

    // ==================== 完整檢查功能 ====================
    
    checkAllRules: function() {
        const result = this.performFullCheck();
        this.showCheckReportModal(result, false);
        this.needsCheck = false;
        this.lastCheckResult = result;
    },

    performFullCheck: function() {
        console.log('🔍 執行完整班表檢查...');
        
        const violations = [];
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            
            for (let day = 1; day <= daysInMonth; day++) {
                const shift = this.assignments[uid]?.[`current_${day}`];
                if (!shift) continue;
                
                const v = this.check7Rules(uid, day, shift);
                violations.push(...v);
            }
        });
        
        // 清除舊的違規標記
        this.violationCells.clear();
        
        // 標記新的違規
        violations.forEach(v => {
            const cellId = `cell_${v.uid}_${v.day}`;
            this.violationCells.add(cellId);
        });
        
        // 重新渲染以顯示紅框
        this.renderMatrix();
        
        return { violations };
    },

    showCheckReportModal: function(result, isPublish) {
        const hardViolations = result.violations.filter(v => v.type === 'hard');
        const softViolations = result.violations.filter(v => v.type === 'soft');
        
        // 統計各類違規
        const hardStats = {};
        const softStats = {};
        
        hardViolations.forEach(v => {
            const rule = v.rule;
            if (!hardStats[rule]) hardStats[rule] = [];
            hardStats[rule].push(v);
        });
        
        softViolations.forEach(v => {
            const rule = v.rule;
            if (!softStats[rule]) softStats[rule] = [];
            softStats[rule].push(v);
        });
        
        let modalHtml = `
        <div id="checkReportModal" style="display:flex; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5); align-items:center; justify-content:center;">
            <div style="background:white; padding:30px; border-radius:12px; width:700px; max-height:80vh; overflow-y:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 10px 0; color:#2c3e50;">
                    📋 排班規則檢查報告
                </h3>
                <p style="color:#666; margin-bottom:20px; font-size:0.9rem;">
                    檢查時間：${new Date().toLocaleString()}<br>
                    檢查範圍：${this.data.year}年${this.data.month}月班表（${new Date(this.data.year, this.data.month, 0).getDate()}天）
                </p>`;
        
        if (result.violations.length === 0) {
            modalHtml += `
                <div style="border:2px solid #27ae60; border-radius:8px; padding:20px; text-align:center; background:#d4edda;">
                    <h2 style="margin:0; color:#27ae60;">
                        ✅ 班表完全符合規則
                    </h2>
                    <p style="margin:10px 0 0 0; color:#666;">
                        所有檢查項目均已通過
                    </p>
                </div>`;
        } else {
            if (hardViolations.length > 0) {
                modalHtml += `
                    <div style="border:2px solid #e74c3c; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <h4 style="margin:0 0 10px 0; color:#e74c3c;">
                            ❌ 硬規則違規（${hardViolations.length}項）
                        </h4>`;
                
                Object.keys(hardStats).forEach((rule, idx) => {
                    const items = hardStats[rule];
                    modalHtml += `
                        <div style="margin-bottom:10px;">
                            <strong>${idx + 1}. ${rule}（${items.length}人）</strong>
                            <ul style="margin:5px 0 0 0; padding-left:20px; font-size:0.9rem;">
                                ${items.map(v => `<li>${v.person}${v.detail ? '<br><small style="color:#666;">' + v.detail + '</small>' : ''}</li>`).join('')}
                            </ul>
                        </div>`;
                });
                
                modalHtml += `</div>`;
            }
            
            if (softViolations.length > 0) {
                modalHtml += `
                    <div style="border:2px solid #f39c12; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <h4 style="margin:0 0 10px 0; color:#f39c12;">
                            ⚠️ 軟規則違規（${softViolations.length}項）
                        </h4>`;
                
                Object.keys(softStats).forEach((rule, idx) => {
                    const items = softStats[rule];
                    modalHtml += `
                        <div style="margin-bottom:10px;">
                            <strong>${idx + 1}. ${rule}（${items.length}人）</strong>
                            <ul style="margin:5px 0 0 0; padding-left:20px; font-size:0.9rem;">
                                ${items.map(v => `<li>${v.person}${v.detail ? '<br><small style="color:#666;">' + v.detail + '</small>' : ''}</li>`).join('')}
                            </ul>
                        </div>`;
                });
                
                modalHtml += `</div>`;
            }
            
            modalHtml += `
                <div style="padding:15px; background:#f8f9fa; border-radius:8px;">
                    <strong>📊 總計：${result.violations.length} 項違規</strong><br>
                    <span style="color:#e74c3c;">硬規則：${hardViolations.length} 項（必須修正才能發布）</span><br>
                    <span style="color:#f39c12;">軟規則：${softViolations.length} 項（可警告後發布）</span>
                </div>`;
        }
        
        modalHtml += `
                <div style="display:flex; gap:15px; justify-content:flex-end; margin-top:20px;">
                    <button id="btnCloseCheckReport" style="padding:10px 20px; border:1px solid #95a5a6; background:#fff; border-radius:4px; cursor:pointer;">
                        關閉
                    </button>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        document.getElementById('btnCloseCheckReport').onclick = () => {
            document.getElementById('checkReportModal').remove();
        };
    },

    // ==================== 輔助函式 ====================
    
    calculateWeekStart: function(day, weekStartDay) {
        const date = new Date(this.data.year, this.data.month - 1, day);
        const dayOfWeek = date.getDay();
        let offset = (dayOfWeek - weekStartDay + 7) % 7;
        return day - offset;
    },

    countOffsInRange: function(uid, startDay, endDay, changedDay, changedShift) {
        let count = 0;
        for (let d = startDay; d <= endDay; d++) {
            let shift;
            if (d === changedDay) {
                shift = changedShift;
            } else {
                shift = this.assignments[uid]?.[`current_${d}`];
            }
            
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                count++;
            }
        }
        return count;
    },

    parseTime: function(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h + m / 60;
    }
};

console.log('✅ schedule_editor_manager.js 已載入 (整合 AI 比較 + 評分系統)');
