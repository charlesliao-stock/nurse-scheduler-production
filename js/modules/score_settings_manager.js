// js/modules/score_settings_manager.js (完整版)

const scoreSettingsManager = {
    currentUnitId: null,
    
    init: async function() {
        console.log("🎯 Score Settings Manager Init START");
        console.log("當前用戶角色:", app.userRole);
        
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

        // 延遲確認元素存在
        let retryCount = 0;
        const checkElement = () => {
            const select = document.getElementById('scoreUnitSelect');
            if (!select) {
                retryCount++;
                if (retryCount < 10) {
                    console.warn(`⏳ 等待元素載入... (${retryCount}/10)`);
                    setTimeout(checkElement, 100);
                } else {
                    console.error("❌ scoreUnitSelect 元素始終不存在!");
                }
                return;
            }
            
            console.log("✅ 找到 scoreUnitSelect 元素");
            this.loadUnitDropdown();
            this.setupWeightSliders();
            console.log("🎯 Score Settings Manager Init COMPLETE");
        };
        
        checkElement();
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('scoreUnitSelect');
        if(!select) {
            console.error("❌ loadUnitDropdown: 找不到 scoreUnitSelect");
            return;
        }

        console.log("📥 開始載入單位列表...");
        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            
            // 權限過濾
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                console.log("權限過濾:", app.userUnitId);
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            
            console.log(`✅ Firestore 查詢成功,共 ${snapshot.size} 個單位`);
            
            if (snapshot.empty) {
                select.innerHTML = '<option value="">無單位資料</option>';
                console.warn("⚠️ 資料庫中沒有單位");
                return;
            }
            
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            let unitCount = 0;
            snapshot.forEach(doc => {
                const unitData = doc.data();
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = unitData.name || doc.id;
                select.appendChild(option);
                unitCount++;
                console.log(`  - 單位 ${unitCount}: ${doc.id} (${unitData.name})`);
            });

            console.log(`✅ 成功載入 ${unitCount} 個單位選項`);

            // 移除舊事件
            select.onchange = null;
            
            // 綁定新事件
            select.addEventListener('change', async (e) => {
                console.log("📌 單位選擇事件觸發:", e.target.value);
                await this.onUnitChange();
            });

            // 如果只有一個單位,自動選擇
            if (snapshot.size === 1) {
                console.log("🔄 自動選擇唯一單位");
                select.selectedIndex = 1;
                await this.onUnitChange();
            }
            
        } catch (e) {
            console.error("❌ 載入單位失敗:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
            alert("載入單位失敗: " + e.message);
        }
    },

    onUnitChange: async function() {
        const select = document.getElementById('scoreUnitSelect');
        const container = document.getElementById('scoreSettingsContainer');
        
        if(!select || !container) {
            console.error("❌ 找不到必要元素:", { select: !!select, container: !!container });
            return;
        }
        
        const unitId = select.value;
        console.log("📌 單位切換處理:", unitId);
        
        if (!unitId) {
            container.style.display = 'none';
            console.log("隱藏設定容器 (未選擇單位)");
            return;
        }

        this.currentUnitId = unitId;
        container.style.display = 'block';
        console.log("顯示設定容器");

        await this.loadSettings();
    },

    loadSettings: async function() {
        if(!this.currentUnitId) {
            console.warn("⚠️ loadSettings: currentUnitId 為空");
            return;
        }

        console.log("📥 載入單位設定:", this.currentUnitId);

        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            
            if(!doc.exists) {
                console.warn("⚠️ 單位文件不存在");
                return;
            }

            const data = doc.data();
            const settings = data.scoreSettings || this.getDefaultSettings();

            console.log("✅ 載入評分設定:", settings);

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
            console.error("❌ 載入設定失敗:", e);
            alert("載入設定失敗: " + e.message);
        }
    },

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

    setupWeightSliders: function() {
        const sliders = ['efficiency', 'fatigue', 'satisfaction', 'fairness', 'cost'];
        sliders.forEach(name => {
            const slider = document.getElementById(`weight_${name}`);
            if(slider) {
                slider.addEventListener('input', () => this.updateWeightDisplay());
            }
        });
    },

    updateWeightDisplay: function() {
        const weights = {
            efficiency: parseInt(document.getElementById('weight_efficiency')?.value || 0),
            fatigue: parseInt(document.getElementById('weight_fatigue')?.value || 0),
            satisfaction: parseInt(document.getElementById('weight_satisfaction')?.value || 0),
            fairness: parseInt(document.getElementById('weight_fairness')?.value || 0),
            cost: parseInt(document.getElementById('weight_cost')?.value || 0)
        };

        Object.keys(weights).forEach(key => {
            const display = document.getElementById(`display_${key}`);
            if(display) display.textContent = `${weights[key]}%`;
        });

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

    saveData: async function() {
        if(!this.currentUnitId) {
            alert("請先選擇單位");
            return;
        }

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
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.currentUnitId);
            }

        } catch (e) {
            console.error("❌ 儲存失敗:", e);
            alert("儲存失敗: " + e.message);
        }
    },

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
