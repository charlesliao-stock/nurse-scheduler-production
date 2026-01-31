// js/modules/pre_schedule_manager.js
// 🔧 最終整合版 v3：修正顯示問題 + 權限強化

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
            
            // ✅ 權限過濾
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
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
                if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
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
        const snap = await db.collection('users')
            .where('unitId', '==', this.currentUnitId)
            .where('isActive', '==', true)
            .get();
        
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
        if(!this.currentUnitId) { 
            alert("請先選擇單位"); 
            return; 
        }
        
        const modal = document.getElementById('preScheduleModal');
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        this.switchTab('basic');

        await this.loadUnitDataForModal();

        let data = {};
        if (docId) {
            document.getElementById('btnImportLast').style.display = 'none';
            const doc = await db.collection('pre_schedules').doc(docId).get();
            data = doc.data();
            this.staffListSnapshot = data.staffList || [];
        } else {
            document.getElementById('btnImportLast').style.display = 'inline-block';
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
        this.renderStaffList();
        this.renderDailyNeedsTable(data.dailyNeeds);
        this.renderBundleLimitSettings(data.bundleLimits || {});
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
        
        this.toggleThreeShiftOption();
        if(s.shiftTypeMode === "2") {
            document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
        }
    },

    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        if (this.staffListSnapshot.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">尚無人員<br><button class="btn btn-sm btn-add" onclick="preScheduleManager.openSearchModal()" style="margin-top:10px;">搜尋並加入人員</button></td></tr>';
            return;
        }

        // 更新排序圖示
        document.querySelectorAll('th i[id^="sort_icon_staff_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_staff_${this.staffSortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.staffSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        // 渲染人員列表
        this.staffListSnapshot.forEach((staff, index) => {
            const supportBadge = staff.isSupport 
                ? '<span class="badge badge-warning" style="margin-left:5px;">支援</span>' 
                : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${staff.empId || '-'}</td>
                <td>${staff.name}${supportBadge}</td>
                <td>${staff.level || '-'}</td>
                <td>
                    <select class="form-control" style="padding:4px 8px;" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)">
                        <option value="">(未分組)</option>
                        ${this.currentUnitGroups.map(g => `<option value="${g}" ${staff.group === g ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeStaff(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('staffCountBadge').innerText = this.staffListSnapshot.length;
    },

    updateStaffGroup: function(index, groupId) {
        if (this.staffListSnapshot[index]) {
            this.staffListSnapshot[index].group = groupId;
            console.log(`更新 ${this.staffListSnapshot[index].name} 組別: ${groupId}`);
        }
    },

    removeStaff: function(index) {
        const staff = this.staffListSnapshot[index];
        if (confirm(`確定移除 ${staff.name} (${staff.empId})？`)) {
            this.staffListSnapshot.splice(index, 1);
            this.renderStaffList();
        }
    },

    renderDailyNeedsTable: function(dailyNeeds = {}) {
        const tbody = document.getElementById('dailyNeedsBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        if (this.activeShifts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px; color:#999;">此單位尚未設定班別</td></tr>';
            return;
        }

        this.activeShifts.forEach(shift => {
            const currentValue = dailyNeeds[shift.code] || 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span style="display:inline-block; width:12px; height:12px; background:${shift.color}; margin-right:8px; border-radius:2px;"></span>
                    <strong>${shift.code}</strong> - ${shift.name}
                </td>
                <td>
                    <input type="number" id="need_${shift.code}" value="${currentValue}" min="0" 
                           style="width:80px; padding:4px 8px; border:1px solid #ccc; border-radius:3px;">
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderBundleLimitSettings: function(bundleLimits = {}) {
        const container = document.getElementById('bundleLimitSettings');
        if(!container) return;
        container.innerHTML = '';

        const bundleShifts = this.activeShifts.filter(s => s.isBundleAvailable);
        
        if (bundleShifts.length === 0) {
            container.innerHTML = '<div style="padding:15px; color:#999; text-align:center;">此單位尚無開放包班的班別</div>';
            return;
        }

        bundleShifts.forEach(shift => {
            const currentValue = bundleLimits[shift.code] || 0;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:10px; background:#f8f9fa; border-radius:4px;';
            div.innerHTML = `
                <span style="display:inline-block; width:12px; height:12px; background:${shift.color}; border-radius:2px;"></span>
                <span style="flex:1;"><strong>${shift.code}</strong> - ${shift.name}</span>
                <input type="number" id="bundle_${shift.code}" value="${currentValue}" min="0" 
                       style="width:80px; padding:4px 8px; border:1px solid #ccc; border-radius:3px;" 
                       placeholder="配額">
                <span style="font-size:0.85rem; color:#666;">人次</span>
            `;
            container.appendChild(div);
        });
    },

    renderSpecificNeedsUI: function(specificNeeds = {}) {
        const container = document.getElementById('specificNeedsContainer');
        if(!container) return;
        
        this.tempSpecificNeeds = JSON.parse(JSON.stringify(specificNeeds));
        
        container.innerHTML = '<button class="btn btn-add" onclick="preScheduleManager.openSpecificNeedModal()" style="margin-bottom:10px;"><i class="fas fa-plus"></i> 新增特定日期需求</button>';
        
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
        
        Object.keys(this.tempSpecificNeeds).forEach(day => {
            const needs = this.tempSpecificNeeds[day];
            const needsText = Object.entries(needs).map(([code, count]) => `${code}: ${count}`).join(', ');
            
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px; background:#f8f9fa; border-radius:4px; display:flex; justify-content:space-between; align-items:center;';
            item.innerHTML = `
                <span><strong>${day} 日</strong>: ${needsText}</span>
                <button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeSpecificNeed('${day}')">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            list.appendChild(item);
        });
        
        container.appendChild(list);
    },

    openSpecificNeedModal: function() {
        const modal = document.getElementById('specificNeedModal');
        if(!modal) return;
        
        modal.classList.add('show');
        document.getElementById('inputSpecificDay').value = '';
        
        const tbody = document.getElementById('specificNeedShiftBody');
        tbody.innerHTML = '';
        
        this.activeShifts.forEach(shift => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span style="display:inline-block; width:12px; height:12px; background:${shift.color}; margin-right:8px; border-radius:2px;"></span>
                    <strong>${shift.code}</strong> - ${shift.name}
                </td>
                <td>
                    <input type="number" id="specific_${shift.code}" value="0" min="0" 
                           style="width:80px; padding:4px 8px; border:1px solid #ccc; border-radius:3px;">
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    closeSpecificNeedModal: function() {
        const modal = document.getElementById('specificNeedModal');
        if(modal) modal.classList.remove('show');
    },

    saveSpecificNeed: function() {
        const day = document.getElementById('inputSpecificDay').value;
        if (!day || day < 1 || day > 31) {
            alert("請輸入有效的日期 (1-31)");
            return;
        }

        const needs = {};
        let hasValue = false;
        
        this.activeShifts.forEach(shift => {
            const input = document.getElementById(`specific_${shift.code}`);
            const value = parseInt(input.value) || 0;
            if (value > 0) {
                needs[shift.code] = value;
                hasValue = true;
            }
        });

        if (!hasValue) {
            alert("請至少設定一個班別的需求人數");
            return;
        }

        this.tempSpecificNeeds[day] = needs;
        this.renderSpecificNeedsUI(this.tempSpecificNeeds);
        this.closeSpecificNeedModal();
    },

    removeSpecificNeed: function(day) {
        if (confirm(`確定刪除 ${day} 日的特定需求？`)) {
            delete this.tempSpecificNeeds[day];
            this.renderSpecificNeedsUI(this.tempSpecificNeeds);
        }
    },

    renderGroupLimitsTable: function(groupLimits = {}) {
        const tbody = document.getElementById('groupLimitsBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        if (this.currentUnitGroups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px; color:#999;">此單位尚未設定組別<br>請至「組別管理」新增</td></tr>';
            return;
        }

        this.currentUnitGroups.forEach(group => {
            const currentValue = groupLimits[group] || 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${group}</strong></td>
                <td>
                    <input type="number" id="grouplimit_${group}" value="${currentValue}" min="0" 
                           style="width:80px; padding:4px 8px; border:1px solid #ccc; border-radius:3px;">
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const ymInput = document.getElementById('inputPreYearMonth').value;
        
        if (!ymInput) {
            alert("請選擇年月");
            return;
        }

        const [year, month] = ymInput.split('-').map(Number);
        
        const openDate = document.getElementById('inputOpenDate').value;
        const closeDate = document.getElementById('inputCloseDate').value;
        
        if (!openDate || !closeDate) {
            alert("請設定開放與截止日期");
            return;
        }

        // 收集每日需求
        const dailyNeeds = {};
        this.activeShifts.forEach(shift => {
            const input = document.getElementById(`need_${shift.code}`);
            if (input) {
                dailyNeeds[shift.code] = parseInt(input.value) || 0;
            }
        });

        // 收集包班配額
        const bundleLimits = {};
        const bundleShifts = this.activeShifts.filter(s => s.isBundleAvailable);
        bundleShifts.forEach(shift => {
            const input = document.getElementById(`bundle_${shift.code}`);
            if (input) {
                bundleLimits[shift.code] = parseInt(input.value) || 0;
            }
        });

        // 收集組別上限
        const groupLimits = {};
        this.currentUnitGroups.forEach(group => {
            const input = document.getElementById(`grouplimit_${group}`);
            if (input) {
                groupLimits[group] = parseInt(input.value) || 0;
            }
        });

        const data = {
            unitId: this.currentUnitId,
            unitName: (await db.collection('units').doc(this.currentUnitId).get()).data().name,
            year: year,
            month: month,
            status: 'open',
            settings: {
                openDate: openDate,
                closeDate: closeDate,
                maxOffDays: parseInt(document.getElementById('inputMaxOff').value) || 8,
                maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday').value) || 2,
                dailyReserved: parseInt(document.getElementById('inputDailyReserve').value) || 1,
                shiftTypeMode: document.getElementById('inputShiftMode').value,
                allowThreeShifts: document.getElementById('checkAllowThree')?.checked || false,
                showAllNames: document.getElementById('checkShowAllNames').checked
            },
            dailyNeeds: dailyNeeds,
            bundleLimits: bundleLimits,
            groupLimits: groupLimits,
            specificNeeds: this.tempSpecificNeeds,
            staffList: this.staffListSnapshot,
            assignments: {},
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // 初始化 assignments
        this.staffListSnapshot.forEach(staff => {
            data.assignments[staff.uid] = {};
        });

        try {
            if (docId) {
                await db.collection('pre_schedules').doc(docId).update(data);
                alert("更新成功！");
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.progress = { submitted: 0, total: this.staffListSnapshot.length };
                await db.collection('pre_schedules').add(data);
                alert("建立成功！");
            }
            
            this.closeModal();
            this.loadData();
            
        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    openSearchModal: function() {
        const modal = document.getElementById('searchStaffModal');
        if(!modal) return;
        
        modal.classList.add('show');
        document.getElementById('inputSearchStaff').value = '';
        document.getElementById('searchResults').innerHTML = '';
    },

    closeSearchModal: function() {
        const modal = document.getElementById('searchStaffModal');
        if(modal) modal.classList.remove('show');
    },

    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        const resultsContainer = document.getElementById('searchResults');
        
        if (!keyword || keyword.length < 2) {
            resultsContainer.innerHTML = '<div style="padding:10px; color:#999;">請輸入至少2個字元</div>';
            return;
        }

        resultsContainer.innerHTML = '<div style="padding:10px;">搜尋中...</div>';

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

            if (results.length === 0) {
                resultsContainer.innerHTML = '<div style="padding:10px; color:#999;">找不到符合的人員 (或已在名單中)</div>';
                return;
            }

            let html = `<div style="border:1px solid #ddd; margin-top:10px; border-radius:4px; max-height:200px; overflow-y:auto;">
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
                    ? '<span class="badge badge-warning">跨單位</span>' 
                    : '<span class="badge" style="background:#95a5a6;">本單位</span>';
                
                html += `<tr>
                    <td>${r.empId}</td>
                    <td>${r.name}</td>
                    <td>${r.unitName}</td>
                    <td>${r.level}</td>
                    <td>
                        ${badge}
                        <button class="btn btn-sm btn-add" onclick="preScheduleManager.addSupportStaff('${r.uid}', '${r.name}', '${r.empId}', '${r.level}', ${isCrossUnit})" style="margin-left:5px;">
                            <i class="fas fa-plus"></i> 加入
                        </button>
                    </td>
                </tr>`;
            });
            
            html += `</tbody></table></div>`;
            resultsContainer.innerHTML = html;

        } catch (e) {
            console.error("搜尋錯誤:", e);
            resultsContainer.innerHTML = '<div style="padding:10px; color:red;">搜尋失敗: ' + e.message + '</div>';
        }
    },

    addSupportStaff: function(uid, name, empId, level, isCrossUnit) {
        if (this.staffListSnapshot.some(s => s.uid === uid)) {
            alert("該人員已在名單中");
            return;
        }

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
        
        alert(`✅ 已加入 ${name} (${empId})`);
    },

    sortStaff: function(field) {
        const state = this.staffSortState;
        
        if (state.field === field) {
            state.order = state.order === 'asc' ? 'desc' : 'asc';
        } else {
            state.field = field;
            state.order = 'asc';
        }

        this.staffListSnapshot.sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';
            
            if (field === 'isSupport') {
                valA = a.isSupport ? 1 : 0;
                valB = b.isSupport ? 1 : 0;
            }
            
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            
            if (state.order === 'asc') {
                return valA > valB ? 1 : valA < valB ? -1 : 0;
            } else {
                return valA < valB ? 1 : valA > valB ? -1 : 0;
            }
        });

        this.renderStaffList();
    },
    
    deleteSchedule: async function(id) { 
        if(confirm("確定刪除此預班表？")) { 
            await db.collection('pre_schedules').doc(id).delete(); 
            this.loadData(); 
        } 
    },
    
    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const opt = document.getElementById('threeShiftOption');
        if(opt) {
            opt.style.display = (mode === '2') ? 'block' : 'none';
        }
    },

    manage: function(id) { 
        window.location.hash = `/admin/pre_schedule_matrix?id=${id}`; 
    },

    importLastSettings: async function() {
        if(!this.currentUnitId) return;
        
        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                alert("找不到上個月的預班表設定。");
                return;
            }

            const lastData = snapshot.docs[0].data();
            
            // 填寫基本設定
            const s = lastData.settings || {};
            document.getElementById('inputMaxOff').value = s.maxOffDays || 8;
            document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
            document.getElementById('inputDailyReserve').value = s.dailyReserved || 1;
            document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
            document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3";
            this.toggleThreeShiftOption();
            if(s.shiftTypeMode === "2") {
                document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
            }

            // 重新渲染表格
            this.renderDailyNeedsTable(lastData.dailyNeeds || {});
            this.renderBundleLimitSettings(lastData.bundleLimits || {});
            this.renderSpecificNeedsUI(lastData.specificNeeds || {});
            this.renderGroupLimitsTable(lastData.groupLimits || {});

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
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = preScheduleManager;
}
