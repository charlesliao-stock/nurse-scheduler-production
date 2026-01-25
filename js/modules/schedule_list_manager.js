// js/modules/schedule_list_manager.js
// 🚀 最終修正版：加入「幽靈人口清洗」機制 (源頭把關)

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
            
            // 如果只有一個單位，自動選取
            if(snapshot.size === 1) { 
                select.selectedIndex = 1; 
                this.loadData(); 
            }
            
            select.onchange = () => this.loadData();
        } catch(e) { console.error(e); }
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
                // .where('status', '==', 'closed') // 暫時移除限制，方便測試
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
                
                let statusHtml = '';
                let actionHtml = '';
                
                if (existingSch) {
                    // 已有排班草稿或已發布
                    const isPub = existingSch.status === 'published';
                    statusHtml = isPub 
                        ? '<span class="badge badge-success">已發布</span>' 
                        : '<span class="badge badge-warning">草稿中</span>';
                    
                    actionHtml = `
                        <button class="btn btn-sm btn-primary" onclick="scheduleListManager.openEditor('${existingSch.id}')">
                            <i class="fas fa-edit"></i> 編輯排班
                        </button>
                        <button class="btn btn-sm btn-delete" onclick="scheduleListManager.deleteSchedule('${existingSch.id}')">
                            <i class=\"fas fa-trash\"></i> 刪除
                        </button>
                    `;
                } else {
                    // 尚未建立排班
                    statusHtml = '<span class="badge" style="background:#ccc;">未建立</span>';
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
                    <td><span class="badge ${pre.status==='open'?'badge-success':'badge-secondary'}">${pre.status==='open'?'開放中':'已截止'}</span></td>
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
                .where('isActive', '==', true) // 只抓在職人員
                .get();

            const validUids = new Set();
            const validStaffMap = {}; // 用於更新姓名職稱

            usersSnap.forEach(doc => {
                // 使用 doc.id (Auth UID) 作為唯一識別
                validUids.add(doc.id);
                validStaffMap[doc.id] = doc.data();
            });

            console.log(`🧹 開始清洗資料... 預班人數: ${preData.staffList.length}, 目前在職人數: ${validUids.size}`);

            // 3. 清洗 StaffList (過濾掉不在 validUids 的人)
            const cleanStaffList = [];
            let ghostCount = 0;

            preData.staffList.forEach(staff => {
                const uid = staff.uid.trim();
                if (validUids.has(uid)) {
                    // 更新人員資訊 (避免預班時的名字與現在不同)
                    const liveData = validStaffMap[uid];
                    cleanStaffList.push({
                        ...staff, // 保留預班時的設定 (如 group)
                        name: liveData.displayName || staff.name, // 更新為最新名字
                        level: liveData.level || staff.level
                    });
                } else {
                    ghostCount++;
                    console.warn(`👻 剔除幽靈人員: ${staff.name} (${uid})`);
                }
            });

            // 4. 清洗 Assignments (過濾掉無效 UID 的排班資料)
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
                
                // 使用清洗後的資料
                staffList: cleanStaffList,
                assignments: cleanAssignments,
                
                dailyNeeds: preData.dailyNeeds || {},
                settings: preData.settings || {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            batch.set(db.collection('schedules').doc(), newSch);
            
            // 選擇性：建立後自動關閉預班 (防止再修改)
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
        } catch(e) { alert("刪除失敗"); }
    },

    openEditor: function(schId) {
        window.location.hash = `/admin/schedule_editor?id=${schId}`;
    }
};
