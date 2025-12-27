// js/modules/pre_schedule_manager.js

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [], // 該單位的組別列表 ['A', 'B']
    staffListSnapshot: [], // 暫存人員名單 (含支援)
    
    // --- 初始化 ---
    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足</h3>';
            return;
        }
        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snapshot = await query.get();
            
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                select.innerHTML += `<option value="${doc.id}">${doc.data().name}</option>`;
            });

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }
            select.onchange = () => this.loadData();

        } catch (e) { console.error(e); }
    },

    // --- 2. 載入列表 ---
    loadData: async function() {
        const unitId = document.getElementById('filterPreUnit').value;
        this.currentUnitId = unitId;
        const tbody = document.getElementById('preScheduleTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';

        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">請先選擇單位</td></tr>';
            return;
        }

        // 順便取得該單位的組別資訊 (供 Modal 使用)
        const unitDoc = await db.collection('units').doc(unitId).get();
        this.currentUnitGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];

        try {
            // 讀取 pre_schedules
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">尚無預班表，請點擊新增</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const d = doc.data();
                const period = `${d.settings.openDate} ~ ${d.settings.closeDate}`;
                // 進度範例 (之後要跟 assignments 連動)
                const progress = d.progress ? `${d.progress.submitted} / ${d.progress.total}` : '0 / 0';
                
                let statusHtml = '<span class="badge" style="background:#95a5a6;">未知</span>';
                if(d.status === 'open') statusHtml = '<span class="badge" style="background:#2ecc71;">開放中</span>';
                else if(d.status === 'closed') statusHtml = '<span class="badge" style="background:#e74c3c;">已截止</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                    <td><small>${period}</small></td>
                    <td>${progress}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <button class="btn btn-primary" style="padding:4px 8px;" onclick="preScheduleManager.manage('${doc.id}')">管理</button>
                        <button class="btn btn-edit" onclick="preScheduleManager.openModal('${doc.id}')">設定</button>
                        <button class="btn btn-delete" onclick="preScheduleManager.deleteSchedule('${doc.id}')">刪除</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- 3. Modal & 設定邏輯 ---
    openModal: async function(docId = null) {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        const modal = document.getElementById('preScheduleModal');
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        document.getElementById('currentMode').value = docId ? 'edit' : 'add';
        
        // 預設切換到第一頁
        this.switchTab('basic');

        if (docId) {
            // [編輯模式]
            document.getElementById('btnImportLast').style.display = 'none'; // 編輯時不給帶入上月
            const doc = await db.collection('pre_schedules').doc(docId).get();
            const data = doc.data();
            this.fillForm(data);
            this.staffListSnapshot = data.staffList || [];
            this.renderStaffList();
            this.renderGroupLimitsTable(data.groupLimits);
        } else {
            // [新增模式]
            document.getElementById('btnImportLast').style.display = 'inline-block';
            
            // 預設為下個月
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            document.getElementById('inputPreYear').value = nextMonth.getFullYear();
            document.getElementById('inputPreMonth').value = nextMonth.getMonth() + 1;
            
            // 預設日期區間 (當月1號到10號)
            const y = nextMonth.getFullYear();
            const m = nextMonth.getMonth() + 1;
            const mStr = m < 10 ? '0'+m : m;
            document.getElementById('inputOpenDate').value = `${y}-${mStr}-01`;
            document.getElementById('inputCloseDate').value = `${y}-${mStr}-10`;

            // 預設值
            document.getElementById('inputMaxOff').value = 8;
            document.getElementById('inputMaxHoliday').value = 2;
            document.getElementById('inputDailyReserve').value = 2;
            document.getElementById('checkShowAllNames').checked = true;
            document.getElementById('inputShiftMode').value = "3";
            this.toggleThreeShiftOption();
            
            // 初始化人員 (該單位所有 Active 人員)
            await this.loadCurrentUnitStaff();
            this.renderStaffList();
            
            // 初始化組別限制表 (全空)
            this.renderGroupLimitsTable({});
        }
    },

    closeModal: function() {
        document.getElementById('preScheduleModal').classList.remove('show');
    },

    switchTab: function(tabName) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // 找出對應按鈕 (這裡簡單用索引或文字判斷，或直接遍歷)
        const btns = document.querySelectorAll('.tab-btn');
        if(tabName==='basic') btns[0].classList.add('active');
        if(tabName==='limits') btns[1].classList.add('active');
        if(tabName==='staff') btns[2].classList.add('active');

        document.getElementById(`tab-${tabName}`).classList.add('active');
    },

    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const div = document.getElementById('divAllowThree');
        div.style.display = (mode === "2") ? 'block' : 'none';
    },

    // --- 4. 資料處理 (人員, 限制, 帶入上月) ---

    // 載入單位現有人員 (新增模式用)
    loadCurrentUnitStaff: async function() {
        const snapshot = await db.collection('users')
            .where('unitId', '==', this.currentUnitId)
            .where('isActive', '==', true)
            .get();
        
        this.staffListSnapshot = snapshot.docs.map(doc => ({
            uid: doc.id,
            empId: doc.data().employeeId,
            name: doc.data().displayName,
            level: doc.data().level,
            group: doc.data().groupId || '',
            isSupport: false // 單位內人員
        }));
    },

    // 渲染人員列表
    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody');
        tbody.innerHTML = '';
        
        // 排序：本單位優先，然後員編
        this.staffListSnapshot.sort((a,b) => {
            if(a.isSupport !== b.isSupport) return a.isSupport ? 1 : -1; 
            return (a.empId||'').localeCompare(b.empId||'');
        });

        this.staffListSnapshot.forEach((u, index) => {
            const badge = u.isSupport ? '<span class="badge" style="background:#e67e22;">支援</span>' : '<span class="badge" style="background:#3498db;">本單位</span>';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${u.level}</td>
                <td><input type="text" value="${u.group}" class="input-mini" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)"></td>
                <td>${badge}</td>
                <td><button class="btn btn-delete" style="padding:2px 5px;" onclick="preScheduleManager.removeStaff(${index})">移除</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    updateStaffGroup: function(index, val) {
        this.staffListSnapshot[index].group = val;
    },

    removeStaff: function(index) {
        if(confirm("確定將此人從本次預班名單移除？")) {
            this.staffListSnapshot.splice(index, 1);
            this.renderStaffList();
        }
    },

    // 加入支援人員
    searchAndAddSupport: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        if(!keyword) return;

        // 搜尋全院
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        const found = snapshot.docs.find(d => 
            d.data().employeeId === keyword || d.data().displayName === keyword
        );

        if(found) {
            // 檢查是否已在名單
            if(this.staffListSnapshot.find(x => x.uid === found.id)) {
                alert("此人員已在名單中"); return;
            }
            this.staffListSnapshot.push({
                uid: found.id,
                empId: found.data().employeeId,
                name: found.data().displayName,
                level: found.data().level,
                group: found.data().groupId || '', // 帶入原單位組別，可修改
                isSupport: true
            });
            this.renderStaffList();
            alert(`已加入支援：${found.data().displayName}`);
            document.getElementById('inputSearchStaff').value = '';
        } else {
            alert("找不到此人員");
        }
    },

    // 渲染組別限制矩陣
    renderGroupLimitsTable: function(savedLimits = {}) {
        const table = document.getElementById('groupLimitTable');
        table.innerHTML = '';

        // Header
        let thead = '<thead><tr><th>限制項目</th>';
        this.currentUnitGroups.forEach(g => { thead += `<th>${g}</th>`; });
        thead += '</tr></thead>';
        table.innerHTML += thead;

        // Rows
        const rows = [
            { key: 'minTotal', label: '每班至少' },
            { key: 'minN', label: '大夜至少' },
            { key: 'minE', label: '小夜至少' },
            { key: 'maxN', label: '大夜最多' },
            { key: 'maxE', label: '小夜最多' }
        ];

        let tbody = '<tbody>';
        rows.forEach(r => {
            tbody += `<tr><td style="background:#f8f9fa; font-weight:bold;">${r.label}</td>`;
            this.currentUnitGroups.forEach(g => {
                // 取得舊值 (如果有的話)
                const val = (savedLimits[g] && savedLimits[g][r.key]) || '';
                tbody += `<td><input type="number" class="limit-input" data-group="${g}" data-key="${r.key}" value="${val}"></td>`;
            });
            tbody += '</tr>';
        });
        tbody += '</tbody>';
        table.innerHTML += tbody;
    },

    // 帶入上月設定
    importLastSettings: async function() {
        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) { alert("找不到過去的設定資料"); return; }
            
            const lastData = snapshot.docs[0].data();
            
            // 填入 Form
            this.fillForm(lastData);
            
            // 填入組別限制
            this.renderGroupLimitsTable(lastData.groupLimits);

            // 填入人員 (注意：要不要同步最新人員狀態？這裡簡單起見，直接用上月的 snapshot)
            // 實務上建議：重新抓取單位人+上月的支援人，這裡先做「直接複製名單」
            this.staffListSnapshot = lastData.staffList || [];
            this.renderStaffList();

            alert("已帶入資料 (日期請自行檢查)");

        } catch(e) { console.error(e); alert("帶入失敗"); }
    },

    fillForm: function(data) {
        // 基本
        // 年月不覆蓋，保留使用者剛選的
        // data.settings
        const s = data.settings;
        document.getElementById('inputMaxOff').value = s.maxOffDays;
        document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs;
        document.getElementById('inputDailyReserve').value = s.dailyReserved;
        document.getElementById('checkShowAllNames').checked = s.showAllNames;
        document.getElementById('inputShiftMode').value = s.shiftTypeMode;
        if(s.shiftTypeMode === "2") {
            document.getElementById('divAllowThree').style.display = 'block';
            document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
        } else {
            document.getElementById('divAllowThree').style.display = 'none';
        }
    },

    // --- 5. 儲存 ---
    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const year = parseInt(document.getElementById('inputPreYear').value);
        const month = parseInt(document.getElementById('inputPreMonth').value);
        const unitId = this.currentUnitId;

        // 收集基本設定
        const settings = {
            openDate: document.getElementById('inputOpenDate').value,
            closeDate: document.getElementById('inputCloseDate').value,
            showAllNames: document.getElementById('checkShowAllNames').checked,
            maxOffDays: parseInt(document.getElementById('inputMaxOff').value) || 0,
            maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday').value) || 0,
            dailyReserved: parseInt(document.getElementById('inputDailyReserve').value) || 0,
            shiftTypeMode: document.getElementById('inputShiftMode').value,
            allowThreeShifts: document.getElementById('checkAllowThree').checked
        };

        if(!settings.openDate || !settings.closeDate) { alert("請設定開放區間"); return; }

        // 收集組別限制
        const groupLimits = {};
        document.querySelectorAll('.limit-input').forEach(inp => {
            const g = inp.dataset.group;
            const k = inp.dataset.key;
            if(!groupLimits[g]) groupLimits[g] = {};
            groupLimits[g][k] = parseInt(inp.value) || 0;
        });

        const data = {
            unitId, year, month,
            status: 'open', // 預設開放
            progress: { submitted: 0, total: this.staffListSnapshot.length },
            settings,
            groupLimits,
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                // 編輯 (不覆蓋 assignments)
                await db.collection('pre_schedules').doc(docId).update(data);
            } else {
                // 新增
                // 檢查是否已存在該月
                const check = await db.collection('pre_schedules')
                    .where('unitId', '==', unitId)
                    .where('year', '==', year)
                    .where('month', '==', month).get();
                if(!check.empty) { alert("該月份的預班表已存在！"); return; }
                
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.assignments = {}; // 初始為空
                await db.collection('pre_schedules').add(data);
            }
            alert("儲存成功！");
            this.closeModal();
            this.loadData();
        } catch(e) {
            console.error(e); alert("儲存失敗: " + e.message);
        }
    },

    deleteSchedule: async function(id) {
        if(confirm("確定刪除此預班表？所有設定與預填資料將消失。")) {
            await db.collection('pre_schedules').doc(id).delete();
            this.loadData();
        }
    },

    manage: function(id) {
        // [第二階段功能] 點擊後跳轉到大表
        // 這裡先用 alert 佔位，下一階段我們會實作 router 跳轉
        alert("準備進入大表排班介面 (ID: " + id + ")\n此功能將在下一階段實作。");
    }
};
