// js/modules/schedule_list_manager.js
// 修正版：確保刪除草稿會解鎖預班表

const scheduleListManager = {
    // ... (其他部分保持不變) ...
    currentUnitId: null,
    preSchedules: [],
    schedules: [],

    init: async function() {
        console.log("Schedule List Manager Loaded.");
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        // ... (保持原樣) ...
        const select = document.getElementById('filterScheduleUnit');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
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
        } catch (e) { console.error(e); }
    },

    loadData: async function() {
        const unitId = document.getElementById('filterScheduleUnit').value;
        this.currentUnitId = unitId;
        const tbody = document.getElementById('scheduleListBody');
        if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        if (!unitId) return;

        try {
            const preSnap = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc').get();

            const schSnap = await db.collection('schedules').where('unitId', '==', unitId).get();
            const scheduleMap = {};
            schSnap.forEach(doc => {
                const d = doc.data();
                if(d.sourceId) scheduleMap[d.sourceId] = { id: doc.id, ...d };
            });

            tbody.innerHTML = '';
            const unitName = document.getElementById('filterScheduleUnit').selectedOptions[0]?.text || '';

            preSnap.forEach(doc => {
                const pre = doc.data();
                const sch = scheduleMap[doc.id];
                
                let statusHtml = pre.status === 'open' ? '<span class="badge badge-success">開放中</span>' : '<span class="badge badge-secondary">已截止</span>';
                let schStatusHtml = sch ? (sch.status === 'published' ? '<span class="badge badge-primary">已發布</span>' : '<span class="badge badge-warning">草稿</span>') : '<span style="color:#ccc;">未建立</span>';
                
                let btns = '';
                if (sch) {
                    btns = `<button class="btn btn-primary btn-sm" onclick="scheduleListManager.openEditor('${sch.id}')"><i class="fas fa-edit"></i> 編輯</button>
                            <button class="btn btn-danger btn-sm" onclick="scheduleListManager.deleteSchedule('${sch.id}')"><i class="fas fa-trash"></i></button>`;
                } else {
                    btns = `<button class="btn btn-success btn-sm" onclick="scheduleListManager.createSchedule('${doc.id}')"><i class="fas fa-magic"></i> 排班</button>`;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitName}</td>
                    <td>${pre.year}/${pre.month}</td>
                    <td>${statusHtml}</td>
                    <td>${schStatusHtml}</td>
                    <td>${sch?.updatedAt ? new Date(sch.updatedAt.toDate()).toLocaleDateString() : '-'}</td>
                    <td>${btns}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) { console.error(e); }
    },

    createSchedule: async function(preId) {
        if(!confirm("確定開始排班？將截止預班功能。")) return;
        try {
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            const preData = preDoc.data();

            const initialAssignments = {};
            if(preData.assignments) {
                Object.keys(preData.assignments).forEach(uid => {
                    initialAssignments[uid] = {};
                    // [重要] 完整複製 assignments，包含 preferences 和 last_X
                    // 這樣 Editor 才能讀到包班偏好和上月資料
                    initialAssignments[uid] = JSON.parse(JSON.stringify(preData.assignments[uid]));
                    
                    // 針對當月日期做預休轉換
                    Object.keys(preData.assignments[uid]).forEach(k => {
                        if (k.startsWith('current_')) {
                            const val = preData.assignments[uid][k];
                            if (val === 'REQ_OFF') initialAssignments[uid][k] = 'OFF'; // 預休轉OFF (顯示用)
                            // 這裡不用刪除 REQ_OFF，保留著 AI V2 會用到，只是顯示上可能轉為 OFF
                            // 但為了 SchedulerV2 邏輯，保留原始值是安全的，Editor render 會處理
                        }
                    });
                });
            }

            const newSch = {
                unitId: preData.unitId,
                year: preData.year, month: preData.month,
                sourceId: preId, status: 'draft',
                staffList: preData.staffList || [],
                assignments: initialAssignments,
                dailyNeeds: preData.dailyNeeds || {},
                settings: preData.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            batch.set(db.collection('schedules').doc(), newSch);
            batch.update(db.collection('pre_schedules').doc(preId), { status: 'closed' });
            await batch.commit();

            alert("已建立排班草稿！");
            this.loadData();
        } catch(e) { alert("建立失敗: " + e.message); }
    },

    deleteSchedule: async function(id) {
        if(!confirm("確定刪除此排班草稿？\n這將會刪除目前的排班結果，並將預班表重新開放 (若在開放時間內)。")) return;
        try {
            const doc = await db.collection('schedules').doc(id).get();
            if(doc.exists) {
                const sourceId = doc.data().sourceId;
                if(sourceId) {
                    // [關鍵修正] 刪除草稿後，強制將預班表改回 'open'
                    await db.collection('pre_schedules').doc(sourceId).update({ status: 'open' });
                }
            }
            await db.collection('schedules').doc(id).delete();
            alert("已刪除草稿，預班表已重新開放。");
            this.loadData();
        } catch(e) { alert("刪除失敗: " + e.message); }
    },

    openEditor: function(schId) {
        window.location.hash = `/admin/schedule_editor?id=${schId}`;
    }
};
