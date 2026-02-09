// js/modules/schedule_editor_manager.js
// 🚀 修正版 v4：加入 AI 排班頻率限制 + 優化 Firebase 讀寫

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
    
    // ✅ 新增：AI 排班頻率控制
    lastAIRunTime: 0,
    aiRunCooldown: 3000, // 3 秒冷卻時間

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
                this.loadLastMonthSchedule() 
            ]);
            
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
        } catch (e) { 
            console.error("❌ 初始化失敗:", e); 
        } finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
        }
    },

    importFromPreSchedule: async function() {
        try {
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if (!preDoc.exists) return;
            const preData = preDoc.data();
            const sourceAssign = preData.assignments || {};
            const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
            
            this.assignments = {};
            this.data.staffList.forEach(s => {
                const uid = s.uid.trim();
                const pre = sourceAssign[uid] || {};
                this.assignments[uid] = { preferences: pre.preferences || {} };
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    if (pre[key]) this.assignments[uid][key] = pre[key];
                }
            });
            await db.collection('schedules').doc(this.scheduleId).update({ assignments: this.assignments });
        } catch (e) { console.error("導入失敗:", e); }
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
        this.lastMonthData = !snap.empty ? snap.docs[0].data().assignments || {} : {};
        console.log(`📅 已載入上月班表資料: ${!snap.empty ? '成功' : '無資料'}`);
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
        
        // === 表頭 ===
        let h = `<tr>
            <th rowspan="2">職編</th>
            <th rowspan="2">姓名</th>
            <th rowspan="2">狀態</th>
            <th rowspan="2">偏好</th>
            <th colspan="6" style="background:#eee;">上月月底</th>`;
        for(let d=1; d<=days; d++) h += `<th>${d}</th>`;
        h += `<th colspan="4">統計</th></tr><tr>`;
        
        for(let d=lastD-5; d<=lastD; d++) {
            h += `<th style="background:#f5f5f5; color:#999; font-size:0.7rem;">${d}</th>`;
        }
        for(let d=1; d<=days; d++) {
            h += `<th style="font-size:0.8rem;">${['日','一','二','三','四','五','六'][new Date(year, month-1, d).getDay()]}</th>`;
        }
        h += `<th>總OFF</th><th>假OFF</th><th>E</th><th>N</th></tr>`;
        thead.innerHTML = h;

        // === 表身 ===
        let bHtml = '';
        this.data.staffList.forEach(s => {
            const uid = s.uid, 
                  ua = this.assignments[uid] || {}, 
                  user = this.usersMap[uid] || {};
            const badges = this.getStaffStatusBadges(uid);
            
            // 從 assignments 中取得偏好設定
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
                <td>${user.employeeId||''}</td>
                <td>${s.name}${s.isSupport ? '<br><span style="color:#27ae60; font-size:0.7rem;">(支援)</span>' : ''}</td>
                <td style="text-align:center;">${badges || '<span style="color:#ccc;">-</span>'}</td>
                <td style="text-align:center; line-height:1.3; padding:4px 2px;">${prefDisplay}</td>`;
            
            const lm = this.lastMonthData[uid] || {};
            for(let d=lastD-5; d<=lastD; d++) {
                const v = lm[`last_${d}`];
                bHtml += `<td style="font-size:0.7rem; background:#f9f9f9; color:#999; text-align:center;">${v==='OFF'?'FF':(v||'-')}</td>`;
            }
            
            let off=0, req=0, e=0, n=0;
            for(let d=1; d<=days; d++) {
                const v = ua[`current_${d}`];
                let txt = v || '', cls = 'cell-clickable';
                if(v === 'OFF') { 
                    off++; 
                    txt='FF'; 
                    cls+=' cell-off'; 
                } else if(v === 'REQ_OFF') { 
                    off++; 
                    req++; 
                    txt='V'; 
                    cls+=' cell-req-off'; 
                } else if(v === 'E') {
                    e++;
                } else if(v === 'N') {
                    n++;
                }
                bHtml += `<td class="${cls}" oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">${txt}</td>`;
            }
            
            bHtml += `<td style="text-align:center;">${off}</td>
                      <td style="text-align:center; color:red;">${req}</td>
                      <td style="text-align:center;">${e}</td>
                      <td style="text-align:center;">${n}</td>`;
            bHtml += `</tr>`;
        });
        tbody.innerHTML = bHtml;

        // === 表尾（人力監控）===
        if (tfoot) {
            let footHtml = '';
            this.shifts.forEach((s, idx) => {
                footHtml += `<tr>`;
                if(idx === 0) {
                    footHtml += `<td colspan="10" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle; background:#f8f9fa;">每日人力<br>監控</td>`;
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

                    const style = isTemp ? 'background:#fff3cd; border:1px solid #f39c12;' : '';
                    footHtml += `<td id="stat_cell_${s.code}_${d}" style="text-align:center; font-size:0.8rem; ${style}">
                                    <span class="stat-actual">-</span>/<span class="stat-need" style="font-weight:bold;">${need}</span>
                                 </td>`;
                }
                footHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
                footHtml += `</tr>`;
            });
            tfoot.innerHTML = footHtml;
            
            setTimeout(() => this.updateRealTimeStats(), 0);
        }
    },

    loadShifts: async function() { 
        const snap = await db.collection('shifts')
            .where('unitId', '==', this.data.unitId)
            .orderBy('startTime')
            .get(); 
        
        // ✅ 過濾掉排班不可用的班別
        this.shifts = snap.docs.map(d => d.data())
            .filter(s => s.isScheduleAvailable !== false);
        
        console.log(`✅ 排班編輯器載入 ${this.shifts.length} 個可用班別:`, this.shifts.map(s => s.code));
    },
    
    loadUsers: async function() { 
        const snap = await db.collection('users').get(); 
        snap.forEach(d => this.usersMap[d.id] = d.data()); 
    },
    
    loadUnitRules: async function() { 
        const doc = await db.collection('units').doc(this.data.unitId).get(); 
        this.unitRules = doc.data()?.schedulingRules || {}; 
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

    // ✅ 核心修正：AI 排班加上頻率限制
    runAI: async function() {
        // ✅ 檢查冷卻時間，避免短時間內重複執行
        const now = Date.now();
        if (now - this.lastAIRunTime < this.aiRunCooldown) {
            const remaining = Math.ceil((this.aiRunCooldown - (now - this.lastAIRunTime)) / 1000);
            alert(`⏰ 請稍候 ${remaining} 秒後再執行 AI 排班\n\n(避免過度消耗 Firebase 配額)`);
            return;
        }
        
        if(!confirm("啟動 AI 自動排班？這將覆蓋目前的排班結果。")) return;
        
        this.lastAIRunTime = now; // ✅ 記錄執行時間
        this.showLoading();
        
        console.log('🤖 AI 排班開始執行，時間:', new Date().toLocaleTimeString());
        
        try {
            if(typeof SchedulerFactory === 'undefined') throw new Error("排班引擎未載入");
            
            // ✅ 準備資料（記憶體操作）
            const staffListWithId = this.data.staffList.map(s => ({
                ...s,
                id: s.uid || s.id,
                schedulingParams: this.usersMap[s.uid]?.schedulingParams || {},
                preferences: this.assignments[s.uid]?.preferences || {}
            }));
            
            const rules = { 
                ...this.unitRules, 
                shifts: this.shifts,
                dailyNeeds: this.data.dailyNeeds || {},
                specificNeeds: this.data.specificNeeds || {}
            };
            
            // ✅ 執行排班（純記憶體操作，無 Firebase 讀寫）
            const scheduler = SchedulerFactory.create('V2', staffListWithId, this.data.year, this.data.month, this.lastMonthData, rules);
            const result = scheduler.run();
            
            console.log("🤖 AI 排班結果樣本:", result[Object.keys(result)[0]]);
            
            // ✅ 轉換結果格式
            const newAssignments = {};
            this.data.staffList.forEach(s => {
                const uid = s.uid.trim();
                newAssignments[uid] = { preferences: (this.assignments[uid]?.preferences || {}) };
                
                for(let d=1; d<=new Date(this.data.year, this.data.month, 0).getDate(); d++) {
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
                    
                    newAssignments[uid][`current_${d}`] = shift;
                }
            });
            
            console.log("📊 轉換後的 assignments 樣本:", Object.keys(newAssignments)[0], newAssignments[Object.keys(newAssignments)[0]]);
            
            // ✅ 更新記憶體
            this.assignments = newAssignments;
            
            // ✅ 一次性寫入 Firebase（僅此一次！）
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

    initContextMenu: function() { /* 右鍵選單初始化 */ },
    showContextMenu: function(e, u, d) { /* 右鍵選單顯示 */ },
    bindEvents: function() { 
        document.addEventListener('click', () => { 
            const m = document.getElementById('schContextMenu'); 
            if(m) m.style.display='none'; 
        }); 
    }
};
