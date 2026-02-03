// js/modules/pre_schedule_manager.js

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    activeShifts: [], 
    staffListSnapshot: [], 
    staffSortState: { field: 'empId', order: 'asc' },
    isLoading: false,
    tempSpecificNeeds: {},

    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理預班設定</p>
                </div>
            `;
            return;
        }
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            const activeRole = app.impersonatedRole || app.userRole;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
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
                if (activeRole !== 'system_admin') select.disabled = true;
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
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc').orderBy('month', 'desc').get();

            tbody.innerHTML = '';
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">尚無預班表</td></tr>';
                return;
            }

            snapshot.forEach(doc => {
                const d = doc.data();
                const statusInfo = app.getPreScheduleStatus(d);
                const progress = d.progress ? `${d.progress.submitted}/${d.progress.total}` : '0/0';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitDoc.data().name}</td>
                    <td style="font-weight:bold;">${d.year}-${String(d.month).padStart(2,'0')}</td>
                    <td><small>${d.settings.openDate} ~ ${d.settings.closeDate}</small></td>
                    <td>
                        <span class="badge" style="background:${statusInfo.color}">${statusInfo.text}</span>
                        ${(statusInfo.code === 'expired' || statusInfo.code === 'closed') ? 
                            `<br><a href="javascript:void(0)" onclick="preScheduleManager.reOpen('${doc.id}')" style="font-size:0.75rem; color:#3498db; text-decoration:underline;">[再開放]</a>` : ''}
                    </td>
                    <td>${progress}</td>
                    <td>
                        <button class="btn btn-edit" onclick="preScheduleManager.openModal('${doc.id}')" style="margin-right:5px;">
                            <i class="fas fa-cog"></i> 設定
                        </button>
                        <button class="btn btn-primary" onclick="preScheduleManager.manage('${doc.id}')" style="margin-right:5px;">
                            <i class="fas fa-th"></i> 管理
                        </button>
                        <button class="btn btn-delete" onclick="preScheduleManager.deleteSchedule('${doc.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch(e) { console.error(e); }
    },

    reOpen: async function(docId) {
        if(!confirm("確定要重新開放預班填寫嗎？\n系統將自動把截止日期延長至明日。")) return;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        try {
            await db.collection('pre_schedules').doc(docId).update({
                'status': 'open',
                'isManualOpen': true,
                'settings.closeDate': dateStr
            });
            alert("已成功再開放，新截止日期為：" + dateStr);
            this.loadData();
        } catch(e) { alert("操作失敗：" + e.message); }
    },

    openModal: async function(docId = null) {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        const modal = document.getElementById('preScheduleModal');
        if (modal) modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        this.switchTab('basic');
        
        await this.loadUnitDataForModal();
        let data = {};
        if (docId) {
            const doc = await db.collection('pre_schedules').doc(docId).get();
            data = doc.data();
            this.staffListSnapshot = data.staffList || [];
            document.getElementById('btnImportLast').style.display = 'none';
        } else {
            document.getElementById('btnImportLast').style.display = 'inline-block';
            const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
            data = {
                year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1,
                settings: { maxOffDays: 8, maxHolidayOffs: 2, dailyReserved: 1, shiftTypeMode: "3", showAllNames: true },
                groupLimits: {}, dailyNeeds: {}, specificNeeds: {}
            };
            await this.loadCurrentUnitStaff();
        }
        this.fillForm(data);
        this.renderDailyNeedsUI(data.dailyNeeds || {});
        this.renderSpecificNeedsUI(data.specificNeeds || {});
        this.renderGroupLimitsUI(data.groupLimits || {});
        this.renderStaffList();
        
        // 清除搜尋結果
        const results = document.getElementById('searchResults');
        if(results) results.innerHTML = '';
        const searchInput = document.getElementById('inputSearchStaff');
        if(searchInput) searchInput.value = '';
    },

    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId')?.value;
        const ymInput = document.getElementById('inputPreYearMonth')?.value;
        if (!ymInput) { alert("請選擇年月"); return; }
        const [year, month] = ymInput.split('-').map(Number);
        const openDate = document.getElementById('inputOpenDate')?.value;
        const closeDate = document.getElementById('inputCloseDate')?.value;
        if (!openDate || !closeDate) { alert("請設定日期"); return; }

        const doc = {
            unitId: this.currentUnitId, year, month,
            status: 'open', isManualOpen: false,
            settings: {
                openDate, closeDate, 
                maxOffDays: parseInt(document.getElementById('inputMaxOff')?.value) || 8,
                maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday')?.value) || 2,
                dailyReserved: parseInt(document.getElementById('inputDailyReserve')?.value) || 1,
                showAllNames: document.getElementById('checkShowAllNames')?.checked !== false,
                shiftTypeMode: document.getElementById('inputShiftMode')?.value || "3",
                allowThreeShifts: document.getElementById('checkAllowThree')?.checked || false
            },
            dailyNeeds: this.getDailyNeedsFromDOM(),
            specificNeeds: this.getSpecificNeedsFromDOM(),
            groupLimits: this.getGroupLimitsFromDOM(),
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) await db.collection('pre_schedules').doc(docId).update(doc);
            else await db.collection('pre_schedules').add({ ...doc, createdAt: firebase.firestore.FieldValue.serverTimestamp(), assignments: {}, progress: { total: doc.staffList.length, submitted: 0 } });
            this.closeModal(); this.loadData();
        } catch(e) { alert("儲存失敗: " + e.message); }
    },

    renderDailyNeedsUI: function(savedData) {
        const container = document.getElementById('dailyNeedsTable'); if(!container) return;
        const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        let html = '<div class="section-title">1. 各班每日人力需求 (週循環)</div><div style="overflow-x:auto;"><table class="table table-sm text-center"><thead><tr><th>班別 \\ 星期</th>' + ['一','二','三','四','五','六','日'].map(d=>`<th>${d}</th>`).join('') + '</tr></thead><tbody>';
        this.activeShifts.forEach(shift => {
            html += `<tr><td style="font-weight:bold;">${shift.name}</td>`;
            weekdayKeys.forEach((key, idx) => {
                const dataKey = `${shift.code}_${idx}`;
                html += `<td><input type="number" class="limit-input needs-input" data-key="${dataKey}" value="${savedData[dataKey]||''}" style="width:100%; text-align:center;"></td>`;
            });
            html += `</tr>`;
        });
        container.innerHTML = html + '</tbody></table></div>';
    },

    getDailyNeedsFromDOM: function() {
        const result = {}; document.querySelectorAll('.needs-input').forEach(input => {
            const val = parseInt(input.value); if (!isNaN(val) && val >= 0) result[input.dataset.key] = val;
        }); return result;
    },

    renderSpecificNeedsUI: function(savedData) {
        this.tempSpecificNeeds = JSON.parse(JSON.stringify(savedData || {}));
        const container = document.getElementById('specificNeedsContainer'); if (!container) return;
        let html = `<div class="section-title">2. 臨時人力設定</div><div style="display:flex; gap:10px; margin-bottom:10px;"><input type="date" id="inputTempDate" class="form-control" style="width:150px;"><select id="inputTempShift" class="form-control" style="width:140px;"><option value="">班別</option>` + this.activeShifts.map(s=>`<option value="${s.code}">${s.code}</option>`).join('') + `</select><input type="number" id="inputTempCount" class="form-control" style="width:80px;"><button class="btn btn-add" onclick="preScheduleManager.addSpecificNeed()">新增</button></div><table class="table table-sm"><thead><tr><th>日期</th><th>班別</th><th>人數</th><th>操作</th></tr></thead><tbody id="specificNeedsBody"></tbody></table>`;
        container.innerHTML = html; this.refreshSpecificNeedsList();
    },

    refreshSpecificNeedsList: function() {
        const tbody = document.getElementById('specificNeedsBody'); if(!tbody) return;
        tbody.innerHTML = ''; Object.keys(this.tempSpecificNeeds).sort().forEach(date => {
            Object.keys(this.tempSpecificNeeds[date]).forEach(shift => {
                const tr = document.createElement('tr'); tr.innerHTML = `<td>${date}</td><td>${shift}</td><td>${this.tempSpecificNeeds[date][shift]}</td><td><button class="btn btn-delete btn-sm" onclick="preScheduleManager.removeSpecificNeed('${date}','${shift}')">刪除</button></td>`; tbody.appendChild(tr);
            });
        });
    },

    addSpecificNeed: function() {
        const date = document.getElementById('inputTempDate').value; const shift = document.getElementById('inputTempShift').value; const count = document.getElementById('inputTempCount').value;
        if(!date || !shift || !count) return; if(!this.tempSpecificNeeds[date]) this.tempSpecificNeeds[date] = {}; this.tempSpecificNeeds[date][shift] = parseInt(count); this.refreshSpecificNeedsList();
    },

    removeSpecificNeed: function(date, shift) { delete this.tempSpecificNeeds[date][shift]; if(Object.keys(this.tempSpecificNeeds[date]).length === 0) delete this.tempSpecificNeeds[date]; this.refreshSpecificNeedsList(); },
    getSpecificNeedsFromDOM: function() { return this.tempSpecificNeeds; },

    renderGroupLimitsUI: function(savedData) {
        const container = document.getElementById('groupLimitTableContainer'); if(!container) return;
        let html = `<div class="section-title">組別人力限制設定 (最少 ~ 最多)</div><div style="overflow-x:auto;"><table class="table table-sm text-center"><thead><tr><th>組別</th>` + this.activeShifts.map(s=>`<th>${s.code}</th>`).join('') + `</tr></thead><tbody>`;
        this.currentUnitGroups.forEach(g => {
            html += `<tr><td style="font-weight:bold;">${g}</td>`;
            this.activeShifts.forEach(s => {
                const limit = savedData[g]?.[s.code] || {};
                // 支援舊格式 (單一數值)
                const minVal = (typeof limit === 'object') ? (limit.min || '') : '';
                const maxVal = (typeof limit === 'object') ? (limit.max || '') : (limit || '');
                
                html += `<td>
                    <div style="display:flex; align-items:center; gap:2px; justify-content:center;">
                        <input type="number" class="limit-input group-limit-min" data-group="${g}" data-shift="${s.code}" value="${minVal}" style="width:45px; padding:2px;" placeholder="最小">
                        <span>~</span>
                        <input type="number" class="limit-input group-limit-max" data-group="${g}" data-shift="${s.code}" value="${maxVal}" style="width:45px; padding:2px;" placeholder="最大">
                    </div>
                </td>`;
            });
            html += `</tr>`;
        });
        container.innerHTML = html + `</tbody></table></div>`;
    },

    getGroupLimitsFromDOM: function() {
        const result = {}; 
        // 處理最大值
        document.querySelectorAll('.group-limit-max').forEach(input => {
            const g = input.dataset.group;
            const s = input.dataset.shift;
            const val = parseInt(input.value);
            if (!isNaN(val) && val >= 0) {
                if(!result[g]) result[g] = {};
                if(!result[g][s]) result[g][s] = {};
                result[g][s].max = val;
            }
        });
        // 處理最小值
        document.querySelectorAll('.group-limit-min').forEach(input => {
            const g = input.dataset.group;
            const s = input.dataset.shift;
            const val = parseInt(input.value);
            if (!isNaN(val) && val >= 0) {
                if(!result[g]) result[g] = {};
                if(!result[g][s]) result[g][s] = {};
                result[g][s].min = val;
            }
        });
        return result;
    },

    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody'); if(!tbody) return;
        
        // 排序邏輯
        const field = this.staffSortState.field;
        const order = this.staffSortState.order === 'asc' ? 1 : -1;
        
        this.staffListSnapshot.sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return -1 * order;
            if (valA > valB) return 1 * order;
            return 0;
        });

        tbody.innerHTML = this.staffListSnapshot.map((s, idx) => `
            <tr>
                <td>${s.empId}</td>
                <td>${s.name}</td>
                <td>${s.level}</td>
                <td>
                    <select onchange="preScheduleManager.updateStaffGroup(${idx}, this.value)" class="form-control form-control-sm">
                        <option value="">無</option>
                        ${this.currentUnitGroups.map(g => `<option value="${g}" ${s.group === g ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <span class="badge ${s.isSupport ? 'badge-info' : 'badge-secondary'}" style="background: ${s.isSupport ? '#17a2b8' : '#6c757d'}; color: white; padding: 2px 5px; border-radius: 3px; font-size: 0.75rem;">
                        ${s.isSupport ? '支援' : '本單位'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-delete btn-sm" onclick="preScheduleManager.removeStaff(${idx})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
        const badge = document.getElementById('staffCountBadge');
        if(badge) badge.textContent = this.staffListSnapshot.length;
    },

    sortStaff: function(field) {
        if (this.staffSortState.field === field) {
            this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.staffSortState.field = field;
            this.staffSortState.order = 'asc';
        }
        this.renderStaffList();
    },

    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        if (!keyword) { alert("請輸入姓名或員編"); return; }
        
        const resultsDiv = document.getElementById('searchResults');
        resultsDiv.innerHTML = '<small>搜尋中...</small>';
        
        try {
            // 搜尋姓名
            const snapName = await db.collection('users')
                .where('displayName', '>=', keyword)
                .where('displayName', '<=', keyword + '\uf8ff')
                .limit(10).get();
            
            // 搜尋員編
            const snapId = await db.collection('users')
                .where('employeeId', '==', keyword)
                .limit(5).get();
            
            const results = [];
            const seenUids = new Set();
            
            [snapName, snapId].forEach(snap => {
                snap.forEach(doc => {
                    if (!seenUids.has(doc.id)) {
                        results.push({ uid: doc.id, ...doc.data() });
                        seenUids.add(doc.id);
                    }
                });
            });
            
            if (results.length === 0) {
                resultsDiv.innerHTML = '<small style="color:red;">找不到人員</small>';
                return;
            }
            
            let html = '<div class="search-results-popup" style="position:absolute; background:white; border:1px solid #ddd; box-shadow:0 2px 10px rgba(0,0,0,0.1); z-index:100; max-height:200px; overflow-y:auto; width:250px;">';
            results.forEach(u => {
                html += `
                    <div class="search-item" onclick='preScheduleManager.addSupportStaff(${JSON.stringify({
                        uid: u.uid,
                        name: u.displayName,
                        empId: u.employeeId,
                        level: u.level || 'N0'
                    })})' style="padding:8px; border-bottom:1px solid #eee; cursor:pointer; font-size:0.9rem;">
                        <strong>${u.displayName}</strong> <small>(${u.employeeId})</small>
                        <div style="font-size:0.75rem; color:#666;">${u.unitName || '未知單位'}</div>
                    </div>
                `;
            });
            html += '</div>';
            resultsDiv.innerHTML = html;
            
        } catch (e) {
            console.error("Search Error:", e);
            resultsDiv.innerHTML = '<small style="color:red;">搜尋出錯</small>';
        }
    },

    addSupportStaff: function(staff) {
        // 檢查是否已在名單中
        if (this.staffListSnapshot.some(s => s.uid === staff.uid)) {
            alert("此人員已在名單中");
            return;
        }
        
        this.staffListSnapshot.push({
            ...staff,
            group: '',
            isSupport: true
        });
        
        this.renderStaffList();
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('inputSearchStaff').value = '';
    },

    updateStaffGroup: function(idx, val) { this.staffListSnapshot[idx].group = val; },
    removeStaff: function(idx) { if(confirm('確定要移除此人員嗎？')) { this.staffListSnapshot.splice(idx, 1); this.renderStaffList(); } },
    closeModal: function() { document.getElementById('preScheduleModal').classList.remove('show'); },
    switchTab: function(tab) { document.querySelectorAll('.tab-btn, .tab-content').forEach(el=>el.classList.remove('active')); document.getElementById(`tab-${tab}`).classList.add('active'); },
    loadUnitDataForModal: async function() { const sSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).orderBy('startTime').get(); this.activeShifts = sSnap.docs.map(d=>d.data()); const uDoc = await db.collection('units').doc(this.currentUnitId).get(); this.currentUnitGroups = uDoc.data().groups || []; },
    loadCurrentUnitStaff: async function() { const snap = await db.collection('users').where('unitId','==',this.currentUnitId).where('isActive','==',true).get(); this.staffListSnapshot = snap.docs.map(d=>({uid:d.id, name:d.data().displayName, empId:d.data().employeeId, level:d.data().level, group:'', isSupport:false})); },
    fillForm: function(data) { 
        if(data.year) document.getElementById('inputPreYearMonth').value = `${data.year}-${String(data.month).padStart(2,'0')}`; 
        const s = data.settings || {}; 
        document.getElementById('inputOpenDate').value = s.openDate || ''; 
        document.getElementById('inputCloseDate').value = s.closeDate || ''; 
        document.getElementById('inputMaxOff').value = s.maxOffDays || 8; 
        document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
        document.getElementById('inputDailyReserve').value = s.dailyReserved || 1;
        document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3"; 
        document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
        if(document.getElementById('checkAllowThree')) document.getElementById('checkAllowThree').checked = s.allowThreeShifts || false;
        this.toggleThreeShiftOption(); 
    },
    toggleThreeShiftOption: function() { const mode = document.getElementById('inputShiftMode')?.value; const container = document.getElementById('threeShiftOption'); if(container) container.style.display = (mode === "2") ? 'block' : 'none'; },
    manage: function(docId) { window.location.hash = `/admin/pre_schedule_matrix?id=${docId}`; },
    deleteSchedule: async function(docId) { if(confirm("確定刪除？")) { await db.collection('pre_schedules').doc(docId).delete(); this.loadData(); } },

    importLastSettings: async function() {
        if (!this.currentUnitId) return;
        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                alert("找不到上個月的預班設定資料");
                return;
            }

            const lastData = snapshot.docs[0].data();
            
            // 帶入人力需求與組別限制
            this.renderDailyNeedsUI(lastData.dailyNeeds || {});
            this.renderSpecificNeedsUI(lastData.specificNeeds || {});
            this.renderGroupLimitsUI(lastData.groupLimits || {});
            
            // 帶入規則設定
            const s = lastData.settings || {};
            document.getElementById('inputMaxOff').value = s.maxOffDays || 8;
            document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
            document.getElementById('inputDailyReserve').value = s.dailyReserved || 1;
            document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3";
            document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
            if (document.getElementById('checkAllowThree')) {
                document.getElementById('checkAllowThree').checked = s.allowThreeShifts || false;
            }
            
            this.toggleThreeShiftOption();
            
            // 帶入人員名單
            this.staffListSnapshot = lastData.staffList || [];
            this.renderStaffList();
            
            alert("已成功帶入上月設定資料");
        } catch (e) {
            console.error("Import Error:", e);
            alert("帶入資料失敗: " + e.message);
        }
    }
};
