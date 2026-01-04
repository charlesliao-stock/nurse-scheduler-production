// js/modules/schedule_editor_manager.js
// 修正版：UI 優化 (不斷行、新增偏好欄位、修正上月顯示) & AI 資料串接修正

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    staffMap: {},
    assignments: {},
    usersMap: {}, 
    isLoading: false,
    targetCell: null, 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;

        if (!app.currentUser) {
            alert("請先登入");
            return;
        }
        
        this.cleanup();
        this.showLoading();

        try {
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadContext()
            ]);
            
            this.assignments = this.data.assignments || {};

            // 1. 還原表格結構
            this.restoreTableStructure();
            
            // 2. 渲染畫面
            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats();
            this.setupEvents();
            
            // 3. 確保選單存在
            const menu = document.getElementById('schContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }

            console.log("✅ 排班編輯器初始化完成");

        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
            // window.location.hash = '/admin/schedule_list'; // 暫時註解方便除錯
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const container = document.getElementById('matrixContainer');
        if(container) container.innerHTML = '<div style="padding:60px; text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><br>載入排班資料中...</div>';
    },

    restoreTableStructure: function() {
        let container = document.getElementById('matrixContainer');
        if (!container) {
            const page = document.querySelector('.page-section');
            if (page) {
                container = document.createElement('div');
                container.id = 'matrixContainer';
                // 設定容器樣式以支援捲動
                container.style.cssText = "width:100%; overflow:auto; max-height:calc(100vh - 180px); margin-top:10px; border:1px solid #ddd; background:#fff;";
                
                const header = page.querySelector('.toolbar') || page.querySelector('div:first-child');
                if(header && header.nextSibling) page.insertBefore(container, header.nextSibling);
                else page.appendChild(container);
            }
        }

        if(container) {
            container.innerHTML = `
                <table id="scheduleGrid" class="table table-bordered table-sm text-center" style="min-width: 1800px; font-size: 0.9rem;">
                    <thead id="schHead" class="thead-light" style="position:sticky; top:0; z-index:100;"></thead>
                    <tbody id="schBody"></tbody>
                    <tfoot id="schFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:90; border-top:2px solid #ddd;"></tfoot>
                </table>
            `;
        }
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(doc => {
            this.usersMap[doc.id] = doc.data();
        });
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("找不到此排班表");
        
        this.data = doc.data();
        if(this.data.unitId) {
            this.shifts = this.shifts.filter(s => s.unitId === this.data.unitId);
        }

        this.data.staffList.forEach(s => {
            this.staffMap[s.uid] = s;
        });

        const titleEl = document.getElementById('schTitle'); 
        if(titleEl) {
            let statusText = this.data.status === 'published' ? '(已發布)' : '(草稿)';
            titleEl.innerHTML = `<i class="fas fa-calendar-alt"></i> 排班作業 ${statusText}`;
        }
        
        this.renderToolbar();
    },

    renderToolbar: function() {
        const statusBadge = document.getElementById('schStatus'); 
        if(statusBadge) {
            statusBadge.textContent = this.data.status === 'published' ? '已發布' : '草稿';
            statusBadge.className = `badge ${this.data.status === 'published' ? 'badge-primary' : 'badge-secondary'}`;
        }
    },

    // --- 核心渲染邏輯 ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if (!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // [修正] 固定顯示上個月最後 6 天
        const lastMonthDate = new Date(year, month - 1, 0);
        const lastMonthEnd = lastMonthDate.getDate();
        const prevShowDays = 6; 
        
        // 1. 建立表頭 (雙層)
        // 第一列
        let h1 = `<tr>
            <th rowspan="2" style="width:50px; position:sticky; left:0; z-index:110; background:#f8f9fa; vertical-align:middle;">職編 ↑</th>
            <th rowspan="2" style="width:50px; position:sticky; left:60px; z-index:110; background:#f8f9fa; vertical-align:middle;">姓名</th>
            <th rowspan="2" style="width:20px; vertical-align:middle;">備</th>
            <th rowspan="2" style="width:20px; vertical-align:middle;">包</th>
            <th rowspan="2" style="width:80px; vertical-align:middle;">排班偏好</th>`; // [新增]
        
        // 上月日期表頭
        for(let i=prevShowDays-1; i>=0; i--) {
            const d = lastMonthEnd - i;
            h1 += `<th class="cell-narrow" style="background:#eee; color:#666;">${d}</th>`;
        }
        
        // 本月日期表頭
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay(); 
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        
        // 統計欄位
        h1 += `
            <th rowspan="2" style="width:40px; border-left:2px solid #ccc; color:#007bff; vertical-align:middle;">OFF</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">小夜</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">大夜</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">假日</th>
        </tr>`;

        // 第二列：星期幾
        let h2 = `<tr>`;
        // 上月星期 (空白)
        for(let i=0; i<prevShowDays; i++) h2 += `<th style="background:#eee;"></th>`;
        
        // 本月星期
        const weeks = ['日','一','二','三','四','五','六'];
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `</tr>`;

        thead.innerHTML = h1 + h2;

        // 2. 建立內容 (Body)
        let bodyHtml = '';
        const sortedStaff = [...this.data.staffList].sort((a,b) => {
            const idA = this.usersMap[a.uid]?.employeeId || '';
            const idB = this.usersMap[b.uid]?.employeeId || '';
            return idA.localeCompare(idB);
        });

        sortedStaff.forEach(staff => {
            const uid = staff.uid;
            const userDetail = this.usersMap[uid] || {};
            const empId = userDetail.employeeId || '';
            const note = userDetail.note || ''; 
            
            // 讀取偏好資料 (從 assignments 中讀取，這是由 pre_schedule 轉過來的)
            const userAssign = this.assignments[uid] || {};
            const userPrefs = userAssign.preferences || {};
            
            // 處理包班顯示
            let bundleHtml = '-';
            if (userPrefs.bundleShift) {
                bundleHtml = `<span class="badge badge-info">${userPrefs.bundleShift}</span>`;
            }

            // 處理志願顯示
            let prefHtml = '';
            const priorities = [];
            if(userPrefs.priority_1) priorities.push(userPrefs.priority_1);
            if(userPrefs.priority_2) priorities.push(userPrefs.priority_2);
            if(userPrefs.priority_3) priorities.push(userPrefs.priority_3);
            if(priorities.length > 0) {
                prefHtml = `<span style="font-size:0.8rem; color:#666;">${priorities.join('>')}</span>`;
            } else {
                prefHtml = '<span style="color:#ccc;">-</span>';
            }

            // [修正] 姓名加入 white-space: nowrap
            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:100; border-right:1px solid #ddd;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:100; font-weight:bold; border-right:1px solid #ddd; white-space: nowrap;">${staff.name}</td>
                <td style="font-size:0.8rem; color:#666;">${note}</td>
                <td>${bundleHtml}</td>
                <td>${prefHtml}</td>`;
            
            // 上月資料格子 (顯示最後 6 天)
            for(let i=prevShowDays-1; i>=0; i--) {
                const d = lastMonthEnd - i;
                const key = `last_${d}`;
                const val = userAssign[key] || '';
                bodyHtml += `<td class="cell-narrow" style="background:#f9f9f9; color:#999;">${val}</td>`;
            }

            // 本月資料格子
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = userAssign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                            data-uid="${uid}" data-day="${d}"
                            style="cursor:pointer;">
                            ${this.renderCellContent(val)}
                         </td>`;
            }

            // 統計格子
            bodyHtml += `
                <td id="stat_off_${uid}" style="border-left:2px solid #ccc; font-weight:bold; color:#007bff;">0</td>
                <td id="stat_E_${uid}">0</td>
                <td id="stat_N_${uid}">0</td>
                <td id="stat_hol_${uid}">0</td>
            </tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部 (每日統計)
        let fHtml = `<tr>
            <td colspan="5" style="position:sticky; left:0; background:#f9f9f9; z-index:100; text-align:right; padding-right:10px;">每日上班人數</td>`;
        for(let i=0; i<prevShowDays; i++) fHtml += `<td></td>`;
        for(let d=1; d<=daysInMonth; d++) {
            fHtml += `<td id="day_count_${d}" style="font-weight:bold;">0</td>`;
        }
        fHtml += `<td colspan="4"></td></tr>`;
        tfoot.innerHTML = fHtml;

        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if (!val) return '';
        if (val === 'OFF') return '<span style="color:#bdc3c7; font-weight:bold;">OFF</span>';
        if (val === 'REQ_OFF') return '<span class="badge badge-success">休</span>';
        
        const shift = this.shifts.find(s => s.code === val);
        const bg = shift ? shift.color : '#3498db';
        return `<span class="badge" style="background:${bg}; color:white;">${val}</span>`;
    },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day);
                return false;
            });
        });
    },

    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dayCounts = {}; 
        for(let d=1; d<=daysInMonth; d++) dayCounts[d] = 0;

        this.data.staffList.forEach(s => {
            let off = 0, eCount = 0, nCount = 0, hol = 0;
            const uid = s.uid;
            
            for(let d=1; d<=daysInMonth; d++) {
                const val = (this.assignments[uid] && this.assignments[uid][`current_${d}`]);
                const date = new Date(this.data.year, this.data.month - 1, d);
                const isWeekend = (date.getDay()===0 || date.getDay()===6);

                if (val === 'OFF' || val === 'REQ_OFF') {
                    off++;
                    if (isWeekend) hol++;
                } else if (val === 'E') {
                    eCount++;
                } else if (val === 'N') {
                    nCount++;
                }

                if (val && val !== 'OFF' && val !== 'REQ_OFF') {
                    dayCounts[d]++;
                }
            }

            const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            setTxt(`stat_off_${uid}`, off);
            setTxt(`stat_E_${uid}`, eCount);
            setTxt(`stat_N_${uid}`, nCount);
            setTxt(`stat_hol_${uid}`, hol);
        });

        for(let d=1; d<=daysInMonth; d++) {
            const el = document.getElementById(`day_count_${d}`);
            if(el) el.textContent = dayCounts[d];
        }
    },

    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        if (!menu) return;

        let list = menu.querySelector('ul');
        if(!list) list = menu;
        list.innerHTML = '';

        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px; background:#f8f9fa; font-weight:bold; border-bottom:1px solid #ddd;">${d}日 設定</div>`;
        list.appendChild(header);

        this.shifts.forEach(s => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="color:${s.color}; font-weight:bold;">●</span> ${s.code} (${s.name})`;
            li.style.padding = '8px 15px';
            li.style.cursor = 'pointer';
            li.onmouseover = () => li.style.background = '#f1f1f1';
            li.onmouseout = () => li.style.background = '#fff';
            li.onclick = () => { this.setShift(s.code); menu.style.display = 'none'; };
            list.appendChild(li);
        });

        const addOpt = (text, code, color) => {
            const li = document.createElement('li');
            li.innerHTML = text;
            li.style.padding = '8px 15px';
            li.style.cursor = 'pointer';
            if(color) li.style.color = color;
            li.onmouseover = () => li.style.background = '#f1f1f1';
            li.onmouseout = () => li.style.background = '#fff';
            li.onclick = () => { this.setShift(code); menu.style.display = 'none'; };
            list.appendChild(li);
        };
        
        list.appendChild(document.createElement('hr'));
        addOpt('OFF (排休)', 'OFF');
        addOpt('<i class="fas fa-trash"></i> 清除', null, 'red');

        menu.style.display = 'block';
        
        const menuWidth = 200;
        const menuHeight = menu.offsetHeight || 300;
        let left = e.pageX;
        let top = e.pageY;
        if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
        if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    },

    setShift: function(code) {
        if (this.targetCell) {
            const { uid, d } = this.targetCell;
            if (!this.assignments[uid]) this.assignments[uid] = {};
            
            const key = `current_${d}`;
            if (code === null) delete this.assignments[uid][key];
            else this.assignments[uid][key] = code;
            
            const cell = document.querySelector(`td[data-uid="${uid}"][data-day="${d}"]`);
            if(cell) cell.innerHTML = this.renderCellContent(code);
            
            this.updateRealTimeStats();
        }
    },

    setupEvents: function() {
        this.globalClickListener = (e) => {
            const menu = document.getElementById('schContextMenu');
            if (menu) menu.style.display = 'none';
        };
        document.addEventListener('click', this.globalClickListener);
    },
    
    cleanup: function() {
        if(this.globalClickListener) document.removeEventListener('click', this.globalClickListener);
        const menu = document.getElementById('schContextMenu');
        if(menu) menu.style.display = 'none';
    },

    // --- AI 與 存檔 (修正連結 V2) ---
    runAI: async function() {
        if (!confirm("確定要執行 AI 排班嗎？\n這將重新計算並覆蓋現有草稿 (預休除外)。")) return;
        this.isLoading = true;
        this.showLoading();
        
        try {
            // [關鍵修正] 準備資料時，必須把 assignments 裡的 preferences 帶入
            // 因為 staffList 只有基本資料，偏好是跟著 assignments 走的
            const staffListForAI = this.data.staffList.map(s => {
                const userAssign = this.assignments[s.uid] || {};
                const userPrefs = userAssign.preferences || {};
                
                return {
                    id: s.uid, 
                    uid: s.uid, 
                    name: s.name,
                    packageType: s.packageType || '', 
                    prefs: userPrefs // 這裡必須正確傳入，AI 才能讀到志願
                };
            });

            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                tolerance: 2, 
                backtrackDepth: 3,
                ...(this.data.settings || {})
            };

            if (typeof SchedulerFactory === 'undefined') throw new Error("SchedulerFactory 未載入");
            
            // 呼叫 SchedulerV2
            const scheduler = SchedulerFactory.create('V2', staffListForAI, this.data.year, this.data.month, {}, rules);
            const aiResult = scheduler.run();

            this.applyAIResult(aiResult);
            
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(true);
            
            alert("✅ AI 排班完成！");

        } catch (e) {
            console.error(e);
            alert("AI 執行失敗: " + e.message);
            this.renderMatrix(); 
        } finally {
            this.isLoading = false;
        }
    },

    applyAIResult: function(aiSchedule) {
        Object.keys(aiSchedule).forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]);
            const daySch = aiSchedule[dateStr];
            ['N','E','D','OFF'].forEach(code => {
                if(daySch[code]) {
                    daySch[code].forEach(uid => {
                        if(!this.assignments[uid]) this.assignments[uid] = {};
                        this.assignments[uid][`current_${day}`] = code;
                    });
                }
            });
        });
    },

    saveDraft: async function(silent = false) {
        try {
            if (!silent) this.isLoading = true;
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (!silent) alert("✅ 草稿已儲存");
        } catch (e) {
            alert("儲存失敗: " + e.message);
        } finally {
            if (!silent) this.isLoading = false;
        }
    },

    publishSchedule: async function() {
        if (!confirm("確定要發布？發布後員工可見。")) return;
        try {
            this.isLoading = true;
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                assignments: this.assignments,
                publishedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("🎉 已發布！");
        } catch (e) { alert("發布失敗: " + e.message); }
        finally { this.isLoading = false; }
    }
};
