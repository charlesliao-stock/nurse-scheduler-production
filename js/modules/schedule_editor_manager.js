// js/modules/schedule_editor_manager.js

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [], // 儲存班別定義
    
    init: async function(id) {
        console.log("Editor Init:", id);
        this.scheduleId = id;
        
        try {
            // 1. 載入排班資料
            const doc = await db.collection('schedules').doc(id).get();
            if(!doc.exists) throw new Error("找不到排班資料");
            this.data = doc.data();

            // 2. [關鍵] 載入該單位的班別設定 (供 AI 使用)
            const shiftSnap = await db.collection('shifts')
                .where('unitId', '==', this.data.unitId)
                .get();
            this.shifts = shiftSnap.docs.map(d => d.data());

            // 3. UI 渲染 (此處略過 UI 細節，重點在下面的 runAI)
            // this.renderMatrix(); ...

        } catch(e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
        }
    },

    cleanup: function() {
        // 清理 UI
    },

    // --- 觸發 AI 排班 ---
    runAI: async function() {
        if(!confirm("確定要執行 AI 排班嗎？這將覆蓋目前的草稿內容。")) return;

        const btn = document.querySelector('.btn-ai'); // 假設按鈕有此 class
        if(btn) { btn.disabled = true; btn.textContent = "運算中..."; }

        try {
            // 1. 準備資料
            // 這裡需要再次撈取完整的人員資料與規則，或由後端 API 處理
            // 若為前端運算：
            const userSnap = await db.collection('users')
                .where('unitId', '==', this.data.unitId)
                .where('isActive', '==', true)
                .get();
            const allStaff = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const unitDoc = await db.collection('units').doc(this.data.unitId).get();
            const rules = unitDoc.data().schedulingRules || {};

            // 2. 呼叫 Runner (傳入 shifts)
            const runner = new ScheduleBatchRunner(
                allStaff,
                this.data.year,
                this.data.month,
                {}, // lastMonthData (暫空)
                rules,
                this.shifts // [修正] 傳入動態班別
            );

            // 3. 執行 V1
            const results = runner.runAll(); 
            const bestResult = results[0]; // 假設取第一個

            // 4. 更新本地與 DB
            if(bestResult && bestResult.schedule) {
                // 轉換格式 (schedule 格式可能需轉為 assignments)
                const newAssignments = this.convertScheduleToAssignments(bestResult.schedule);
                
                await db.collection('schedules').doc(this.scheduleId).update({
                    assignments: newAssignments,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                alert("AI 排班完成！");
                location.reload(); // 簡單重整以顯示結果
            }

        } catch(e) {
            console.error("AI Error:", e);
            alert("運算發生錯誤: " + e.message);
        } finally {
            if(btn) { btn.disabled = false; btn.textContent = "AI 自動排班"; }
        }
    },

    convertScheduleToAssignments: function(schedule) {
        // 將 { "2023-01-01": { N: [uid1], E: [uid2] } }
        // 轉為 { uid1: { "2023-01-01": "N" }, uid2: ... }
        const assignments = {};
        for(const [dateStr, shifts] of Object.entries(schedule)) {
            for(const [shiftCode, uids] of Object.entries(shifts)) {
                if(shiftCode === 'OFF' || shiftCode === 'LEAVE') continue; // 通常不存 OFF 以節省空間，視需求而定
                
                uids.forEach(uid => {
                    if(!assignments[uid]) assignments[uid] = {};
                    assignments[uid][dateStr] = shiftCode;
                });
            }
        }
        return assignments;
    }
};
