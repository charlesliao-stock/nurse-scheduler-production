# 系統統計菜單設定指南

## 方法一：通過 Firebase Console 手動新增

### 步驟：

1. **登入 Firebase Console**
   - 進入 https://console.firebase.google.com
   - 選擇您的專案

2. **進入 Firestore Database**
   - 左側選單 → Firestore Database
   - 選擇 `system_menus` 集合

3. **新增文檔**
   - 點擊「新增文檔」按鈕
   - 填寫以下資料：

| 欄位 | 類型 | 值 |
|------|------|-----|
| `label` | 字串 | `系統統計` |
| `order` | 數字 | `9` |
| `path` | 字串 | `/admin/system_statistics` |
| `icon` | 字串 | `fas fa-chart-bar` |
| `allowedRoles` | 陣列 | `["system_admin", "unit_manager", "unit_scheduler"]` |
| `isActive` | 布林值 | `true` |
| `createdAt` | 時間戳 | 自動 |
| `updatedAt` | 時間戳 | 自動 |

4. **保存**
   - 點擊「保存」按鈕

---

## 方法二：通過應用程式菜單管理頁面新增

### 步驟：

1. **登入系統**
   - 使用系統管理員帳號登入

2. **進入選單管理**
   - 點擊左側菜單 → 「選單管理」

3. **新增選單**
   - 點擊「新增選單」按鈕
   - 填寫以下資料：
     - **名稱 (Label)**: `系統統計`
     - **排序 (Order)**: `9`
     - **路徑 (Path)**: `/admin/system_statistics`
     - **圖示代碼**: `fas fa-chart-bar`
     - **權限角色**: 勾選「系統管理員」、「單位護理長」、「排班人員」
     - **啟用狀態**: 勾選「啟用」

4. **保存**
   - 點擊「儲存」按鈕

---

## 方法三：通過瀏覽器控制台新增（開發者用）

在瀏覽器控制台執行以下 JavaScript 代碼：

```javascript
// 新增系統統計菜單
db.collection('system_menus').add({
    label: '系統統計',
    order: 9,
    path: '/admin/system_statistics',
    icon: 'fas fa-chart-bar',
    allowedRoles: ['system_admin', 'unit_manager', 'unit_scheduler'],
    isActive: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
}).then(docRef => {
    console.log('✅ 系統統計菜單新增成功，ID:', docRef.id);
    alert('菜單新增成功！請重新整理頁面。');
    // 重新整理頁面以更新菜單
    location.reload();
}).catch(error => {
    console.error('❌ 新增失敗:', error);
    alert('新增失敗: ' + error.message);
});
```

---

## 驗證菜單是否成功新增

### 方法 1：檢查 Firestore
1. 進入 Firebase Console
2. 查看 `system_meuns` 集合
3. 確認是否有新增的「系統統計」文檔

### 方法 2：檢查應用程式
1. 重新整理頁面
2. 檢查左側菜單是否顯示「系統統計」
3. 點擊菜單項，確認是否能正確載入系統統計頁面

### 方法 3：檢查瀏覽器控制台
```javascript
// 在控制台執行
db.collection('system_menus').where('path', '==', '/admin/system_statistics').get()
    .then(snapshot => {
        if (snapshot.empty) {
            console.log('❌ 菜單未找到');
        } else {
            console.log('✅ 菜單已存在:', snapshot.docs[0].data());
        }
    });
```

---

## 常見問題

### Q1: 菜單新增後沒有顯示？
**A**: 
1. 確認您的帳號角色是否在 `allowedRoles` 中
2. 重新整理頁面（Ctrl+F5 強制刷新）
3. 檢查 `isActive` 是否為 `true`
4. 檢查瀏覽器控制台是否有錯誤信息

### Q2: 點擊菜單後顯示「找不到路由」？
**A**: 
1. 確認 `router.js` 中是否有 `/admin/system_statistics` 路由
2. 確認 `system_statistics.html` 檔案是否存在於 `views/` 目錄
3. 確認所有相關的 JavaScript 檔案是否在 `index.html` 中正確引入

### Q3: 系統統計頁面無法載入？
**A**: 
1. 檢查瀏覽器控制台的錯誤信息
2. 確認 `systemStatisticsManager` 是否正確初始化
3. 確認 Firestore 權限是否正確設定

---

## 相關檔案清單

| 檔案 | 說明 |
|------|------|
| `views/system_statistics.html` | 系統統計頁面 HTML |
| `js/modules/system_statistics_manager.js` | 統計計算邏輯 |
| `js/modules/system_statistics_ui_manager.js` | 統計 UI 管理 |
| `js/modules/analysis_report_generator.js` | AI 分析報告生成 |
| `js/modules/automated_report_scheduler.js` | 自動化報告排程 |
| `js/router.js` | 路由配置 |
| `index.html` | 主應用程式 |

---

## 後續步驟

1. ✅ 新增菜單項
2. ✅ 驗證菜單是否顯示
3. ✅ 測試系統統計功能
4. ✅ 查看 SYSTEM_STATISTICS_TESTING.md 進行完整測試

---

**完成日期**: 2024-01-23
**版本**: 1.0
