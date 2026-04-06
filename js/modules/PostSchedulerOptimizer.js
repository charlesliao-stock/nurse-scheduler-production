// js/modules/PostSchedulerOptimizer.js
// 負責 AI 排班後的優化處理與單位專屬規則檢查

const PostSchedulerOptimizer = {
    // 優化選項定義
    options: [
        { id: 'balance_night_shifts', name: '平衡夜班分配', description: '確保夜班在人員間分配更平均', default: true },
        { id: 'minimize_isolated_work', name: '減少單日上班', description: '盡量避免單獨一天的上班（夾在休假中間）', default: false },
        { id: 'prefer_long_off', name: '優先安排長假', description: '在滿足人力需求下，優先保留連續休假', default: true },
        { id: 'fairness_score_weight', name: '提高公平性權重', description: '在評分時給予公平性更高的權重', default: false }
    ],

    /**
     * 渲染優化選項介面
     * @param {HTMLElement} container 容器元素
     */
    renderOptions: function(container) {
        if (!container) return;
        
        let html = `
        <div class="optimizer-options" style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef;">
            <h4 style="margin-top: 0; margin-bottom: 10px; font-size: 16px; color: #2c3e50;">
                <i class="fas fa-magic"></i> AI 優化選項
            </h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        `;
        
        this.options.forEach(opt => {
            html += `
                <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
                    <input type="checkbox" id="opt_${opt.id}" ${opt.default ? 'checked' : ''} style="margin-right: 8px;">
                    <span title="${opt.description}">${opt.name}</span>
                </label>
            `;
        });
        
        html += `
            </div>
        </div>
        `;
        
        container.innerHTML = html;
    },

    /**
     * 獲取當前勾選的優化選項
     */
    getSelectedOptions: function() {
        const selected = {};
        this.options.forEach(opt => {
            const el = document.getElementById(`opt_${opt.id}`);
            selected[opt.id] = el ? el.checked : opt.default;
        });
        return selected;
    },

    /**
     * 執行優化邏輯 (這通常會與後端或 AI 核心配合)
     * @param {Object} schedule 當前班表資料
     * @param {Object} rules 單位規則
     * @returns {Object} 優化後的班表
     */
    optimize: function(schedule, rules) {
        const selectedOptions = this.getSelectedOptions();
        console.log('🚀 執行優化，選項:', selectedOptions);
        
        // 這裡實作前端能做的簡單優化，或標記需要 AI 重新計算的部分
        // 目前先作為介面整合與邏輯框架
        
        return schedule;
    },

    /**
     * 計算特定單位的優化評分
     * @param {Object} assignments 班表分配
     * @param {Object} unitRules 單位規則
     */
    calculateOptimizationScore: function(assignments, unitRules) {
        // 實作單位專屬的評分邏輯
        let score = 100;
        let deductions = [];
        
        // 範例：檢查夜班平衡
        // ... 邏輯實作 ...
        
        return {
            score: Math.max(0, score),
            deductions: deductions
        };
    }
};
