// js/modules/pre_schedule_manager.js
// 🔧 最終整合版 v3：修正顯示問題

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

    loadUnitDataForModal: async function() {
        if(!this.currentUnitId) return;
        try {
            const shiftSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).orderBy('startTime').get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());
            
            const unitDoc = await db.collection('units').doc(this.currentUnitId).get();
            this.currentUnitGroups = unitDoc.data().groups || [];
            
            console.log("✅ Modal Data Loaded. Shifts:", this.activeShifts.length, "Groups:", this.currentUnitGroups.length);
        } catch(e) { console.error("Load Modal Data Error:", e); }
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

        await this.loadUnitDataForModal();

        let data = {};
        if (docId) {
            document.getElementById('btnImportLast').style.display = 'none';
            const doc = await db.collection('pre_schedules').doc(docId).get();
            data = doc.data();
            this.staffListSnapshot = data.staffList || [];
        } else {
            document.getElementById('btnImportLast').style.display = 'inline-block';
            const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
            data = {
                year: nextMonth.getFullYear(),
                month: nextMonth.getMonth() + 1,
                settings: { maxOffDays: 8, maxHolidayOffs: 2, dailyReserved: 1, shiftTypeMode: "3", showAllNames: true },
                groupLimits: {}, dailyNeeds: {}, specificNeeds: {}, bundleLimits: {}
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
        if(s.shiftTypeMode === "2") document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
    },

    renderDailyNeedsTable: function(savedNeeds = {}) {
        const container = document.getElementById('dailyNeedsTable');
        if(!container) return;
        
        let html = `<h4 style="margin-top:0; border-bottom:1px solid #eee; padding-bottom:10px; color:#2c3e50;">1. 各班每日人力需求 (週循環)</h4>`;
        
        if (!this.activeShifts || this.activeShifts.length === 0) {
            container.innerHTML = html + `<div style="color:red; padding:10px; background:#fff3cd;">⚠️ 未偵測到班別資料。請先至「班別管理」新增班別,或重新整理頁面。</div>`;
            return;
        }

        html += `<table class="table table-bordered table-sm text-center">`;
        const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        
        let tableHTML = '<thead><tr><th style="background:#f8f9fa;">班別 \\ 星期</th>';
        days.forEach(d => tableHTML += `<th style="background:#f8f9fa; min-width:60px;">${d}</th>`);
        tableHTML += '</tr></thead><tbody>';

        this.activeShifts.forEach(shift => {
            tableHTML += `<tr><td style="font-weight:bold;">${shift.name} (${shift.code})</td>`;
            for(let i=0; i<7; i++) {
                const key = `${shift.code}_${i}`; 
                const val = (savedNeeds && savedNeeds[key] !== undefined) ? savedNeeds[key] : '';
                tableHTML += `<td><input type="number" class="limit-input needs-input" data-key="${key}" value="${val}" style="width:100%;"></td>`;
            }
            tableHTML += `</tr>`;
        });
        
        tableHTML += '</tbody></table>';
        container.innerHTML = html + tableHTML;
    },

    // 🆕 包班限制設定獨立函數
    renderBundleLimitSettings: function(bundleLimits = {}) {
        // 清除舊的包班設定區塊（如果存在）
        const oldBlock = document.getElementById('bundleLimitBlock');
        if (oldBlock) oldBlock.remove();

        const container = document.getElementById('dailyNeedsTable');
        if (!container) return;

        const html = `
        <div id="bundleLimitBlock" style="border-left:3px solid #e74c3c; padding:20px; margin-top:25px; background:#f9f9f9; border-radius:8px;">
            <h4 style="margin-top:0; color:#e74c3c;">📦 包班人數限制設定</h4>
            <p style="color:#666; font-size:0.9rem; margin-bottom:15px;">
                設定各夜班允許的包班人數，系統會在排班前檢查並提示
            </p>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                <div style="background:#fff; padding:15px; border-radius:8px; border:1px solid #ddd;">
                    <label style="display:block; margin-bottom:10px; font-weight:bold; color:#3498db;">
                        🌙 小夜班建議包班人數
                    </label>
                    <input type="number" 
                           id="bundleLimit_E" 
                           min="0" 
                           max="20" 
                           placeholder="例如: 4"
                           value="${bundleLimits.E || ''}"
                           style="width:100%; padding:10px; font-size:1.1rem; border:1px solid #ddd; border-radius:4px;">
                    <small style="display:block; margin-top:8px; color:#666;">
                        留空表示不限制
                    </small>
                </div>
                
                <div style="background:#fff; padding:15px; border-radius:8px; border:1px solid #ddd;">
                    <label style="display:block; margin-bottom:10px; font-weight:bold; color:#9b59b6;">
                        🌃 大夜班建議包班人數
                    </label>
                    <input type="number" 
                           id="bundleLimit_N" 
                           min="0" 
                           max="20" 
                           placeholder="例如: 3"
                           value="${bundleLimits.N || ''}"
                           style="width:100%; padding:10px; font-size:1.1rem; border:1px solid #ddd; border-radius:4px;">
                    <small style="display:block; margin-top:8px; color:#666;">
                        留空表示不限制
                    </small>
                </div>
            </div>
            
            <div style="background:#e3f2fd; padding:12px; margin-top:15px; border-radius:4px; font-size:0.9rem;">
                💡 <strong>提示：</strong>系統會在執行 AI 排班前，根據此設定檢查包班人數是否合理
            </div>
        </div>`;
        
        container.insertAdjacentHTML('beforeend', html);
    },

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
            <button class="btn btn-add" onclick="preScheduleManager.addSpecificNeed()"><i class="fas fa-plus"></i> 新增</button>
        </div>`;

        const list = Object.entries(this.tempSpecificNeeds);
        if(list.length > 0) {
            html += `<table class="table table-sm table-bordered" style="margin-top:10px;">
                <thead><tr style="background:#f8f9fa;"><th style="width:30%;">日期</th><th style="width:30%;">班別</th><th style="width:20%;">人數</th><th style="width:20%;">操作</th></tr></thead><tbody>`;
            
            list.forEach(([date, shiftObj]) => {
                Object.keys(shiftObj).forEach(shiftCode => {
                    html += `<tr>
                        <td>${date}</td>
                        <td>${shiftCode}</td>
                        <td>${shiftObj[shiftCode]}</td>
                        <td><button class="btn btn-sm btn-delete" onclick="preScheduleManager.removeSpecificNeed('${date}','${shiftCode}')"><i class="fas fa-trash"></i></button></td>
                    </tr>`;
                });
            });
            html += `</tbody></table>`;
        } else {
            html += `<p style="color:#999; font-style:italic;">尚無臨時需求</p>`;
        }
        
        container.innerHTML = html;
    },

    addSpecificNeed: function() {
        const date = document.getElementById('inputTempDate').value;
        const shift = document.getElementById('inputTempShift').value;
        const count = parseInt(document.getElementById('inputTempCount').value);
        
        if(!date || !shift || isNaN(count)) { alert("請填寫完整"); return; }
        
        if(!this.tempSpecificNeeds[date]) this.tempSpecificNeeds[date] = {};
        this.tempSpecificNeeds[date][shift] = count;
        
        document.getElementById('inputTempDate').value = '';
        document.getElementById('inputTempCount').value = '';
        
        this.renderSpecificNeedsUI(this.tempSpecificNeeds);
    },

    removeSpecificNeed: function(date, shift) {
        if(this.tempSpecificNeeds[date]) {
            delete this.tempSpecificNeeds[date][shift];
            if(Object.keys(this.tempSpecificNeeds[date]).length === 0) {
                delete this.tempSpecificNeeds[date];
            }
        }
        this.renderSpecificNeedsUI(this.tempSpecificNeeds);
    },

    renderGroupLimitsTable: function(savedLimits = {}) {
        const container = document.getElementById('groupLimitTableContainer');
        if(!container) return;
        
        let html = `<h4 style="margin-top:20px; border-bottom:1px solid #eee; padding-bottom:10px; color:#2c3e50;">3. 組別人力限制</h4>`;
        
        if(this.currentUnitGroups.length === 0) {
            container.innerHTML = html + '<p style="color:#999;">此單位尚無組別</p>';
            return;
        }

        html += '<div id="groupLimitTable"><table class="table table-bordered table-sm text-center"><thead><tr style="background:#f8f9fa;"><th>組別</th><th>班別</th><th>每日最少人數</th><th>每日最多人數</th></tr></thead><tbody>';
        this.currentUnitGroups.forEach(g => {
            this.activeShifts.forEach((s, idx) => {
                const minVal = savedLimits[g]?.[s.code]?.min ?? '';
                const maxVal = savedLimits[g]?.[s.code]?.max ?? '';
                html += `<tr>`;
                if(idx === 0) html += `<td rowspan="${this.activeShifts.length}" style="vertical-align:middle; font-weight:bold;">${g}</td>`;
                html += `<td>${s.name} (${s.code})</td>
                         <td><input type="number" class="limit-input" data-group="${g}" data-shift="${s.code}" data-type="min" value="${minVal}" style="width:100%;"></td>
                         <td><input type="number" class="limit-input" data-group="${g}" data-shift="${s.code}" data-type="max" value="${maxVal}" style="width:100%;"></td>
                    </tr>`;
            });
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    },

    importLastMonthSettings: async function() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            const ym = document.getElementById('inputPreYearMonth').value;
            if (!ym) {
                alert("請先選擇要建立的月份");
                return;
            }
            
            const [targetYear, targetMonth] = ym.split('-').map(Number);
            let prevYear = targetYear, prevMonth = targetMonth - 1;
            if (prevMonth === 0) { prevMonth = 12; prevYear--; }
            
            const snap = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .where('year', '==', prevYear)
                .where('month', '==', prevMonth)
                .limit(1)
                .get();
            
            if (snap.empty) {
                alert(`找不到 ${prevYear}/${prevMonth} 的預班表設定`);
                return;
            }
            
            const data = snap.docs[0].data();
            const s = data.settings || {};
            
            document.getElementById('inputOpenDate').value = s.openDate || '';
            document.getElementById('inputCloseDate').value = s.closeDate || '';
            document.getElementById('inputMaxOff').value = s.maxOffDays || 8;
            document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
            document.getElementById('inputDailyReserve').value = s.dailyReserved || 1;
            document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
            document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3";
            
            this.toggleThreeShiftOption(); 
            if (s.shiftTypeMode === "2") {
                document.getElementById('checkAllowThree').checked = s.allowThreeShifts === true;
            }

            this.renderDailyNeedsTable(data.dailyNeeds || {});
            this.renderBundleLimitSettings(data.bundleLimits || {});
            this.renderGroupLimitsTable(data.groupLimits || {});

            alert(`✅ 已成功帶入 ${prevYear}/${prevMonth} 的設定!\n請切換至「2. 人力需求設定」檢查內容。`);

        } catch (e) {
            console.error("Import Error:", e);
            alert("帶入失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const ym = document.getElementById('inputPreYearMonth').value;
        if(!ym) { alert("請選擇月份"); return; }
        const [year, month] = ym.split('-').map(Number);
        
        const dailyNeeds = {};
        let hasNeeds = false; 

        document.querySelectorAll('.needs-input').forEach(i => {
            if(i.value && parseInt(i.value) > 0) {
                dailyNeeds[i.dataset.key] = parseInt(i.value);
                hasNeeds = true;
            }
        });

        if (!hasNeeds) {
            alert("⚠️ 無法儲存:\n\n「1. 各班每日人力需求」尚未填寫。\n\n請切換至該頁籤手動輸入,或使用「帶入上月設定」功能。");
            this.switchTab('needs'); 
            return;
        }

        const groupLimits = {};
        document.querySelectorAll('#groupLimitTable .limit-input').forEach(i => {
            const g = i.dataset.group;
            const s = i.dataset.shift;
            const t = i.dataset.type;
            if(!groupLimits[g]) groupLimits[g] = {};
            if(!groupLimits[g][s]) groupLimits[g][s] = {};
            
            if(i.value !== '') {
                groupLimits[g][s][t] = parseInt(i.value);
            }
        });

        const specificNeeds = this.tempSpecificNeeds || {};

        // 🆕 收集包班人數限制
        const bundleLimits = {};
        const limitE = parseInt(document.getElementById('bundleLimit_E').value);
        const limitN = parseInt(document.getElementById('bundleLimit_N').value);
        
        if (!isNaN(limitE) && limitE > 0) bundleLimits.E = limitE;
        if (!isNaN(limitN) && limitN > 0) bundleLimits.N = limitN;

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
            bundleLimits,
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                const schSnap = await db.collection('schedules').where('sourceId', '==', docId).get();
                let needSync = false;
                
                if (!schSnap.empty) {
                    const schDoc = schSnap.docs[0];
                    if (confirm(`⚠️ 系統偵測到該月份已有「排班草稿」!\n\n您修改了人力需求設定。\n\n[確定]:同步更新排班表需求 (排班表下方將出現紅字缺額,需確認)\n[取消]:僅儲存預班表`)) {
                        needSync = true;
                        await db.collection('schedules').doc(schDoc.id).update({
                            dailyNeeds: dailyNeeds,
                            specificNeeds: specificNeeds,
                            groupLimits: groupLimits,
                            bundleLimits: bundleLimits,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }

                await db.collection('pre_schedules').doc(docId).update(data);
                alert(needSync ? "預班已儲存,並同步至排班表!" : "預班設定已儲存。");
                
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
    
    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        if (!keyword) {
            alert("請輸入搜尋關鍵字 (姓名或員編)");
            return;
        }

        const resultsContainer = document.getElementById('searchResults');
        resultsContainer.innerHTML = '<div style="padding:10px; color:#666;">搜尋中...</div>';

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
                const badge = isCrossUnit ? '<span class="badge badge-warning">跨單位</span>' : '<span class="badge" style="background:#95a5a6;">本單位</span>';
                
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
        if(confirm("確定刪除?")) { await db.collection('pre_schedules').doc(id).delete(); this.loadData(); } 
    },
    
    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const opt = document.getElementById('threeShiftOption');
        if(mode === '2') opt.style.display = 'block';
        else opt.style.display = 'none';
    },

    manage: function(id) { window.location.hash = `/admin/pre_schedule_matrix?id=${id}`; }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = preScheduleManager;
}
