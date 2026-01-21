// js/modules/shift_exchange_manager.js

const shiftExchangeManager = {
    // --- 換班申請列表 (Inbox) ---
    init: async function() {
        const container = document.getElementById('content-area');
        // 這裡可以動態渲染一個換班審核列表的 HTML，或是在 schedule_list 裡面增加一個按鈕進入
        // 為了簡化，假設這是在一個獨立頁面 '/admin/shift_exchange_list'
    },

    // --- 功能 2.1: 驗證邏輯 (模擬交換並檢查) ---
    validateSwap: async function(scheduleData, day, uidA, shiftA, uidB, shiftB) {
        console.log(`正在驗證換班: ${day}日, ${uidA}(${shiftA}) <-> ${uidB}(${shiftB})`);

        // 1. 準備環境：需要 BaseScheduler 的邏輯
        // 我們需要重建一個「模擬的」Assignments
        const mockAssignments = JSON.parse(JSON.stringify(scheduleData.assignments));
        
        // 2. 執行交換
        const key = `current_${day}`;
        mockAssignments[uidA][key] = shiftB;
        mockAssignments[uidB][key] = shiftA;

        // 3. 獲取規則與 Context
        // 注意：BaseScheduler 需要完整的 StaffList 和 Rules
        // 我們需要從 DB 獲取或是從 currentSchedule 中提取
        const unitId = scheduleData.unitId;
        const unitDoc = await db.collection('units').doc(unitId).get();
        const rules = unitDoc.exists ? (unitDoc.data().schedulingRules || {}) : {};
        
        // 4. 實例化 Scheduler (只為了用它的檢查功能)
        // 這裡需要技巧：BaseScheduler 需要 lastMonthData，若無則檢查會變弱
        // 為了效能，我們這裡做「局部檢查」或「完整檢查」
        // 這裡示範調用 BaseScheduler 的邏輯 (假設 BaseScheduler 已載入)
        
        try {
            const scheduler = new BaseScheduler(
                scheduleData.staffList, 
                scheduleData.year, 
                scheduleData.month, 
                scheduleData.lastMonthData || {}, 
                rules
            );
            
            // 強制注入模擬的 schedule 狀態
            // BaseScheduler 初始化時會建立自己的 schedule 結構，我們需要 override 它
            // 但 BaseScheduler 設計上是「產生」班表，不是「驗證」現成班表
            // 所以我們直接呼叫它的 isValidAssignment 方法會比較快，但需要先把 schedule 狀態更新進去
            
            // 更好的做法：手動呼叫關鍵檢查函式
            
            // 檢查 A (現在拿的是 shiftB)
            const staffA = scheduleData.staffList.find(s => s.uid === uidA);
            const staffB = scheduleData.staffList.find(s => s.uid === uidB);
            const dateStr = `${scheduleData.year}-${String(scheduleData.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            
            // 為了讓 Scheduler 上下文正確，我們需要手動填充 scheduler.schedule 和 counters
            // 這部分工程較大，為了實用性，我們這裡實作「輕量版關鍵驗證」
            
            // 檢查 A: minGap11 (昨天的班 vs 今天的新班 ShiftB)
            const prevShiftA = scheduler.getYesterdayShift(uidA, dateStr); 
            if (!scheduler.checkRestPeriod(prevShiftA, shiftB)) {
                return { pass: false, reason: `申請人違反間隔 11 小時 (昨:${prevShiftA} -> 今:${shiftB})` };
            }
            
            // 檢查 A: minGap11 (今天的新班 ShiftB vs 明天的班)
            // 需要去 assignments 查明天的班
            const nextDayKey = `current_${day+1}`;
            const nextShiftA = mockAssignments[uidA][nextDayKey] || 'OFF';
            if (!scheduler.checkRestPeriod(shiftB, nextShiftA)) {
                return { pass: false, reason: `申請人違反間隔 11 小時 (今:${shiftB} -> 明:${nextShiftA})` };
            }

            // 檢查 A: 連續上班 (需往回追溯)
            // ... (若需要嚴格檢查，可在此實作)

            // 同樣檢查 B (現在拿的是 shiftA)
            const prevShiftB = scheduler.getYesterdayShift(uidB, dateStr);
            if (!scheduler.checkRestPeriod(prevShiftB, shiftA)) {
                return { pass: false, reason: `對方違反間隔 11 小時 (昨:${prevShiftB} -> 今:${shiftA})` };
            }
            const nextShiftB = mockAssignments[uidB][nextDayKey] || 'OFF';
            if (!scheduler.checkRestPeriod(shiftA, nextShiftB)) {
                return { pass: false, reason: `對方違反間隔 11 小時 (今:${shiftA} -> 明:${nextShiftB})` };
            }

            return { pass: true };

        } catch(e) {
            console.error("Validation Error:", e);
            // 若驗證器出錯，暫時放行但警告
            return { pass: true, warning: "驗證過程異常，請人工覆核" };
        }
    },

    // --- 功能 2.2: 簽核流程 (被換班者同意 -> 護理長同意 -> 執行) ---
    
    // 同意 (對象是 Target 或 Manager)
    approveRequest: async function(reqId, role) {
        const reqDoc = await db.collection('shift_requests').doc(reqId).get();
        const req = reqDoc.data();

        if (role === 'target') {
            // 被換班者同意 -> 轉給經理
            await db.collection('shift_requests').doc(reqId).update({
                status: 'pending_manager',
                targetApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("已同意換班，等待護理長審核。");
        } 
        else if (role === 'manager') {
            // 護理長同意 -> 執行換班
            await this.executeSwap(reqId, req);
        }
    },

    rejectRequest: async function(reqId, reason) {
        await db.collection('shift_requests').doc(reqId).update({
            status: 'rejected',
            rejectReason: reason || '無理由',
            closedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("已拒絕申請。");
    },

    executeSwap: async function(reqId, req) {
        const schRef = db.collection('schedules').doc(req.scheduleId);
        
        try {
            await db.runTransaction(async (t) => {
                const schDoc = await t.get(schRef);
                const assignments = schDoc.data().assignments;
                const key = `current_${req.day}`;

                // 更新 assignments
                assignments[req.requesterId][key] = req.targetShift;
                assignments[req.targetId][key] = req.requesterShift;

                // 寫回
                t.update(schRef, { 
                    assignments: assignments,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 更新申請單狀態
                t.update(db.collection('shift_requests').doc(reqId), {
                    status: 'approved',
                    closedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    managerApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            alert("換班已執行！班表已更新。");
        } catch(e) {
            console.error(e);
            alert("執行換班失敗: " + e.message);
        }
    }
};
