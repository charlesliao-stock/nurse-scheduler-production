// js/modules/schedule_list_manager.js

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
        if(!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">請先選擇單位</td></tr>';
            return;
        }

        try {
            // 1. 讀取該單位的預班表 (依月份排序)
            const preSnap = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            if (preSnap.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">尚無預班資料，請先至「預班管理」建立。</td></tr>';
                return;
            }

            // 2. 讀取該單位的正式班表 (用於比對狀態)
            const schSnap = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .get();
            
            // 建立查表 Map: sourceId (PreSchedule ID) -> Schedule Doc
            const scheduleMap = {};
            schSnap.forEach(doc => {
                const data = doc.data();
                if(data.sourceId) scheduleMap[data.sourceId] = { id: doc.id, ...data };
            });

            // 3. 渲染列表
            tbody.innerHTML = '';
            const select = document.getElementById('filterScheduleUnit');
            const unitName = select.options[select.selectedIndex]?.text || '';

            preSnap.forEach(doc => {
                const preData = doc.data();
                const preId = doc.id;
                const scheduleData = scheduleMap[preId];
                
                // 預班狀態
                let preStatusHtml = '';
                if(preData.status === 'open') preStatusHtml = '<span class="badge" style="background:#2ecc71;">開放中</span>';
                else if(preData.status === 'closed') preStatusHtml = '<span class="badge" style="background:#e74c3c;">已截止</span>';
                else preStatusHtml = `<span class="badge" style="background:#95a5a6;">${preData.status}</span>`;

                // 排班狀態與按鈕
                let scheduleStatusHtml = '<span style="color:#999;">未開始</span>';
                let actionButtons = '';
                let lastUpdate = '-';

                if (scheduleData) {
                    // 已有排班紀錄
                    const st = scheduleData.status;
                    if (st === 'draft') scheduleStatusHtml = '<span class="badge" style="background:#f39c12;">草稿</span>';
                    else if (st === 'published') scheduleStatusHtml = '<span class="badge" style="background:#3498db;">已發布</span>';
                    
                    if (scheduleData.updatedAt) {
                        lastUpdate = new Date(scheduleData.updatedAt.toDate()).toLocaleString();
                    }

                    actionButtons = `
                        <button class="btn btn-primary" onclick="scheduleListManager.openEditor('${scheduleData.id}')">
                            <i class="fas fa-edit"></i> ${st === 'published' ? '檢視/修改' : '繼續排班'}
                        </button>
                        <button class="btn btn-delete" style="padding:5px 10px;" onclick="scheduleListManager.deleteSchedule('${scheduleData.id}')" title="刪除草稿重排">
                            <i class="fas fa-trash"></i>
                        </button>
                    `;
                } else {
                    // 尚未開始排班
                    actionButtons = `
                        <button class="btn" style="background:#8e44ad;" onclick="scheduleListManager.createSchedule('${preId}')">
                            <i class="fas fa-magic"></i> 開始排班
                        </button>
                    `;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitName}</td>
                    <td style="font-weight:bold; font-size:1.1rem;">${preData.year} / ${preData.month}</td>
                    <td>${preStatusHtml}</td>
                    <td>${scheduleStatusHtml}</td>
                    <td style="font-size:0.85rem; color:#666;">${lastUpdate}</td>
                    <td><div style="display:flex; gap:5px;">${actionButtons}</div></td>
                `;
                tbody.appendChild(tr);
            });

        } catch (e) {
            console.error("Load Data Error:", e);
            alert("載入失敗: " + e.message);
        }
    },

    // 建立新排班 (從預班複製)
    createSchedule: async function(preId) {
        if(!confirm("確定開始排班？\n系統將會截止該月份的預班功能，並建立排班草稿。")) return;

        try {
            // 1. 取得預班資料
            const preDoc = await db.collection('pre_schedules').doc(preId).get();
            if(!preDoc.exists) throw new Error("預班資料遺失");
            const preData = preDoc.data();

            // 2. 準備正式班表資料
            // 複製 assignments 作為初始狀態 (originalAssignments) 與 工作狀態 (assignments)
            const newSchedule = {
                unitId: preData.unitId,
                year: preData.year,
                month: preData.month,
                sourceId: preId, // 關聯回預班表
                status: 'draft', // 初始為草稿
                staffList: preData.staffList || [], // 複製人員名單 (快照)
                assignments: preData.assignments || {}, // 工作區
                originalAssignments: JSON.parse(JSON.stringify(preData.assignments || {})), // 備份 (用於重置)
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                history: [] // 操作紀錄
            };

            const batch = db.batch();

            // 3. 寫入 schedules
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
                const sourceId = doc.data().sourceId;
                if(sourceId) {
                    await db.collection('pre_schedules').doc(sourceId).update({ status: 'open' });
                }
            }

            await db.collection('schedules').doc(schId).delete();
            alert("已刪除草稿，您可以重新開始排班。");
            this.loadData();
        } catch(e) {
            alert("刪除失敗: " + e.message);
        }
    },

    openEditor: function(schId) {
        window.location.hash = `/admin/schedule_matrix?id=${schId}`;
    }
};
