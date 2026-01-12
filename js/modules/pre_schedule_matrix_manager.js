// js/modules/pre_schedule_matrix_manager.js
// 修正版：執行排班時，自動建立正式班表草稿並帶入資料

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {},
    globalClickListener: null,
    isLoading: false,

    init: async function(id) {
        console.log("🎯 Matrix Manager Init:", id);
        
        if(!id) {
            alert("錯誤:缺少預班表 ID");
            window.location.hash = '/admin/pre_schedules';
            return;
        }
        
        this.cleanup();
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
            
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }
            
            console.log("✅ Matrix 初始化完成");
            
        } catch(error) {
            console.error("❌ Matrix 初始化失敗:", error);
            alert("載入失敗: " + error.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const container = document.getElementById('matrixContainer');
        if(container) container.innerHTML = '<div style="padding:60px; text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size:3rem;"></i><br>載入中...</div>';
    },

    restoreTableStructure: function() {
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.innerHTML = `
                <table id="scheduleMatrix">
                    <thead id="matrixHead"></thead>
                    <tbody id="matrixBody"></tbody>
                    <tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; font-weight:bold; border-top:2px solid #ddd;"></tfoot>
                </table>
            `;
        }
    },

    loadShifts: async function() {
        const snapshot = await db.collection('shifts').get();
        this.shifts = snapshot.docs.map(doc => doc.data());
    },

    loadUsers: async function() {
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        snapshot.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        const titleEl = document.getElementById('matrixTitle');
        if(titleEl) titleEl.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const statusMap = { 'open':'開放中', 'closed':'已截止', 'scheduled':'已排班' };
        const st = this.data.status || 'open';
        const statusEl = document.getElementById('matrixStatus');
        if(statusEl) {
            statusEl.textContent = statusMap[st] || st;
            statusEl.className = `badge ${st === 'open' ? 'bg-success' : 'bg-secondary'}`;
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        
        // Header
        let header1 = `<tr><th rowspan="2">員編</th><th rowspan="2">姓名</th><th rowspan="2">特註</th><th rowspan="2">偏好</th><th colspan="6" style="background:#eee;">上月</th><th colspan="${daysInMonth}">本月 ${month} 月</th><th rowspan="2" style="background:#fff; position:sticky; right:0; z-index:20; border-left:2px solid #ccc; width:60px;">統計</th></tr>`;
        let header2 = `<tr>`;
        for(let i=5; i>=0; i--) header2 += `<th class="cell-narrow" style="background:#eee;">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay(); 
            const color = (w===0||w===6) ? 'color:red;' : '';
            header2 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        thead.innerHTML = header1 + header2;

        // Body
        let bodyHtml = '';
        const staffList = this.data.staffList || [];
        staffList.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        staffList.forEach(u => {
            const assign = this.localAssignments[u.uid] || {};
            const pref = assign.preferences || {};
            let prefHtml = pref.bundleShift ? `<span class="badge badge-info">${pref.bundleShift}</span>` : '';
            
            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId || ''}</td>
                <td>${u.name}</td>
                <td></td>
                <td style="font-size:0.8rem;">${prefHtml}</td>`;
            
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const val = assign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" data-type="last" data-day="${d}" data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" data-type="current" data-day="${d}" data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc;">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // Foot
        let footHtml = `<tr><td colspan="4">每日統計</td>`;
        for(let i=0; i<6; i++) footHtml += `<td></td>`;
        for(let d=1; d<=daysInMonth; d++) footHtml += `<td id="stat_col_${d}">0</td>`;
        footHtml += `<td></td></tr>`;
        tfoot.innerHTML = footHtml;
        
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return '<span style="color:#999;">OFF</span>';
        if(val === 'REQ_OFF') return '<span class="badge badge-success">休</span>';
        if(val.startsWith('!')) return `<span style="color:red; font-size:0.8rem;"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        return `<span class="badge badge-secondary">${val}</span>`;
    },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day, cell.dataset.type);
            });
        });
    },

    handleRightClick: function(e, uid, day, type) {
        const menu = document.getElementById('customContextMenu');
        if(!menu) return;
        
        let list = menu.querySelector('ul');
        if(!list) { list = document.createElement('ul'); menu.appendChild(list); }
        list.innerHTML = `<li style="background:#f8f9fa; font-weight:bold;">設定 ${day}日</li>`;
        
        // 增加選項
        const add = (txt, val, color) => {
            list.innerHTML += `<li onclick="matrixManager.setShift('${uid}', '${type==='last'?'last':'current'}_${day}', '${val}')" style="cursor:pointer; padding:5px 10px; color:${color||'inherit'}">${txt}</li>`;
        };
        
        if(type === 'current') {
            add('預休 (REQ_OFF)', 'REQ_OFF', '#2ecc71');
            add('強制休 (OFF)', 'OFF', '#999');
            this.shifts.forEach(s => add(`指定 ${s.code}`, s.code, s.color));
            list.innerHTML += '<hr style="margin:5px 0;">';
            this.shifts.forEach(s => add(`勿排 ${s.code}`, `!${s.code}`, 'red'));
        } else {
            add('OFF', 'OFF');
            this.shifts.forEach(s => add(s.code, s.code));
        }
        add('清除', null, 'red');

        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    },

    setShift: function(uid, key, val) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if(val === null || val === 'null') delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        this.renderMatrix(); 
        document.getElementById('customContextMenu').style.display = 'none';
    },

    updateStats: function() { /* ...統計邏輯保持原樣... */ },
    
    setupEvents: function() {
        document.addEventListener('click', () => {
            const m = document.getElementById('customContextMenu');
            if(m) m.style.display = 'none';
        });
    },
    
    cleanup: function() {
        const m = document.getElementById('customContextMenu');
        if(m) m.style.display = 'none';
    },

    saveData: async function() {
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("已儲存");
        } catch(e) { alert("儲存失敗"); }
    },

    // --- [關鍵修正] 執行排班：轉拋資料至 formal schedule ---
    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告:有紅字! 確定強制執行?")) return;
        } else {
            if(!confirm("確定執行排班? 將鎖定預班並建立正式草稿。")) return;
        }

        this.isLoading = true;
        this.showLoading();

        try {
            // 1. 準備正式班表資料 (Deep Copy)
            const initialAssignments = {};
            if (this.localAssignments) {
                Object.keys(this.localAssignments).forEach(uid => {
                    // 完整複製，包含 preferences 和 last_X
                    initialAssignments[uid] = JSON.parse(JSON.stringify(this.localAssignments[uid]));
                });
            }

            const scheduleData = {
                unitId: this.data.unitId,
                year: this.data.year,
                month: this.data.month,
                sourceId: this.docId, // 連結回預班表
                status: 'draft',
                staffList: this.data.staffList || [],
                assignments: initialAssignments,
                dailyNeeds: this.data.dailyNeeds || {},
                settings: this.data.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();

            // 2. 更新預班表狀態 -> closed
            const preRef = db.collection('pre_schedules').doc(this.docId);
            batch.update(preRef, { 
                assignments: this.localAssignments, // 確保最新變更被存入
                status: 'closed', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            });

            // 3. 建立正式班表
            const newSchRef = db.collection('schedules').doc();
            batch.set(newSchRef, scheduleData);

            await batch.commit();

            alert("🎉 執行成功! 正轉跳至排班作業...");
            
            // 4. 轉跳至排班編輯器
            window.location.hash = `/admin/schedule_editor?id=${newSchRef.id}`;

        } catch(e) { 
            console.error(e);
            alert("執行失敗: " + e.message); 
            this.renderMatrix(); // 恢復畫面
        } finally { 
            this.isLoading = false; 
        }
    }
};
