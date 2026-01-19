// js/modules/score_settings_manager.js
// 班表評分設定管理器

const scoreSettingsManager = {
    currentUnitId: null,
    
    init: async function() {
        console.log("Score Settings Manager Loaded.");
        
        // 權限檢查
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法存取評分設定</p>
                </div>
            `;
            return;
        }

        await this.loadUnitDropdown();
        this.setupWeightSliders();
    },

    // 載入單位下拉選單
    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
        if(!select) {
            console.error("找不到 scoreUnitSelect 元素");
            return;
        }

        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            
            // 權限過濾
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            
            console.log(`載入 ${snapshot.size} 個單位`);
            
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });

            // 綁定事件 (先移除舊事件避免重複)
            select.onchange = null;
            select.addEventListener('change', () => {
                this.onUnitChange();
            });

            // 如果只有一個單位,自動選擇
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                // 手動觸發事件
                const event = new Event('change');
                select.dispatchEvent(event);
            }
            
        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
            alert("載入單位失敗: " + e.message);
        }
    },

    // 單位切換
    onUnitChange: async function() {
        const select = document.getElementById('scoreUnitSelect');
        const unitId = select.value;
        
        if (!unitId) {
            document.getElementById('scoreSettingsContainer').style.display = 'none';
            return;
        }

        this.currentUnitId = unitId;
        document.getElementById('scoreSettingsContainer').style.display = 'block';

        await this.loadSettings();
    },

    // 載入設定
    loadSettings: async function() {
        if(!this.currentUnitId) return;

        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if(!doc.exists) return;

            const data = doc.data();
            const settings = data.scoreSettings || this.getDefaultSettings();

            // 填入權重
            const weights = settings.weights || {};
            document.getElementById('weight_efficiency').value = weights.efficiency || 40;
            document.getElementById('weight_fatigue').value = weights.fatigue || 25;
            document.getElementById('weight_satisfaction').value = weights.satisfaction || 20;
            document.getElementById('weight_fairness').value = weights.fairness || 10;
            document.getElementById('weight_cost').value = weights.cost || 5;

            // 填入閾值
            const thresholds = settings.thresholds || {};
            document.getElementById('threshold_maxConsecutive').value = thresholds.maxConsecutive || 6;
            document.getElementById('threshold_fatigueLevel').value = thresholds.fatigueLevel || 'moderate';
            document.getElementById('threshold_offStdDev').value = thresholds.offStdDev || 1.5;
            document.getElementById('threshold_gapTolerance').value = thresholds.gapTolerance || 5;

            this.updateWeightDisplay();

        } catch (e) {
            console.error("Load Settings Error:", e);
            alert("載入設定失敗: " + e.message);
        }
    },

    // 預設設定
    getDefaultSettings: function() {
        return {
            weights: {
                efficiency: 40,
                fatigue: 25,
                satisfaction: 20,
                fairness: 10,
                cost: 5
            },
            thresholds: {
                maxConsecutive: 6,
                fatigueLevel: 'moderate',
                offStdDev: 1.5,
                gapTolerance: 5
            }
        };
    },

    // 設定滑桿事件
    setupWeightSliders: function() {
        const sliders = ['efficiency', 'fatigue', 'satisfaction', 'fairness', 'cost'];
        sliders.forEach(name => {
            const slider = document.getElementById(`weight_${name}`);
            if(slider) {
                slider.addEventListener('input', () => this.updateWeightDisplay());
            }
        });
    },

    // 更新權重顯示
    updateWeightDisplay: function() {
        const weights = {
            efficiency: parseInt(document.getElementById('weight_efficiency')?.value || 0),
            fatigue: parseInt(document.getElementById('weight_fatigue')?.value || 0),
            satisfaction: parseInt(document.getElementById('weight_satisfaction')?.value || 0),
            fairness: parseInt(document.getElementById('weight_fairness')?.value || 0),
            cost: parseInt(document.getElementById('weight_cost')?.value || 0)
        };

        // 更新顯示值
        Object.keys(weights).forEach(key => {
            const display = document.getElementById(`display_${key}`);
            if(display) display.textContent = `${weights[key]}%`;
        });

        // 計算總和
        const total = Object.values(weights).reduce((sum, val) => sum + val, 0);
        const totalElement = document.getElementById('totalWeight');
        const warningElement = document.getElementById('weightWarning');

        if(totalElement) {
            totalElement.textContent = `${total}%`;
            totalElement.style.color = total === 100 ? '#27ae60' : '#e74c3c';
        }

        if(warningElement) {
            warningElement.style.display = total !== 100 ? 'block' : 'none';
        }

        return total === 100;
    },

    // 儲存設定
    saveData: async function() {
        if(!this.currentUnitId) {
            alert("請先選擇單位");
            return;
        }

        // 驗證權重總和
        if(!this.updateWeightDisplay()) {
            alert("權重總和必須為 100%,請調整後再儲存。");
            this.switchTab('weights');
            return;
        }

        const settings = {
            weights: {
                efficiency: parseInt(document.getElementById('weight_efficiency').value),
                fatigue: parseInt(document.getElementById('weight_fatigue').value),
                satisfaction: parseInt(document.getElementById('weight_satisfaction').value),
                fairness: parseInt(document.getElementById('weight_fairness').value),
                cost: parseInt(document.getElementById('weight_cost').value)
            },
            thresholds: {
                maxConsecutive: parseInt(document.getElementById('threshold_maxConsecutive').value),
                fatigueLevel: document.getElementById('threshold_fatigueLevel').value,
                offStdDev: parseFloat(document.getElementById('threshold_offStdDev').value),
                gapTolerance: parseInt(document.getElementById('threshold_gapTolerance').value)
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                scoreSettings: settings
            });

            alert("✅ 評分設定已儲存成功!");
            
            // 同步更新 scoringManager (如果存在)
            if(typeof scoringManager !== 'undefined') {
                scoringManager.loadSettings(this.currentUnitId);
            }

        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    // 切換頁籤
    switchTab: function(tabName) {
        const wrapper = document.querySelector('.tab-content-wrapper');
        if(wrapper) {
            wrapper.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${tabName}`)?.classList.add('active');
        }
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.dataset.tab === tabName) btn.classList.add('active');
        });
    }
};
