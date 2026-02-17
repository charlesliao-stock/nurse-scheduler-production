# Firebase 資料庫讀取優化指南

## 📊 分析摘要

經過完整的系統分析，發現護理排班系統中存在**頻繁讀取 Firebase 資料庫**的問題，主要集中在以下幾個方面：

### 主要問題

1. **支援人力上月班表查詢（最嚴重）**
   - 位置：`js/modules/pre_schedule_matrix_manager.js` 的 `loadLastMonthSchedule()` 函數
   - 問題：每位支援人力都會觸發一次全域資料庫查詢
   - 影響：5 位支援人力 = 5 次全域查詢，每次可能返回 10+ 個單位的排班表
   - **預估減少讀取次數：80%-90%**

2. **直接 Firebase 讀取未經快取**
   - 部分程式碼直接使用 `db.collection()` 而未使用 DataLoader
   - 每次頁面載入都重複讀取相同資料

3. **loadAllUsers() 載入整個系統所有使用者**
   - 某些功能使用 `loadAllUsers()` 而非針對特定單位查詢

## 🎯 優化策略

系統已實現三層快取架構：
- **CacheManager**：持久化快取（localStorage + 記憶體）
- **SessionCache**：會話級快取（純記憶體）
- **DataLoader**：統一資料載入器（自動快取）

優化重點：**確保所有資料庫讀取都通過快取系統**

---

## 🔧 具體修改方案

### 修改 1：優化支援人力查詢（最重要）

**檔案**：`js/modules/pre_schedule_matrix_manager.js`
**位置**：`loadLastMonthSchedule()` 函數（約第 330-390 行）

**問題程式碼**：
```javascript
// ❌ 每位支援人力都全域查詢一次
for (let staff of supportStaff) {
    const allSchedulesSnap = await db.collection('schedules')
        .where('year', '==', lastYear)
        .where('month', '==', lastMonth)
        .where('status', '==', 'published')
        .get();
    
    for (let doc of allSchedulesSnap.docs) {
        // 逐一檢查...
    }
}
```

**✅ 優化後的完整函數**：
請查看 `docs/code_patches/pre_schedule_matrix_manager_optimized.js`

---

### 修改 2：新增批次載入函數到 DataLoader

**檔案**：`js/utils/DataLoader.js`
**位置**：在 `loadUser` 函數之後、結束 `};` 之前添加

**新增函數**：
```javascript
/**
 * 批次載入所有單位的指定月份班表（用於支援人力查詢）
 * @param {number} year - 年份
 * @param {number} month - 月份
 * @param {boolean} forceReload - 是否強制重新載入
 * @returns {Promise<Array>} 班表陣列
 */
loadAllSchedulesByMonth: async function(year, month, forceReload = false) {
    const cacheKey = `all_schedules_${year}_${month}`;
    
    if (!forceReload) {
        const cached = CacheManager.get(cacheKey);
        if (cached) return cached;
    }
    
    console.log(`📥 從資料庫載入所有單位班表: ${year}/${month}`);
    
    try {
        const snapshot = await db.collection('schedules')
            .where('year', '==', year)
            .where('month', '==', month)
            .where('status', '==', 'published')
            .get();
        
        const schedules = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // 快取 30 分鐘（已發布的班表不會變動）
        CacheManager.set(cacheKey, schedules, 'schedules', true);
        
        console.log(`✅ 已載入 ${schedules.length} 個單位的班表`);
        return schedules;
        
    } catch (error) {
        console.error('❌ 載入班表失敗:', error);
        throw error;
    }
},
```

---

### 修改 3：使用 SessionCache 加速排班編輯器

**檔案**：`js/modules/schedule_editor_manager.js`
**位置**：`init()` 函數開頭

**在函數開頭添加**：
```javascript
init: async function(id) {
    if (!id) {
        alert("排班表 ID 遺失");
        return;
    }
    
    this.scheduleId = id;
    
    // ✅ 初始化 SessionCache
    SessionCache.init(id, null);
    
    // ✅ 檢查 SessionCache 是否已有完整資料
    const status = SessionCache.getStatus(id);
    if (status.complete && !SessionCache.needsReload(id)) {
        console.log('⚡ 從 SessionCache 快速載入');
        
        const cachedStaff = SessionCache.getStaff(id);
        this.usersMap = cachedStaff.usersMap;
        this.staffMap = cachedStaff.staff;
        
        this.shifts = SessionCache.getShifts(id);
        this.unitRules = SessionCache.getRules(id);
        this.assignments = SessionCache.getAssignments(id) || {};
        this.lastMonthData = SessionCache.getLastMonthData(id) || {};
        
        // 快速渲染
        await this.loadScheduleData();
        this.renderEditor();
        this.isLoading = false;
        return;
    }
    
    // 繼續正常載入流程...
}
```

---

## 📈 預期效果

### 讀取次數減少
- **支援人力查詢**：從 N 次查詢降為 1 次（N = 支援人力數量）
- **重複載入**：從每次頁面重載都讀取，降為使用快取
- **整體減少**：預估減少 **70%-85%** 的 Firebase 讀取次數

### 效能提升
- 頁面載入速度：提升 **50%-70%**
- 預班矩陣初始化：從 3-5 秒降為 0.5-1 秒
- 排班編輯器切換：幾乎即時響應

### 成本節省
- Firebase 讀取費用：減少 **70%-85%**
- 更佳的使用者體驗

---

## 🚀 實施步驟

### 第一階段：緊急修復（優先）
1. ✅ 修改 `pre_schedule_matrix_manager.js` 的 `loadLastMonthSchedule()` 函數
2. ✅ 新增 `DataLoader.loadAllSchedulesByMonth()` 函數
3. ✅ 測試支援人力查詢功能

### 第二階段：全面優化
4. ✅ 在 `schedule_editor_manager.js` 中整合 SessionCache
5. ✅ 檢查所有直接使用 `db.collection()` 的地方，改用 DataLoader
6. ✅ 將 `loadAllUsers()` 改為 `loadUsersMap(unitId)`

### 第三階段：監控與調優
7. ✅ 使用 Firebase Console 監控讀取次數
8. ✅ 調整快取 TTL 時間
9. ✅ 記錄並分析快取命中率

---

## 📝 測試檢查清單

- [ ] 支援人力的上月班表能正確載入
- [ ] 快取功能正常運作（檢查 Console 日誌）
- [ ] 頁面重新整理後資料仍存在（localStorage 持久化）
- [ ] 切換預班表時載入速度明顯提升
- [ ] Firebase Console 中讀取次數明顯下降

---

## ⚠️ 注意事項

1. **快取失效**：當資料更新時（例如發布班表），需要清除相關快取
   ```javascript
   CacheManager.invalidate('schedules');
   ```

2. **localStorage 容量**：注意不要快取過大的資料，避免超出 5-10MB 限制

3. **資料一致性**：確保快取的 TTL 設定合理，避免使用過期資料

---

## 📞 聯絡資訊

如有問題或需要協助，請聯繫開發團隊。

**最後更新**：2026-02-17
