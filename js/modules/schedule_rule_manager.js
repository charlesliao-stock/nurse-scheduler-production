// js/modules/schedule_rule_manager.js
// 🔧 修正版：讀取權重設定 (Must/Try) 與手動救火開關

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        await this.loadUnitDropdown();
        
        // 監聽時間區間變化
        const startInput = document.getElementById('rule_nightStart');
        const endInput = document.getElementById('rule_nightEnd');
        if (startInput && endInput) {
            const updateList = () => {
                const rules = { policy: { noNightAfterOff_List: this.getCheckedNightLimits() } };
                this.renderNightShiftOptions(rules.policy.noNightAfterOff_List);
            };
            startInput.onchange = updateList;
            endInput.onchange = updateList;
        }
    },

    loadUnitDropdown: async function() {
        const select = document.getElementById('ruleUnitSelect');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            
            select.onchange = () => {
                this.currentUnitId = select.value;
                if(this.currentUnitId) this.loadDataToForm();
            };

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change'));
            }

        } catch (e) { console.error(e); }
    },

    loadDataToForm: async function() {
        if(!this.currentUnitId) return;
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if(!doc.exists) return;
            const data = doc.data();
            const r = data.schedulingRules || {};

            // Helper
            const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };

            // Hard
            setCheck('rule_minGap11', r.hard?.minGap11 !== false);
            setCheck('rule_maxDiversity3', r.hard?.maxDiversity3 !== false);
            setCheck('rule_protectPregnant', r.hard?.protectPregnant !== false);
            setCheck('rule_twoOffPerFortnight', r.hard?.twoOffPerFortnight !== false);
            setVal('rule_offGapMax', r.hard?.offGapMax || 12);
            setVal('rule_weekStartDay', r.hard?.weekStartDay || 1);

            // Policy
            setCheck('rule_limitConsecutive', r.policy?.limitConsecutive !== false);
            setVal('rule_maxConsDays', r.policy?.maxConsDays || 6);
            setCheck('rule_bundleNightOnly', r.policy?.bundleNightOnly !== false);
            setCheck('rule_noNightAfterOff', r.policy?.noNightAfterOff !== false);
            
            // 🆕 權重設定 (Must/Try)
            setVal('rule_prioritize_bundle', r.policy?.prioritizeBundle || 'must');
            setVal('rule_prioritize_pref', r.policy?.prioritizePref || 'must');

            // 救火模式 (預設關閉)
            setCheck('rule_enableRelaxation', r.policy?.enableRelaxation === true);

            // Night shift limits
            if(r.policy?.noNightAfterOff_List) {
                this.renderNightShiftOptions(r.policy.noNightAfterOff_List);
            } else {
                this.renderNightShiftOptions([]);
            }

            // Pattern
            setVal('rule_dayStartShift', r.pattern?.dayStartShift || 'D');
            setVal('rule_rotationOrder', r.pattern?.rotationOrder || 'OFF,N,E,D');
            setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
            setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
            setCheck('rule_avoidLonelyOff', r.pattern?.avoidLonelyOff !== false);

            // Fairness
            setCheck('rule_fairOff', r.fairness?.fairOff !== false);
            setVal('rule_fairOffVar', r.fairness?.fairOffVar || 2);
            setCheck('rule_fairNight', r.fairness?.fairNight !== false);
            setVal('rule_fairNightVar', r.fairness?.fairNightVar || 2);
            setVal('rule_fairBalanceRounds', r.fairness?.balanceRounds || 100);

            // AI Params
            setVal('ai_backtrack_depth', r.aiParams?.backtrack_depth || 3);
            setVal('ai_max_attempts', r.aiParams?.max_attempts || 20);

        } catch (e) { console.error(e); }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const getInt = (id, def) => { const v = parseInt(getVal(id)); return isNaN(v) ? def : v; };

        const nightLimits = this.getCheckedNightLimits();

        const rules = {
            hard: {
                minGap11: getCheck('rule_minGap11'),
                maxDiversity3: getCheck('rule_maxDiversity3'),
                protectPregnant: getCheck('rule_protectPregnant'),
                twoOffPerFortnight: getCheck('rule_twoOffPerFortnight'),
                offGapMax: getInt('rule_offGapMax', 12),
                weekStartDay: getInt('rule_weekStartDay', 1)
            },
            policy: {
                limitConsecutive: getCheck('rule_limitConsecutive'),
                maxConsDays: getInt('rule_maxConsDays', 6),
                bundleNightOnly: getCheck('rule_bundleNightOnly'),
                noNightAfterOff: getCheck('rule_noNightAfterOff'),
                noNightAfterOff_List: nightLimits,
                
                // 🆕 儲存權重設定
                prioritizeBundle: getVal('rule_prioritize_bundle'), 
                prioritizePref: getVal('rule_prioritize_pref'),
                
                // 救火模式 (必須手動開啟)
                enableRelaxation: getCheck('rule_enableRelaxation') 
            },
            pattern: {
                dayStartShift: getVal('rule_dayStartShift'),
                rotationOrder: getVal('rule_rotationOrder'),
                consecutivePref: getCheck('rule_consecutivePref'),
                minConsecutive: getInt('rule_minConsecutive', 2),
                avoidLonelyOff: getCheck('rule_avoidLonelyOff')
            },
            fairness: {
                fairOff: getCheck('rule_fairOff'),
                fairOffVar: getInt('rule_fairOffVar', 2),
                fairNight: getCheck('rule_fairNight'),
                fairNightVar: getInt('rule_fairNightVar', 2),
                balanceRounds: getInt('rule_fairBalanceRounds', 100)
            },
            aiParams: {
                backtrack_depth: getInt('ai_backtrack_depth', 3),
                max_attempts: getInt('ai_max_attempts', 20)
            }
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: rules,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("規則已儲存成功！");
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    renderNightShiftOptions: async function(checkedCodes) {
        const container = document.getElementById('nightShiftOptions');
        if(!container) return;
        container.innerHTML = '載入中...';
        
        if (!this.activeShifts.length && this.currentUnitId) {
             const snap = await db.collection('shifts').where('unitId','==',this.currentUnitId).get();
             this.activeShifts = snap.docs.map(d => d.data());
        }

        container.innerHTML = '';
        this.activeShifts.forEach(s => {
            const isChecked = checkedCodes.includes(s.code);
            const div = document.createElement('div');
            div.innerHTML = `
                <label style="display:inline-flex; align-items:center;">
                    <input type="checkbox" value="${s.code}" class="night-limit-chk" ${isChecked?'checked':''}>
                    <span style="margin-left:4px; font-size:0.9rem;">${s.code}</span>
                </label>
            `;
            container.appendChild(div);
        });
    },

    getCheckedNightLimits: function() {
        const chks = document.querySelectorAll('.night-limit-chk:checked');
        return Array.from(chks).map(c => c.value);
    },

    switchTab: function(tabName) {
        const wrapper = document.querySelector('.tab-content-wrapper');
        if(wrapper) {
            wrapper.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById(`tab-${tabName}`);
            if(target) target.classList.add('active');
        }
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(tabName)) btn.classList.add('active');
        });
    }
};
