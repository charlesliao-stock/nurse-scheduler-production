// js/modules/pre_schedule_manager.js
// 🔧 完整修復版：確保抓得到 HTML ID

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    activeShifts: [], 
    staffListSnapshot: [], 
    staffSortState: { field: 'isSupport', order: 'asc' },
    isLoading: false,
    tempSpecificNeeds: {}, 

    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        const adminToolbar = document.getElementById('adminToolbar');
        if (adminToolbar) {
            adminToolbar.style.display = (app.userRole === 'user') ? 'none' : 'block';
        }
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            if(snapshot.size === 1) { 
                select.selectedIndex = 1; 
                this.loadData(); 
            }
            select.onchange = () => this.loadData();
        } catch(e) { console.error(e); }
    },

    loadData: async function() {
        this.currentUnitId = document.getElementById('filterPreUnit').value;
        if(!this.currentUnitId) return;
        
        const tbody = document.getElementById('preScheduleTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const unitDoc = await db.collection('units').doc(this.currentUnitId).get();
            this.currentUnitGroups = unitDoc.data().groups || [];
            
            const shiftSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());

            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            tbody.innerHTML = '';
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">尚無預班表</td></tr>';
                return;
            }

            snapshot.forEach(doc => {
                const d = doc.data();
                const statusMap = { 'open': '開放中', 'closed': '已鎖定' };
                const statusColor = d.status === 'open' ? '#2ecc71' : '#95a5a6';
                const progress = d.progress ? `${d.progress.submitted}/${d.progress.total}` : '-/-';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitDoc.data().name}</td>
                    <td style="font-weight:bold;">${d.year}-${String(d.month).padStart(2,'0')}</td>
                    <td>${d.settings.openDate} ~ ${d.settings.closeDate}</td>
                    <td><span class="badge" style="background:${statusColor}">${statusMap[d.status]}</span></td>
                    <td>${progress}</td>
                    <td>
                        <button class="btn btn-sm" onclick="preScheduleManager.openModal('${doc.id}')" style="margin-right:5px;">設定</button>
                        <button class="btn btn-sm btn-primary" onclick="preScheduleManager.manage('${doc.id}')" style="margin-right:5px;">管理</button>
                        <button class="btn btn-sm btn-delete" onclick="preScheduleManager.deleteSchedule('${doc.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch(e) { console.error(e); }
    },

    closeModal: function() { document.getElementById('preScheduleModal').classList.remove('show'); },
    
    switchTab: function(tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        const btns = document.querySelectorAll('.tab-btn');
        if(tabName === 'basic') btns[0].classList.add('active');
        if(tabName === 'needs') btns[1].classList.add('active');
        if(tabName === 'staff') btns[2].classList.add('active');
    },

    loadCurrentUnitStaff: async function() {
        if(!this.currentUnitId) return;
        const snap = await db.collection('users').where('unitId', '==', this.currentUnitId).where('isActive', '==', true).get();
        this.staffListSnapshot = snap.docs.map(doc => ({
            uid: doc.id,
            name: doc.data().displayName,
            empId: doc.data().employeeId,
            level: doc.data().level,
            group: doc.data().groupId,
            isSupport: false 
        }));
        document.getElementById('staffCountBadge').innerText = this.staffListSnapshot.length;
    },

    openModal: async function(docId = null) {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        const modal = document.getElementById('preScheduleModal');
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        this.switchTab('basic');

        let data = {};
        if (docId) {
            const doc = await db.collection('pre_schedules').doc(docId).get();
            data = doc.data();
            this.staffListSnapshot = data.staffList || [];
        } else {
            const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
            data = {
                year: nextMonth.getFullYear(),
                month: nextMonth.getMonth() + 1,
                settings: { maxOffDays: 8, maxHolidayOffs: 2, dailyReserved: 1, shiftTypeMode: "3", showAllNames: true },
                groupLimits: {}, dailyNeeds: {}, specificNeeds: {}
            };
            await this.loadCurrentUnitStaff();
        }

        this.fillForm(data);
        this.renderStaffList();
        
        // 渲染三個區塊
        this.renderDailyNeedsTable(data.dailyNeeds);
        this.renderSpecificNeedsUI(data.specificNeeds || {}); 
        this.renderGroupLimitsTable(data.groupLimits);
    },

    fillForm: function(data) {
        if(data.year && data.month) {
            const m = data.month < 10 ? '0'+data.month : data.month;
            document.getElementById('inputPreYearMonth').value = `${data.year}-${m}`;
        }
        const s = data.settings || {};
        document.getElementById('inputOpenDate').value = s.openDate || '';
        document.getElementById('inputCloseDate').value = s.closeDate || '';
        document.getElementById('inputMaxOff').value = s.maxOffDays;
        document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs;
        document.getElementById('inputDailyReserve').value = s.dailyReserved;
        document.getElementById('checkShowAllNames').checked = s.showAllNames;
        document.getElementById('inputShiftMode').value = s.shiftTypeMode;
        if(s.shiftTypeMode === "2") document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
    },

    // 1. 常態需求
    renderDailyNeedsTable: function(savedNeeds = {}) {
        const container = document.getElementById('dailyNeedsTable');
        if(!container) return;
        
        let html = `<h4 style="margin-top:0; border-bottom:1px solid #eee; padding-bottom:10px; color:#2c3e50;">1. 各班每日人力需求 (週循環)</h4>`;
        html += `<table class="table table-bordered table-sm text-center">`;
        const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        let thead = '<thead><tr><th style="background:#f8f9fa;">班別 \\ 星期</th>';
        days.forEach(d => thead += `<th style="background:#f8f9fa; min-width:60px;">${d}</th>`);
        thead += '</tr></thead><tbody>';

        this.activeShifts.forEach(shift => {
            thead += `<tr><td style="font-weight:bold;">${shift.name} (${shift.code})</td>`;
            for(let i=0; i<7; i++) {
                const key = `${shift.code}_${i}`; 
                const val = (savedNeeds && savedNeeds[key] !== undefined) ? savedNeeds[key] : '';
                thead += `<td><input type="number" class="limit-input needs-input" data-key="${key}" value="${val}" style="width:100%;"></td>`;
            }
            thead += `</tr>`;
        });
        thead += '</tbody></table>';
        container.innerHTML = html;
    },

    // 2. 臨時需求
    renderSpecificNeedsUI: function(specificNeeds = {}) {
        const container = document.getElementById('specificNeedsContainer'); 
        if(!container) return;

        this.tempSpecificNeeds = JSON.parse(JSON.stringify(specificNeeds)); 

        let html = `<h4 style="margin-top:20px; border-bottom:1px solid #eee; padding-bottom:10px; color:#2c3e50;">2. 臨時人力設定 (指定日期覆蓋)</h4>`;
        
        html += `<div style="display:flex; gap:10px; margin-bottom:10px; background:#f9f9f9; padding:10px; border-radius:4px; align-items:center;">
            <input type="date" id="inputTempDate" class="form-control" style="width:150px;">
            <select id="inputTempShift" class="form-control" style="width:120px;">
                ${this.activeShifts.map(s => `<option value="${s.code}">${s.name} (${s.code})</option>`).join('')}
            </select>
            <input type="number" id="inputTempCount" class="form-control" placeholder="人數" style="width:80px;" min="0">
            <button class="btn btn-add" type="button" onclick="preScheduleManager.addSpecificNeed()">
                <i class="fas fa-plus"></i> 新增
            </button>
        </div>`;

        html += `<div style="max-height:150px; overflow-y:auto; border:1px solid #eee;">
            <table class="table table-sm text-center" style="margin:0;">
            <thead style="position:sticky; top:0; background:#fff;">
                <tr><th style="width:30%">日期</th><th style="width:30%">班別</th><th style="width:20%">需求人數</th><th style="width:20%">操作</th></tr>
            </thead>
            <tbody id="specificNeedsBody">`;

        const rows = [];
        Object.keys(this.tempSpecificNeeds).sort().forEach(dateStr => {
            Object.keys(this.tempSpecificNeeds[dateStr]).forEach(shift => {
                rows.push({ date: dateStr, shift: shift, count: this.tempSpecificNeeds[dateStr][shift] });
            });
        });

        if(rows.length === 0) {
            html += `<tr><td colspan="4" style="color:#999; padding:10px;">尚無設定 (將採用週間規則)</td></tr>`;
        } else {
            rows.forEach(r => {
                html += `<tr>
                    <td>${r.date}</td>
                    <td><span class="badge" style="background:#3498db;">${r.shift}</span></td>
                    <td style="font-weight:bold; color:#e74c3c;">${r.count}</td>
                    <td><button class="btn btn-delete btn-sm" style="padding:2px 6px;" onclick="preScheduleManager.removeSpecificNeed('${r.date}', '${r.shift}')"><i class="fas fa-trash"></i></button></td>
                </tr>`;
            });
        }
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },

    addSpecificNeed: function() {
        const date = document.getElementById('inputTempDate').value;
        const shift = document.getElementById('inputTempShift').value;
        const count = document.getElementById('inputTempCount').value;
        if(!date || !shift || !count) { alert("請填寫完整資訊"); return; }
        
        if(!this.tempSpecificNeeds[date]) this.tempSpecificNeeds[date] = {};
        this.tempSpecificNeeds[date][shift] = parseInt(count);
        this.renderSpecificNeedsUI(this.tempSpecificNeeds);
    },

    removeSpecificNeed: function(date, shift) {
        if(this.tempSpecificNeeds[date]) {
            delete this.tempSpecificNeeds[date][shift];
            if(Object.keys(this.tempSpecificNeeds[date]).length === 0) delete this.tempSpecificNeeds[date];
        }
        this.renderSpecificNeedsUI(this.tempSpecificNeeds);
    },

    // 3. 組別限制 (改為: 組別 x 班別 (至少/最多))
    renderGroupLimitsTable: function(savedLimits = {}) {
        const container = document.getElementById('groupLimitTableContainer');
        if(!container) return;
        
        let html = `<h4 style="margin-top:20px; border-bottom:1px solid #eee; padding-bottom:10px; color:#2c3e50;">3. 組別限制 (進階演算法參考)</h4>`;
        html += `<div style="overflow-x:auto;"><table class="table table-bordered table-sm text-center" id="groupLimitTable" style="min-width:100%;">
            <thead><tr><th style="background:#f8f9fa; width:100px;">組別</th>`;
        
        // 動態產生班別表頭
        this.activeShifts.forEach(s => {
            html += `<th style="background:#f8f9fa;">${s.name} (至少)</th><th style="background:#f8f9fa;">${s.name} (最多)</th>`;
        });
        html += `</tr></thead><tbody>`;

        this.currentUnitGroups.forEach(g => {
            html += `<tr><td style="font-weight:bold;">${g}</td>`;
            this.activeShifts.forEach(s => {
                const minVal = (savedLimits[g] && savedLimits[g][s.code] && savedLimits[g][s.code].min) || '';
                const maxVal = (savedLimits[g] && savedLimits[g][s.code] && savedLimits[g][s.code].max) || '';
                
                html += `<td><input type="number" class="limit-input" placeholder="-" data-group="${g}" data-shift="${s.code}" data-type="min" value="${minVal}" style="width:50px; text-align:center;"></td>`;
                html += `<td><input type="number" class="limit-input" placeholder="-" data-group="${g}" data-shift="${s.code}" data-type="max" value="${maxVal}" style="width:50px; text-align:center;"></td>`;
            });
            html += `</tr>`;
        });
        
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },

    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const ym = document.getElementById('inputPreYearMonth').value;
        if(!ym) { alert("請選擇月份"); return; }
        const [year, month] = ym.split('-').map(Number);
        
        // 1. 收集組別限制 (新結構: Group -> Shift -> Min/Max)
        const groupLimits = {};
        document.querySelectorAll('#groupLimitTable .limit-input').forEach(i => {
            const g = i.dataset.group;
            const s = i.dataset.shift;
            const t = i.dataset.type; // min 或 max
            if(!groupLimits[g]) groupLimits[g] = {};
            if(!groupLimits[g][s]) groupLimits[g][s] = {};
            
            if(i.value !== '') {
                groupLimits[g][s][t] = parseInt(i.value);
            }
        });

        // 2. 收集每日需求
        const dailyNeeds = {};
        document.querySelectorAll('.needs-input').forEach(i => {
            if(i.value) dailyNeeds[i.dataset.key] = parseInt(i.value);
        });

        const specificNeeds = this.tempSpecificNeeds || {};

        const data = {
            unitId: this.currentUnitId, year, month,
            status: 'open',
            progress: { submitted: 0, total: this.staffListSnapshot.length },
            settings: {
                openDate: document.getElementById('inputOpenDate').value,
                closeDate: document.getElementById('inputCloseDate').value,
                showAllNames: document.getElementById('checkShowAllNames').checked,
                maxOffDays: parseInt(document.getElementById('inputMaxOff').value)||0,
                maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday').value)||0,
                dailyReserved: parseInt(document.getElementById('inputDailyReserve').value)||0,
                shiftTypeMode: document.getElementById('inputShiftMode').value,
                allowThreeShifts: document.getElementById('checkAllowThree').checked
            },
            groupLimits,
            dailyNeeds,
            specificNeeds,
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                const schSnap = await db.collection('schedules').where('sourceId', '==', docId).get();
                let needSync = false;
                
                if (!schSnap.empty) {
                    const schDoc = schSnap.docs[0];
                    if (confirm(`⚠️ 系統偵測到該月份已有「排班草稿」！\n\n您修改了人力需求設定。\n\n[確定]：同步更新排班表需求 (排班表下方將出現紅字缺額，需確認)\n[取消]：僅儲存預班表`)) {
                        needSync = true;
                        await db.collection('schedules').doc(schDoc.id).update({
                            dailyNeeds: dailyNeeds,
                            specificNeeds: specificNeeds,
                            groupLimits: groupLimits, // 同步組別限制
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }

                await db.collection('pre_schedules').doc(docId).update(data);
                alert(needSync ? "預班已儲存，並同步至排班表！" : "預班設定已儲存。");
                
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.assignments = {};
                await db.collection('pre_schedules').add(data);
                alert("建立成功");
            }
            this.closeModal(); 
            this.loadData();
        } catch(e) { console.error(e); alert("錯誤: " + e.message); }
    },
    
    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody');
        tbody.innerHTML = '';
        this.staffListSnapshot.forEach((s, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.empId}</td>
                <td>${s.name}</td>
                <td>${s.level}</td>
                <td>
                    <select onchange="preScheduleManager.updateStaffGroup(${idx}, this.value)">
                        <option value="">無</option>
                        ${this.currentUnitGroups.map(g => `<option value="${g}" ${s.group===g?'selected':''}>${g}</option>`).join('')}
                    </select>
                </td>
                <td>${s.isSupport ? '<span class="badge badge-warning">支援</span>' : '本單位'}</td>
                <td><button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeStaff(${idx})">移除</button></td>
            `;
            tbody.appendChild(tr);
        });
        document.getElementById('staffCountBadge').innerText = this.staffListSnapshot.length;
    },
    
    updateStaffGroup: function(index, val) { this.staffListSnapshot[index].group = val; },
    removeStaff: function(index) { this.staffListSnapshot.splice(index, 1); this.renderStaffList(); },
    
    importLastSettings: async function() { alert("功能開發中"); },
    deleteSchedule: async function(id) { 
        if(confirm("確定刪除?")) { await db.collection('pre_schedules').doc(id).delete(); this.loadData(); } 
    },
    
    // 工具: 簡易開關三班選項
    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const opt = document.getElementById('threeShiftOption');
        if(mode === '2') opt.style.display = 'block';
        else opt.style.display = 'none';
    },

    manage: function(id) { window.location.hash = `/admin/pre_schedule_matrix?id=${id}`; }
};
