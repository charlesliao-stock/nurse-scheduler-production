// js/modules/pre_schedule_matrix_manager.js
// 🔧 完整版：底部點擊調整 + 執行排班資料傳遞

const matrixManager = {
    docId: null, data: null, shifts: [], localAssignments: {}, usersMap: {}, isLoading: false,
    
    init: async function(id) { 
        if(!id) { alert("ID遺失"); return; }
        this.docId = id; 
        this.isLoading = true;
        try {
            this.showLoading();
            await Promise.all([this.loadShifts(), this.loadUsers(), this.loadScheduleData()]);
            this.restoreTableStructure(); 
            this.renderMatrix(); 
            this.updateStats(); 
            this.setupEvents();
        } catch(e) { console.error(e); alert("載入失敗"); } 
        finally { this.isLoading = false; }
    },

    showLoading: function() { document.getElementById('matrixBody').innerHTML = '<tr><td colspan="35">載入中...</td></tr>'; },
    
    loadShifts: async function() { 
        if(!this.docId) return;
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if(doc.exists) {
            const uid = doc.data().unitId;
            const snap = await db.collection('shifts').where('unitId','==',uid).orderBy('startTime').get();
            this.shifts = snap.docs.map(d=>d.data());
        }
    },
    loadUsers: async function() { 
        const snap = await db.collection('users').get(); 
        snap.forEach(d => this.usersMap[d.id] = d.data()); 
    },
    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        if(!this.data.specificNeeds) this.data.specificNeeds = {};
    },

    restoreTableStructure: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        thead.innerHTML = ''; tbody.innerHTML = ''; tfoot.innerHTML = '';
    },

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px;">設定</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        h1 += `</tr>`;

        let h2 = `<tr>`;
        const weeks = ['日','一','二','三','四','五','六'];
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `</tr>`;
        thead.innerHTML = h1 + h2;

        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.localAssignments[uid] || {};
            const empId = this.usersMap[uid]?.employeeId || staff.empId;

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff;">${staff.name}</td>
                <td><button class="btn btn-sm" onclick="matrixManager.openPrefModal('${uid}','${staff.name}')"><i class="fas fa-cog"></i></button></td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable" data-uid="${uid}" data-day="${d}">${this.renderCellContent(val)}</td>`;
            }
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        let footHtml = '';
        this.shifts.forEach((s, idx) => {
            footHtml += `<tr>`;
            if(idx === 0) footHtml += `<td colspan="3" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; vertical-align:middle;">每日人力<br>監控 (點擊調整)</td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const jsDay = new Date(year, month-1, d).getDay(); 
                const dayIdx = (jsDay === 0) ? 6 : jsDay - 1; 
                
                let need = 0;
                let isTemp = false;
                
                if (this.data.specificNeeds[dateStr] && this.data.specificNeeds[dateStr][s.code] !== undefined) {
                    need = this.data.specificNeeds[dateStr][s.code];
                    isTemp = true;
                } else {
                    need = this.data.dailyNeeds[`${s.code}_${dayIdx}`] || 0;
                }

                const style = isTemp ? 'background:#fff3cd; border:2px solid #f39c12;' : '';
                
                footHtml += `<td id="stat_cell_${s.code}_${d}" style="cursor:pointer; ${style}" 
                                onclick="matrixManager.handleNeedClick('${dateStr}', '${s.code}', ${need})">
                                <span class="stat-actual">-</span> / <span class="stat-need" style="font-weight:bold;">${need}</span>
                             </td>`;
            }
            footHtml += `</tr>`;
        });
        tfoot.innerHTML = footHtml;
        
        setTimeout(() => this.updateStats(), 0);
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'REQ_OFF') return '<span class="badge badge-success">預休</span>';
        if(typeof val === 'string' && val.startsWith('!')) return `<span style="color:red; font-size:0.8rem;">!${val.replace('!','')}</span>`;
        return val;
    },

    handleNeedClick: async function(dateStr, shiftCode, currentNeed) {
        const newNeed = prompt(`調整 ${dateStr} [${shiftCode}] 需求人數：`, currentNeed);
        if (newNeed === null) return;
        const val = parseInt(newNeed);
        if (isNaN(val) || val < 0) return;

        if (!this.data.specificNeeds[dateStr]) this.data.specificNeeds[dateStr] = {};
        this.data.specificNeeds[dateStr][shiftCode] = val;

        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                specificNeeds: this.data.specificNeeds,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            const schSnap = await db.collection('schedules').where('sourceId', '==', this.docId).get();
            if (!schSnap.empty) {
                await db.collection('schedules').doc(schSnap.docs[0].id).update({
                    specificNeeds: this.data.specificNeeds
                });
            }
            this.renderMatrix();
        } catch(e) { alert("更新失敗"); }
    },

    updateStats: function() {
        const counts = {}; 
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        for(let d=1; d<=daysInMonth; d++) {
            counts[d] = {};
            this.shifts.forEach(s => counts[d][s.code] = 0);
        }
        Object.values(this.localAssignments).forEach(assign => {
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val && val !== 'OFF' && val !== 'REQ_OFF' && !val.startsWith('!')) {
                    if(counts[d][val] !== undefined) counts[d][val]++;
                }
            }
        });
        for(let d=1; d<=daysInMonth; d++) {
            this.shifts.forEach(s => {
                const cell = document.getElementById(`stat_cell_${s.code}_${d}`);
                if(cell) {
                    const actualSpan = cell.querySelector('.stat-actual');
                    const needSpan = cell.querySelector('.stat-need');
                    const actual = counts[d][s.code];
                    const need = parseInt(needSpan.innerText);
                    if(actualSpan) actualSpan.innerText = actual;
                    if(actual < need) cell.classList.add('text-danger');
                    else cell.classList.remove('text-danger');
                }
            });
        }
    },

    getDateStr: function(d) { return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day);
            });
        });
        document.addEventListener('click', () => { document.getElementById('customContextMenu').style.display='none'; });
    },

    handleRightClick: function(e, uid, day) {
        const menu = document.getElementById('customContextMenu');
        const ul = menu.querySelector('ul');
        ul.innerHTML = `
            <li onclick="matrixManager.setShift('${uid}','current_${day}','REQ_OFF')">設為預休</li>
            <li onclick="matrixManager.setShift('${uid}','current_${day}',null)">清除</li>
        `;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    setShift: function(uid, key, val) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if(val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        db.collection('pre_schedules').doc(this.docId).update({
            [`assignments.${uid}.${key}`]: val === null ? firebase.firestore.FieldValue.delete() : val
        });
        this.renderMatrix();
    },

    executeSchedule: async function() {
        if(!confirm("確定執行排班? 將鎖定預班並建立正式草稿。")) return;
        this.isLoading = true; this.showLoading();
        try {
            const initialAssignments = {};
            if (this.localAssignments) {
                Object.keys(this.localAssignments).forEach(uid => {
                    initialAssignments[uid] = JSON.parse(JSON.stringify(this.localAssignments[uid]));
                });
            }

            const scheduleData = {
                unitId: this.data.unitId, year: this.data.year, month: this.data.month,
                sourceId: this.docId, status: 'draft',
                staffList: this.data.staffList || [],
                assignments: initialAssignments,
                dailyNeeds: this.data.dailyNeeds || {},
                specificNeeds: this.data.specificNeeds || {}, 
                groupLimits: this.data.groupLimits || {}, // 帶入組別限制
                settings: this.data.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            batch.update(db.collection('pre_schedules').doc(this.docId), { status: 'closed', assignments: this.localAssignments });
            const newSchRef = db.collection('schedules').doc();
            batch.set(newSchRef, scheduleData);

            await batch.commit();
            alert("執行成功! 轉跳中...");
            window.location.hash = `/admin/schedule_editor?id=${newSchRef.id}`;
        } catch(e) { console.error(e); alert("失敗: "+e.message); this.renderMatrix(); } 
        finally { this.isLoading = false; }
    },
    
    openPrefModal: function(uid, name) { 
        document.getElementById('prefTargetUid').value = uid;
        document.getElementById('prefTargetName').innerText = name;
        document.getElementById('prefModal').classList.add('show');
    },
    closePrefModal: function() { document.getElementById('prefModal').classList.remove('show'); },
    savePreferences: function() { this.closePrefModal(); },
    setupEvents: function() { },
    cleanup: function() { document.getElementById('customContextMenu').style.display='none'; }
};
