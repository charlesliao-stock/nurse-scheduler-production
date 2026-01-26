# 帳號開通流程修復說明

## 📋 問題概述

### **症狀**
- 員工開通帳號時出現錯誤：「此 Email 已經被註冊過了 (Auth)」
- 但人員管理頁面仍顯示該員工為「未開通」狀態
- Email 之前未被註冊過，不是重複開通同一帳號

### **根本原因**

| 項目 | 說明 |
|------|------|
| **主要原因** | 新建立的 Firestore 文件沒有設定 `isActive: true` |
| **次要原因** | `staff_manager.js` 只查詢 `isActive === true` 的員工 |
| **結果** | 開通成功但人員管理找不到該員工 |

### **資料流程圖**

```
匯入員工資料
    ↓
users 集合 (ID=隨機, isRegistered=false, uid=null, isActive=true)
    ↓
員工點擊開通
    ↓
建立 Auth 帳號 ✅
    ↓
建立新文件 (ID=UID, isRegistered=true, isActive=true) ✅
    ↓
刪除舊文件 ✅
    ↓
人員管理查詢 (isActive=true) ✅
    ↓
顯示「已開通」✅
```

---

## 🔧 修復內容

### **1. signup.html 修復**

#### **修改內容**

**第 109 行**：添加 `isActive: true`
```javascript
batch.set(newDocRef, {
    ...newData,
    uid: newUid,           // 綁定真實 UID
    isRegistered: true,    // 標記已註冊
    isActive: true,        // ✅ 新增：確保員工狀態為啟用
    activatedAt: firebase.firestore.FieldValue.serverTimestamp()
});
```

**第 125-144 行**：改進「Email 已被註冊」錯誤處理
```javascript
// 處理「Email 已被註冊」的特殊情況
if(error.code === 'auth/email-already-in-use') {
    // 嘗試查找是否已有對應的 Firestore 文件
    try {
        const existingDocs = await db.collection('users')
            .where('email', '==', email)
            .where('isRegistered', '==', true)
            .get();
        
        if (!existingDocs.empty) {
            text = "此帳號已經開通，請直接前往登入頁面。";
        } else {
            // Auth 帳號存在但 Firestore 資料不同步
            text = "此 Email 已被註冊 (Auth)。\n\n可能原因：之前開通失敗導致資料不同步。\n\n請聯絡系統管理員進行修復。";
        }
    } catch (checkError) {
        console.error("檢查現有帳號失敗:", checkError);
        text = "此 Email 已經被註冊過了 (Auth)，請嘗試直接登入。";
    }
}
```

#### **改進效果**
- ✅ 新建立的員工記錄自動設定為啟用狀態
- ✅ 區分「帳號已開通」和「資料不同步」的情況
- ✅ 提供更清晰的錯誤提示

---

### **2. staff_manager.js 修復**

#### **新增故障排查工具**

**函數名稱**：`fixAuthFirestoreSync(email)`

**位置**：第 199 行之後

**功能**：
1. 查詢 Firestore 中的所有相關記錄
2. 檢測並清理重複記錄
3. 修復資料不同步的情況
4. 自動恢復停用的員工狀態

#### **使用流程**

```javascript
// 系統管理員可以在瀏覽器控制台直接調用
await staffManager.fixAuthFirestoreSync('employee@example.com');
```

#### **修復邏輯**

| 情況 | 處理方式 |
|------|---------|
| **多筆相同 Email 記錄** | 保留最新的已開通記錄，刪除其他舊記錄 |
| **未開通記錄** | 提示用戶完成開通流程 |
| **已開通但停用** | 自動恢復為啟用狀態 |
| **已開通且啟用** | 確認狀態正常 |

#### **改進效果**
- ✅ 自動檢測並修復資料不同步問題
- ✅ 清理重複記錄
- ✅ 支持系統管理員手動排查

---

### **3. staff.html 改進**

#### **新增 UI 元素**

**故障排查按鈕**（第 15 行）
```html
<button class="btn" style="background-color:#17a2b8; color:white;" onclick="staffManager.openTroubleshootModal()">
    <i class="fas fa-wrench"></i> 故障排查
</button>
```

**故障排查 Modal**（第 186-245 行）
- 輸入員工 Email
- 點擊「開始修復」按鈕
- 系統自動檢查並修復

#### **改進效果**
- ✅ 提供友善的用戶界面
- ✅ 支持系統管理員自助修復
- ✅ 無需進入 Firebase Console

---

## 🚀 使用指南

### **場景 1：正常開通流程（已修復）**

1. **管理員匯入員工資料**
   - 使用 CSV 檔案批次匯入
   - 系統自動設定 `isActive: true`

2. **員工開通帳號**
   - 進入 signup.html
   - 輸入員工編號、Email、密碼
   - 點擊「確認開通」

3. **驗證結果**
   - 開通成功，自動跳轉到登入頁面
   - 人員管理中顯示「已開通」

### **場景 2：修復「Email 已被註冊」錯誤**

#### **方法 1：使用 UI 故障排查工具（推薦）**

1. 進入「人員管理」頁面
2. 點擊「故障排查」按鈕
3. 輸入員工 Email
4. 點擊「開始修復」
5. 系統自動檢查並修復

#### **方法 2：使用瀏覽器控制台**

1. 開啟瀏覽器開發者工具（F12）
2. 進入「Console」標籤
3. 執行以下命令：
   ```javascript
   await staffManager.fixAuthFirestoreSync('employee@example.com');
   ```
4. 等待修復完成

#### **方法 3：手動修復（Firebase Console）**

1. 進入 Firebase Console
2. 進入 Firestore Database
3. 查看 `users` 集合
4. 找到相關的員工記錄
5. 檢查並修正以下欄位：
   - `isActive`: 應為 `true`
   - `isRegistered`: 應為 `true`
   - `uid`: 應有值（Firebase Auth 的 UID）
6. 刪除重複的舊記錄

---

## 🧪 測試場景

### **測試 1：正常開通**
```
步驟：
1. 新增員工資料（Email: test1@example.com）
2. 員工使用 signup.html 開通帳號
3. 檢查人員管理中是否顯示「已開通」

預期結果：
✅ 人員管理顯示「已開通」
✅ Firestore 中 isActive=true, isRegistered=true
```

### **測試 2：修復重複記錄**
```
步驟：
1. 手動建立兩筆相同 Email 的記錄
2. 使用「故障排查」工具
3. 輸入 Email，點擊「開始修復」

預期結果：
✅ 系統自動清理重複記錄
✅ 保留最新的已開通記錄
✅ 人員管理正確顯示員工狀態
```

### **測試 3：修復停用狀態**
```
步驟：
1. 手動將已開通的員工 isActive 改為 false
2. 使用「故障排查」工具
3. 輸入 Email，點擊「開始修復」

預期結果：
✅ 系統自動恢復 isActive=true
✅ 人員管理正確顯示「已開通」
```

### **測試 4：「Email 已被註冊」錯誤提示**
```
步驟：
1. 建立員工資料（Email: test2@example.com）
2. 員工第一次開通（成功）
3. 員工再次嘗試開通（應出現錯誤）

預期結果：
✅ 第二次開通時出現「此帳號已經開通，請直接前往登入頁面」
✅ 錯誤提示清晰明確
```

---

## 📊 修復前後對比

| 項目 | 修復前 | 修復後 |
|------|-------|-------|
| **新建立文件的 isActive** | ❌ 未設定（默認 undefined） | ✅ 自動設定為 true |
| **「Email 已被註冊」錯誤** | ❌ 提示不清楚 | ✅ 區分不同情況，提示明確 |
| **故障排查工具** | ❌ 無 | ✅ 提供 UI 和 API 兩種方式 |
| **重複記錄處理** | ❌ 無自動清理 | ✅ 自動檢測並清理 |
| **停用狀態恢復** | ❌ 無自動修復 | ✅ 自動檢測並恢復 |

---

## 🔍 常見問題

### **Q1：開通後人員管理仍顯示「未開通」**

**原因**：
- Firestore 文件的 `isActive` 為 false
- 或者文件沒有被正確建立

**解決方案**：
1. 使用「故障排查」工具
2. 或手動檢查 Firestore 中的記錄

### **Q2：出現「此 Email 已經被註冊過了 (Auth)」**

**原因**：
- Firebase Auth 中已存在該 Email 的帳號
- 但 Firestore 資料不同步

**解決方案**：
1. 使用「故障排查」工具修復
2. 或聯絡系統管理員

### **Q3：故障排查工具不工作**

**檢查項目**：
- 是否已登入系統管理員帳號
- Email 是否正確
- 瀏覽器控制台是否有錯誤信息

**解決方案**：
1. 檢查瀏覽器控制台（F12）
2. 查看錯誤信息
3. 聯絡系統管理員

### **Q4：如何手動修復資料不同步**

**步驟**：
1. 進入 Firebase Console
2. 查看 `users` 集合
3. 找到相關記錄
4. 編輯以下欄位：
   - `isActive`: 改為 `true`
   - `isRegistered`: 確認為 `true`
   - `uid`: 確認有值
5. 刪除重複的舊記錄
6. 重新整理人員管理頁面

---

## 📝 技術細節

### **修復涉及的文件**

| 檔案 | 修改內容 | 行數 |
|------|---------|------|
| `signup.html` | 添加 isActive, 改進錯誤處理 | 109, 125-144 |
| `staff_manager.js` | 新增 fixAuthFirestoreSync 函數 | 199+ |
| `staff.html` | 添加故障排查 UI 和按鈕 | 15, 186-245 |

### **Firestore 資料結構**

```javascript
// 員工記錄結構
{
    uid: "firebase_uid_xxx",              // Firebase Auth UID
    email: "employee@example.com",        // 員工 Email
    displayName: "張三",                  // 員工姓名
    employeeId: "E001",                   // 員工編號
    unitId: "unit_001",                   // 單位 ID
    isRegistered: true,                   // 是否已開通
    isActive: true,                       // 是否啟用（關鍵欄位）
    role: "user",                         // 系統角色
    activatedAt: Timestamp,               // 開通時間
    createdAt: Timestamp,                 // 建立時間
    updatedAt: Timestamp                  // 更新時間
}
```

### **關鍵欄位說明**

| 欄位 | 說明 | 影響 |
|------|------|------|
| `uid` | Firebase Auth UID | 用於登入驗證 |
| `isRegistered` | 是否已開通 | 人員管理顯示「已開通」 |
| `isActive` | 是否啟用 | **staff_manager.js 查詢條件** |
| `email` | 員工 Email | 用於 Auth 帳號建立 |

---

## 🔐 安全考慮

### **修復工具的安全性**

- ✅ `fixAuthFirestoreSync()` 只能由登入的管理員調用
- ✅ 修復工具會要求確認才執行刪除操作
- ✅ 所有操作都記錄在瀏覽器控制台中
- ✅ 修復前會檢查記錄的有效性

### **建議做法**

1. 定期檢查 Firestore 中的異常記錄
2. 監控「Email 已被註冊」錯誤的發生頻率
3. 定期備份 Firestore 資料
4. 限制只有系統管理員能使用故障排查工具

---

## 📞 支持

如有問題，請：
1. 檢查瀏覽器控制台的錯誤信息
2. 查看 Firestore 中的記錄
3. 使用「故障排查」工具進行診斷
4. 聯絡系統管理員

---

**修復版本**：1.0  
**修復日期**：2024-01-26  
**提交哈希**：ca9e776
