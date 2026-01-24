// js/modules/schedule_editor_manager.js
// 🚀 完整修正版：包含完整缺額檢查、上月資料修正顯示、AI 資料傳遞優化

const scheduleEditorManager = {
    scheduleId: null, data: null, shifts: [], assignments: {}, 
    unitRules: {}, staffMap: {}, usersMap: {}, isLoading: false,
    lastMonthData: {}, // 儲存上個月完整資料 (含修正)

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
                this.loadLastMonthSchedule() // 載入上月班表
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
            }
            
            // 資料結構防呆驗證
            if (!this.data.assignments || typeof this.data.assignments !== 'object') {
                this.data.assignments = {};
            }
            this.assignments = this.data.assignments;
            
            if (!this.data.staffList || !Array.isArray(this.data.staffList)) {
                throw new Error("人員名單 (StaffList) 資料損毀，無法載入排班表。");
            }

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.setupEvents();
            
            // 初始化右鍵選單 DOM
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

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("資料不存在");
        this.data = doc.data();
        this.data.staffList.forEach(s => { this.staffMap[s.uid] = s; });
    },

    // 載入上月班表邏輯
    loadLastMonthSchedule: async function() {
        // 1. 優先使用資料庫中已經存好的 lastMonthData (這是從預班表帶過來的，包含手動修正)
        if (this.data.lastMonthData && Object.keys(this.data.lastMonthData).length > 0) {
            this.lastMonthData = this.data.lastMonthData;
            
            // 計算上個月天數
            const { year, month } = this.data;
            let ly = year, lm = month - 1;
            if (lm === 0) { lm = 12; ly--; }
            this.lastMonthDays = new Date(ly, lm, 0).getDate();
            
            console.log("✅ 使用傳遞過來的上月資料 (含修正)");
            return;
        }

        // 2. 如果沒有傳遞過來的資料，才嘗試自己去撈 (備案)
        console.warn("⚠️ 無傳遞資料，嘗試重新撈取上月班表...");
        const { unitId, year, month } = this.data;
        let lastYear = year;
        let lastMonth = month - 1;
        if (lastMonth === 0) { lastMonth = 12; lastYear--; }

        const snap = await db.collection('schedules')
            .where('unitId', '==', unitId)
            .where('year', '==', lastYear)
            .where('month', '==', lastMonth)
            .where('status', '==', 'published')
            .limit(1)
            .get();

        this.lastMonthData = {};
        this.lastMonthDays = new Date(lastYear, lastMonth, 0).getDate();
        
        if (!snap.empty) {
            const lastData = snap.docs[0].data();
            const assigns = lastData.assignments || {};
            // 轉格式以符合 renderMatrix 需求
            Object.keys(assigns).forEach(uid => {
                this.lastMonthData[uid] = {};
                for (let d = 1; d <= this.lastMonthDays; d++) {
                    const key = `current_${d}`;
                    if (assigns[uid][key]) this.lastMonthData[uid][`last_${d}`] = assigns[uid][key];
                }
            });
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weeks = ['日','一','二','三','四','五','六'];
        
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
            
            // 優先讀取 staff.prefs (從預班表帶過來的)，其次讀取 assignments 裡的
            const prefs = staff.prefs || ua.preferences || {};
            const bundleDisplay = prefs.bundleShift || staff.packageType || '-';

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff;">${staff.name}</td>
                <td>${bundleDisplay}</td>`;
            
            // 渲染上月最後 6 天班表 (使用 lastMonthData)
            const lastData = this.lastMonthData[uid] || {};
            for(let d = lastMonthDays - 5; d <= lastMonthDays; d++) {
                // lastMonthData 的 key 可能是 last_28 或 current_28 (視來源而定)
                const val = lastData[`last_${d}`] || lastData[`current_${d}`] || lastData[d] || ''; 
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
                
                // 渲染格子
                bodyHtml += `<td class="cell-clickable ${isLocked?'':'cell-draggable'}" 
                                 data-uid="${uid}" data-day="${d}" ${dragAttr} 
                                 oncontextmenu="scheduleEditorManager.handleRightClick(event, '${uid}', '${d}'); return false;">
                                 ${this.renderCellContent(val)}
                             </td>`;
                
                // 計算統計
                if (!val || val === 'OFF' || val === 'REQ_OFF') {
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

            // 右側統計欄位
            bodyHtml += `<td style="background:#f9f9f9; font-weight:bold;">${totalOff}</td>
                         <td style="background:#f9f9f9; color:red;">${holidayOff}</td>
                         <td style="background:#f9f9f9;">${eveningCount}</td>
                         <td style="background:#f9f9f9;">${nightCount}</td>`;
            
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
        this.bindEvents();
    },

    runAI: async function() {
        if (typeof SchedulerFactory === 'undefined') { alert("AI 模組未載入"); return; }
        if (!confirm("確定執行 AI 排班? (覆蓋草稿)")) return;
        
        this.isLoading = true; this.showLoading();
        try {
            const year = this.data.year;
            const month = this.data.month;
            
            // 1. 準備人員資料 (整合偏好)
            const staffListForAI = this.data.staffList.map(s => {
                const ua = this.assignments[s.uid] || {};
                
                // 收集本月的 REQ_OFF 鎖定狀態
                const preReq = {};
                for(let d=1; d<=31; d++) {
                    const k = `current_${d}`;
                    if(ua[k] === 'REQ_OFF') preReq[`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = 'REQ_OFF';
                }
                
                // 優先讀取 staff.prefs
                const prefs = s.prefs || ua.preferences || {};

                return {
                    id: s.uid, uid: s.uid, name: s.name, group: s.group,
                    prefs: prefs,
                    packageType: prefs.bundleShift || null,
                    schedulingParams: preReq
                };
            });

            // 2. 準備規則
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                specificNeeds: this.data.specificNeeds || {}, 
                groupLimits: this.data.groupLimits || {}, 
                shiftCodes: this.shifts.map(s => s.code),
                shifts: this.shifts, 
                ...this.unitRules, 
                ...(this.data.settings || {})
            };

            // 3. 執行排班 (直接傳遞 this.lastMonthData)
            const scheduler = SchedulerFactory.create('V2', staffListForAI, year, month, this.lastMonthData, rules);
            const aiResult = scheduler.run();
            
            this.applyAIResult(aiResult);
            this.renderMatrix();
            this.updateRealTimeStats();
            
            if(typeof scoringManager !== 'undefined') {
                scoringManager.setBase(null);
            }
            this.updateScheduleScore();

            await this.saveDraft(true);
            alert("AI 排班完成!");
        } catch (e) { console.error(e); alert("AI 失敗: " + e.message); this.renderMatrix(); }
        finally { this.isLoading = false; }
    },

    // 檢查缺額 (完整版)
    checkShortages: function() {
        const list = [];
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};
        const specificNeeds = this.data.specificNeeds || {};
        
        // 1. 統計目前排班狀況
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

        // 2. 比對需求
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const jsDay = new Date(this.data.year, this.data.month-1, d).getDay();
            const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1;

            this.shifts.forEach(s => {
                const actual = countMap[`${d}_${s.code}`] || 0;
                let need = 0;
                // 優先讀取臨時需求，若無則讀取常規需求
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

    // --- 以下為輔助函式 (保持不變) ---
    showLoading: function() { document.getElementById('schBody').innerHTML='<tr><td colspan="35">載入中...</td></tr>'; },
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
    renderCellContent: function(val) {
        if (!val || val === 'OFF') return '<span style="color:#bbb;">OFF</span>';
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
            for(let i=0; i<6; i++) fHtml += `<td style="background:#f0f0f0;"></td>`; 

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
            fHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
            fHtml += `<td style="background:#f0f0f0; font-weight:bold;">${s.code}</td></tr>`;
        });
        tfoot.innerHTML = fHtml;
    },
    renderScoreBoardContainer: function() {
        const container = document.getElementById('matrixContainer');
        const parent = container.parentElement; 
        if(document.getElementById('scoreDashboard')) return;

        const html = `
        <div id="scoreDashboard" style="background:#fff; padding:10px 20px; border-bottom:1px solid #ddd; display:flex; align-items:center; gap:20px;">
            <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="scheduleEditorManager.showDetailedScore()">
                <div style="position:relative; width:50px; height:50px; border-radius:50%; background:#ecf0f1; display:flex; justify-content:center; align-items:center;" id="scoreCircleBg">
                    <div style="width:42px; height:42px; background:#fff; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:2;">
                        <span id="scoreValue" style="font-size:1rem; font-weight:bold; color:#2c3e50;">-</span>
                    </div>
                </div>
                <div>
                    <h4 style="margin:0; font-size:0.9rem;">評分 (點擊查看詳情)</h4>
                    <div id="scoreCompareBadge" style="font-size:0.75rem; color:#999; background:#f5f5f5; padding:2px 6px; border-radius:4px;">AI原始</div>
                </div>
            </div>
        </div>`;
        parent.insertBefore(this.createElementFromHTML(html), container);

        if(!document.getElementById('scoreDetailModal')) {
            const modalHtml = `
            <div id="scoreDetailModal" class="modal" style="display:none; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5);">
                <div style="background:white; margin:5% auto; padding:20px; border-radius:8px; width:600px; max-height:80vh; overflow-y:auto; position:relative;">
                    <span onclick="document.getElementById('scoreDetailModal').style.display='none'" style="position:absolute; right:20px; top:10px; font-size:24px; cursor:pointer;">&times;</span>
                    <h3 style="border-bottom:2px solid #3498db; padding-bottom:10px;">排班評分詳情</h3>
                    <div id="scoreDetailContent" style="margin-top:20px;"></div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
    },
    createElementFromHTML: function(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; },
    updateScheduleScore: function() {
        if (typeof scoringManager === 'undefined') return;
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        const score = res.total;
        document.getElementById('scoreValue').innerText = Math.round(score);
        document.getElementById('scoreCircleBg').style.background = `conic-gradient(#3498db 0% ${score}%, #ecf0f1 ${score}% 100%)`;
        this.lastScoreResult = res; 
    },
    showDetailedScore: function() {
        if(!this.lastScoreResult) return;
        const res = this.lastScoreResult;
        let html = '';
        html += `<h4>總分: ${res.total.toFixed(1)}</h4>`;
        document.getElementById('scoreDetailContent').innerHTML = html;
        document.getElementById('scoreDetailModal').style.display = 'block';
    },
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
