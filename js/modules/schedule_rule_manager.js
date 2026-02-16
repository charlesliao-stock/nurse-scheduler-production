// js/modules/schedule_rule_manager.js

const scheduleRuleManager = {
    currentUnitId: null,
    activeShifts: [], 
    
    init: async function() {
        console.log("Scheduling Rules Manager Loaded.");
        
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
            const units = await DataLoader.loadUnits();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            let filteredUnits = units;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    filteredUnits = units.filter(u => u.id === activeUnitId);
                }
            }

            select.innerHTML = '<option value="">請選擇單位</option>';
            filteredUnits.forEach(u => {
                const option = document.createElement('option');
                option.value = u.id;
                option.textContent = u.name;
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

            if (filteredUnits.length === 1) {
                select.selectedIndex = 1;
                
                if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                    select.disabled = true;
                    select.style.backgroundColor = '#f5f5f5';
                }
                
                select.dispatchEvent(new Event('change'));
            }

            const enablePrefRatio = document.getElementById('rule_enablePrefRatio');
            if (enablePrefRatio) {
                enablePrefRatio.onchange = () => {
                    const container = document.getElementById('prefRatioContainer');
                    if (container) container.style.opacity = enablePrefRatio.checked ? '1' : '0.5';
                };
            }

        } catch (e) { 
            console.error(e); 
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadDataToForm: async function() {
        if(!this.currentUnitId) return;
        try {
            const shifts = await DataLoader.loadShifts(this.currentUnitId);
            this.activeShifts = shifts.filter(s => s.isScheduleAvailable !== false);
            
            console.log(`✅ 排班規則載入 ${this.activeShifts.length} 個可用班別:`, this.activeShifts.map(s => s.code));

            const rules = await DataLoader.loadSchedulingRules(this.currentUnitId);
            const r = rules || {};

            const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
            
            const setVal = (id, val) => { 
                const el = document.getElementById(id); 
                if(el) {
                    el.value = (val !== null && val !== undefined) ? val : ''; 
                }
            };

            setCheck('rule_minGap11', r.hard?.minGap11 !== false);
            
            // 相容舊版 maxDiversity3，但優先使用新版 maxDiversity2
            const maxDiversityValue = (r.hard?.maxDiversity2 !== undefined) ? 
                r.hard.maxDiversity2 : (r.hard?.maxDiversity3 !== false);
            setCheck('rule_maxDiversity2', maxDiversityValue !== false);
            
            setCheck('rule_protectPregnant', r.hard?.protectPregnant !== false);
            setCheck('rule_twoOffPerFortnight', r.hard?.twoOffPerFortnight !== false);
            
            setVal('rule_offGapMax', r.hard?.offGapMax ?? 12);
            setVal('rule_weekStartDay', r.hard?.weekStartDay ?? 1); 

            setCheck('rule_limitConsecutive', r.policy?.limitConsecutive !== false);
            setVal('rule_maxConsDays', r.policy?.maxConsDays || 6);
            setVal('rule_longVacationDays', r.policy?.longVacationDays || 7);
            setVal('rule_longVacationWorkLimit', r.policy?.longVacationWorkLimit || 7);
            
            setCheck('rule_bundleNightOnly', r.policy?.bundleNightOnly !== false);
            setCheck('rule_enablePrefRatio', r.policy?.enablePrefRatio === true);
            setVal('rule_prefRatio1', r.policy?.prefRatio1 ?? 50);
            setVal('rule_prefRatio2', r.policy?.prefRatio2 ?? 30);
            setVal('rule_prefRatio3', r.policy?.prefRatio3 ?? 20);
            setCheck('rule_noNightAfterOff', r.policy?.noNightAfterOff !== false);
            setCheck('rule_protectPGY', r.policy?.protectPGY !== false);
            
            setVal('rule_prioritize_bundle', r.policy?.prioritizeBundle || 'must');
            setVal('rule_prioritize_pref', r.policy?.prioritizePref || 'must');
            setVal('rule_prioritize_prereq', r.policy?.prioritizePreReq || 'must');
            setVal('rule_prioritize_avoid', r.policy?.prioritizeAvoid || 'must');
            setCheck('rule_enableRelaxation', r.policy?.enableRelaxation === true);

            if (r.policy?.nightStart) document.getElementById('rule_nightStart').value = r.policy.nightStart;
            if (r.policy?.nightEnd) document.getElementById('rule_nightEnd').value = r.policy.nightEnd;
            this.renderNightShiftOptions(r.policy?.noNightAfterOff_List || []);
            this.renderPGYShiftOptions(r.policy?.protectPGY_List || []);

            const shortagePriority = r.policy?.shortageHandling?.priorityOrder || [];
            this.renderShortagePriorityList(shortagePriority);

            setCheck('rule_consecutivePref', r.pattern?.consecutivePref !== false);
            setVal('rule_minConsecutive', r.pattern?.minConsecutive || 2);
            setCheck('rule_avoidLonelyOff', r.pattern?.avoidLonelyOff !== false);
            
            this.renderStartShiftSelect(r.pattern?.dayStartShift || 'D');
            this.renderRotationSortableList(r.pattern?.rotationOrder || 'OFF,N,E,D');

            setCheck('rule_fairOff', r.fairness?.fairOff !== false);
            setVal('rule_fairOffVar', r.fairness?.fairOffVar || 2);
            setCheck('rule_fairNight', r.fairness?.fairNight !== false);
            setVal('rule_fairNightVar', r.fairness?.fairNightVar || 2);
            setVal('rule_fairBalanceRounds', r.fairness?.balanceRounds || 100);
            
            setVal('ai_backtrack_depth', r.aiParams?.backtrack_depth || 3);
            setVal('ai_max_attempts', r.aiParams?.max_attempts || 20);
            setVal('ai_balancing_segments', r.aiParams?.balancingSegments || 1); 

            const container = document.getElementById('rulesContainer');
            if(container) container.style.display = 'block';

        } catch (e) { 
            console.error("❌ 載入排班規則失敗:", e); 
        }
    },

    saveData: async function() {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        
        const getInt = (id, def) => { 
            const v = parseInt(getVal(id)); 
            return isNaN(v) ? def : v; 
        };

        const rotationOrder = this.getRotationOrderFromDOM();
        const shortagePriority = this.getShortagePriorityFromDOM();

        const rules = {
            hard: {
                minGap11: getCheck('rule_minGap11'),
                maxDiversity2: getCheck('rule_maxDiversity2'),  // 改為 maxDiversity2
                protectPregnant: getCheck('rule_protectPregnant'),
                twoOffPerFortnight: getCheck('rule_twoOffPerFortnight'),
                offGapMax: getInt('rule_offGapMax', 12),
                weekStartDay: getInt('rule_weekStartDay', 1)
            },
            policy: {
                limitConsecutive: getCheck('rule_limitConsecutive'),
                maxConsDays: getInt('rule_maxConsDays', 6),
                longVacationDays: getInt('rule_longVacationDays', 7),
                longVacationWorkLimit: getInt('rule_longVacationWorkLimit', 7),
                bundleNightOnly: getCheck('rule_bundleNightOnly'),
                enablePrefRatio: getCheck('rule_enablePrefRatio'),
                prefRatio1: getInt('rule_prefRatio1', 50),
                prefRatio2: getInt('rule_prefRatio2', 30),
                prefRatio3: getInt('rule_prefRatio3', 20),
                noNightAfterOff: getCheck('rule_noNightAfterOff'),
                noNightAfterOff_List: this.getCheckedNightLimits(),
                protectPGY: getCheck('rule_protectPGY'),
                protectPGY_List: this.getCheckedPGYLimits(),
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
            
            CacheManager.invalidate('rules', this.currentUnitId);
            
            alert("排班規則已儲存");
        } catch(e) { 
            console.error(e); 
            alert("儲存失敗: " + e.message); 
        }
    },

    renderShortagePriorityList: function(savedOrder) {
        const container = document.getElementById('shortagePriorityList');
        if (!container) return;
        
        console.log("Rendering shortage priority list, activeShifts count:", this.activeShifts.length);
        
        let order = savedOrder && savedOrder.length > 0 ? [...savedOrder] : [];
        
        const activeCodes = this.activeShifts.map(s => s.code);
        order = order.filter(code => activeCodes.includes(code));

        if (this.activeShifts.length > 0) {
            this.activeShifts.forEach(shift => {
                if (!order.includes(shift.code)) {
                    order.push(shift.code);
                }
            });
        }
        
        if (order.length === 0) {
            const nightShifts = [];
            const dayShifts = [];
            
            this.activeShifts.forEach(s => {
                const start = this.parseTime(s.startTime);
                const isNight = start >= 22 || start <= 6;
                
                if (isNight) {
                    nightShifts.push(s.code);
                } else {
                    dayShifts.push(s.code);
                }
            });
            
            order = [...nightShifts, ...dayShifts];
        }
        
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
        
        if (select.options.length === 0 && this.activeShifts.length > 0) {
            const firstShift = this.activeShifts[0];
            const opt = document.createElement('option'); 
            opt.value = firstShift.code; 
            opt.textContent = firstShift.code;
            select.appendChild(opt);
        }
        
        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            select.value = currentVal;
        } else {
            select.selectedIndex = 0;
        }
    },

    renderRotationSortableList: function(savedOrderStr) {
        const container = document.getElementById('rotationSortableList');
        if(!container) return;
        container.innerHTML = '';
        
        const availableCodes = ['OFF', ...this.activeShifts.map(s => s.code)];
        let orderArray = savedOrderStr ? savedOrderStr.split(',').map(s => s.trim()) : [];
        
        const finalOrder = orderArray.filter(code => availableCodes.includes(code));
        
        availableCodes.forEach(code => { 
            if (!finalOrder.includes(code)) finalOrder.push(code); 
        });

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
        if(!container) {
            // 如果找不到容器，動態生成一個預設順序
            const codes = ['OFF', ...this.activeShifts.map(s => s.code)];
            return codes.join(',');
        }
        return Array.from(container.querySelectorAll('.sortable-item'))
            .map(item => item.dataset.code)
            .join(',');
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
                div.innerHTML = `<label style="display:inline-flex; align-items:center; margin-right:15px;">
                    <input type="checkbox" value="${s.code}" class="night-limit-chk" ${isChecked?'checked':''}> 
                    <span style="margin-left:4px; font-weight:bold;">${s.code}</span>
                </label>`;
                container.appendChild(div);
            }
        });
        
        if (!hasOptions) {
            container.innerHTML = '<span style="color:#999;">(無符合班別)</span>';
        }
    },

    parseTime: function(t) { 
        if(!t) return 0; 
        const [h, m] = t.split(':').map(Number); 
        return h + m/60; 
    },
    
    getCheckedNightLimits: function() { 
        return Array.from(document.querySelectorAll('.night-limit-chk:checked'))
            .map(c => c.value); 
    },
    
    renderPGYShiftOptions: function(checkedCodes) {
        const container = document.getElementById('pgyShiftOptions');
        if(!container) return;
        container.innerHTML = '';

        if (this.activeShifts.length === 0) {
            container.innerHTML = '<span style="color:#999;">(無可選班別)</span>';
            return;
        }

        this.activeShifts.forEach(s => {
            const isChecked = checkedCodes.includes(s.code);
            const div = document.createElement('div');
            div.style.display = 'inline-block';
            div.innerHTML = `<label style="display:inline-flex; align-items:center; margin-right:15px; cursor:pointer;">
                <input type="checkbox" value="${s.code}" class="pgy-limit-chk" ${isChecked?'checked':''}> 
                <span style="margin-left:4px; font-weight:bold;">${s.code}</span>
            </label>`;
            container.appendChild(div);
        });
    },

    getCheckedPGYLimits: function() { 
        return Array.from(document.querySelectorAll('.pgy-limit-chk:checked'))
            .map(c => c.value); 
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
