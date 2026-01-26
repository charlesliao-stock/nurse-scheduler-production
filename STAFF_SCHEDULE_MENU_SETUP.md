# 「我的班表與統計」菜單設定指南

## 概述

「我的班表與統計」是護理師員工查看個人班表、統計資訊，以及提出換班申請的功能頁面。

---

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
| `label` | 字串 | `我的班表與統計` |
| `order` | 數字 | `5` |
| `path` | 字串 | `/staff/schedule` |
| `icon` | 字串 | `fas fa-calendar-alt` |
| `allowedRoles` | 陣列 | `["user"]` |
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
     - **名稱 (Label)**: `我的班表與統計`
     - **排序 (Order)**: `5`
     - **路徑 (Path)**: `/staff/schedule`
     - **圖示代碼**: `fas fa-calendar-alt`
     - **權限角色**: 勾選「護理師」
     - **啟用狀態**: 勾選「啟用」

4. **保存**
   - 點擊「儲存」按鈕

---

## 方法三：通過瀏覽器控制台新增（開發者用）

在瀏覽器控制台執行以下 JavaScript 代碼：

```javascript
// 新增「我的班表與統計」菜單
db.collection('system_menus').add({
    label: '我的班表與統計',
    order: 5,
    path: '/staff/schedule',
    icon: 'fas fa-calendar-alt',
    allowedRoles: ['user'],
    isActive: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
}).then(docRef => {
    console.log('✅ 「我的班表與統計」菜單新增成功，ID:', docRef.id);
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
2. 查看 `system_menus` 集合
3. 確認是否有新增的「我的班表與統計」文檔

### 方法 2：檢查應用程式
1. 重新整理頁面
2. 以護理師帳號登入
3. 檢查左側菜單是否顯示「我的班表與統計」
4. 點擊菜單項，確認是否能正確載入頁面

### 方法 3：檢查瀏覽器控制台
```javascript
// 在控制台執行
db.collection('system_menus').where('path', '==', '/staff/schedule').get()
    .then(snapshot => {
        if (snapshot.empty) {
            console.log('❌ 菜單未找到');
        } else {
            console.log('✅ 菜單已存在:', snapshot.docs[0].data());
        }
    });
```

---

## 功能介紹

### 頁面功能

**「我的班表與統計」頁面包含以下功能：**

1. **班表查詢**
   - 選擇月份查詢個人班表
   - 支持日期區間篩選（選填）

2. **統計卡片**
   - 上班總數
   - 總休假 (OFF)
   - 假日休 (Holiday)
   - 小夜班 (E)
   - 大夜班 (N)
   - 換班數

3. **班表詳情**
   - 顯示每日班別
   - 顯示班別備註
   - 支持換班操作

4. **提出換班申請**
   - 選擇互換對象
   - 選擇換班事由分類
   - 填寫其他原因說明（若選擇「其他」）
   - 填寫換班原因說明

### 換班事由分類

| 分類 | 說明 |
|------|------|
| 單位人力調整 | 因單位人力調度需求 |
| 公假 | 因公假需求 |
| 病假 | 因病假需求 |
| 喪假 | 因喪假需求 |
| 支援 | 支援其他單位 |
| 個人因素 | 個人私人因素 |
| 其他 | 其他原因（需填寫說明） |

---

## 常見問題

### Q1: 菜單新增後沒有顯示？
**A**: 
1. 確認您的帳號角色是否為「護理師」(user)
2. 重新整理頁面（Ctrl+F5 強制刷新）
3. 檢查 `isActive` 是否為 `true`
4. 檢查瀏覽器控制台是否有錯誤信息

### Q2: 點擊菜單後顯示「找不到路由」？
**A**: 
1. 確認 `router.js` 中是否有 `/staff/schedule` 路由
2. 確認 `staff_schedule.html` 檔案是否存在於 `views/` 目錄
3. 確認 `staffScheduleManager` 是否在 `index.html` 中正確引入

### Q3: 提出換班申請時出錯？
**A**: 
1. 檢查瀏覽器控制台的錯誤信息
2. 確認 Firestore `shift_requests` 集合是否存在
3. 確認 Firestore 權限是否允許寫入

### Q4: 換班對象列表為空？
**A**: 
1. 確認是否有其他員工在同一天有班表
2. 檢查班表資料是否正確載入
3. 確認 Firestore 查詢邏輯是否正確

---

## 相關檔案清單

| 檔案 | 說明 |
|------|------|
| `views/staff_schedule.html` | 我的班表與統計頁面 HTML |
| `js/modules/staff_schedule_manager.js` | 班表管理邏輯 |
| `js/router.js` | 路由配置 |
| `index.html` | 主應用程式 |

---

## 後續步驟

1. ✅ 新增菜單項
2. ✅ 驗證菜單是否顯示
3. ✅ 測試班表查詢功能
4. ✅ 測試提出換班申請功能

---

**完成日期**: 2024-01-26
**版本**: 1.0
