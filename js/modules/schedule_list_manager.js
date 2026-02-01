// js/modules/schedule_list_manager.js
// 🚀 最終修正版 v2：加強權限控制 + 幽靈人口清洗機制

const scheduleListManager = {
    currentUnitId: null,

    init: async function() {
        // ✅ 權限檢查
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
            
            // ✅ 如果只有一個單位，自動選取並隱藏選單
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
        const unitId = document.getElementById('filterScheduleUnit').value;
        const tbody = document.getElementById('scheduleListBody');
        if(!tbody) return;
        
        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">請先選擇單位</td></tr>';
            return;
        }

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            // 1. 讀取該單位的「已結束」預班表 (準備要排班的)
            const preSnaps = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            // 2. 讀取該單位「已建立」的正式班表
            const schSnaps = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .get();
            
            const schMap = {}; // Key: sourceId (預班ID), Value: Schedule Doc
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
                
                let statusHtml = '';
                let actionHtml = '';
                
                if (existingSch) {
                    const isPub = existingSch.status === 'published';
                    statusHtml = isPub 
                        ? '<span class="badge badge-success">已發布</span>' 
                        : '<span class="badge badge-warning">排班中</span>';
                    
                    actionHtml = `
                        <button class="btn btn-sm btn-primary" onclick="scheduleListManager.openEditor('${existingSch.id}')">
                            <i class="fas fa-edit"></i> 編輯排班
                        </button>
                        <button class="btn btn-sm btn-delete" onclick="scheduleListManager.deleteSchedule('${existingSch.id}')">
                            <i class="fas fa-trash"></i> 刪除
                        </button>
                    `;
                } else {
                    statusHtml = '<span class="badge" style="background:#ccc;">準備中</span>';
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
                    <td>${statusHtml}</td>
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

    // 🔥 核心修正：建立排班時進行「人員清洗」
    createSchedule: async function(preId) {
        if(!confirm("確定要將此預班表轉為正式排班草稿嗎？\n(系統將自動過濾已離職人員)")) return;
        
        try {
            // 1. 讀取預班資料
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            if(!preDoc.exists) throw new Error("預班資料不存在");
            const preData = preDoc.data();

            // 2. 讀取該單位「目前有效」的人員名單 (Source of Truth)
            const usersSnap = await db.collection('users')
                .where('unitId', '==', preData.unitId)
                .where('isActive', '==', true)
                .get();

            const validUids = new Set();
            const validStaffMap = {};

            usersSnap.forEach(doc => {
                validUids.add(doc.id);
                validStaffMap[doc.id] = doc.data();
            });

            console.log(`🧹 開始清洗資料... 預班人數: ${preData.staffList.length}, 目前在職人數: ${validUids.size}`);

            // 3. 清洗 StaffList
            const cleanStaffList = [];
            let ghostCount = 0;

            preData.staffList.forEach(staff => {
                const uid = staff.uid.trim();
                if (validUids.has(uid)) {
                    const liveData = validStaffMap[uid];
                    cleanStaffList.push({
                        ...staff,
                        name: liveData.displayName || staff.name,
                        level: liveData.level || staff.level
                    });
                } else {
                    ghostCount++;
                    console.warn(`👻 剔除幽靈人員: ${staff.name} (${uid})`);
                }
            });

            // 4. 清洗 Assignments
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

            // 5. 建立新排班物件
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
