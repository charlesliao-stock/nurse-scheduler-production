// js/modules/schedule_rule_manager.js
// 🚀 最終完整版：整合拖曳排序、動態班別、完整權重設定

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        
        const container = document.getElementById('rulesContainer');
        if(container) container.style.display = 'none';

        await this.loadUnitDropdown();
        
        // 監聽夜班時間區間變化 -> 觸發動態重繪
        const startInput = document.getElementById('rule_nightStart');
        const endInput = document.getElementById('rule_nightEnd');
        if (startInput && endInput) {
            const updateList = () => {
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
            // 1. 載入該單位的班別 (用於 Tab 2 夜班 & Tab 3 輪替)
            const shiftSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());

            // 2. 載入規則
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if(!doc.exists) return;
            const data = doc.data();
            const r = data.schedulingRules || {};

            const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };

            // --- Tab 1: Hard Rules ---
            setCheck('rule_minGap11', r.hard?.minGap11 !== false);
            setCheck('rule_maxDiversity3', r.hard?.maxDiversity3 !== false);
            setCheck('rule_protectPregnant', r.hard?.protectPregnant !== false);
            setCheck('rule_twoOffPerFortnight', r.hard?.twoOffPerFortnight !== false);
            setVal('rule_offGapMax', r.hard?.offGapMax || 12);
            setVal('rule_weekStartDay', r.hard?.weekStartDay || 1);

            // --- Tab 2: Policy Rules ---
            setCheck('rule_limitConsecutive', r.policy?.limitConsecutive !== false);
            setVal('rule_maxConsDays', r.policy?.maxConsDays || 6);
            setCheck('rule_bundleNightOnly', r.policy?.bundleNightOnly !== false);
            setCheck('rule_noNightAfterOff', r.policy?.noNightAfterOff !== false);
            
            // 4大權重設定
            setVal('rule_prioritize_bundle', r.policy?.prioritizeBundle || 'must');
            setVal('rule_prioritize_pref', r.policy?.prioritizePref || 'must');
            setVal('rule_prioritize_prereq', r.policy?.prioritizePreReq || 'must');
            setVal('rule_prioritize_avoid', r.policy?.prioritizeAvoid || 'must');
            
            // 救火模式
            setCheck('rule_enableRelaxation', r.policy?.enableRelaxation === true);

            // 夜班設定
            if (r.policy?.nightStart) document.getElementById('rule_nightStart').value = r.policy.nightStart;
            if (r.policy?.nightEnd) document.getElementById('rule_nightEnd').value = r.policy.nightEnd;
            this.renderNightShiftOptions(r.policy?.noNightAfterOff_List || []);

            // --- Tab 3: Pattern Rules ---
            setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
            setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
            setCheck('rule_avoidLonelyOff', r.pattern?.avoidLonelyOff !== false);
            
            // 🆕 動態起始班別 (下拉)
            this.renderStartShiftSelect(r.pattern?.dayStartShift || 'D');
            
            // 🆕 動態輪替順序 (拖曳)
            const savedOrder = r.pattern?.rotationOrder || 'OFF,N,E,D';
            this.renderRotationSortableList(savedOrder);

            // --- Tab 4 & 5 ---
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

        // 取得拖曳排序結果
        const rotationOrder = this.getRotationOrderFromDOM();

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
                noNightAfterOff_List: this.getCheckedNightLimits(),
                nightStart: getVal('rule_nightStart'),
                nightEnd: getVal('rule_nightEnd'),
                
                // 4大權重
                prioritizeBundle: getVal('rule_prioritize_bundle'), 
                prioritizePref: getVal('rule_prioritize_pref'),
                prioritizePreReq: getVal('rule_prioritize_prereq'),
                prioritizeAvoid: getVal('rule_prioritize_avoid'),
                
                enableRelaxation: getCheck('rule_enableRelaxation') 
            },
            pattern: {
                dayStartShift: getVal('rule_dayStartShift'), // 下拉選單值
                rotationOrder: rotationOrder,                // 拖曳排序值
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

    // 🆕 渲染起始班別下拉選單
    renderStartShiftSelect: function(currentVal) {
        const select = document.getElementById('rule_dayStartShift');
        if(!select) return;
        select.innerHTML = '';
        
        this.activeShifts.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.code;
            opt.textContent = `${s.code} (${s.name})`;
            select.appendChild(opt);
        });

        // 若無班別資料，預設 D
        if (select.options.length === 0) {
            const opt = document.createElement('option'); opt.value = 'D'; opt.textContent = 'D';
            select.appendChild(opt);
        }

        // 嘗試選中之前的值，否則選第一個
        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            select.value = currentVal;
        } else {
            select.selectedIndex = 0;
        }
    },

    // 🆕 渲染拖曳排序列表
    renderRotationSortableList: function(savedOrderStr) {
        const container = document.getElementById('rotationSortableList');
        if(!container) return;
        container.innerHTML = '';

        // 準備所有可用班別 (含 OFF)
        const availableCodes = ['OFF', ...this.activeShifts.map(s => s.code)];
        
        let orderArray = [];
        if (savedOrderStr) orderArray = savedOrderStr.split(',').map(s => s.trim());

        // 合併邏輯：確保現有班別都在，且移除已刪除的
        const finalOrder = orderArray.filter(code => availableCodes.includes(code));
        availableCodes.forEach(code => {
            if (!finalOrder.includes(code)) finalOrder.push(code);
        });

        finalOrder.forEach(code => {
            const item = document.createElement('div');
            item.className = 'sortable-item';
            item.draggable = true;
            item.dataset.code = code;
            item.innerHTML = `
                <span>${code}</span>
                <i class="fas fa-grip-lines-vertical"></i>
            `;
            container.appendChild(item);
            this.addDragEvents(item, container);
        });
    },

    // 🆕 拖曳事件綁定
    addDragEvents: function(item, container) {
        item.addEventListener('dragstart', () => item.classList.add('dragging'));
        item.addEventListener('dragend', () => item.classList.remove('dragging'));

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(container, e.clientX);
            const draggable = document.querySelector('.dragging');
            if (afterElement == null) container.appendChild(draggable);
            else container.insertBefore(draggable, afterElement);
        });
    },

    getDragAfterElement: function(container, x) {
        const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    getRotationOrderFromDOM: function() {
        const container = document.getElementById('rotationSortableList');
        if(!container) return 'OFF,N,E,D';
        const items = container.querySelectorAll('.sortable-item');
        return Array.from(items).map(item => item.dataset.code).join(',');
    },

    // 夜班選項渲染
    renderNightShiftOptions: function(checkedCodes) {
        const container = document.getElementById('nightShiftOptions');
        if(!container) return;
        container.innerHTML = '';
        
        const nStartStr = document.getElementById('rule_nightStart').value || '20:00';
        const nEndStr = document.getElementById('rule_nightEnd').value || '06:00';
        
        const parse = (t) => { if(!t) return 0; const [h, m] = t.split(':').map(Number); return h + m/60; };
        const nStart = parse(nStartStr);
        const nEnd = parse(nEndStr);

        const isNight = (shift) => {
            if (!shift.startTime) return false;
            const sStart = parse(shift.startTime);
            if (nStart > nEnd) return (sStart >= nStart) || (sStart <= nEnd);
            else return (sStart >= nStart) && (sStart <= nEnd);
        };

        let hasOptions = false;
        this.activeShifts.forEach(s => {
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

        if (!hasOptions) container.innerHTML = '<span style="color:#999; font-size:0.9rem;">(依據目前時間設定，無符合的夜班班別)</span>';
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
