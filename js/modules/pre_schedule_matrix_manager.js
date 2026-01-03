// js/modules/pre_schedule_matrix_manager.js
// Fix: 執行排班時建立完整快照 (Snapshot)，確保特註、偏好、上月班表無縫移轉

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {}, 
    globalClickListener: null,
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        try {
            this.showLoading();
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
            // 確保右鍵選單
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
            
        } catch(error) {
            console.error(error);
            alert("載入失敗: " + error.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = '<div style="padding:50px;text-align:center;">載入中...</div>';
    },

    restoreTableStructure: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = `<table id="scheduleMatrix" oncontextmenu="return false;"><thead id="matrixHead"></thead><tbody id="matrixBody"></tbody><tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; border-top:2px solid #ddd;"></tfoot></table>`;
    },

    loadShifts: async function() {
        const s = await db.collection('shifts').get();
        this.shifts = s.docs.map(d => d.data());
    },

    loadUsers: async function() {
        // 載入所有人員資料，用於取得最新的特註與參數
        const s = await db.collection('users').where('isActive', '==', true).get();
        s.forEach(d => { this.usersMap[d.id] = d.data(); });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        const t = document.getElementById('matrixTitle');
        if(t) t.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const stBadge = document.getElementById('matrixStatus');
        if(stBadge) {
            const st = this.data.status || 'open';
            stBadge.textContent = st === 'open' ? '開放中' : (st==='scheduled'?'已排班':'已截止');
            stBadge.className = `badge ${st === 'open' ? 'bg-success' : 'bg-secondary'}`;
        }
    },

    // --- [核心修正] 執行排班：建立完整快照 ---
    executeSchedule: async function() {
        // 1. 檢查紅字 (違反規則)
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告：目前有人員預休超過上限 (紅字)！\n確定要強制執行嗎？")) return;
        }

        // 2. 統計未預班人數
        let submittedCount = 0;
        this.data.staffList.forEach(u => { if (this.localAssignments[u.uid]) submittedCount++; });
        const unsubmitted = this.data.staffList.length - submittedCount;
        
        const msg = `準備執行排班：\n總人數：${this.data.staffList.length}\n已預班：${submittedCount}\n未預班：${unsubmitted}\n\n執行後將鎖定此預班表並建立排班草稿。\n確定繼續？`;
        if(!confirm(msg)) return;

        try {
            this.isLoading = true;

            // 3. 建立人員資料快照 (Snapshot)
            // 將最新的 User DB 資料 (特註、懷孕、包班) 寫死進這張班表
            const snapshotStaffList = this.data.staffList.map(u => {
                const userProfile = this.usersMap[u.uid] || {};
                const params = userProfile.schedulingParams || {};
                const note = userProfile.note || ""; // 取得特註
                
                return {
                    ...u, // uid, name, level, empId
                    schedulingParams: params, // 快照排班參數 (懷孕/包班)
                    note: note // 快照特註
                };
            });

            // 4. 準備排班草稿資料
            const newScheduleData = {
                unitId: this.data.unitId,
                year: this.data.year,
                month: this.data.month,
                sourceId: this.docId, // 關聯來源
                status: 'draft',
                
                // [關鍵] 完整複製：人員快照 (含特註/參數)
                staffList: JSON.parse(JSON.stringify(snapshotStaffList)),
                
                // [關鍵] 完整複製：預班結果 (含 last_X 上月班表, preferences 偏好, REQ_OFF 預休)
                assignments: JSON.parse(JSON.stringify(this.localAssignments)),
                
                // [關鍵] 複製當下規則 (避免未來規則變動影響舊班表)
                rules: this.data.rules || {}, 
                dailyNeeds: JSON.parse(JSON.stringify(this.data.dailyNeeds || {})),

                createdBy: app.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // 5. 寫入資料庫 (Batch)
            const batch = db.batch();
            
            // A. 新增排班草稿
            const newDocRef = db.collection('schedules').doc();
            batch.set(newDocRef, newScheduleData);
            
            // B. 更新預班表狀態
            const preDocRef = db.collection('pre_schedules').doc(this.docId);
            batch.update(preDocRef, {
                status: 'scheduled',
                assignments: this.localAssignments, // 順便存最後狀態
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();

            alert("✅ 排班草稿建立成功！\n即將進入排班作業頁面...");
            window.location.hash = `/admin/schedule_editor/${newDocRef.id}`;

        } catch(e) {
            console.error(e);
            alert("執行失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // --- 渲染矩陣 (與之前相同，確保預班畫面正常) ---
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        
        // 表頭
        let h1 = `<tr><th rowspan="2">員編</th><th rowspan="2">姓名</th><th rowspan="2">特註</th><th rowspan="2">偏好</th><th colspan="6" style="background:#eee;">上月</th><th colspan="${daysInMonth}">本月 ${month} 月</th><th rowspan="2" style="background:#fff; position:sticky; right:0; border-left:2px solid #ccc;">統計</th></tr>`;
        let h2 = `<tr>`;
        for(let i=5; i>=0; i--) h2 += `<th class="cell-last-month cell-narrow">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            const c = (w===0||w===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="${c}">${d}</th>`;
        }
        h2 += `</tr>`;
        thead.innerHTML = h1 + h2;

        // 內容
        let bodyHtml = '';
        const list = this.data.staffList || [];
        list.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        list.forEach(u => {
            const userProfile = this.usersMap[u.uid] || {};
            const params = userProfile.schedulingParams || {};
            let icon = '';
            if(params.isPregnant) icon += '🤰 ';
            if(params.isBreastfeeding) icon += '🤱 ';
            
            const assign = this.localAssignments[u.uid] || {};
            const pref = assign.preferences || {};
            let prefInfo = pref.bundleShift ? `<span class="badge bg-info">包${pref.bundleShift}</span>` : '';

            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${icon}</td>
                <td style="cursor:pointer;" onclick="matrixManager.openPreferenceModal('${u.uid}','${u.name}')">${prefInfo} ✎</td>`;
            
            // 上月
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const val = assign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-last-month cell-narrow" data-type="last" data-day="${d}" onmousedown="matrixManager.onCellClick(event,this)">${this.renderCell(val)}</td>`;
            }
            // 本月
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`] || '';
                bodyHtml += `<td class="cell-narrow" data-type="current" data-day="${d}" onmousedown="matrixManager.onCellClick(event,this)">${this.renderCell(val)}</td>`;
            }
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold;">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
        
        // 底部
        let f = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i=0; i<6; i++) f += `<td style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) f += `<td id="stat_col_${d}" class="font-bold">0</td>`;
        f += `<td>-</td></tr>`;
        tfoot.innerHTML = f;
    },

    renderCell: function(v) {
        if(!v) return '';
        if(v==='OFF') return '<span style="color:#888;">OFF</span>';
        if(v==='REQ_OFF') return '<span style="color:green;font-weight:bold;">休</span>';
        if(v.startsWith('!')) return `<span style="color:red;font-size:0.8em;">🚫${v.substring(1)}</span>`;
        return `<b>${v}</b>`;
    },

    // ... (保留 updateStats, openPreferenceModal, savePreferences 等互動函式，不需更動) ...
    updateStats: function() { /* 請保留原邏輯 */ },
    onCellClick: function(e, cell) { /* 請保留原邏輯 */ },
    // 請保留原檔其餘部分
    handleLeftClick: function(uid, key) {
        if(!this.localAssignments[uid]) this.localAssignments[uid]={};
        const cur = this.localAssignments[uid][key];
        if(cur==='OFF') delete this.localAssignments[uid][key]; else this.localAssignments[uid][key]='OFF';
    },
    setupEvents: function() { /* 保留 */ },
    cleanup: function() { /* 保留 */ },
    saveData: async function() { /* 保留 */ }
};
// Hook Init
const _origInit = matrixManager.init;
matrixManager.init = function(id) { this.cleanup(); _origInit.call(this, id); };
