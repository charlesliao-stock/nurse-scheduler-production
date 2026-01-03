// js/modules/schedule_editor_manager.js 的 runAI 部分

    runAI: async function() {
        if (!confirm("確定要執行 AI 排班嗎？\n現有的手動排班可能會被覆蓋，但鎖定的預休不會變動。")) return;

        this.isLoading = true;
        // 建議這裡可以加一個 showLoading() 的 UI 效果
        
        try {
            console.log("🤖 準備執行 AI 排班...");

            // 1. 準備資料
            // 必須確保資料結構符合 BaseScheduler 的需求
            // staffList 需包含 id, name, packageType, prefs 等
            const staffListForAI = this.data.staffList.map(s => ({
                id: s.uid, // BaseScheduler 使用 id
                uid: s.uid,
                name: s.name,
                packageType: s.packageType || '',
                prefs: s.preferences || {} // 確保預班偏好有帶入
            }));

            // 2. 準備規則與設定
            // 從 UI 或 DB 讀取設定，若無則使用預設值
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {}, // 每日人力需求
                tolerance: 2,       // [重點] 容許誤差 2 天
                backtrackDepth: 3,  // [重點] 回溯深度 3 天
                ...(this.data.settings || {}) // 合併其他設定
            };

            // 3. 呼叫工廠建立 V2 排班器
            // 需傳入: 人員, 年, 月, 上個月資料(暫時給空), 規則
            const scheduler = SchedulerFactory.create(
                'V2', 
                staffListForAI, 
                this.data.year, 
                this.data.month, 
                {}, // TODO: 若有上個月資料 (lastMonthData) 需在此傳入
                rules
            );

            // 4. 執行運算
            const newSchedule = scheduler.run();

            // 5. 將結果寫回本地 assignments (UI 更新用)
            // Scheduler 回傳的是 { "2026-01-01": { N:['uid1'], ... } }
            // 我們需要轉換回 Matrix 的格式 { uid: { current_1: 'N', ... } }
            
            this.convertAndApplySchedule(newSchedule);

            // 6. 重新渲染與存檔
            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(); // 自動存檔

            alert("✅ AI 排班完成！\n已套用「天數平衡」與「回溯優化」策略。");

        } catch (e) {
            console.error("AI 執行失敗:", e);
            alert("AI 排班失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // [新增] 輔助函數：將 AI 的日期導向格式 轉回 人員導向格式
    convertAndApplySchedule: function(aiSchedule) {
        // 清空現有排班 (保留預休的邏輯在 AI 內部已處理，這裡是接收結果)
        // 但為了保險，我們只更新 AI 有排的部分
        
        Object.keys(aiSchedule).forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]); // 取得日期 (假設格式 YYYY-MM-DD)
            const daySchedule = aiSchedule[dateStr]; // { N:[], E:[], D:[], OFF:[] }
            
            // 遍歷當天所有班別
            ['N', 'E', 'D', 'OFF'].forEach(shiftCode => {
                if(daySchedule[shiftCode]) {
                    daySchedule[shiftCode].forEach(uid => {
                        if(!this.assignments[uid]) this.assignments[uid] = {};
                        
                        // 寫入 assignments
                        // 注意：如果原本是 REQ_OFF，AI 應該會回傳 REQ_OFF 或保持原狀
                        // 這裡直接覆蓋，因為 AI 已經考慮過鎖定了
                        this.assignments[uid][`current_${day}`] = shiftCode;
                    });
                }
            });
        });
    },
