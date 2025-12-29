// js/modules/pre_schedule_matrix_manager.js
// Fix: 執行排班時，完整複製人員特註、偏好、上月班表、預班結果到排班作業

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {}, // 儲存最新的 User 資料 (含特註、懷孕狀態)
    globalClickListener: null,
    isLoading: false,

    init: async function(id) {
        if(!id) return;
        this.docId = id;
        this.isLoading = true;
        try {
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
            // 確保右鍵選單存在
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
            
        } catch(error) { console.error(error); alert("載入失敗: " + error.message); } 
        finally { this.isLoading = false; }
    },

    loadShifts: async function() {
        const s = await db.collection('shifts').get();
        this.shifts = s.docs.map(d => d.data());
    },
    loadUsers: async function() {
        const s = await db.collection('users').where('isActive', '==', true).get();
        s.forEach(d => { this.usersMap[d.id] = d.data(); });
    },
    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        const t = document.getElementById('matrixTitle');
        if(t) t.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
    },

    // --- [核心修正] 執行排班：建立完整快照 ---
    executeSchedule: async function() {
        // 1. 檢查是否有紅字 (違反規則)
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告：有人員預休超過上限 (紅字)！確定要強制執行？")) return;
        }

        // 2. 提示未預班人數
        let submittedCount = 0;
        this.data.staffList.forEach(u => { if (this.localAssignments[u.uid]) submittedCount++; });
        const unsubmitted = this.data.staffList.length - submittedCount;
        
        if(!confirm(`準備執行排班：\n\n總人數：${this.data.staffList.length}\n已預班：${submittedCount}\n未預班：${unsubmitted}\n\n確定執行？(將建立排班草稿)`)) return;

        try {
            this.isLoading = true;

            // 3. 建立人員資料快照 (Snapshot)
            // 將最新的 User DB 資料 (特註、懷孕、包班) 寫死進這張班表
            const snapshotStaffList = this.data.staffList.map(u => {
                const userProfile = this.usersMap[u.uid] || {};
                const params = userProfile.schedulingParams || {};
                
                // 檢查特註
                const note = userProfile.note || "";
                
                return {
                    ...u, 
                    schedulingParams: params, // 快照排班參數
                    note: note // 快照特註
                };
            });

            // 4. 準備排班草稿資料
            const newScheduleData = {
                unitId: this.data.unitId,
                year: this.data.year,
                month: this.data.month,
                sourceId: this.docId,
                status: 'draft',
                
                // 完整複製：人員快照
                staffList: JSON.parse(JSON.stringify(snapshotStaffList)),
                
                // 完整複製：預班結果 (含 last_X 上月班表, preferences 偏好, REQ_OFF 預休)
                assignments: JSON.parse(JSON.stringify(this.localAssignments)),
                
                // 完整複製：當下的規則與每日需求
                rules: this.data.rules || {}, 
                dailyNeeds: JSON.parse(JSON.stringify(this.data.dailyNeeds || {})),

                createdBy: app.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // 5. 寫入 DB (Batch)
            const batch = db.batch();
            const newDocRef = db.collection('schedules').doc(); // 新增到 schedules
            batch.set(newDocRef, newScheduleData);
            
            const preDocRef = db.collection('pre_schedules').doc(this.docId);
            batch.update(preDocRef, {
                status: 'scheduled',
                assignments: this.localAssignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
            alert("✅ 排班草稿建立成功！即將進入排班作業...");
            window.location.hash = `/admin/schedule_editor/${newDocRef.id}`;

        } catch(e) { console.error(e); alert("執行失敗: " + e.message); } 
        finally { this.isLoading = false; }
    },

    // ... (保留原本的 renderMatrix, updateStats, savePreferences 等 UI 相關函式，不需更動) ...
    // 為了節省篇幅，請保留原檔案中其他的 UI 渲染函式
    restoreTableStructure: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = `<table id="scheduleMatrix"><thead id="matrixHead"></thead><tbody id="matrixBody"></tbody><tfoot id="matrixFoot"></tfoot></table>`;
    },
    // (請確保這裡包含原有的 renderMatrix, onCellClick 等函式)
    renderMatrix: function() { /* 請保留原有的渲染邏輯 */ 
        // 這裡僅示意，請使用您原檔的 renderMatrix，確保預班介面正常
        const thead = document.getElementById('matrixHead');
        if(!thead) return;
        // ... (原程式碼) ...
        // 如果您沒有備份，我可以提供完整的 renderMatrix，但通常只需替換 executeSchedule 即可解決資料傳遞問題
    },
    updateStats: function() { /* 保留原邏輯 */ },
    setupEvents: function() { /* 保留原邏輯 */ },
    cleanup: function() { /* 保留原邏輯 */ },
    saveData: async function() { /* 保留原邏輯 */ },
    
    // 輔助函式
    showLoading: function() { document.getElementById('matrixContainer').innerHTML = '載入中...'; },
    
    // ... 其餘函式 ...
};

// ... Prefernece Modal 相關函式保持不變 ...
