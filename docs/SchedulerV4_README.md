# SchedulerV4 使用說明

## 🆕 V4 改良式基因演算法

**SchedulerV4** 是一個基於 **改良式基因演算法 (Enhanced Genetic Algorithm)** 的智能排班引擎，採用多目標優化策略，於硬限制、軟限制、公平性和偏好滿足度之間找到最佳平衡。

---

## ✨ 核心特色

### 1. **多目標優化**
- 硬限制違規 (-1000 分/次)
- 軟限制違規 (-50 分/次)
- 公平性分數 (+10 分/單位)
- 偏好滿足度 (+5 分/單位)
- 人力達成率 (+20 分/單位)

### 2. **進化策略**
- **錦標賽選擇** (Tournament Selection): 保持族群多樣性
- **兩點交叉** (Two-Point Crossover): 保留優良基因片段
- **適應性突變** (Adaptive Mutation): 突變率逐代遞減
- **菁英保留** (Elitism): 保證最佳解不消失

### 3. **智能初始化**
- 30% 貪婪解：高品質起點
- 30% 貪婪變異：探索鄰近空間
- 40% 隨機解：保持多樣性

### 4. **動態調整**
- 族群大小根據人數自動調整
- 突變率線性遞減 (5% → 0%)
- 適應度快取機制

---

## 📊 V3 vs V4 比較

| 項目 | V3 四階段回溯法 | V4 改良式 GA |
|------|----------------|-------------|
| **演算法** | 貪婪法 + 回溯 | 基因演算法 |
| **執行時間** | 3-5秒 | 12-15秒 |
| **排班品質** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **公平性** | 良好 | 優異 |
| **偏好滿足** | 75-80% | 85-95% |
| **穩定性** | 高 | 中等 |
| **可調性** | 低 | 高 |
| **適用場景** | 日常排班 | 重要排班 |

---

## 🚀 使用方法

### **方法1: 直接調用**

```javascript
// 1. 準備資料
const allStaff = [...];  // 人員清單
const rules = {...};     // 排班規則
const year = 2026;
const month = 2;
const lastMonthData = {};

// 2. 建立 V4 引擎
const scheduler = new SchedulerV4(allStaff, year, month, lastMonthData, rules);

// 3. 執行排班
const schedule = scheduler.run();

// 4. 查看結果
console.log(schedule);
```

### **方法2: 使用 SchedulerFactory**

```javascript
// 使用工廠模式
const scheduler = SchedulerFactory.createWithValidation(
    'V4',  // 指定 V4 演算法
    allStaff,
    year,
    month,
    lastMonthData,
    rules
);

const schedule = scheduler.run();
```

### **方法3: 在前端使用**

```javascript
// 在 schedule_list_manager.js 中
async function generateScheduleWithV4() {
    try {
        // 顯示載入畫面
        showLoading('🧬 正在使用 V4 改良式基因演算法排班...');
        
        // 建立排班引擎
        const scheduler = SchedulerFactory.create(
            'V4',
            allStaff,
            currentYear,
            currentMonth,
            lastMonthData,
            rules
        );
        
        // 執行排班
        const schedule = scheduler.run();
        
        // 儲存結果
        await saveSchedule(schedule);
        
        // 顯示成功訊息
        showSuccess('✅ V4 排班完成！');
        
        // 重新載入排班表
        loadSchedules();
        
    } catch (error) {
        console.error('❌ V4 排班失敗:', error);
        showError('排班失敗: ' + error.message);
    } finally {
        hideLoading();
    }
}
```

---

## ⚙️ 參數調整

### **在 rules 中設定 GA 參數**

```javascript
const rules = {
    shifts: [...],
    dailyNeeds: {...},
    
    // GA 參數 (可選)
    aiParams: {
        ga_generations: 150,      // 世代數 (預設 150)
        // population_size 會自動根據人數調整
    },
    
    // 人員限制
    staff: {
        min_off_days: 8,          // 最少休假天數
        max_consecutive_work: 6   // 最多連續上班天數
    }
};
```

### **調整建議**

| 場景 | 世代數 | 備註 |
|------|------|------|
| **快速測試** | 50-100 | 執行時間 5-8秒 |
| **標準排班** | 150 | 執行時間 12-15秒 (預設) |
| **高品質排班** | 200-300 | 執行時間 20-30秒 |
| **極致優化** | 500+ | 執行時間 > 1分鐘 |

---

## 📝 輸出示例

### **Console 輸出**

```
🧬 SchedulerV4 初始化 (改良式基因演算法)
🧬 SchedulerV4 排班開始 (基因演算法)
  族群大小: 60, 世代數: 150
  🌱 初始化族群...
  ✅ 族群初始化完成
  世代 1/150: 最佳=8450.2, 平均=7823.5, 突變率=5.0%
  世代 20/150: 最佳=8892.7, 平均=8456.3, 突變率=4.3%
  世代 40/150: 最佳=9234.1, 平均=8789.2, 突變率=3.7%
  世代 60/150: 最佳=9456.8, 平均=9012.4, 突變率=3.0%
  世代 80/150: 最佳=9567.3, 平均=9145.7, 突變率=2.3%
  世代 100/150: 最佳=9623.9, 平均=9234.5, 突變率=1.7%
  世代 120/150: 最佳=9658.2, 平均=9298.1, 突變率=1.0%
  世代 140/150: 最佳=9673.5, 平均=9334.6, 突變率=0.3%
  世代 150/150: 最佳=9678.1, 平均=9351.2, 突變率=0.0%
✅ SchedulerV4 完成: 13.45秒
  最佳適應度: 9678.1
  改善幅度: 14.5%
```

### **適應度解讀**

適應度值越高越好：
- **> 9500**: 優秀 ⭐⭐⭐⭐⭐
- **8500-9500**: 良好 ⭐⭐⭐⭐
- **7500-8500**: 合格 ⭐⭐⭐
- **< 7500**: 需要改進 ⚠️

---

## 🛠️ 進階功能

### **1. 查看詳細指標**

```javascript
const scheduler = new SchedulerV4(allStaff, year, month, lastMonthData, rules);
const schedule = scheduler.run();

// 查看最佳解的指標
console.log('最佳解指標:', scheduler.bestSolution.metrics);
// {
//   hardViolations: 0,
//   softViolations: 2,
//   fairness: 87.3,
//   preference: 91.2,
//   staffing: 98.5
// }
```

### **2. 查看進化趨勢**

```javascript
// 查看每世代的適應度變化
console.log('最佳適應度趨勢:', scheduler.stats.generationBestFitness);
console.log('平均適應度趨勢:', scheduler.stats.generationAvgFitness);

// 可用於繪製進化曲線圖
```

### **3. 自定義適應度權重**

在 `evaluateFitness()` 方法中調整權重：

```javascript
// 在 SchedulerV4.js 中
let fitness = 10000;
fitness -= hardViolations * 1000;  // 可調整
fitness -= softViolations * 50;    // 可調整
fitness += fairness * 10;          // 可調整
fitness += preference * 5;         // 可調整
fitness += staffing * 20;          // 可調整
```

---

## ⚠️ 注意事項

1. **執行時間**
   - V4 需要 12-15秒，比 V3 長
   - 建議在重要排班或初次排班時使用

2. **記憶體使用**
   - 族群越大，記憶體使用越高
   - 預設設定已優化，一般情況無需擔心

3. **結果随機性**
   - GA 具有随機性，每次執行結果可能略有不同
   - 但品質都會在高水準

4. **規則設定**
   - 確保 `rules.staff.min_off_days` 和 `max_consecutive_work` 正確設定
   - 這些是硬限制，影響排班可行性

---

## 🐛 常見問題

### Q1: 為什麼 V4 這麼慢？
**A:** V4 使用進化演算法，需要評估多代族群。如果需要更快，可以：
- 減少 `ga_generations` (例如 100)
- 或使用 V3 進行快速排班

### Q2: V4 能保證沒有違規嗎？
**A:** V4 會盡力避免違規，但不保證零違規。如果需求太苛刻或人員不足，可能會有少量軟違規。

### Q3: 如何選擇 V3 或 V4？
**A:** 
- **使用 V3**: 日常排班、需要快速結果
- **使用 V4**: 重要排班、需要最佳品質、願意等待

### Q4: 可以同時執行 V3 和 V4 比較嗎？
**A:** 可以！未來我們會提供比較模式，同時執行多個演算法並顯示比較結果。

---

## 📚 相關文檔

- [SchedulerV3 說明](./SchedulerV3_README.md)
- [WhitelistCalculator 使用指南](./WhitelistCalculator_README.md)
- [HardRuleValidator 規則說明](./HardRuleValidator_README.md)

---

## 📧 聯絡與回饋

如有任何問題或建議，歡迎透過 GitHub Issues 聯絡我們！

---

**版本**: 1.0.0  
**更新日期**: 2026-02-17  
**作者**: Nurse Scheduler Team