// ✅ 新的資料結構
const exchangeData = {
    scheduleId: this.scheduleData.id || null,
    unitId: this.scheduleData.unitId || null,
    year: this.currentYear,
    month: this.currentMonth,
    date: dateStr,  // ✅ 完整日期字串 "2026-01-11"
    
    // ✅ 使用 Uid 後綴
    requesterUid: finalRequesterId,  // 不是 requesterId
    requesterName: myName,
    requesterShift: this.selectedShift,
    
    targetUid: targetUid,  // 不是 targetId
    targetName: targetName,
    targetShift: targetShift,
    
    status: 'pending_target',
    reasonCategory: reasonRadio.value,
    reason: reason,
    
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
};
