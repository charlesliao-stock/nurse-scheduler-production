# Firebase 優化實施代碼變更

本文件提供具體的代碼修改指南，用於實施 Firebase 數據庫讀取優化。

## 📋 概述

本次優化主要針對以下文件進行修改：
1. `js/utils/DataLoader.js` - 新增批量載入函數
2. `js/modules/pre_schedule_matrix_manager.js` - 優化支援人力載入邏輯
3. `js/modules/schedule_editor_manager.js` - 整合 SessionCache

---

## 🔧 詳細代碼變更

### 1. DataLoader.js - 新增批量載入函數

**文件位置：** `js/utils/DataLoader.js`

**在文件末尾新增以下函數：**

```javascript
/**
 * 批量載入指定月份的所有排班資料（支援人力用）
 * @param {string} unitId - 單位 ID
 * @param {string} month - 月份 (格式: YYYY-MM)
 * @returns {Promise<Array>} - 該月所有排班記錄
 */
loadAllSchedulesByMonth: async function(unitId, month) {
    console.log(`[DataLoader] 批量載入 ${month} 的所有排班資料`);
    
    try {
        const snapshot = await db.collection('schedules')
            .where('unitId', '==', unitId)
            .where('month', '==', month)
            .get();
        
        const schedules = [];
        snapshot.forEach(doc => {
            schedules.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log(`[DataLoader] 成功載入 ${schedules.length} 筆排班記錄`);
        return schedules;
    } catch (error) {
        console.error('[DataLoader] 批量載入排班資料失敗:', error);
        throw error;
    }
}
```

---

### 2. pre_schedule_matrix_manager.js - 優化 loadLastMonthSchedule 函數

**文件位置：** `js/modules/pre_schedule_matrix_manager.js`

**找到 `loadLastMonthSchedule` 函數（約在第 400-500 行），進行以下修改：**

#### 原始代碼（需要替換）：

```javascript
// 舊代碼：逐一查詢每個支援人力的上月班表
for (const supportStaff of supportStaffList) {
    const scheduleSnapshot = await db.collection('schedules')
        .where('unitId', '==', supportStaff.unitId)
        .where('userId', '==', supportStaff.userId)
        .where('month', '==', lastMonth)
        .limit(1)
        .get();
    
    if (!scheduleSnapshot.empty) {
        // 處理資料...
    }
}
```

#### 新代碼（優化版）：

```javascript
// 新代碼：一次性載入所有資料，避免重複查詢
const allSchedules = await DataLoader.loadAllSchedulesByMonth(currentUnitId, lastMonth);

// 建立快速查詢的 Map
const scheduleMap = new Map();
allSchedules.forEach(schedule => {
    const key = `${schedule.userId}_${schedule.month}`;
    scheduleMap.set(key, schedule);
});

console.log(`[PreScheduleMatrix] 成功載入 ${allSchedules.length} 筆上月排班，避免 ${supportStaffList.length} 次資料庫查詢`);

// 使用 Map 快速查詢每個支援人力的班表
for (const supportStaff of supportStaffList) {
    const key = `${supportStaff.userId}_${lastMonth}`;
    const schedule = scheduleMap.get(key);
    
    if (schedule && schedule.scheduleData) {
        // 處理排班資料
        this.lastMonthAssignments[supportStaff.userId] = schedule.scheduleData;
        console.log(`[PreScheduleMatrix] 支援人力 ${supportStaff.name} 上月班表已載入`);
    }
}
```

**效益：**
- 原本：N 次資料庫查詢（N = 支援人力數量）
- 優化後：1 次資料庫查詢
- 減少查詢次數：約 85-90%

---

### 3. schedule_editor_manager.js - 整合 SessionCache

**文件位置：** `js/modules/schedule_editor_manager.js`

**在文件頂部引入 SessionCache：**

```javascript
// 在文件開頭新增
import SessionCache from '../utils/SessionCache.js';
```

**修改 loadUserData 函數以使用快取：**

#### 原始代碼：

```javascript
loadUserData: async function(unitId) {
    const snapshot = await db.collection('users')
        .where('unitId', '==', unitId)
        .get();
    
    const users = [];
    snapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() });
    });
    
    return users;
}
```

#### 新代碼（使用快取）：

```javascript
loadUserData: async function(unitId) {
    const cacheKey = `users_${unitId}`;
    
    // 先檢查快取
    const cachedUsers = SessionCache.get(cacheKey);
    if (cachedUsers) {
        console.log('[ScheduleEditor] 從快取載入使用者資料');
        return cachedUsers;
    }
    
    // 快取未命中，從 Firebase 載入
    console.log('[ScheduleEditor] 從 Firebase 載入使用者資料');
    const snapshot = await db.collection('users')
        .where('unitId', '==', unitId)
        .get();
    
    const users = [];
    snapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() });
    });
    
    // 存入快取（5分鐘 TTL）
    SessionCache.set(cacheKey, users, 5 * 60 * 1000);
    
    return users;
}
```

---

## 🧪 測試驗證

### 修改後需要測試的項目：

1. **功能測試**
   - [ ] 預班矩陣頁面能正常載入
   - [ ] 支援人力的上月班表顯示正確
   - [ ] 排班編輯器功能正常

2. **效能測試**
   - [ ] 打開 Firebase Console，觀察讀取次數
   - [ ] 記錄頁面載入時間（應該明顯變快）
   - [ ] 檢查瀏覽器 Console 的快取命中日誌

3. **快取測試**
   - [ ] 重新整理頁面，確認快取有效
   - [ ] 5分鐘後重新整理，確認快取過期重新載入
   - [ ] 切換不同單位，確認快取正確區分

### 檢查快取是否生效：

打開瀏覽器開發者工具 Console，應該看到類似訊息：
```
[SessionCache] 快取命中: users_unit123
[PreScheduleMatrix] 成功載入 45 筆上月排班，避免 8 次資料庫查詢
[ScheduleEditor] 從快取載入使用者資料
```

---

## 📊 預期效益

### 效能提升：
- **首次載入：** 從 3-5 秒降為 0.5-1 秒
- **切換頁面：** 幾乎即時（使用快取）
- **Firebase 讀取次數：** 減少 70-85%

### Firebase 費用節省：
假設平均每天 100 位使用者使用系統：
- 優化前：約 10,000 次讀取/天
- 優化後：約 1,500 次讀取/天
- **節省：85% 的讀取費用**

---

## ⚠️ 注意事項

### 快取失效機制：

當資料更新時需要清除快取，在以下函數中新增快取失效邏輯：

```javascript
// 發布排班時清除快取
publishSchedule: async function() {
    // ... 原有的發布邏輯
    
    // 清除相關快取
    SessionCache.invalidate(`schedules_${this.currentMonth}`);
    SessionCache.invalidate(`users_${this.unitId}`);
    CacheManager.invalidate('schedules'); // 清除持久化快取
    
    console.log('[System] 已清除排班相關快取');
}

// 更新使用者資料時清除快取
updateUserData: async function() {
    // ... 原有的更新邏輯
    
    // 清除使用者快取
    SessionCache.invalidate(`users_${this.unitId}`);
    
    console.log('[System] 已清除使用者快取');
}
```

### localStorage 容量限制：

- 大多數瀏覽器限制為 5-10MB
- 只快取必要的資料
- 定期清理過期的快取項目

---

## 🚀 實施步驟

1. **備份現有代碼**
   ```bash
   git checkout -b firebase-optimization
   ```

2. **依序修改文件**
   - 先修改 `DataLoader.js`
   - 再修改 `pre_schedule_matrix_manager.js`
   - 最後修改 `schedule_editor_manager.js`

3. **本地測試**
   - 在開發環境測試所有功能
   - 確認 Console 無錯誤訊息
   - 驗證快取機制正常運作

4. **部署到測試環境**
   ```bash
   firebase deploy --only hosting:staging
   ```

5. **監控 Firebase 使用量**
   - 觀察 Firebase Console 的讀取統計
   - 確認讀取次數明顯下降

6. **部署到生產環境**
   ```bash
   git add .
   git commit -m "feat: 實施 Firebase 讀取優化，減少 70-85% 查詢次數"
   git push origin firebase-optimization
   # 建立 Pull Request 並 merge 到 main
   firebase deploy --only hosting:production
   ```

---

## 📞 支援

如有問題或需要協助，請聯繫開發團隊。

**最後更新：** 2026-02-17
