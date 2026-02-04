// js/modules/schedule_rule_manager.js
// 🔧 最終完美版 v2 - 加強權限控制（比照 staff_manager.js）
// 🆕 包含：週日(0)修復、缺額處理優先順序設定

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        
        // ✅ 權限檢查
        const activeRole = app.impersonatedRole || app.userRole;
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理排班規則</p>
                </div>
            `;
            return;
        }
        
        const container = document.getElementById('rulesContainer');
        if(container) container.style.display = 'none';

        await this.loadUnitDropdown();
        
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
            
            // ✅ 權限過濾：使用 impersonatedRole 或 userRole
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
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

            // ✅ 如果只有一個單位，自動選取並限制選單
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                
                // 單位護理長不需要看到選單
                if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                    select.disabled = true;
                    select.style.backgroundColor = '#f5f5f5';
                }
                
                select.dispatchEvent(new Event('change'));
            }

        } catch (e) { 
            console.error(e); 
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadDataToForm: async function() {
        if(!this.currentUnitId) return;
        try {
            const shiftSnap = await db.collection('shifts').where('unitId','==',this.currentUnitId).get();
            this.activeShifts = shiftSnap.docs.map(d => d.data());

            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if(!doc.exists) return;
            const data = doc.data();
            const r = data.schedulingRules || {};

            const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
            
            // [關鍵修正 1] 讀取時：特別處理 0，避免 0 被轉成空字串
            const setVal = (id, val) => { 
                const el = document.getElementById(id); 
                if(el) {
                    // 如果是 null 或 undefined 轉為空字串，但保留 0
                    el.value = (val !== null && val !== undefined) ? val : ''; 
                }
            };

            // Hard Rules
            setCheck('rule_minGap11', r.hard?.minGap11 !== false);
            setCheck('rule_maxDiversity3', r.hard?.maxDiversity3 !== false);
            setCheck('rule_protectPregnant', r.hard?.protectPregnant !== false);
            setCheck('rule_twoOffPerFortnight', r.hard?.twoOffPerFortnight !== false);
            
            // 使用 ?? 確保讀取資料庫的 0 不會被後面的預設值覆蓋
            setVal('rule_offGapMax', r.hard?.offGapMax ?? 12);
            setVal('rule_weekStartDay', r.hard?.weekStartDay ?? 1); 

            // Policy Rules
            setCheck('rule_limitConsecutive', r.policy?.limitConsecutive !== false);
            setVal('rule_maxConsDays', r.policy?.maxConsDays || 6);
            setVal('rule_longVacationDays', r.policy?.longVacationDays || 7);
            setVal('rule_longVacationWorkLimit', r.policy?.longVacationWorkLimit || 7);
            
            setCheck('rule_bundleNightOnly', r.policy?.bundleNightOnly !== false);
            setCheck('rule_noNightAfterOff', r.policy?.noNightAfterOff !== false);
            
            setVal('rule_prioritize_bundle', r.policy?.prioritizeBundle || 'must');
            setVal('rule_prioritize_pref', r.policy?.prioritizePref || 'must');
            setVal('rule_prioritize_prereq', r.policy?.prioritizePreReq || 'must');
            setVal('rule_prioritize_avoid', r.policy?.prioritizeAvoid || 'must');
            setCheck('rule_enableRelaxation', r.policy?.enableRelaxation === true);

            if (r.policy?.nightStart) document.getElementById('rule_nightStart').value = r.policy.nightStart;
            if (r.policy?.nightEnd) document.getElementById('rule_nightEnd').value = r.policy.nightEnd;
            this.renderNightShiftOptions(r.policy?.noNightAfterOff_List || []);

            // 🔥 新增：缺額處理優先順序
            const shortagePriority = r.policy?.shortageHandling?.priorityOrder || [];
            this.renderShortagePriorityList(shortagePriority);

            // Pattern Rules
            setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
            setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
            setCheck('rule_avoidLonelyOff', r.pattern?.avoidLonelyOff !== false);
            
            this.renderStartShiftSelect(r.pattern?.dayStartShift || 'D');
            this.renderRotationSortableList(r.pattern?.rotationOrder || 'OFF,N,E,D');

            // Fairness Rules
            setCheck('rule_fairOff', r.fairness?.fairOff !== false);
            setVal('rule_fairOffVar', r.fairness?.fairOffVar || 2);
            setCheck('rule_fairNight', r.fairness?.fairNight !== false);
            setVal('rule_fairNightVar', r.fairness?.fairNightVar || 2);
            setVal('rule_fairBalanceRounds', r.fairness?.balanceRounds || 100);
            
            // AI Params
            setVal('ai_backtrack_depth', r.aiParams?.backtrack_depth || 3);
            setVal('ai_max_attempts', r.aiParams?.max_attempts || 20);
            setVal('ai_balancing_segments', r.aiParams?.balancingSegments || 1); 

            const container = document.getElementById('rulesContainer');
            if(container) container.style.display = 'block';

        } catch (e) { console.error(e); }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        
        // [關鍵修正 2] 儲存時：使用 isNaN 檢查，允許 0 值通過
        const getInt = (id, def) => { 
            const v = parseInt(getVal(id)); 
            return isNaN(v) ? def : v; 
        };

        const rotationOrder = this.getRotationOrderFromDOM();
        
        // 🔥 新增：取得缺額處理優先順序
        const shortagePriority = this.getShortagePriorityFromDOM();

        const rules = {
            hard: {
                minGap11: getCheck('rule_minGap11'),
                maxDiversity3: getCheck('rule_maxDiversity3'),
                protectPregnant: getCheck('rule_protectPregnant'),
                twoOffPerFortnight: getCheck('rule_twoOffPerFortnight'),
                offGapMax: getInt('rule_offGapMax', 12),
                weekStartDay: getInt('rule_weekStartDay', 1) // 0 (週日) 現在可以被正確儲存
            },
            policy: {
                limitConsecutive: getCheck('rule_limitConsecutive'),
                maxConsDays: getInt('rule_maxConsDays', 6),
                longVacationDays: getInt('rule_longVacationDays', 7),
                longVacationWorkLimit: getInt('rule_longVacationWorkLimit', 7),
                bundleNightOnly: getCheck('rule_bundleNightOnly'),
                noNightAfterOff: getCheck('rule_noNightAfterOff'),
                noNightAfterOff_List: this.getCheckedNightLimits(),
                nightStart: getVal('rule_nightStart') || '20:00',
                nightEnd: getVal('rule_nightEnd') || '06:00',
                prioritizeBundle: getVal('rule_prioritize_bundle') || 'must',
                prioritizePref: getVal('rule_prioritize_pref') || 'must',
                prioritizePreReq: getVal('rule_prioritize_prereq') || 'must',
                prioritizeAvoid: getVal('rule_prioritize_avoid') || 'must',
                enableRelaxation: getCheck('rule_enableRelaxation'),
                shortageHandling: {
                    priorityOrder: shortagePriority
                }
            },
            pattern: {
                consecutivePref: getCheck('rule_consecutivePref'),
                minConsecutive: getInt('rule_minConsecutive', 2),
                avoidLonelyOff: getCheck('rule_avoidLonelyOff'),
                dayStartShift: getVal('rule_dayStartShift') || 'D',
                rotationOrder: rotationOrder
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
                max_attempts: getInt('ai_max_attempts', 20),
                balancingSegments: getInt('ai_balancing_segments', 1)
            }
        };

        try {
            await db.collection('units').doc(this.currentUnitId).update({
                schedulingRules: rules,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("排班規則已儲存");
        } catch(e) { 
            console.error(e); 
            alert("儲存失敗: " + e.message); 
        }
    },

    // 🔥 新增：渲染缺額處理優先順序列表
    renderShortagePriorityList: function(savedOrder) {
        const container = document.getElementById('shortagePriorityList');
        if (!container) return;
        
        // 建立班別順序陣列
        let order = savedOrder && savedOrder.length > 0 ? [...savedOrder] : [];
        
        // 將新增的班別（尚未在順序中的）加到最後
        this.activeShifts.forEach(shift => {
            if (!order.includes(shift.code)) {
                order.push(shift.code);
            }
        });
        
        // 如果順序為空，使用智能預設順序（夜班優先）
        if (order.length === 0) {
            const nightShifts = [];
            const dayShifts = [];
            
            this.activeShifts.forEach(s => {
                const start = this.parseTime(s.startTime);
                // 判斷是否為夜班（22:00-06:00）
                const isNight = start >= 22 || start <= 6;
                
                if (isNight) {
                    nightShifts.push(s.code);
                } else {
                    dayShifts.push(s.code);
                }
            });
            
            // 夜班在前，白班在後
            order = [...nightShifts, ...dayShifts];
        }
        
        // 渲染列表
        container.innerHTML = '';
        
        order.forEach((code, index) => {
            const shift = this.activeShifts.find(s => s.code === code);
            if (!shift) return;
            
            const item = document.createElement('div');
            item.className = 'sortable-item shortage-priority-item';
            item.draggable = true;
            item.dataset.code = code;
            
            const priorityLabel = index === 0 ? '最優先' : 
                                  index === order.length - 1 ? '可接受缺額' : '';
            
            const shiftColor = shift.color || '#666';
            
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-grip-lines-vertical" style="color:#999; cursor:grab;"></i>
                    <span class="priority-badge">${index + 1}</span>
                    <div style="flex:1;">
                        <strong style="color:${shiftColor};">${code}</strong> - ${shift.name}
                        <small style="color:#999; margin-left:8px;">${shift.startTime}-${shift.endTime}</small>
                    </div>
                    <span style="color:#666; font-size:0.85rem; font-style:italic; min-width:80px; text-align:right;">
                        ${priorityLabel}
                    </span>
                </div>
            `;
            
            container.appendChild(item);
            this.addDragEvents(item, container);
        });
    },

    // 🔥 新增：從 DOM 取得缺額處理優先順序
    getShortagePriorityFromDOM: function() {
        const container = document.getElementById('shortagePriorityList');
        if (!container) return [];
        
        return Array.from(container.querySelectorAll('.shortage-priority-item'))
            .map(item => item.dataset.code);
    },

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
        if (select.options.length === 0) {
            const opt = document.createElement('option'); opt.value = 'D'; opt.textContent = 'D';
            select.appendChild(opt);
        }
        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) select.value = currentVal;
        else select.selectedIndex = 0;
    },

    renderRotationSortableList: function(savedOrderStr) {
        const container = document.getElementById('rotationSortableList');
        if(!container) return;
        container.innerHTML = '';
        const availableCodes = ['OFF', ...this.activeShifts.map(s => s.code)];
        let orderArray = savedOrderStr ? savedOrderStr.split(',').map(s => s.trim()) : [];
        
        const finalOrder = orderArray.filter(code => availableCodes.includes(code));
        availableCodes.forEach(code => { if (!finalOrder.includes(code)) finalOrder.push(code); });

        finalOrder.forEach(code => {
            const item = document.createElement('div');
            item.className = 'sortable-item';
            item.draggable = true;
            item.dataset.code = code;
            item.innerHTML = `<span>${code}</span><i class="fas fa-grip-lines-vertical"></i>`;
            container.appendChild(item);
            this.addDragEvents(item, container);
        });
    },

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
        return Array.from(container.querySelectorAll('.sortable-item')).map(item => item.dataset.code).join(',');
    },

    renderNightShiftOptions: function(checkedCodes) {
        const container = document.getElementById('nightShiftOptions');
        if(!container) return;
        container.innerHTML = '';
        const nStart = this.parseTime(document.getElementById('rule_nightStart').value || '20:00');
        const nEnd = this.parseTime(document.getElementById('rule_nightEnd').value || '06:00');

        let hasOptions = false;
        this.activeShifts.forEach(s => {
            const sStart = this.parseTime(s.startTime);
            let isNight = (nStart > nEnd) ? (sStart >= nStart || sStart <= nEnd) : (sStart >= nStart && sStart <= nEnd);
            
            if (isNight) {
                hasOptions = true;
                const isChecked = checkedCodes.includes(s.code);
                const div = document.createElement('div');
                div.innerHTML = `<label style="display:inline-flex; align-items:center; margin-right:15px;"><input type="checkbox" value="${s.code}" class="night-limit-chk" ${isChecked?'checked':''}> <span style="margin-left:4px; font-weight:bold;">${s.code}</span></label>`;
                container.appendChild(div);
            }
        });
        if (!hasOptions) container.innerHTML = '<span style="color:#999;">(無符合班別)</span>';
    },

    parseTime: function(t) { if(!t) return 0; const [h, m] = t.split(':').map(Number); return h + m/60; },
    getCheckedNightLimits: function() { return Array.from(document.querySelectorAll('.night-limit-chk:checked')).map(c => c.value); },
    
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
