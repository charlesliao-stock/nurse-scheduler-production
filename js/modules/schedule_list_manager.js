// js/modules/schedule_list_manager.js

const scheduleListManager = {
    currentUnitId: null,

    init: async function() {
        const activeRole = app.impersonatedRole || app.userRole;
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理排班</p>
                </div>
            `;
            return;
        }
        await this.loadUnitDropdown();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('filterScheduleUnit');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            const units = await DataLoader.loadUnits();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            let filteredUnits = units;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    filteredUnits = units.filter(u => u.id === activeUnitId);
                }
            }
            
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            filteredUnits.forEach(u => {
                const option = document.createElement('option');
                option.value = u.id;
                option.textContent = u.name;
                select.appendChild(option);
            });
            
            if(filteredUnits.length === 1) { 
                select.selectedIndex = 1;
                
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
        const unitId = document.getElementById('filterScheduleUnit').value;
        const tbody = document.getElementById('scheduleListBody');
        if(!tbody) return;
        
        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">請先選擇單位</td></tr>';
            return;
        }

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const preSnaps = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            const schSnaps = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .get();
            
            const schMap = {};
            schSnaps.forEach(doc => {
                const d = doc.data();
                if(d.sourceId) schMap[d.sourceId] = { id: doc.id, ...d };
            });

            tbody.innerHTML = '';
            
            if (preSnaps.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">尚無預班資料</td></tr>';
                return;
            }

            preSnaps.forEach(doc => {
                const pre = doc.data();
                const preId = doc.id;
                const existingSch = schMap[preId];
                const preStatusInfo = app.getPreScheduleStatus(pre);
                const schStatusInfo = app.getScheduleStatus(existingSch);
                
                let actionHtml = '';
                if (existingSch) {
                    actionHtml = `
                        <button class="btn btn-sm btn-primary" onclick="scheduleListManager.openEditor('${existingSch.id}')">
                            <i class="fas fa-edit"></i> 編輯排班
                        </button>
                        <button class="btn btn-sm btn-delete" onclick="scheduleListManager.deleteSchedule('${existingSch.id}')">
                            <i class="fas fa-trash"></i> 刪除
                        </button>
                    `;
                } else {
                    actionHtml = `
                        <button class="btn btn-sm btn-add" onclick="scheduleListManager.createSchedule('${preId}')">
                            <i class="fas fa-magic"></i> 執行排班
                        </button>
                    `;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:bold;">${pre.unitName || unitId}</td>
                    <td>${pre.year} 年 ${pre.month} 月</td>
                    <td><span class="badge" style="background:${preStatusInfo.color}">${preStatusInfo.text}</span></td>
                    <td><span class="badge" style="background:${schStatusInfo.color}; color:white;">${schStatusInfo.text}</span></td>
                    <td style="font-size:0.85rem; color:#666;">${existingSch ? new Date(existingSch.updatedAt?.toDate()).toLocaleString() : '-'}</td>
                    <td>${actionHtml}</td>
                `;
                tbody.appendChild(tr);
            });

        } catch(e) { 
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    createSchedule: async function(preId) {
        if(!confirm("確定要將此預班表轉為正式排班草稿嗎？\n(系統將自動過濾已離職人員)")) return;
        
        try {
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            if(!preDoc.exists) throw new Error("預班資料不存在");
            const preData = preDoc.data();

            const staff = await DataLoader.loadStaff(preData.unitId);

            const validUids = new Set();
            const validStaffMap = {};

            staff.forEach(s => {
                validUids.add(s.uid);
                validStaffMap[s.uid] = s;
            });

            console.log(`🧹 開始清洗資料... 預班人數: ${preData.staffList.length}, 目前在職人數: ${validUids.size}`);

            const cleanStaffList = [];
            let ghostCount = 0;

            preData.staffList.forEach(s => {
                if (!s.uid) return;
                const uid = s.uid.trim();
                if (validUids.has(uid)) {
                    const liveData = validStaffMap[uid];
                    cleanStaffList.push({
                        ...s,
                        name: liveData.displayName || s.name,
                        level: liveData.level || s.level
                    });
                } else {
                    ghostCount++;
                    console.warn(`👻 剔除幽靈人員: ${s.name} (${uid})`);
                }
            });

            const cleanAssignments = {};
            const initialAssignments = preData.assignments || {};
            
            Object.keys(initialAssignments).forEach(uid => {
                const cleanUid = uid.trim();
                if (validUids.has(cleanUid)) {
                    cleanAssignments[cleanUid] = initialAssignments[uid];
                }
            });

            if (ghostCount > 0) {
                console.log(`✅ 清洗完成，共移除 ${ghostCount} 位已離職或無效人員。`);
            }

            const newSch = {
                unitId: preData.unitId,
                year: preData.year, 
                month: preData.month,
                sourceId: preId, 
                status: 'draft',
                staffList: cleanStaffList,
                assignments: cleanAssignments,
                dailyNeeds: preData.dailyNeeds || {},
                settings: preData.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            batch.set(db.collection('schedules').doc(), newSch);
            batch.update(db.collection('pre_schedules').doc(preId), { status: 'closed' });
            
            await batch.commit();

            alert(`已建立排班草稿！\n(已自動剔除 ${ghostCount} 位非現職人員)`);
            this.loadData();

        } catch(e) { 
            console.error(e);
            alert("建立失敗: " + e.message); 
        }
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
        } catch(e) { 
            console.error(e);
            alert("刪除失敗: " + e.message); 
        }
    },

    openEditor: function(schId) {
        window.location.hash = `/admin/schedule_editor?id=${schId}`;
    }
};
