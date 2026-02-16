// js/modules/ai_scheduler_comparison.js
// AI排班多版本比較模組

const AISchedulerComparison = {
    
    /**
     * 顯示比較對話框
     */
    showComparisonDialog: async function(allStaff, year, month, lastMonthData, rules, onSelectCallback) {
        console.log('📦 開啟 AI 排班比較模式');
        
        // 建立對話框
        const dialog = this.createDialog();
        document.body.appendChild(dialog);
        
        // 顯示載入中
        this.showLoading(dialog);
        
        try {
            // 執行所有演算法
            const results = await SchedulerFactory.runMultiple(
                ['V3', 'V4', 'V5', 'V6'],
                allStaff,
                year,
                month,
                lastMonthData,
                rules
            );
            
            // 顯示結果
            this.showResults(dialog, results, onSelectCallback);
            
        } catch (error) {
            console.error('❌ 比較模式失敗:', error);
            this.showError(dialog, error.message);
        }
    },
    
    /**
     * 建立對話框
     */
    createDialog: function() {
        const overlay = document.createElement('div');
        overlay.id = 'ai-comparison-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            backdrop-filter: blur(4px);
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 16px;
            padding: 32px;
            max-width: 1200px;
            width: 95%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;
        
        overlay.appendChild(dialog);
        return overlay;
    },
    
    /**
     * 顯示載入中
     */
    showLoading: function(dialog) {
        const content = dialog.querySelector('div');
        content.innerHTML = `
            <div style="text-align: center; padding: 60px 0;">
                <div style="font-size: 48px; margin-bottom: 20px;">🧬</div>
                <h2 style="margin-bottom: 16px; color: #333;">🚀 AI 排班比較中</h2>
                <p style="color: #666; font-size: 16px; margin-bottom: 30px;">
                    正在同時執行 4 種演算法，預計需要 30-50 秒...
                </p>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 600px; margin: 0 auto;">
                    <div class="algo-status" data-algo="V3" style="padding: 16px; border: 2px solid #e0e0e0; border-radius: 12px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔄</div>
                        <div style="font-weight: 600; margin-bottom: 4px;">V3 回溯法</div>
                        <div class="status-text" style="color: #ffa500; font-size: 14px;">⚙️ 執行中...</div>
                    </div>
                    
                    <div class="algo-status" data-algo="V4" style="padding: 16px; border: 2px solid #e0e0e0; border-radius: 12px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🧬</div>
                        <div style="font-weight: 600; margin-bottom: 4px;">V4 基因演算法</div>
                        <div class="status-text" style="color: #999; font-size: 14px;">⏳ 等待中...</div>
                    </div>
                    
                    <div class="algo-status" data-algo="V5" style="padding: 16px; border: 2px solid #e0e0e0; border-radius: 12px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔢</div>
                        <div style="font-weight: 600; margin-bottom: 4px;">V5 IP+GA</div>
                        <div class="status-text" style="color: #999; font-size: 14px;">⏳ 等待中...</div>
                    </div>
                    
                    <div class="algo-status" data-algo="V6" style="padding: 16px; border: 2px solid #e0e0e0; border-radius: 12px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">⚡</div>
                        <div style="font-weight: 600; margin-bottom: 4px;">V6 混合式</div>
                        <div class="status-text" style="color: #999; font-size: 14px;">⏳ 等待中...</div>
                    </div>
                </div>
                
                <div style="margin-top: 30px;">
                    <div class="progress-bar" style="width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
                        <div class="progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #2196F3); transition: width 0.3s;"></div>
                    </div>
                </div>
            </div>
        `;
        
        // 模擬進度更新
        this.simulateProgress(content);
    },
    
    /**
     * 模擬進度更新
     */
    simulateProgress: function(content) {
        const progressFill = content.querySelector('.progress-fill');
        const algos = ['V3', 'V4', 'V5', 'V6'];
        let currentAlgo = 0;
        let progress = 0;
        
        const interval = setInterval(() => {
            progress += Math.random() * 3;
            if (progress > 100) progress = 100;
            
            progressFill.style.width = progress + '%';
            
            // 更新演算法狀態
            const algoProgress = Math.floor(progress / 25);
            if (algoProgress > currentAlgo) {
                if (currentAlgo > 0) {
                    const prevStatus = content.querySelector(`.algo-status[data-algo="${algos[currentAlgo - 1]}"]`);
                    const prevText = prevStatus.querySelector('.status-text');
                    prevText.textContent = '✅ 完成';
                    prevText.style.color = '#4CAF50';
                    prevStatus.style.borderColor = '#4CAF50';
                }
                
                if (algoProgress < algos.length) {
                    const currentStatus = content.querySelector(`.algo-status[data-algo="${algos[algoProgress]}"]`);
                    const currentText = currentStatus.querySelector('.status-text');
                    currentText.textContent = '⚙️ 執行中...';
                    currentText.style.color = '#ffa500';
                    currentStatus.style.borderColor = '#ffa500';
                }
                
                currentAlgo = algoProgress;
            }
            
            if (progress >= 100) {
                clearInterval(interval);
            }
        }, 300);
    },
    
    /**
     * 顯示結果
     */
    showResults: function(dialog, results, onSelectCallback) {
        const content = dialog.querySelector('div');
        
        // 排序: 由高到低
        results.sort((a, b) => {
            if (!a.success) return 1;
            if (!b.success) return -1;
            return parseFloat(b.metrics.overallScore) - parseFloat(a.metrics.overallScore);
        });
        
        const bestAlgo = results[0];
        
        content.innerHTML = `
            <div style="margin-bottom: 24px;">
                <h2 style="font-size: 28px; margin-bottom: 8px; color: #333;">
                    🏆 AI 排班比較結果
                </h2>
                <p style="color: #666; font-size: 16px;">
                    已完成 4 種演算法的排班，請選擇最適合的方案
                </p>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 24px;">
                ${results.map((result, index) => this.renderResultCard(result, index === 0)).join('')}
            </div>
            
            <div style="margin-top: 24px; padding: 20px; background: #f5f5f5; border-radius: 12px;">
                <h3 style="margin-bottom: 12px; font-size: 18px;">💡 建議</h3>
                <p style="color: #555; line-height: 1.6;">
                    ${this.getRecommendation(bestAlgo)}
                </p>
            </div>
            
            <div style="text-align: center; margin-top: 24px;">
                <button id="close-comparison" style="
                    padding: 12px 32px;
                    background: #e0e0e0;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                    transition: all 0.2s;
                ">
                    取消
                </button>
            </div>
        `;
        
        // 綁定事件
        results.forEach((result, index) => {
            if (result.success) {
                const btn = content.querySelector(`#select-${result.strategy}`);
                btn.addEventListener('click', () => {
                    onSelectCallback(result.schedule, result.strategy);
                    this.closeDialog(dialog);
                });
            }
        });
        
        content.querySelector('#close-comparison').addEventListener('click', () => {
            this.closeDialog(dialog);
        });
    },
    
    /**
     * 渲染結果卡片
     */
    renderResultCard: function(result, isBest) {
        if (!result.success) {
            return `
                <div style="
                    padding: 24px;
                    border: 2px solid #f44336;
                    border-radius: 12px;
                    background: #ffebee;
                ">
                    <div style="font-size: 32px; margin-bottom: 12px;">❌</div>
                    <h3 style="font-size: 20px; margin-bottom: 8px;">${result.strategy}</h3>
                    <p style="color: #d32f2f;">排班失敗: ${result.error}</p>
                </div>
            `;
        }
        
        const metrics = result.metrics;
        const borderColor = isBest ? '#4CAF50' : '#e0e0e0';
        const bgColor = isBest ? '#e8f5e9' : '#ffffff';
        
        return `
            <div style="
                padding: 24px;
                border: 3px solid ${borderColor};
                border-radius: 12px;
                background: ${bgColor};
                position: relative;
                transition: all 0.2s;
                cursor: pointer;
            " class="result-card" onmouseover="this.style.boxShadow='0 8px 24px rgba(0,0,0,0.15)'" onmouseout="this.style.boxShadow='none'">
                ${isBest ? '<div style="position: absolute; top: 12px; right: 12px; background: #4CAF50; color: white; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 600;">⭐ 最佳</div>' : ''}
                
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 36px; margin-bottom: 8px;">${this.getAlgoIcon(result.strategy)}</div>
                    <h3 style="font-size: 20px; margin-bottom: 4px; font-weight: 600;">${result.strategy}</h3>
                    <p style="color: #666; font-size: 14px;">${result.description}</p>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 14px; color: #666;">綜合評分</span>
                        <span style="font-size: 24px; font-weight: 700; color: ${this.getScoreColor(parseFloat(metrics.overallScore))};">  ${metrics.overallScore}</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
                        <div style="width: ${metrics.overallScore}%; height: 100%; background: ${this.getScoreColor(parseFloat(metrics.overallScore))};"></div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div style="padding: 8px; background: white; border-radius: 8px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">人力達成</div>
                        <div style="font-size: 16px; font-weight: 600; color: #2196F3;">${metrics.staffingRate}</div>
                    </div>
                    <div style="padding: 8px; background: white; border-radius: 8px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">偏好滿足</div>
                        <div style="font-size: 16px; font-weight: 600; color: #9C27B0;">${metrics.preferenceScore}</div>
                    </div>
                    <div style="padding: 8px; background: white; border-radius: 8px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">公平性</div>
                        <div style="font-size: 16px; font-weight: 600; color: #FF9800;">${metrics.fairnessScore}</div>
                    </div>
                    <div style="padding: 8px; background: white; border-radius: 8px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">執行時間</div>
                        <div style="font-size: 16px; font-weight: 600; color: #607D8B;">${result.executionTime}s</div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
                    <div style="padding: 6px; background: ${metrics.hardViolations === 0 ? '#e8f5e9' : '#ffebee'}; border-radius: 6px; font-size: 13px; text-align: center;">
                        ${metrics.hardViolations === 0 ? '✅' : '⚠️'} 硬限制: ${metrics.hardViolations}
                    </div>
                    <div style="padding: 6px; background: ${parseFloat(metrics.softViolations) < 2 ? '#e8f5e9' : '#fff3e0'}; border-radius: 6px; font-size: 13px; text-align: center;">
                        ${parseFloat(metrics.softViolations) < 2 ? '✅' : '🟡'} 軟限制: ${metrics.softViolations}
                    </div>
                </div>
                
                <button id="select-${result.strategy}" style="
                    width: 100%;
                    padding: 14px;
                    background: ${isBest ? '#4CAF50' : '#2196F3'};
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                    ${isBest ? '✨ 選擇最佳方案' : '👉 選擇此方案'}
                </button>
            </div>
        `;
    },
    
    /**
     * 獲取演算法圖示
     */
    getAlgoIcon: function(strategy) {
        const icons = {
            'V3': '🔄',
            'V4': '🧬',
            'V5': '🔢',
            'V6': '⚡'
        };
        return icons[strategy] || '🤖';
    },
    
    /**
     * 獲取分數顏色
     */
    getScoreColor: function(score) {
        if (score >= 80) return '#4CAF50';
        if (score >= 60) return '#FFC107';
        if (score >= 40) return '#FF9800';
        return '#f44336';
    },
    
    /**
     * 獲取建議
     */
    getRecommendation: function(bestResult) {
        if (!bestResult.success) {
            return '所有演算法均失敗，請檢查排班規則與人員設定。';
        }
        
        const strategy = bestResult.strategy;
        const recommendations = {
            'V3': 'V3 回溯法是最快的選擇，適合日常排班使用。若需要更高品質，建議選擇 V4 或 V6。',
            'V4': 'V4 基因演算法提供最佳的排班品質，特別在偏好滿足度方面表現優異。適合重要排班或複雜情況。',
            'V5': 'V5 兩階段法在公平性方面表現最佳，能確保每位員工的休假均衡分配。適合追求公平性的場景。',
            'V6': 'V6 混合式演算法在速度與品質間取得平衡，是大多數情況下的優選。約 10 秒內即可獲得高品質排班。'
        };
        
        return recommendations[strategy] || '請選擇最適合您需求的排班方案。';
    },
    
    /**
     * 顯示錯誤
     */
    showError: function(dialog, errorMessage) {
        const content = dialog.querySelector('div');
        content.innerHTML = `
            <div style="text-align: center; padding: 60px 0;">
                <div style="font-size: 64px; margin-bottom: 20px;">❌</div>
                <h2 style="margin-bottom: 16px; color: #f44336;">排班失敗</h2>
                <p style="color: #666; font-size: 16px; margin-bottom: 30px;">
                    ${errorMessage}
                </p>
                <button id="close-error" style="
                    padding: 12px 32px;
                    background: #f44336;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                ">
                    關閉
                </button>
            </div>
        `;
        
        content.querySelector('#close-error').addEventListener('click', () => {
            this.closeDialog(dialog);
        });
    },
    
    /**
     * 關閉對話框
     */
    closeDialog: function(dialog) {
        dialog.style.opacity = '0';
        setTimeout(() => {
            dialog.remove();
        }, 300);
    }
};

console.log('✅ AISchedulerComparison 已載入');
