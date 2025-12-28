// js/modules/schedule_editor_manager.js

const scheduleEditorManager = {
    scheduleId: null,
    data: null,      // Schedule Document Data
    shifts: [],      // Shift Definitions
    shiftMap: {},    // Code -> Shift Object
    staffMap: {},    // Uid -> Staff Object
    assignments: {}, // Current working assignments
    stats: {},       // Real-time stats
    
    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        
        if (!app.currentUser) return;

        await this.loadContext();
        this.renderMatrix();
        this.updateRealTimeStats();
        this.setupEvents();
    },

    loadContext: async function() {
        try {
            // 1. 載入排班資料
            const doc = await db.collection('schedules').doc(this.scheduleId).get();
            if (!doc.exists) throw new Error("班表不存在");
            this.data = doc.data();
            this.assignments = this.data.assignments || {};

            // 2. 載入班別 (取得顏色等資訊)
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            // 3. 建立人員 Map (加速查找)
            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            // 更新標題
            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            const st = this.data.status;
            const badge = document.getElementById('schStatus');
            badge.textContent = st === 'published' ? '已發布' : '草稿';
            badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;

        } catch(e) {
            console.error(e);
            alert("載入失敗: " + e.message);
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();

        // --- 表頭 ---
        let h1 = `<tr><th rowspan="2" style="width:60px;">姓名</th><th rowspan="2" style="width:40px;">職級</th>`;
        let h2 = `<tr>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const weekDay = date.getDay(); // 0=Sun
            const color = (weekDay===0 || weekDay===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
            // 可加星期幾
        }
        h1 += `</tr>`;
        thead.innerHTML = h1; // 簡化版表頭

        // --- 表身 ---
        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            bodyHtml += `<tr data-uid="${u.uid}">
                <td style="font-weight:bold;">${u.name}</td>
                <td>${u.level}</td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = this.assignments[u.uid]?.[key] || '';
                
                // 判斷是否為預班 (REQ_OFF) 或 勿排 (!X) -> 顯示底色
                let cellClass = "cell-clickable cell-narrow";
                let style = "";
                let content = "";

                if (val === 'REQ_OFF') {
                    style = "background:#e8f8f5; color:#27ae60; font-weight:bold;"; // 預休綠底
                    content = "休";
                } else if (val && val.startsWith('!')) {
                    style = "background:#fdedec; color:#c0392b; font-size:0.8rem;"; // 勿排紅底
                    content = `<i class="fas fa-ban"></i>`;
                } else if (val === 'OFF') {
                    content = "OFF";
                } else if (val) {
                    // 一般班別
                    const shift = this.shiftMap[val];
                    const color = shift ? shift.color : '#333';
                    style = `color:${color}; font-weight:bold;`;
                    content = val;
                }

                bodyHtml += `<td class="${cellClass}" style="${style}" 
                    onclick="scheduleEditorManager.handleCellClick('${u.uid}', ${d})"
                    oncontextmenu="scheduleEditorManager.handleRightClick(event, '${u.uid}', ${d})">
                    ${content}
                </td>`;
            }
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;
    },

    updateRealTimeStats: function() {
        const tbody = document.getElementById('sideStatsBody');
        tbody.innerHTML = '';
        
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();

        this.data.staffList.forEach(u => {
            let off = 0, holidayOff = 0, n = 0, e = 0;
            const assign = this.assignments[u.uid] || {};

            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                const date = new Date(this.data.year, this.data.month - 1, d);
                const isWeekend = (date.getDay()===0 || date.getDay()===6);

                if(val === 'OFF' || val === 'REQ_OFF') {
                    off++;
                    if(isWeekend) holidayOff++;
                } else if (val === 'N') n++;
                else if (val === 'E') e++;
            }

            tbody.innerHTML += `<tr>
                <td>${u.name}</td>
                <td>${off}</td>
                <td>${holidayOff}</td>
                <td>${n}</td>
                <td>${e}</td>
            </tr>`;
        });
    },

    // 簡單的點擊切換 (Demo 用，實際上應該彈出選單)
    handleCellClick: function(uid, day) {
        // TODO: 實作左鍵點擊邏輯 (例如變成選取狀態)
        console.log("Click:", uid, day);
    },

    handleRightClick: function(e, uid, day) {
        e.preventDefault();
        const menu = document.getElementById('schContextMenu');
        const options = document.getElementById('schMenuOptions');
        
        let html = `<div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, 'OFF')">OFF (休)</div>`;
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, '${s.code}')" style="color:${s.color}">${s.name} (${s.code})</div>`;
        });
        html += `<div class="menu-separator"></div>`;
        html += `<div class="menu-item" onclick="scheduleEditorManager.setShift('${uid}', ${day}, null)" style="color:red;">清除</div>`;

        options.innerHTML = html;
        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    },

    setShift: function(uid, day, code) {
        if(!this.assignments[uid]) this.assignments[uid] = {};
        const key = `current_${day}`;
        
        if(code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;

        document.getElementById('schContextMenu').style.display = 'none';
        
        // 局部更新 UI (或是重繪)
        this.renderMatrix();
        this.updateRealTimeStats();
    },

    setupEvents: function() {
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('schContextMenu');
            if(menu && !menu.contains(e.target)) menu.style.display = 'none';
        });
    },

    saveDraft: async function() {
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("草稿已儲存");
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },

    runAI: async function() {
        if(!confirm("確定要執行 AI 排班？將會覆蓋目前的空白欄位。")) return;
        // 這裡未來會呼叫 scheduleManager.runAutoSchedule
        // 但需要先將目前的 draft 傳給 AI，或讓 AI 讀取
        // 暫時用 Alert 模擬
        alert("AI 排班運算中... (請先確保 scheduleManager 已整合)");
    }
};
