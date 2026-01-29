// 🔥 在 SchedulerV2.js 中新增的缺額處理函數
// 放在 fillShiftNeeds() 函數之後

/**
 * 🔥 新增：從低優先班別借調人力
 * @param {number} day - 日期
 * @param {string} targetShift - 目標班別（需要人力的班別）
 * @param {number} gap - 缺額人數
 * @returns {number} - 成功調整的人數
 */
borrowFromLowerPriority(day, targetShift, gap) {
    const dateStr = this.getDateStr(day);
    const priorityOrder = this.rules.policy?.shortageHandling?.priorityOrder || [];
    
    // 如果沒有設定優先順序，不進行借調
    if (priorityOrder.length === 0) return 0;
    
    const currentIndex = priorityOrder.indexOf(targetShift);
    
    // 如果目標班別不在優先清單中，或已經是最低優先，無法借調
    if (currentIndex === -1 || currentIndex === priorityOrder.length - 1) return 0;
    
    let recovered = 0;
    console.log(`🔄 嘗試為 ${targetShift} 班借調人力（缺 ${gap} 人）...`);
    
    // 從優先順序更低的班別開始借調（從後往前）
    for (let i = priorityOrder.length - 1; i > currentIndex && gap > 0; i--) {
        const sourceShift = priorityOrder[i];
        const sourceUids = this.schedule[dateStr][sourceShift] || [];
        
        // 跳過空班別
        if (sourceUids.length === 0) continue;
        
        // 嘗試將人從 sourceShift 移到 targetShift
        for (const uid of [...sourceUids]) {
            if (gap <= 0) break;
            
            const staff = this.staffList.find(s => s.id === uid);
            if (!staff) continue;
            
            // 檢查是否是預排的（不能調整）
            if (this.isPreRequestOff(uid, dateStr)) continue;
            
            const params = staff.schedulingParams || {};
            if (params[dateStr] === sourceShift) continue; // 使用者指定的班別不調整
            
            // 檢查是否可以改排到目標班別
            if (this.isValidAssignment(staff, dateStr, targetShift)) {
                this.updateShift(dateStr, uid, sourceShift, targetShift);
                gap--;
                recovered++;
                console.log(`  ✓ 從 ${sourceShift} 調 ${staff.name || uid} 到 ${targetShift}`);
            }
        }
        
        if (recovered > 0) {
            console.log(`  → 從 ${sourceShift} 成功調整 ${recovered} 人`);
        }
    }
    
    if (recovered === 0) {
        console.log(`  ✗ 無法從低優先班別借調人力`);
    }
    
    return recovered;
}

// 🔥 修改：在 fillShiftNeeds() 函數的最後加入缺額處理
// 原本的 fillShiftNeeds() 函數最後部分應該修改為：

/*
    if (gap > 0 && this.backtrackDepth > 0) {
        const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
        gap -= recovered;
    }
    
    // 🔥 新增：如果還有缺額，嘗試從低優先班別借調
    if (gap > 0) {
        const borrowRecovered = this.borrowFromLowerPriority(day, shiftCode, gap);
        gap -= borrowRecovered;
    }
    
    if (gap > 0) {
        const priorityOrder = this.rules.policy?.shortageHandling?.priorityOrder || [];
        const priorityIndex = priorityOrder.indexOf(shiftCode);
        const priorityLabel = priorityIndex === 0 ? '（最高優先）' : 
                              priorityIndex === priorityOrder.length - 1 ? '（可接受缺額）' : '';
        console.warn(`[缺口] ${dateStr} ${shiftCode} 尚缺 ${gap} ${priorityLabel}`);
    }
*/
