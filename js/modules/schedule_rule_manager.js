// js/modules/schedule_rule_manager.js
// 修正版：支援 AI V2 參數設定 (容許誤差、回溯深度)

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        await this.loadUnitDropdown();
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

            // 自動選擇第一個單位
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadUnitData(select.value);
            }

            select.onchange = () => {
                if(select.value) this.loadUnitData(select.value);
                else document.getElementById('rulesContainer').style.display = 'none';
            };

        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadUnitData: async function(unitId) {
        this.currentUnitId = unitId;
        const container = document.getElementById('rulesContainer');
        if(container) container.style.display = 'block';
        
        try {
            // 1. 載入班別 (用於排班順序設定)
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', unitId).get();
            this.activeShifts = shiftsSnap.docs.map(d => d.data());

            // 2. 載入規則
            const doc = await db.collection('units').doc(unitId).get();
            if(!doc.exists) return;
            
            const unitData = doc.data();
            const rules = unitData.schedulingRules || {};
            
            this.fillForm(rules);
            console.log("規則載入完成");

        } catch(e) {
            console.error("Load Data Error:", e);
            alert("資料載入失敗");
        }
    },

    fillForm: function(r) {
        // --- 1. 硬性規則 (Hard Rules) ---
        const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };

        setCheck('rule_minGap11', r.hard?.minGap11 !== false); 
        setCheck('rule_maxDiversity3', r.hard?.maxDiversity3 !== false);
        setCheck('rule_protectPregnant', r.hard?.protectPregnant !== false);
        setCheck('rule_twoOffPerFortnight', r.hard?.twoOffPerFortnight !== false);
        setVal('rule_offGapMax', r.hard?.offGapMax || 12);
        setVal('rule_weekStartDay', r.hard?.weekStartDay || "1");

        // --- 2. 政策規則 (Policy) ---
        setVal('rule_reqOffWeight', r.policy?.reqOffWeight || 'must');
        setVal('rule_reqBanWeight', r.policy?.reqBanWeight || 'must');
        setCheck('rule_limitConsecutive', r.policy?.limitConsecutive !== false);
        setVal('rule_maxConsDays', r.policy?.maxConsDays || 6);
        setCheck('rule_longLeaveAdjust', r.policy?.longLeaveAdjust !== false);
        
        // 舊參數若還在 HTML 上則填入，若無則忽略
        setVal('rule_longLeaveThres', r.policy?.longLeaveThres || 5);
        setVal('rule_longLeaveMaxCons', r.policy?.longLeaveMaxCons || 7);
        setCheck('rule_bundleNightOnly', r.policy?.bundleNightOnly !== false);
        setCheck('rule_noNightAfterOff', r.policy?.noNightAfterOff !== false);

        // --- 3. 班別模式 (Pattern) ---
        setVal('rule_dayStartShift', r.pattern?.dayStartShift || 'D');
        setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
        setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
        
        // 渲染拖拉排序 (如果 HTML 有這個容器)
        const savedOrder = r.pattern?.rotationOrder || 'OFF,N,D,E';
        if(document.getElementById('rotationContainer')) {
            this.renderRotationEditor(savedOrder);
        }

        // --- 4. 公平性 (Fairness) ---
        setCheck('rule_fairOff', r.fairness?.fairOff !== false);
        setVal('rule_fairOffVar', r.fairness?.fairOffVar || 2);
        setCheck('rule_fairHoliday', r.fairness?.fairHoliday !== false);
        setCheck('rule_fairNight', r.fairness?.fairNight !== false);

        // --- 5. [新增] AI V2 參數 ---
        const ai = r.aiParams || {};
        
        // 回溯深度 (預設 3)
        setVal('ai_backtrack_depth', ai.backtrack_depth || 3);
        // 容許誤差 (預設 2)
        setVal('ai_tolerance', (ai.tolerance !== undefined) ? ai.tolerance : 2);
        // 最大嘗試次數 (預設 20)
        setVal('ai_max_attempts', ai.max_attempts || 20);

        // 舊權重欄位 (若 HTML 還有保留，設為預設值避免報錯)
        setVal('ai_w_balance', ai.w_balance || 200);
        setVal('ai_w_continuity', ai.w_continuity || 50);
        setVal('ai_w_surplus', ai.w_surplus || 150);
    },

    // 拖拉排序功能 (用於設定輪班順序)
    renderRotationEditor: function(savedOrderStr) {
        const container = document.getElementById('rotationContainer');
        if(!container) return;
        
        container.innerHTML = '';
        let items = [{ code: 'OFF', name: '休' }];
        this.activeShifts.forEach(s => {
            items.push({ code: s.code, name: s.name, color: s.color });
        });
        
        const savedArr = savedOrderStr.split(',').map(s => s.trim());
        items.sort((a, b) => {
            let idxA = savedArr.indexOf(a.code);
            let idxB = savedArr.indexOf(b.code);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
        });
        
        items.forEach((item, index) => {
            if (index > 0) {
                const arrow = document.createElement('div');
                arrow.className = 'sortable-arrow';
                arrow.innerHTML = '<i class="fas fa-arrow-right"></i>';
                container.appendChild(arrow);
            }
            const div = document.createElement('div');
            div.className = 'sortable-item';
            div.draggable = true;
            div.dataset.code = item.code;
            
            let colorDot = '';
            if (item.code === 'OFF') colorDot = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#2ecc71; margin-right:5px;"></span>`;
            else if (item.color) colorDot = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${item.color}; margin-right:5px;"></span>`;
            
            div.innerHTML = `${colorDot} ${item.name} (${item.code})`;
            container.appendChild(div);
        });
        
        this.setupDragAndDrop();
    },

    setupDragAndDrop: function() {
        const container = document.getElementById('rotationContainer');
        if(!container) return;
        
        let draggedItem = null;
        container.querySelectorAll('.sortable-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                e.dataTransfer.effectAllowed = 'move';
                item.classList.add('dragging');
            });
            item.addEventListener('dragend', () => {
                draggedItem = null;
                item.classList.remove('dragging');
                this.refreshArrows();
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault(); 
                e.dataTransfer.dropEffect = 'move';
                const target = e.target.closest('.sortable-item');
                if (target && target !== draggedItem) {
                    const rect = target.getBoundingClientRect();
                    const next = (e.clientX - rect.left) / (rect.right - rect.left) > 0.5;
                    if(next) container.insertBefore(draggedItem, target.nextSibling);
                    else container.insertBefore(draggedItem, target);
                }
            });
        });
    },

    refreshArrows: function() {
        const container = document.getElementById('rotationContainer');
        if(!container) return;
        container.querySelectorAll('.sortable-arrow').forEach(el => el.remove());
        const items = container.querySelectorAll('.sortable-item');
        items.forEach((item, index) => {
            if (index > 0) {
                const arrow = document.createElement('div');
                arrow.className = 'sortable-arrow';
                arrow.innerHTML = '<i class="fas fa-arrow-right"></i>';
                container.insertBefore(arrow, item);
            }
        });
    },

    getRotationOrderString: function() {
        const items = document.querySelectorAll('#rotationContainer .sortable-item');
        const codes = Array.from(items).map(el => el.dataset.code);
        return codes.join(',');
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }

        const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
        const getVal = (id, def) => { const el = document.getElementById(id); return el ? (el.value || def) : def; };
        const getInt = (id, def) => { const el = document.getElementById(id); return el ? (parseInt(el.value) || def) : def; };

        const rules = {
            hard: {
                minGap11: getCheck('rule_minGap11'),
                maxDiversity3: getCheck('rule_maxDiversity3'),
                protectPregnant: getCheck('rule_protectPregnant'),
                twoOffPerFortnight: getCheck('rule_twoOffPerFortnight'),
                offGapMax: getInt('rule_offGapMax', 12),
                weekStartDay: getVal('rule_weekStartDay', "1")
            },
            policy: {
                reqOffWeight: getVal('rule_reqOffWeight', 'must'),
                reqBanWeight: getVal('rule_reqBanWeight', 'must'),
                limitConsecutive: getCheck('rule_limitConsecutive'),
                maxConsDays: getInt('rule_maxConsDays', 6),
                longLeaveAdjust: getCheck('rule_longLeaveAdjust'),
                bundleNightOnly: getCheck('rule_bundleNightOnly'),
                noNightAfterOff: getCheck('rule_noNightAfterOff'),
                enableRelaxation: getCheck('rule_enableRelaxation') // 新增：放寬機制開關
            },
            pattern: {
                dayStartShift: getVal('rule_dayStartShift', 'D'),
                rotationOrder: this.getRotationOrderString(), 
                consecutivePref: getCheck('rule_consecutivePref'),
                minConsecutive: getInt('rule_minConsecutive', 2),
                avoidLonelyOff: getCheck('rule_avoidLonelyOff'),
                monthBuffer: getCheck('rule_monthBuffer'),
                monthBufferDays: getInt('rule_monthBufferDays', 7)
            },
            fairness: {
                fairOff: getCheck('rule_fairOff'),
                fairOffVar: getInt('rule_fairOffVar', 2),
                fairHoliday: getCheck('rule_fairHoliday'),
                fairHolidayVar: getInt('rule_fairHolidayVar', 2),
                fairNight: getCheck('rule_fairNight'),
                fairNightVar: getInt('rule_fairNightVar', 2)
            },
            // [關鍵] AI V2 參數
            aiParams: {
                backtrack_depth: getInt('ai_backtrack_depth', 3),
                max_attempts: getInt('ai_max_attempts', 20),
                tolerance: getInt('ai_tolerance', 2),
                // 保留舊權重以免 UI 報錯
                w_balance: getInt('ai_w_balance', 200),
                w_continuity: getInt('ai_w_continuity', 50),
                w_surplus: getInt('ai_w_surplus', 150)
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
