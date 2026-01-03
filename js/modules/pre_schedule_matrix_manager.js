// js/modules/pre_schedule_matrix_manager.js

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {}, 
    targetCell: null, // 右鍵點擊的目標格
    isLoading: false,

    init: async function(id) {
        console.log("🎯 Matrix Manager Init:", id);
        
        if(!id) {
            alert("錯誤: 缺少預班表 ID");
            window.location.hash = '/admin/pre_schedules';
            return;
        }

        this.docId = id;
        this.isLoading = true;
        this.showLoading();

        try {
            // 平行載入資料
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);

            // 渲染畫面
            this.renderToolbar();
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();

            // [修正] 確保右鍵選單被移到 body 層級，避免被表格遮擋
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }

            console.log("✅ Matrix 初始化完成");

        } catch(error) {
            console.error("Matrix Init Error:", error);
            alert("載入失敗: " + error.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const container = document.getElementById('matrixContainer');
        if(container) container.innerHTML = '<div style="padding:50px; text-align:center;">載入中...</div>';
    },

    // --- 1. 資料載入 ---
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

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(!doc.exists) throw new Error("預班表不存在");
        
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        // 過濾班別
        if(this.data.unitId) {
            this.shifts = this.shifts.filter(s => s.unitId === this.data.unitId);
        }
    },

    // --- 2. 渲染 ---
    renderToolbar: function() {
        const title = document.getElementById('matrixTitle');
        const status = document.getElementById('matrixStatus');
        if(title) title.textContent = `${this.data.year} 年 ${this.data.month} 月 - 預班矩陣`;
        if(status) {
            status.textContent = this.data.status === 'open' ? '進行中' : '已截止';
            status.className = `badge ${this.data.status === 'open' ? 'badge-success' : 'badge-warning'}`;
        }
    },

    renderMatrix: function() {
        // 尋找或建立表格容器
        let grid = document.getElementById('matrixTable');
        if (!grid) {
            const container = document.querySelector('.page-section');
            if (container) {
                const wrap = document.createElement('div');
                wrap.className = 'table-container';
                wrap.style.overflow = 'auto';
                wrap.style.maxHeight = 'calc(100vh - 150px)';
                wrap.innerHTML = '<table id="matrixTable"></table>';
                
                const toolbar = container.querySelector('.toolbar') || container.querySelector('div:first-child');
                if(toolbar && toolbar.nextSibling) {
                    container.insertBefore(wrap, toolbar.nextSibling);
                } else {
                    container.appendChild(wrap);
                }
                grid = document.getElementById('matrixTable');
            }
        }
        
        if (!grid) return;

        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        let html = '<thead><tr><th style="min-width:100px; position:sticky; left:0; z-index:10; background:#fff;">人員</th>';
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = ['日','一','二','三','四','五','六'][date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            html += `<th style="text-align:center; ${color}">${d}<br><small>${dayOfWeek}</small></th>`;
        }
        html += '</tr></thead><tbody>';

        const staffList = this.data.staffList || [];
        
        staffList.forEach(staff => {
            const uid = staff.uid;
            html += `<tr>
                <td style="position:sticky; left:0; background:#f9f9f9; z-index:5; font-weight:bold; border-right:1px solid #ddd;">
                    ${staff.name} <span style="font-size:0.8rem; color:#666;">(${staff.employeeId})</span>
                </td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = (this.localAssignments[uid] && this.localAssignments[uid][key]) || '';
                
                let style = '';
                if(val === 'REQ_OFF') style = 'background:#2ecc71; color:white;';
                else if(val.startsWith('!')) style = 'background:#34495e; color:white;';
                else if(val) {
                    const shift = this.shifts.find(s => s.code === val);
                    if(shift) style = `background:${shift.color}; color:white;`;
                }

                html += `<td class="matrix-cell" 
                            style="text-align:center; cursor:pointer; ${style}"
                            oncontextmenu="matrixManager.handleRightClick(event, '${uid}', ${d})"
                            onclick="matrixManager.handleCellClick('${uid}', ${d})">
                            ${val}
                         </td>`;
            }
            html += '</tr>';
        });

        html += '</tbody>';
        grid.innerHTML = html;
    },

    updateStats: function() {
        // 更新統計 (可依需求實作)
    },

    // --- 3. [關鍵修正] 動態生成右鍵選單 ---
    handleRightClick: function(e, uid, day) {
        e.preventDefault();
        this.targetCell = { uid, day };

        const menu = document.getElementById('customContextMenu');
        if (!menu) return;

        // [重要] 這裡負責填入內容，解決空白問題
        const ul = menu.querySelector('ul') || menu;
        ul.innerHTML = ''; // 清空舊內容

        // 1. 標題
        const header = document.createElement('li');
        header.innerHTML = `<div style="padding:5px 10px; background:#f1f1f1; font-weight:bold; border-bottom:1px solid #ddd;">${day}號 設定</div>`;
        header.style.pointerEvents = 'none';
        ul.appendChild(header);

        // 2. 特殊選項 (預休, 指定白班)
        const specialOps = [
            { code: 'REQ_OFF', name: '預休 (REQ_OFF)', color: '#2ecc71' },
            { code: '!D', name: '指定白班 (!D)', color: '#34495e' }
        ];

        specialOps.forEach(op => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${op.color};margin-right:8px;border-radius:50%;"></span>${op.name}`;
            li.className = 'menu-item'; // 使用 CSS class
            li.style.padding = '8px 12px';
            li.style.cursor = 'pointer';
            li.onclick = () => this.setShift(op.code);
            // 簡單 hover 效果
            li.onmouseover = () => li.style.background = '#f9f9f9';
            li.onmouseout = () => li.style.background = 'white';
            ul.appendChild(li);
        });

        // 3. 一般班別
        this.shifts.forEach(s => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${s.color};margin-right:8px;border-radius:50%;"></span>${s.code}`;
            li.style.padding = '8px 12px';
            li.style.cursor = 'pointer';
            li.onclick = () => this.setShift(s.code);
            li.onmouseover = () => li.style.background = '#f9f9f9';
            li.onmouseout = () => li.style.background = 'white';
            ul.appendChild(li);
        });

        // 4. 清除
        const clearLi = document.createElement('li');
        clearLi.innerHTML = `<span style="color:red;"><i class="fas fa-times"></i> 清除設定</span>`;
        clearLi.style.padding = '8px 12px';
        clearLi.style.cursor = 'pointer';
        clearLi.style.borderTop = '1px solid #eee';
        clearLi.onclick = () => this.setShift(null);
        clearLi.onmouseover = () => clearLi.style.background = '#fff0f0';
        clearLi.onmouseout = () => clearLi.style.background = 'white';
        ul.appendChild(clearLi);

        // 顯示位置
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    setShift: function(val) {
        if (!this.targetCell) return;
        const { uid, day } = this.targetCell;
        const key = `current_${day}`;

        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};

        if (val === null) {
            delete this.localAssignments[uid][key];
        } else {
            this.localAssignments[uid][key] = val;
        }

        document.getElementById('customContextMenu').style.display = 'none';
        this.renderMatrix(); 
    },

    handleCellClick: function(uid, d) {
        // 左鍵點擊 (保留擴充性)
    },

    setupEvents: function() {
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu) menu.style.display = 'none';
        };
        document.addEventListener('click', this.globalClickListener);
    },
    
    // --- 4. 存檔與執行 ---
    saveData: async function(silent = false) {
        if (!this.docId) return;
        try {
            if(!silent) this.isLoading = true;
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if(!silent) alert("✅ 預班草稿已儲存");
        } catch(e) { 
            console.error(e); 
            if(!silent) alert("儲存失敗: " + e.message); 
        } finally { 
            if(!silent) this.isLoading = false; 
        }
    },

    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告:有紅字!確定強制執行?")) return;
        }
        if(!confirm("即將鎖定預班表，並建立正式排班草稿。\n確定繼續？")) return;

        this.isLoading = true;
        this.showLoading();

        try {
            const initialAssignments = {};
            Object.keys(this.localAssignments).forEach(uid => {
                const userAssigns = this.localAssignments[uid];
                initialAssignments[uid] = {};
                Object.keys(userAssigns).forEach(key => {
                    if (key.startsWith('current_')) {
                        const val = userAssigns[key];
                        if (val === 'REQ_OFF') initialAssignments[uid][key] = 'OFF';
                        else if (val && !val.startsWith('!')) initialAssignments[uid][key] = val;
                    }
                });
            });

            const scheduleData = {
                preScheduleId: this.docId,
                sourceId: this.docId,
                unitId: this.data.unitId,
                year: this.data.year,
                month: this.data.month,
                status: 'draft',
                settings: this.data.settings || {},
                staffList: this.data.staffList || [],
                dailyNeeds: this.data.dailyNeeds || {}, 
                groupLimits: this.data.groupLimits || {},
                assignments: initialAssignments,
                stats: {}, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            const preRef = db.collection('pre_schedules').doc(this.docId);
            batch.update(preRef, { status: 'closed' });

            const newScheduleRef = db.collection('schedules').doc();
            batch.set(newScheduleRef, scheduleData);

            await batch.commit();

            alert("🎉 預班已鎖定，正在轉跳至排班作業介面...");
            window.location.hash = `/admin/schedule_editor?id=${newScheduleRef.id}`;

        } catch(e) { 
            console.error(e);
            alert("執行失敗: " + e.message); 
            this.renderMatrix(); 
        } finally { 
            this.isLoading = false; 
        }
    },
    
    cleanup: function() {
        if(this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
        }
        const menu = document.getElementById('customContextMenu');
        if (menu) menu.style.display = 'none';
    }
};
