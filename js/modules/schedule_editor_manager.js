// js/modules/schedule_editor_manager.js
// 修正版：完全還原排班作業畫面 (含上月日期、雙層表頭、詳細統計)

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    staffMap: {},
    assignments: {},
    usersMap: {}, // 讀取使用者詳細資料(如職編)
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
                this.loadUsers(), // 載入人員資料(為了職編)
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
            window.location.hash = '/admin/schedule_list';
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
            // 建立符合截圖的表格
            container.innerHTML = `
                <table id="scheduleGrid" class="table table-bordered table-sm text-center" style="min-width: 1500px; font-size: 0.9rem;">
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
        // 為了取得職編 (Employee ID)
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

        // 標題更新
        const titleEl = document.getElementById('schTitle'); // 假設 HTML 有這個 ID
        if(titleEl) {
            let statusText = this.data.status === 'published' ? '(已發布)' : '(草稿)';
            titleEl.innerHTML = `<i class="fas fa-calendar-alt"></i> 排班作業 ${statusText}`;
        }
        
        this.updateStatusUI();
    },

    renderToolbar: function() {
        // 更新狀態標籤
        const statusBadge = document.getElementById('schStatus'); // 假設有
        if(statusBadge) {
            statusBadge.textContent = this.data.status === 'published' ? '已發布' : '草稿';
            statusBadge.className = `badge ${this.data.status === 'published' ? 'badge-primary' : 'badge-secondary'}`;
        }
    },

    // --- 核心渲染邏輯 (對照截圖) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if (!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // 計算上個月最後幾天 (為了顯示 26~月底)
        const lastMonthDate = new Date(year, month - 1, 0);
        const lastMonthEnd = lastMonthDate.getDate();
        const prevShowStart = 26; // 從 26 號開始顯示
        
        // 1. 建立表頭 (雙層)
        // 第一列：職編, 姓名, 備註, 上月日期..., 本月日期..., 統計欄位
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa; vertical-align:middle;">職編 ↑</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa; vertical-align:middle;">姓名</th>
            <th rowspan="2" style="width:60px; vertical-align:middle;">備註</th>`;
        
        // 上月日期表頭 (26~End)
        for(let d=prevShowStart; d<=lastMonthEnd; d++) {
            h1 += `<th class="cell-narrow" style="background:#eee; color:#666;">${d}</th>`;
        }
        
        // 本月日期表頭 (1~End)
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay(); // 0=Sun
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        
        // 統計欄位表頭
        h1 += `
            <th rowspan="2" style="width:40px; border-left:2px solid #ccc; color:#007bff; vertical-align:middle;">OFF</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">小夜</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">大夜</th>
            <th rowspan="2" style="width:40px; vertical-align:middle;">假日</th>
        </tr>`;

        // 第二列：星期幾
        let h2 = `<tr>`;
        // 上月星期 (空白或補上)
        for(let d=prevShowStart; d<=lastMonthEnd; d++) {
             h2 += `<th style="background:#eee;"></th>`; // 截圖上月沒有顯示星期，留白
        }
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
        // 排序：依職編
        const sortedStaff = [...this.data.staffList].sort((a,b) => {
            const idA = this.usersMap[a.uid]?.employeeId || '';
            const idB = this.usersMap[b.uid]?.employeeId || '';
            return idA.localeCompare(idB);
        });

        sortedStaff.forEach(staff => {
            const uid = staff.uid;
            const userDetail = this.usersMap[uid] || {};
            const empId = userDetail.employeeId || '';
            const note = userDetail.note || ''; // 或從 schedulingParams 讀取
            
            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:100; border-right:1px solid #ddd;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:100; font-weight:bold; border-right:1px solid #ddd;">${staff.name}</td>
                <td style="font-size:0.8rem; color:#666;">${note}</td>`;
            
            // 上月資料格子 (唯讀/參考)
            // 需注意：formal schedule 可能沒有存上個月資料，若無則顯示空或嘗試讀取 pre_schedule 的 last_
            for(let d=prevShowStart; d<=lastMonthEnd; d++) {
                // 嘗試從 assignments 讀取 last_X，若無則空
                const key = `last_${d}`;
                const val = (this.assignments[uid] && this.assignments[uid][key]) || '';
                bodyHtml += `<td class="cell-narrow" style="background:#f9f9f9; color:#999;">${val}</td>`;
            }

            // 本月資料格子 (可操作)
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = (this.assignments[uid] && this.assignments[uid][key]) || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                            data-uid="${uid}" data-day="${d}"
                            style="cursor:pointer;">
                            ${this.renderCellContent(val)}
                         </td>`;
            }

            // 統計格子 (ID 用於後續更新)
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
            <td colspan="3" style="position:sticky; left:0; background:#f9f9f9; z-index:100; text-align:right; padding-right:10px;">每日上班人數</td>`;
        // 上月留白
        for(let d=prevShowStart; d<=lastMonthEnd; d++) fHtml += `<td></td>`;
        // 本月統計
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
        
        // 班別顏色
        const shift = this.shifts.find(s => s.code === val);
        const bg = shift ? shift.color : '#3498db';
        return `<span class="badge" style="background:${bg}; color:white;">${val}</span>`;
    },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            // 右鍵選單
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day);
                return false;
            });
            // 左鍵點擊 (可選: 反白選取或直接切換)
            cell.addEventListener('click', (e) => {
                // 暫時不做動作，或可加入選取邏輯
            });
        });
    },

    // --- 統計更新 (對照截圖右側) ---
    updateRealTimeStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dayCounts = {}; // 每日上班人數
        for(let d=1; d<=daysInMonth; d++) dayCounts[d] = 0;

        this.data.staffList.forEach(s => {
            let off = 0, eCount = 0, nCount = 0, hol = 0;
            const uid = s.uid;
            
            for(let d=1; d<=daysInMonth; d++) {
                const val = (this.assignments[uid] && this.assignments[uid][`current_${d}`]);
                const date = new Date(this.data.year, this.data.month - 1, d);
                const isWeekend = (date.getDay()===0 || date.getDay()===6);

                // 統計個人
                if (val === 'OFF' || val === 'REQ_OFF') {
                    off++;
                    if (isWeekend) hol++; // 簡易假日定義，可根據班表定義調整
                } else if (val === 'E') {
                    eCount++;
                } else if (val === 'N') {
                    nCount++;
                }

                // 統計每日
                if (val && val !== 'OFF' && val !== 'REQ_OFF') {
                    dayCounts[d]++;
                }
            }

            // 更新 DOM
            const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            setTxt(`stat_off_${uid}`, off);
            setTxt(`stat_E_${uid}`, eCount);
            setTxt(`stat_N_${uid}`, nCount);
            setTxt(`stat_hol_${uid}`, hol);
        });

        // 更新底部
        for(let d=1; d<=daysInMonth; d++) {
            const el = document.getElementById(`day_count_${d}`);
            if(el) el.textContent = dayCounts[d];
        }
    },

    // --- 右鍵選單 ---
    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        if (!menu) return;

        let list = menu.querySelector('ul');
        if(!list) list = menu;
        list.innerHTML = '';

        // 標題
        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px; background:#f8f9fa; font-weight:bold; border-bottom:1px solid #ddd;">${d}日 設定</div>`;
        list.appendChild(header);

        // 班別選項
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

        // OFF & Clear
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

        // 定位
        menu.style.display = 'block';
        
        // 防止溢出螢幕
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
            
            // 局部更新
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

    // --- AI 與 存檔 (整合 V2) ---
    runAI: async function() {
        if (!confirm("確定要執行 AI 排班嗎？\n這將重新計算並覆蓋現有草稿 (預休除外)。")) return;
        this.isLoading = true;
        this.showLoading();
        
        try {
            // 準備資料
            const staffListForAI = this.data.staffList.map(s => ({
                id: s.uid, uid: s.uid, name: s.name,
                packageType: s.packageType || '', prefs: s.preferences || {}
            }));

            // 讀取規則
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                tolerance: 2, 
                backtrackDepth: 3,
                ...(this.data.settings || {})
            };

            // 呼叫 Factory
            if (typeof SchedulerFactory === 'undefined') throw new Error("SchedulerFactory 未載入");
            
            // 傳入上個月資料 (若有)
            const lastMonthData = {}; // 暫時為空，若 assignments 有 last_ 可整理進去

            const scheduler = SchedulerFactory.create('V2', staffListForAI, this.data.year, this.data.month, lastMonthData, rules);
            const aiResult = scheduler.run();

            // 套用結果
            this.applyAIResult(aiResult);
            
            // 重繪
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(true);
            
            alert("✅ AI 排班完成！");

        } catch (e) {
            console.error(e);
            alert("AI 執行失敗: " + e.message);
            this.renderMatrix(); // 恢復
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
                        // 直接寫入
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
