// js/modules/schedule_list_manager.js
// 修正重點：在建立排班 (createSchedule) 時，補上 dailyNeeds 與 groupLimits 的資料傳遞

const scheduleListManager = {
    currentUnitId: null,
    preSchedules: [],
    schedules: [], // 正式班表快照

    init: async function() {
        console.log("Schedule List Manager Loaded.");
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('filterScheduleUnit');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            // 權限過濾
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

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }

            select.onchange = () => this.loadData();

        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadData: async function() {
        const unitId = document.getElementById('filterScheduleUnit').value;
        this.currentUnitId = unitId;
        const tbody = document.getElementById('scheduleListBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';

        if(!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">請先選擇單位</td></tr>';
            return;
        }

        try {
            // 1. 讀取該單位的「預班表」(作為來源)
            // 只撈取 status = 'closed' (已鎖定) 或 'open' (視您的流程而定，通常是要排班的)
            // 這裡我們先全部撈出來，再由前端配對
            const preSnap = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(12)
                .get();

            this.preSchedules = preSnap.docs.map(d => ({id: d.id, ...d.data()}));

            // 2. 讀取該單位的「正式班表」
            const schSnap = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(12)
                .get();
                
            this.schedules = schSnap.docs.map(d => ({id: d.id, ...d.data()}));

            this.renderTable();

        } catch(e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    renderTable: function() {
        const tbody = document.getElementById('scheduleListBody');
        tbody.innerHTML = '';

        // 以「預班表」為主體來列表，因為每個排班都源自一個預班
        // 或者，如果有獨立建立的班表，也需要考慮。
        // 這裡採用：顯示所有預班表，並檢查是否有對應的正式班表

        if (this.preSchedules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">尚無資料</td></tr>';
            return;
        }

        // 建立單位的 Cache (如果需要顯示單位名稱，但因為已經 filterUnit 了，通常都是同一個)
        // 略過

        this.preSchedules.forEach(pre => {
            // 找對應的正式班表 (假設 sourceId = pre.id)
            const schedule = this.schedules.find(s => s.sourceId === pre.id || s.preScheduleId === pre.id); // 相容兩種命名

            const tr = document.createElement('tr');
            
            // 狀態判定
            let preStatusHtml = this.getStatusBadge(pre.status);
            let schStatusHtml = schedule ? this.getStatusBadge(schedule.status) : '<span class="badge" style="background:#eee; color:#999;">未建立</span>';
            
            // 操作按鈕
            let actions = '';
            if (schedule) {
                // 已有班表 -> 進入編輯
                actions += `<button class="btn btn-primary" onclick="scheduleListManager.openEditor('${schedule.id}')"><i class="fas fa-edit"></i> 編輯排班</button> `;
                // 刪除按鈕 (慎用)
                actions += `<button class="btn btn-danger" onclick="scheduleListManager.deleteSchedule('${schedule.id}')"><i class="fas fa-trash"></i></button>`;
            } else {
                // 無班表 -> 建立
                actions += `<button class="btn btn-add" onclick="scheduleListManager.createSchedule('${pre.id}')"><i class="fas fa-magic"></i> 產生排班</button>`;
            }

            // 日期格式化
            const lastUpdate = schedule ? (schedule.updatedAt ? new Date(schedule.updatedAt.seconds * 1000).toLocaleString() : '-') : '-';

            tr.innerHTML = `
                <td>${this.getUnitName(pre.unitId) || pre.unitId}</td>
                <td style="font-weight:bold;">${pre.year} 年 ${pre.month} 月</td>
                <td>${preStatusHtml}</td>
                <td>${schStatusHtml}</td>
                <td style="font-size:0.85rem; color:#666;">${lastUpdate}</td>
                <td>${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- 核心功能：從預班建立正式班表 ---
    createSchedule: async function(preId) {
        if(!confirm("確定要從這份預班表產生正式排班嗎？\n(這將鎖定預班表)")) return;

        try {
            // 1. 讀取預班資料
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            if(!preDoc.exists) throw new Error("預班表不存在");
            const preData = preDoc.data();

            // 2. 轉換資料 (Assignments)
            // 邏輯同 pre_schedule_matrix_manager.js
            const initialAssignments = {};
            const localAssignments = preData.assignments || {};

            Object.keys(localAssignments).forEach(uid => {
                const userAssigns = localAssignments[uid];
                initialAssignments[uid] = {};
                
                Object.keys(userAssigns).forEach(key => {
                    if (key.startsWith('current_')) {
                        const val = userAssigns[key];
                        // 轉換規則
                        if (val === 'REQ_OFF') {
                            initialAssignments[uid][key] = 'OFF'; // 預休轉正式休
                        } else if (val && !val.startsWith('!')) {
                            // 保留其他有效班別 (排除 !D 這種標記，除非您有其他用途)
                            initialAssignments[uid][key] = val;
                        }
                    }
                });
            });

            // 3. 建立新文件
            const newSchedule = {
                sourceId: preId, // 關聯回去
                preScheduleId: preId, // 雙重保險
                unitId: preData.unitId,
                year: preData.year,
                month: preData.month,
                status: 'draft',
                
                settings: preData.settings || {},
                staffList: preData.staffList || [],
                
                // [關鍵修正] 務必帶入 dailyNeeds 與 groupLimits，否則 AI 會抓不到需求
                dailyNeeds: preData.dailyNeeds || {},
                groupLimits: preData.groupLimits || {},
                
                assignments: initialAssignments,
                stats: {},
                
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            const newRef = db.collection('schedules').doc();
            batch.set(newRef, newSchedule);

            // 4. 更新 pre_schedules 狀態為 closed
            const preRef = db.collection('pre_schedules').doc(preId);
            batch.update(preRef, { status: 'closed' });

            await batch.commit();

            // 5. 跳轉
            alert("排班草稿已建立！");
            this.openEditor(newRef.id);

        } catch(e) {
            console.error("Create Schedule Error:", e);
            alert("建立失敗: " + e.message);
        }
    },

    deleteSchedule: async function(schId) {
        if(!confirm("⚠️ 警告：確定要刪除這份排班草稿嗎？\n這將會清除所有已排好的班別，並需重新從預班匯入。")) return;
        try {
            // 刪除前先查詢 sourceId，以便將預班表狀態改回 open (選擇性，或保持 closed)
            // 這裡簡單處理：只刪除 schedule，預班表保持 closed (管理者可手動去預班管理打開，或這裡順便打開)
            
            // 進階：順便把預班表打開
            const doc = await db.collection('schedules').doc(schId).get();
            if(doc.exists) {
                const sourceId = doc.data().sourceId || doc.data().preScheduleId;
                if(sourceId) {
                    await db.collection('pre_schedules').doc(sourceId).update({ status: 'open' });
                }
            }

            await db.collection('schedules').doc(schId).delete();
            alert("已刪除");
            this.loadData();
        } catch(e) {
            console.error(e);
            alert("刪除失敗: " + e.message);
        }
    },

    openEditor: function(id) {
        window.location.hash = `/admin/schedule_editor?id=${id}`;
    },

    getStatusBadge: function(status) {
        const map = {
            'open': '<span class="badge badge-success">進行中</span>',
            'closed': '<span class="badge badge-warning">已截止</span>',
            'draft': '<span class="badge badge-warning">草稿</span>',
            'published': '<span class="badge badge-success">已發布</span>'
        };
        return map[status] || status;
    },

    getUnitName: function(id) {
        // 簡單實作：如果有 cache 就用，沒有就回傳 ID
        const select = document.getElementById('filterScheduleUnit');
        if (select) {
            const opt = select.querySelector(`option[value="${id}"]`);
            if (opt) return opt.textContent;
        }
        return id;
    }
};
