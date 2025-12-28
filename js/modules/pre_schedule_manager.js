// js/modules/pre_schedule_manager.js

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    activeShifts: [], // [新增] 儲存該單位的班別
    staffListSnapshot: [], 
    staffSortState: { field: 'isSupport', order: 'asc' },
    isLoading: false,
    
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
        select.disabled = false;
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
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }
            select.onchange = () => this.loadData();
        } catch (e) { console.error(e); }
    },

    loadData: async function() {
        const unitId = document.getElementById('filterPreUnit').value;
        this.currentUnitId = unitId;
        const select = document.getElementById('filterPreUnit');
        const unitName = select.options[select.selectedIndex]?.text || '';
        const tbody = document.getElementById('preScheduleTableBody');
        if(!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">請先選擇單位</td></tr>';
            return;
        }

        try {
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', unitId).get();
            this.activeShifts = shiftsSnap.docs.map(d => d.data());
            const unitDoc = await db.collection('units').doc(unitId).get();
            this.currentUnitGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];
        } catch(e) { console.error(e); }

        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc').get();

            if (snapshot.empty) {
                let msg = '尚無預班表';
                if(app.userRole !== 'user') msg += '<br><button class="btn btn-add" style="margin-top:10px;" onclick="preScheduleManager.openModal()">立即新增</button>';
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">${msg}</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            const today = new Date().toISOString().split('T')[0];
            
            snapshot.forEach(doc => {
                const d = doc.data();
                const s = d.settings || {};
                const openDate = s.openDate || '9999-12-31';
                const closeDate = s.closeDate || '1970-01-01';
                const period = `${openDate} ~ ${closeDate}`;
                const progress = d.progress ? `${d.progress.submitted} / ${d.progress.total}` : '-';
                
                let statusText = '未知', statusColor = '#95a5a6', isFillable = false;
                if (d.status === 'closed') { statusText = '已截止'; statusColor = '#e74c3c'; }
                else if (today < openDate) { statusText = '準備中'; statusColor = '#f39c12'; }
                else if (today > closeDate) { statusText = '已截止'; statusColor = '#e74c3c'; }
                else { statusText = '開放中'; statusColor = '#2ecc71'; isFillable = true; }

                // 權限判斷
                const isParticipant = (d.staffList || []).some(u => u.uid === app.currentUser.uid);
                let actionsHtml = '';

                // User 只能看列表，不在此處操作 (入口已分流)，但為保險起見保留基本顯示
                if (app.userRole === 'user') {
                    actionsHtml = '<span style="color:#999;">請至「提交預班」操作</span>';
                } else {
                    actionsHtml = `
                        <button class="btn btn-primary" onclick="preScheduleManager.manage('${doc.id}')">管理</button>
                        <button class="btn btn-edit" onclick="preScheduleManager.openModal('${doc.id}')">設定</button>
                        <button class="btn btn-delete" onclick="preScheduleManager.deleteSchedule('${doc.id}')">刪除</button>
                    `;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitName}</td>
                    <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                    <td><small>${period}</small></td>
                    <td><span class="badge" style="background:${statusColor};">${statusText}</span></td>
                    <td>${progress}</td>
                    <td>${actionsHtml}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) { console.error(e); }
    },

    openModal: async function(docId = null) {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        const modal = document.getElementById('preScheduleModal');
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        document.getElementById('currentMode').value = docId ? 'edit' : 'add';
        document.getElementById('searchResults').innerHTML = ''; 
        document.getElementById('inputSearchStaff').value = '';
        this.switchTab('basic');

        if (docId) {
            document.getElementById('btnImportLast').style.display = 'none';
            const doc = await db.collection('pre_schedules').doc(docId).get();
            const data = doc.data();
            this.fillForm(data); 
            this.staffListSnapshot = data.staffList || [];
            this.renderStaffList();
            this.renderGroupLimitsTable(data.groupLimits);
            this.renderDailyNeedsTable(data.dailyNeeds); // [新增]
        } else {
            document.getElementById('btnImportLast').style.display = 'inline-block';
            const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
            document.getElementById('inputPreYearMonth').value = `${nextMonth.getFullYear()}-${(nextMonth.getMonth()+1).toString().padStart(2,'0')}`;
            document.getElementById('inputMaxOff').value = 8;
            document.getElementById('inputMaxHoliday').value = 2;
            document.getElementById('inputDailyReserve').value = 1;
            document.getElementById('checkShowAllNames').checked = true;
            document.getElementById('inputShiftMode').value = "3";
            this.toggleThreeShiftOption();
            await this.loadCurrentUnitStaff();
            this.renderStaffList();
            this.renderGroupLimitsTable({});
            this.renderDailyNeedsTable({}); // [新增]
        }
    },

    closeModal: function() { document.getElementById('preScheduleModal').classList.remove('show'); },
    switchTab: function(tabName) {
        const modal = document.getElementById('preScheduleModal');
        modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        modal.querySelector(`#tab-${tabName}`).classList.add('active');
        modal.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(`'${tabName}'`)) btn.classList.add('active');
        });
    },
    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const div = document.getElementById('divAllowThree');
        if(div) div.style.display = (mode === "2") ? 'block' : 'none';
    },
    loadCurrentUnitStaff: async function() {
        const snapshot = await db.collection('users').where('unitId', '==', this.currentUnitId).where('isActive', '==', true).get();
        this.staffListSnapshot = snapshot.docs.map(doc => ({ uid: doc.id, empId: doc.data().employeeId, name: doc.data().displayName, level: doc.data().level, group: doc.data().groupId || '', unitName: '本單位', isSupport: false }));
    },
    handleSearchEnter: function(event) { if (event.key === 'Enter') this.searchStaff(); },
    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        const resultDiv = document.getElementById('searchResults');
        resultDiv.innerHTML = '';
        if(!keyword) return;
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        const found = snapshot.docs.filter(d => (d.data().employeeId && d.data().employeeId.includes(keyword)) || (d.data().displayName && d.data().displayName.includes(keyword)));
        if(found.length === 0) { resultDiv.innerHTML = '<div style="color:red; padding:10px;">找不到符合的人員</div>'; return; }
        found.forEach(doc => {
            const u = doc.data();
            const exists = this.staffListSnapshot.find(x => x.uid === doc.id);
            const btnState = exists ? '<button class="btn" disabled style="background:#ccc;">已在名單</button>' : `<button class="btn btn-add" onclick="preScheduleManager.addSupport('${doc.id}')">加入支援</button>`;
            resultDiv.innerHTML += `<div class="search-result-card"><div><span class="search-info">${u.displayName}</span><span class="search-detail">${u.employeeId}</span></div>${btnState}</div>`;
        });
    },
    addSupport: async function(uid) {
        const doc = await db.collection('users').doc(uid).get();
        if(!doc.exists) return;
        const u = doc.data();
        this.staffListSnapshot.push({ uid: doc.id, empId: u.employeeId, name: u.displayName, level: u.level, group: u.groupId || '', unitName: u.unitId, isSupport: true });
        document.getElementById('searchResults').innerHTML = ''; document.getElementById('inputSearchStaff').value = ''; this.renderStaffList();
    },
    sortStaff: function(field) {
        if (this.staffSortState.field === field) this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
        else { this.staffSortState.field = field; this.staffSortState.order = 'asc'; }
        this.renderStaffList();
    },
    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody');
        tbody.innerHTML = '';
        document.getElementById('staffTotalCount').textContent = this.staffListSnapshot.length;
        const { field, order } = this.staffSortState;
        this.staffListSnapshot.sort((a,b) => {
            let valA = a[field] || '', valB = b[field] || '';
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
        this.staffListSnapshot.forEach((u, index) => {
            const badge = u.isSupport ? '<span class="badge" style="background:#e67e22;">支援</span>' : '<span class="badge" style="background:#3498db;">本單位</span>';
            tbody.innerHTML += `<tr><td>${u.empId}</td><td>${u.name}</td><td>${u.level}</td><td><input type="text" value="${u.group}" class="input-mini" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)"></td><td>${badge}</td><td><button class="btn btn-delete" onclick="preScheduleManager.removeStaff(${index})">移除</button></td></tr>`;
        });
    },
    updateStaffGroup: function(index, val) { this.staffListSnapshot[index].group = val; },
    removeStaff: function(index) { this.staffListSnapshot.splice(index, 1); this.renderStaffList(); },
    
    // [新增] 渲染每日需求矩陣
    renderDailyNeedsTable: function(savedNeeds = {}) {
        const table = document.getElementById('dailyNeedsTable');
        if(!table) return;
        table.innerHTML = '';
        const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        let thead = '<thead><tr><th style="background:#f8f9fa;">班別 \\ 星期</th>';
        days.forEach(d => thead += `<th style="background:#f8f9fa; min-width:60px;">${d}</th>`);
        thead += '</tr></thead>';
        table.innerHTML = thead;
        let tbody = '<tbody>';
        if (this.activeShifts.length === 0) {
            tbody += `<tr><td colspan="8" style="padding:20px; text-align:center; color:#999;">請先在「班別管理」新增班別</td></tr>`;
        } else {
            this.activeShifts.forEach(shift => {
                tbody += `<tr><td style="font-weight:bold;">${shift.name} (${shift.code})</td>`;
                for(let i=0; i<7; i++) {
                    const key = `${shift.code}_${i}`; 
                    const val = (savedNeeds && savedNeeds[key] !== undefined) ? savedNeeds[key] : '';
                    tbody += `<td><input type="number" class="limit-input needs-input" data-key="${key}" value="${val}" style="width:100%;"></td>`;
                }
                tbody += `</tr>`;
            });
        }
        tbody += '</tbody>';
        table.innerHTML += tbody;
    },

    renderGroupLimitsTable: function(savedLimits = {}) {
        const table = document.getElementById('groupLimitTable');
        table.innerHTML = '<thead><tr><th style="background:#f8f9fa;">組別</th><th>每班至少</th><th>小夜至少</th><th>大夜至少</th><th>小夜最多</th><th>大夜最多</th></tr></thead><tbody>' + 
        (this.currentUnitGroups.map(g => {
            const row = (k) => `<input type="number" class="limit-input" placeholder="不限" data-group="${g}" data-key="${k}" value="${(savedLimits[g] && savedLimits[g][k]) || ''}">`;
            return `<tr><td style="font-weight:bold;">${g}</td><td>${row('minTotal')}</td><td>${row('minE')}</td><td>${row('minN')}</td><td>${row('maxE')}</td><td>${row('maxN')}</td></tr>`;
        }).join('')) + '</tbody>';
    },
    importLastSettings: async function() {
        const snap = await db.collection('pre_schedules').where('unitId', '==', this.currentUnitId).orderBy('year', 'desc').orderBy('month', 'desc').limit(1).get();
        if(snap.empty) { alert("無資料"); return; }
        const d = snap.docs[0].data();
        this.fillForm(d); this.renderGroupLimitsTable(d.groupLimits); 
        this.renderDailyNeedsTable(d.dailyNeeds || {}); 
        this.staffListSnapshot = d.staffList || []; this.renderStaffList();
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
        this.toggleThreeShiftOption();
        if(s.shiftTypeMode === "2") document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
    },
    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const ym = document.getElementById('inputPreYearMonth').value;
        if(!ym) { alert("請選擇月份"); return; }
        const [year, month] = ym.split('-').map(Number);
        
        const groupLimits = {};
        document.querySelectorAll('#groupLimitTable .limit-input').forEach(i => {
            const g = i.dataset.group, k = i.dataset.key;
            if(!groupLimits[g]) groupLimits[g] = {};
            groupLimits[g][k] = i.value ? parseInt(i.value) : null;
        });

        const dailyNeeds = {};
        document.querySelectorAll('.needs-input').forEach(i => {
            if(i.value) dailyNeeds[i.dataset.key] = parseInt(i.value);
        });

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
            dailyNeeds, // [新增]
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                const old = await db.collection('pre_schedules').doc(docId).get();
                if(old.exists) {
                    data.status = old.data().status;
                    if(old.data().progress) data.progress.submitted = old.data().progress.submitted;
                }
                await db.collection('pre_schedules').doc(docId).update(data);
            } else {
                const dup = await db.collection('pre_schedules').where('unitId','==',this.currentUnitId).where('year','==',year).where('month','==',month).get();
                if(!dup.empty) { alert("該月份已存在"); return; }
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.assignments = {};
                await db.collection('pre_schedules').add(data);
            }
            alert("儲存成功"); this.closeModal(); this.loadData();
        } catch(e) { console.error(e); alert("錯誤: " + e.message); }
    },
    deleteSchedule: async function(id) {
        if(confirm("確定刪除?")) { await db.collection('pre_schedules').doc(id).delete(); this.loadData(); }
    },
    manage: function(id) {
        window.location.hash = `/admin/pre_schedule_matrix?id=${id}`;
    }
};
