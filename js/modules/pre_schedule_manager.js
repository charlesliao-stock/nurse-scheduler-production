// js/modules/pre_schedule_manager.js
// 🔧 完整修復版 v6：修復所有函數名稱和表格渲染問題

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
        
        // ✅ 權限檢查
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
            
            // ✅ 權限過濾：使用 impersonatedRole 或 userRole
            const activeRole = app.impersonatedRole || app.userRole;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }
            
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            
            // ✅ 如果只有一個單位，自動選取並限制選單
            if(snapshot.size === 1) { 
                select.selectedIndex = 1;
                
                // 單位護理長不需要看到選單
                if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                    select.disabled = true;
                    select.style.backgroundColor = '#f5f5f5';
                }
                
                this.loadData(); 
            }
            
            select.onchange = () => this.loadData();
            
        } catch(e) { 
            console.error(e); 
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadData: async function() {
        this.currentUnitId = document.getElementById('filterPreUnit').value;
        if(!this.currentUnitId) return;
        
        const tbody = document.getElementById('preScheduleTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const unitDoc = await db.collection('units').doc(this.currentUnitId).get();
            this.currentUnitGroups = unitDoc.data().groups || [];
            
            const shiftSnap = await db.collection('shifts')
                .where('unitId','==',this.currentUnitId)
                .get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());

            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
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
        } catch(e) { 
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    closeModal: function() { 
        document.getElementById('preScheduleModal').classList.remove('show'); 
    },
    
    switchTab: function(tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        const btns = document.querySelectorAll('.tab-btn');
        if(tabName === 'basic') btns[0].classList.add('active');
        if(tabName === 'needs') btns[1].classList.add('active');
        if(tabName === 'staff') btns[2].classList.add('active');
    },

    loadUnitDataForModal: async function() {
        if(!this.currentUnitId) return;
        try {
            const shiftSnap = await db.collection('shifts')
                .where('unitId','==',this.currentUnitId)
                .orderBy('startTime')
                .get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());
            
            const unitDoc = await db.collection('units').doc(this.currentUnitId).get();
            this.currentUnitGroups = unitDoc.data().groups || [];
            
            console.log("✅ Modal Data Loaded. Shifts:", this.activeShifts.length, "Groups:", this.currentUnitGroups.length);
        } catch(e) { 
            console.error("Load Modal Data Error:", e); 
        }
    },

    loadCurrentUnitStaff: async function() {
        if(!this.currentUnitId) return;
        
        // ✅ 權限過濾：只載入在職人員
        const snap = await db.collection('users')
            .where('unitId', '==', this.currentUnitId)
            .where('isActive', '==', true)
            .get();
        
        this.staffListSnapshot = snap.docs.map(doc => ({
            uid: doc.id,
            name: doc.data().displayName,
            empId: doc.data().employeeId,
            level: doc.data().level,
            group: doc.data().groupId || '',
            isSupport: false 
        }));
        
        const badge = document.getElementById('staffCountBadge');
        if (badge) badge.innerText = this.staffListSnapshot.length;
    },

    openModal: async function(docId = null) {
        if(!this.currentUnitId) { 
            alert("請先選擇單位"); 
            return; 
        }
        
        const modal = document.getElementById('preScheduleModal');
        if (!modal) {
            console.error('預班表 Modal 元素不存在');
            return;
        }
        
        modal.classList.add('show');
        
        const docIdInput = document.getElementById('preScheduleDocId');
        if (docIdInput) docIdInput.value = docId || '';
        
        this.switchTab('basic');

        await this.loadUnitDataForModal();

        let data = {};
        if (docId) {
            const btnImportLast = document.getElementById('btnImportLast');
            if (btnImportLast) btnImportLast.style.display = 'none';
            
            const doc = await db.collection('pre_schedules').doc(docId).get();
            data = doc.data();
            this.staffListSnapshot = data.staffList || [];
        } else {
            const btnImportLast = document.getElementById('btnImportLast');
            if (btnImportLast) btnImportLast.style.display = 'inline-block';
            
            const nextMonth = new Date(); 
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            data = {
                year: nextMonth.getFullYear(),
                month: nextMonth.getMonth() + 1,
                settings: { 
                    maxOffDays: 8, 
                    maxHolidayOffs: 2, 
                    dailyReserved: 1, 
                    shiftTypeMode: "3", 
                    showAllNames: true 
                },
                groupLimits: {}, 
                dailyNeeds: {}, 
                specificNeeds: {}, 
                bundleLimits: {}
            };
            await this.loadCurrentUnitStaff();
        }

        this.fillForm(data);
        
        console.log("📊 Opening modal with data:", {
            dailyNeeds: data.dailyNeeds,
            specificNeeds: data.specificNeeds,
            groupLimits: data.groupLimits
        });
        
        this.renderDailyNeedsUI(data.dailyNeeds || {});
        this.renderSpecificNeedsUI(data.specificNeeds || {}); 
        this.renderGroupLimitsUI(data.groupLimits || {});
        this.renderStaffList();
    },

    fillForm: function(data) {
        // ✅ 安全設定：檢查元素是否存在再設值
        const setInputValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value || '';
        };
        
        const setCheckboxValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.checked = value;
        };

        if(data.year && data.month) {
            const m = data.month < 10 ? '0'+data.month : data.month;
            setInputValue('inputPreYearMonth', `${data.year}-${m}`);
        }
        
        const s = data.settings || {};
        setInputValue('inputOpenDate', s.openDate || '');
        setInputValue('inputCloseDate', s.closeDate || '');
        setInputValue('inputMaxOff', s.maxOffDays || 8);
        setInputValue('inputMaxHoliday', s.maxHolidayOffs || 2);
        setInputValue('inputDailyReserve', s.dailyReserved || 1);
        setCheckboxValue('checkShowAllNames', s.showAllNames !== false);
        setInputValue('inputShiftMode', s.shiftTypeMode || "3");
        
        this.toggleThreeShiftOption();
        if(s.shiftTypeMode === "2") {
            setCheckboxValue('checkAllowThree', s.allowThreeShifts || false);
        }
    },

    // ✅ HTML 中調用的是 saveData，所以這裡改名
    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId')?.value;
        const ymInput = document.getElementById('inputPreYearMonth')?.value;
        
        if (!ymInput) {
            alert("請選擇年月");
            return;
        }

        const [year, month] = ymInput.split('-').map(Number);
        
        const openDate = document.getElementById('inputOpenDate')?.value;
        const closeDate = document.getElementById('inputCloseDate')?.value;
        
        if (!openDate || !closeDate) {
            alert("請設定開放與截止日期");
            return;
        }

        const dailyNeeds = this.getDailyNeedsFromDOM();
        const specificNeeds = this.getSpecificNeedsFromDOM();
        const groupLimits = this.getGroupLimitsFromDOM();

        const doc = {
            unitId: this.currentUnitId,
            unitName: (await db.collection('units').doc(this.currentUnitId).get()).data().name,
            year, 
            month,
            status: 'open',
            settings: {
                openDate, 
                closeDate, 
                maxOffDays: parseInt(document.getElementById('inputMaxOff')?.value) || 8,
                maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday')?.value) || 2,
                dailyReserved: parseInt(document.getElementById('inputDailyReserve')?.value) || 1,
                showAllNames: document.getElementById('checkShowAllNames')?.checked !== false,
                shiftTypeMode: document.getElementById('inputShiftMode')?.value || "3",
                allowThreeShifts: (document.getElementById('inputShiftMode')?.value === "2") 
                    ? (document.getElementById('checkAllowThree')?.checked || false) 
                    : null
            },
            dailyNeeds,
            specificNeeds,
            groupLimits,
            staffList: this.staffListSnapshot,
            assignments: {},
            progress: { total: this.staffListSnapshot.length, submitted: 0 },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) {
                await db.collection('pre_schedules').doc(docId).update(doc);
                alert("已更新預班表");
            } else {
                await db.collection('pre_schedules').add(doc);
                alert("已建立新預班表");
            }
            this.closeModal();
            await this.loadData();
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    // ✅ 渲染每日人力需求表格 - 使用正確的容器 ID
    renderDailyNeedsUI: function(savedData) {
        const container = document.getElementById('dailyNeedsTable');
        if(!container) {
            console.error('dailyNeedsTable container not found');
            return;
        }
        
        const ymInput = document.getElementById('inputPreYearMonth')?.value;
        if (!ymInput) {
            container.innerHTML = '<p style="color:#999;">請先選擇預班月份</p>';
            return;
        }
        
        const [year, month] = ymInput.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();

        let html = `
            <div class="section-title" style="margin-bottom:15px; border-bottom:2px solid #3498db; padding-bottom:5px;">
                每日人力需求設定
            </div>
            <div style="overflow-x:auto; max-height:400px; border:1px solid #ddd;">
                <table class="table table-sm">
                    <thead class="sticky-th">
                        <tr>
                            <th style="width:60px;">日期</th>`;
        
        this.activeShifts.forEach(s => {
            html += `<th style="background:${s.color||'#eee'}; color:#fff;">${s.code}</th>`;
        });
        html += `</tr></thead><tbody>`;

        for(let d=1; d<=daysInMonth; d++) {
            html += `<tr><td style="font-weight:bold;">${d}</td>`;
            this.activeShifts.forEach(s => {
                let val = '';
                if (savedData[d] && savedData[d][s.code] !== undefined) {
                    const rawVal = savedData[d][s.code];
                    val = (typeof rawVal === 'number' || !isNaN(rawVal)) ? rawVal : '';
                }
                html += `<td><input type="number" min="0" class="limit-input" style="width:60px;" data-day="${d}" data-shift="${s.code}" value="${val}" placeholder="0"></td>`;
            });
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;
        
        container.innerHTML = html;
    },

    getDailyNeedsFromDOM: function() {
        const result = {};
        document.querySelectorAll('#dailyNeedsTable input').forEach(input => {
            const day = parseInt(input.dataset.day);
            const shift = input.dataset.shift;
            const val = parseInt(input.value);
            
            // 只儲存有效的正數
            if (!isNaN(val) && val > 0) {
                if(!result[day]) result[day] = {};
                result[day][shift] = val;
            }
        });
        return result;
    },

    // ✅ 渲染特定日期需求 UI
    renderSpecificNeedsUI: function(savedData) {
        this.tempSpecificNeeds = JSON.parse(JSON.stringify(savedData || {}));
        
        const container = document.getElementById('specificNeedsContainer');
        if (!container) {
            console.error('specificNeedsContainer not found');
            return;
        }

        let html = `
            <div class="section-title" style="margin-top:30px; margin-bottom:15px; border-bottom:2px solid #e74c3c; padding-bottom:5px;">
                特定日期需求加成
            </div>
            <div style="background:#f9f9f9; padding:15px; border-radius:4px; margin-bottom:15px;">
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                    <input type="number" id="inputSpecificDay" placeholder="日期" min="1" max="31" class="form-control" style="width:80px;">
                    <select id="inputSpecificShift" class="form-control" style="width:100px;">
                        <option value="">選擇班別</option>`;
        
        this.activeShifts.forEach(s => {
            html += `<option value="${s.code}">${s.code}</option>`;
        });
        
        html += `</select>
                    <input type="number" id="inputSpecificNeed" placeholder="需求人數" min="1" class="form-control" style="width:100px;">
                    <button class="btn btn-add" onclick="preScheduleManager.addSpecificNeed()">新增</button>
                </div>
                <div id="specificNeedsList"></div>
            </div>`;
        
        container.innerHTML = html;
        this.refreshSpecificNeedsList();
    },

    refreshSpecificNeedsList: function() {
        const list = document.getElementById('specificNeedsList');
        if(!list) return;
        list.innerHTML = '';

        const keys = Object.keys(this.tempSpecificNeeds);
        if(keys.length === 0) {
            list.innerHTML = '<div style="color:#999; padding:10px;">尚無特定日期需求</div>';
            return;
        }

        keys.forEach(day => {
            const dayData = this.tempSpecificNeeds[day];
            const div = document.createElement('div');
            div.style.cssText = 'border:1px solid #ddd; padding:10px; margin-bottom:8px; border-radius:4px; background:#fff;';
            
            let shiftStr = '';
            for(let shift in dayData) {
                if(dayData[shift] > 0) shiftStr += `${shift}:${dayData[shift]}人 `;
            }

            div.innerHTML = `
                <strong style="color:#2980b9;">${day} 日</strong> → ${shiftStr}
                <button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeSpecificNeed('${day}')" style="float:right;">刪除</button>
            `;
            list.appendChild(div);
        });
    },

    addSpecificNeed: function() {
        const day = parseInt(document.getElementById('inputSpecificDay').value);
        const shift = document.getElementById('inputSpecificShift').value;
        const need = parseInt(document.getElementById('inputSpecificNeed').value);

        if(!day || !shift || !need) {
            alert("請填寫完整");
            return;
        }

        if(!this.tempSpecificNeeds[day]) this.tempSpecificNeeds[day] = {};
        this.tempSpecificNeeds[day][shift] = need;

        this.refreshSpecificNeedsList();
        
        document.getElementById('inputSpecificDay').value = '';
        document.getElementById('inputSpecificNeed').value = '';
    },

    removeSpecificNeed: function(day) {
        delete this.tempSpecificNeeds[day];
        this.refreshSpecificNeedsList();
    },

    getSpecificNeedsFromDOM: function() {
        return this.tempSpecificNeeds;
    },

    // ✅ 渲染組別限制表格
    renderGroupLimitsUI: function(savedData) {
        const container = document.getElementById('groupLimitTableContainer');
        if(!container) {
            console.error('groupLimitTableContainer not found');
            return;
        }

        if(this.currentUnitGroups.length === 0) {
            container.innerHTML = '<p style="color:#999; padding:20px;">此單位未設定組別</p>';
            return;
        }

        let html = `
            <div class="section-title" style="margin-top:30px; margin-bottom:15px; border-bottom:2px solid #9b59b6; padding-bottom:5px;">
                組別人力上限設定
            </div>
            <div style="overflow-x:auto; border:1px solid #ddd;">
                <table class="table table-sm">
                    <thead class="sticky-th">
                        <tr>
                            <th style="width:100px;">組別</th>`;
        
        this.activeShifts.forEach(s => {
            html += `<th style="background:${s.color||'#eee'}; color:#fff;">${s.code}</th>`;
        });
        html += `</tr></thead><tbody>`;

        this.currentUnitGroups.forEach(g => {
            html += `<tr><td style="font-weight:bold;">${g}</td>`;
            this.activeShifts.forEach(s => {
                let val = '';
                if (savedData[g] && savedData[g][s.code] !== undefined) {
                    // 確保轉換為數字或空字串
                    const rawVal = savedData[g][s.code];
                    val = (typeof rawVal === 'number' || !isNaN(rawVal)) ? rawVal : '';
                }
                html += `<td><input type="number" min="0" class="limit-input" style="width:60px;" data-group="${g}" data-shift="${s.code}" value="${val}" placeholder="0"></td>`;
            });
            html += `</tr>`;
        });
        
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },

    getGroupLimitsFromDOM: function() {
        const result = {};
        document.querySelectorAll('#groupLimitTableContainer input').forEach(input => {
            const group = input.dataset.group;
            const shift = input.dataset.shift;
            const val = parseInt(input.value);
            
            // 只儲存有效的正數
            if (!isNaN(val) && val > 0) {
                if(!result[group]) result[group] = {};
                result[group][shift] = val;
            }
        });
        return result;
    },

    // ✅ 渲染人員列表 - 使用正確的 tbody ID
    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody');
        if(!tbody) {
            console.error('preStaffBody not found');
            return;
        }
        tbody.innerHTML = '';

        if (this.staffListSnapshot.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">尚無人員，請使用上方搜尋功能加入人員</td></tr>';
            return;
        }

        // 排序
        this.sortStaffList();

        // 渲染人員列表
        this.staffListSnapshot.forEach((staff, index) => {
            const supportBadge = staff.isSupport 
                ? '<span class="badge badge-warning" style="background:#f39c12;">支援</span>' 
                : '<span class="badge" style="background:#95a5a6;">本單位</span>';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${staff.empId || '-'}</td>
                <td>${staff.name}</td>
                <td>${staff.level || '-'}</td>
                <td>
                    <select class="form-control" style="padding:4px 8px; font-size:0.9rem;" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)">
                        <option value="">(未分組)</option>
                        ${this.currentUnitGroups.map(g => `<option value="${g}" ${staff.group === g ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </td>
                <td>${supportBadge}</td>
                <td>
                    <button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeStaff(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        const badge = document.getElementById('staffCountBadge');
        if (badge) badge.innerText = this.staffListSnapshot.length;
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

    sortStaffList: function() {
        const field = this.staffSortState.field;
        const order = this.staffSortState.order;
        
        this.staffListSnapshot.sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';
            
            if (field === 'isSupport') {
                valA = a.isSupport ? 1 : 0;
                valB = b.isSupport ? 1 : 0;
            }
            
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
    },

    updateStaffGroup: function(index, groupId) {
        if (this.staffListSnapshot[index]) {
            this.staffListSnapshot[index].group = groupId;
            console.log(`更新 ${this.staffListSnapshot[index].name} 組別: ${groupId}`);
        }
    },

    removeStaff: function(index) {
        if(confirm(`確定移除 ${this.staffListSnapshot[index].name}？`)) {
            this.staffListSnapshot.splice(index, 1);
            this.renderStaffList();
        }
    },

    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff')?.value.trim();
        const resultsContainer = document.getElementById('searchResults');
        
        if (!keyword || keyword.length < 2) {
            if (resultsContainer) {
                resultsContainer.innerHTML = '<div style="padding:10px; color:#999; position:absolute; background:#fff; border:1px solid #ddd; border-radius:4px; z-index:1000; box-shadow:0 2px 8px rgba(0,0,0,0.1);">請輸入至少2個字元</div>';
                setTimeout(() => { resultsContainer.innerHTML = ''; }, 2000);
            }
            return;
        }

        if (resultsContainer) {
            resultsContainer.innerHTML = '<div style="padding:10px; position:absolute; background:#fff; border:1px solid #ddd; border-radius:4px; z-index:1000;">搜尋中...</div>';
        }

        try {
            const snapshot = await db.collection('users')
                .where('isActive', '==', true)
                .get();

            const results = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const name = data.displayName || '';
                const empId = data.employeeId || '';
                
                if (name.includes(keyword) || empId.includes(keyword)) {
                    const alreadyAdded = this.staffListSnapshot.some(s => s.uid === doc.id);
                    if (!alreadyAdded) {
                        results.push({
                            uid: doc.id,
                            name: name,
                            empId: empId,
                            unitName: data.unitName || '未知單位',
                            level: data.level || 'N',
                            unitId: data.unitId
                        });
                    }
                }
            });

            if (!resultsContainer) return;

            if (results.length === 0) {
                resultsContainer.innerHTML = '<div style="padding:10px; color:#999; position:absolute; background:#fff; border:1px solid #ddd; border-radius:4px; z-index:1000;">找不到符合的人員 (或已在名單中)</div>';
                setTimeout(() => { resultsContainer.innerHTML = ''; }, 3000);
                return;
            }

            let html = `<div style="position:absolute; background:#fff; border:1px solid #ddd; border-radius:4px; z-index:1000; box-shadow:0 4px 12px rgba(0,0,0,0.15); max-width:600px; max-height:300px; overflow-y:auto;">
                <table class="table table-sm" style="margin:0;">
                    <thead style="position:sticky; top:0; background:#f8f9fa;">
                        <tr>
                            <th style="width:15%;">員編</th>
                            <th style="width:20%;">姓名</th>
                            <th style="width:25%;">單位</th>
                            <th style="width:15%;">層級</th>
                            <th style="width:25%;">操作</th>
                        </tr>
                    </thead>
                    <tbody>`;
            
            results.forEach(r => {
                const isCrossUnit = r.unitId !== this.currentUnitId;
                const badge = isCrossUnit 
                    ? '<span class="badge badge-warning" style="background:#f39c12;">跨單位</span>' 
                    : '<span class="badge" style="background:#95a5a6;">本單位</span>';
                
                html += `<tr>
                    <td>${r.empId}</td>
                    <td>${r.name}</td>
                    <td>${r.unitName}</td>
                    <td>${r.level}</td>
                    <td>
                        ${badge}
                        <button class="btn btn-sm btn-add" onclick="preScheduleManager.addStaff('${r.uid}', '${r.name}', '${r.empId}', '${r.level}', ${isCrossUnit})" style="margin-left:5px;">
                            <i class="fas fa-plus"></i> 加入
                        </button>
                    </td>
                </tr>`;
            });
            
            html += `</tbody></table>
                <div style="text-align:right; padding:10px; border-top:1px solid #eee; background:#f9f9f9;">
                    <button class="btn btn-sm" onclick="document.getElementById('searchResults').innerHTML = ''">關閉</button>
                </div>
            </div>`;
            resultsContainer.innerHTML = html;

        } catch (e) {
            console.error("搜尋錯誤:", e);
            if (resultsContainer) {
                resultsContainer.innerHTML = '<div style="padding:10px; color:red; position:absolute; background:#fff; border:1px solid #ddd; border-radius:4px; z-index:1000;">搜尋失敗: ' + e.message + '</div>';
            }
        }
    },

    addStaff: function(uid, name, empId, level, isCrossUnit) {
        // 檢查是否已加入
        if (this.staffListSnapshot.some(s => s.uid === uid)) {
            alert("此人員已在名單中");
            return;
        }

        // 加入人員
        this.staffListSnapshot.push({
            uid: uid,
            name: name,
            empId: empId,
            level: level,
            group: '',
            isSupport: isCrossUnit
        });

        this.renderStaffList();
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('inputSearchStaff').value = '';
        
        alert(`✅ 已加入 ${name}${isCrossUnit ? ' (跨單位支援)' : ''}`);
    },

    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode')?.value;
        const container = document.getElementById('threeShiftOption');
        
        if (container) {
            container.style.display = (mode === "2") ? 'block' : 'none';
        }
    },

    importLastSettings: async function() {
        if (!this.currentUnitId) {
            alert("請先選擇單位");
            return;
        }

        try {
            // 查詢上個月的預班表
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                alert("找不到上個月的預班表");
                return;
            }

            const lastDoc = snapshot.docs[0];
            const lastData = lastDoc.data();

            // 輔助函數
            const setInputValue = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            };
            
            const setCheckboxValue = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.checked = value;
            };

            // 帶入基本設定
            const s = lastData.settings || {};
            setInputValue('inputMaxOff', s.maxOffDays);
            setInputValue('inputMaxHoliday', s.maxHolidayOffs);
            setInputValue('inputDailyReserve', s.dailyReserved);
            setCheckboxValue('checkShowAllNames', s.showAllNames);
            setInputValue('inputShiftMode', s.shiftTypeMode);
            
            this.toggleThreeShiftOption();
            if (s.shiftTypeMode === "2") {
                setCheckboxValue('checkAllowThree', s.allowThreeShifts);
            }

            // 重新渲染表格
            this.renderDailyNeedsUI(lastData.dailyNeeds || {});
            this.renderSpecificNeedsUI(lastData.specificNeeds || {});
            this.renderGroupLimitsUI(lastData.groupLimits || {});

            // 如果有人員名單也一併帶入
            if (lastData.staffList && lastData.staffList.length > 0) {
                this.staffListSnapshot = JSON.parse(JSON.stringify(lastData.staffList));
                this.renderStaffList();
            }

            alert(`✅ 已成功帶入 ${lastData.year}-${lastData.month} 的設定。`);
            
        } catch(e) {
            console.error("Import Last Settings Error:", e);
            alert("帶入設定失敗: " + e.message);
        }
    },

    deleteSchedule: async function(docId) {
        if (!confirm("確定要刪除此預班表？此動作無法復原！")) {
            return;
        }

        try {
            await db.collection('pre_schedules').doc(docId).delete();
            alert("✅ 已刪除預班表");
            await this.loadData();
        } catch(e) {
            console.error("刪除失敗:", e);
            alert("刪除失敗: " + e.message);
        }
    },

    manage: function(docId) {
        // 導向預班管理介面
        window.location.href = `/admin/pre_schedules/manage.html?id=${docId}`;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = preScheduleManager;
}
