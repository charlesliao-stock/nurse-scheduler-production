// js/modules/schedule_rule_manager.js
// 🔧 修正版：恢復預班/勿排權重設定 + 夜班動態過濾邏輯

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        
        const container = document.getElementById('rulesContainer');
        if(container) container.style.display = 'none';

        await this.loadUnitDropdown();
        
        // 監聽時間區間變化 -> 觸發動態重繪
        const startInput = document.getElementById('rule_nightStart');
        const endInput = document.getElementById('rule_nightEnd');
        if (startInput && endInput) {
            const updateList = () => {
                // 取得當前勾選的項目 (避免重繪時被清空)
                const currentChecked = this.getCheckedNightLimits();
                this.renderNightShiftOptions(currentChecked);
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
                if(this.currentUnitId) {
                    this.loadDataToForm();
                } else {
                    const container = document.getElementById('rulesContainer');
                    if(container) container.style.display = 'none';
                }
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
            // 先載入該單位的班別 (為了夜班過濾功能)
            const shiftSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());

            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if(!doc.exists) return;
            const data = doc.data();
            const r = data.schedulingRules || {};

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
            
            // 權重設定 (恢復 4 個選項)
            setVal('rule_prioritize_bundle', r.policy?.prioritizeBundle || 'must');
            setVal('rule_prioritize_pref', r.policy?.prioritizePref || 'must');
            setVal('rule_prioritize_prereq', r.policy?.prioritizePreReq || 'must'); // 🆕
            setVal('rule_prioritize_avoid', r.policy?.prioritizeAvoid || 'must');   // 🆕

            setCheck('rule_enableRelaxation', r.policy?.enableRelaxation === true);

            // 夜班區間設定
            if (r.policy?.nightStart) document.getElementById('rule_nightStart').value = r.policy.nightStart;
            if (r.policy?.nightEnd) document.getElementById('rule_nightEnd').value = r.policy.nightEnd;

            // 渲染夜班選項 (動態過濾)
            const savedList = r.policy?.noNightAfterOff_List || [];
            this.renderNightShiftOptions(savedList);

            // Pattern
            setVal('rule_dayStartShift', r.pattern?.dayStartShift || 'D');
            setVal('rule_rotationOrder', r.pattern?.rotationOrder || 'OFF,N,E,D');
            setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
            setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
            setCheck('rule_avoidLonelyOff', r.pattern?.avoidLonelyOff !== false);

            // Fairness & AI
            setCheck('rule_fairOff', r.fairness?.fairOff !== false);
            setVal('rule_fairOffVar', r.fairness?.fairOffVar || 2);
            setCheck('rule_fairNight', r.fairness?.fairNight !== false);
            setVal('rule_fairNightVar', r.fairness?.fairNightVar || 2);
            setVal('rule_fairBalanceRounds', r.fairness?.balanceRounds || 100);
            setVal('ai_backtrack_depth', r.aiParams?.backtrack_depth || 3);
            setVal('ai_max_attempts', r.aiParams?.max_attempts || 20);

            const container = document.getElementById('rulesContainer');
            if(container) container.style.display = 'block';

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
                nightStart: getVal('rule_nightStart'),
                nightEnd: getVal('rule_nightEnd'),
                
                // 儲存 4 個權重
                prioritizeBundle: getVal('rule_prioritize_bundle'), 
                prioritizePref: getVal('rule_prioritize_pref'),
                prioritizePreReq: getVal('rule_prioritize_prereq'), // 🆕
                prioritizeAvoid: getVal('rule_prioritize_avoid'),   // 🆕
                
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
        } catch(e) { console.error(e); alert("儲存失敗: " + e.message); }
    },

    // 🆕 修正：依據時間動態顯示班別 checkbox
    renderNightShiftOptions: function(checkedCodes) {
        const container = document.getElementById('nightShiftOptions');
        if(!container) return;
        
        container.innerHTML = '';
        
        // 1. 取得設定的時間區間
        const nStartStr = document.getElementById('rule_nightStart').value || '20:00';
        const nEndStr = document.getElementById('rule_nightEnd').value || '06:00';
        
        const parse = (t) => {
            if(!t) return 0;
            const [h, m] = t.split(':').map(Number);
            return h + m/60;
        };
        const nStart = parse(nStartStr);
        const nEnd = parse(nEndStr);

        // 2. 判斷班別是否算夜班 (重疊邏輯)
        const isNight = (shift) => {
            if (!shift.startTime) return false;
            const sStart = parse(shift.startTime);
            
            // 簡單判斷：若班別開始時間 >= 夜班開始，或 <= 夜班結束(跨日)
            if (nStart > nEnd) { // 典型的跨日 (如 20:00 - 06:00)
                return (sStart >= nStart) || (sStart <= nEnd);
            } else { // 同日 (少見)
                return (sStart >= nStart) && (sStart <= nEnd);
            }
        };

        // 3. 過濾與渲染
        let hasOptions = false;
        this.activeShifts.forEach(s => {
            // 只有被判定為夜班的才顯示
            if (isNight(s)) {
                hasOptions = true;
                const isChecked = checkedCodes.includes(s.code);
                const div = document.createElement('div');
                div.innerHTML = `
                    <label style="display:inline-flex; align-items:center; margin-right:15px; cursor:pointer;">
                        <input type="checkbox" value="${s.code}" class="night-limit-chk" ${isChecked?'checked':''}>
                        <span style="margin-left:4px; font-weight:bold; color:#2c3e50;">${s.code}</span>
                        <span style="font-size:0.8rem; color:#888; margin-left:2px;">(${s.startTime})</span>
                    </label>
                `;
                container.appendChild(div);
            }
        });

        if (!hasOptions) {
            container.innerHTML = '<span style="color:#999; font-size:0.9rem;">(依據目前時間設定，無符合的夜班班別)</span>';
        }
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
