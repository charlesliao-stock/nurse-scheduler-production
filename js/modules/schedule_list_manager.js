// js/modules/schedule_list_manager.js
// 修正版：建立排班時完整複製預班資料

const scheduleListManager = {
    currentUnitId: null,

    init: async function() {
        await this.loadUnitDropdown();
    },

loadUnitDropdown: async function() {
        const select = document.getElementById('filterScheduleUnit');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');

            // [修正] 支援模擬身分
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;

            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
            }
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            if(snapshot.size === 1) { select.selectedIndex = 1; this.loadData(); }
            select.onchange = () => this.loadData();
        } catch(e) { console.error(e); }
    },

    loadData: async function() {
        const unitId = document.getElementById('filterScheduleUnit').value;
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
                tr.innerHTML = `<td>${pre.year}/${pre.month}</td>
                    <td>${statusHtml}</td>
                    <td>${schStatusHtml}</td>
                    <td>${sch?.updatedAt ? new Date(sch.updatedAt.toDate()).toLocaleDateString() : '-'}</td>
                    <td>${btns}</td>`;
                tbody.appendChild(tr);
            });
        } catch(e) { console.error(e); }
    },

    createSchedule: async function(preId) {
        if(!confirm("確定開始排班？將截止預班功能。")) return;
        try {
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            const preData = preDoc.data();

            const initialAssignments = {};
            if(preData.assignments) {
                Object.keys(preData.assignments).forEach(uid => {
                    // [關鍵] 完整複製 assignments，包含 preferences 和 REQ_OFF
                    initialAssignments[uid] = JSON.parse(JSON.stringify(preData.assignments[uid]));
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
        if(!confirm("確定刪除此排班草稿？將重新開放預班。")) return;
        try {
            const doc = await db.collection('schedules').doc(id).get();
            if(doc.exists && doc.data().sourceId) {
                await db.collection('pre_schedules').doc(doc.data().sourceId).update({ status: 'open' });
            }
            await db.collection('schedules').doc(id).delete();
            alert("已刪除草稿");
            this.loadData();
        } catch(e) { alert("刪除失敗"); }
    },

    openEditor: function(schId) {
        window.location.hash = `/admin/schedule_editor?id=${schId}`;
    }
};
