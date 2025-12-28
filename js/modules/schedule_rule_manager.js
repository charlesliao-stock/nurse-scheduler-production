// js/modules/schedule_rule_manager.js

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
        container.style.display = 'block';
        
        try {
            // 1. 載入班別 (為了顯示方塊名稱)
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
        // Hard
        document.getElementById('rule_minGap11').checked = r.hard?.minGap11 !== false; 
        document.getElementById('rule_maxDiversity3').checked = r.hard?.maxDiversity3 !== false;
        document.getElementById('rule_protectPregnant').checked = r.hard?.protectPregnant !== false;
        document.getElementById('rule_twoOffPerFortnight').checked = r.hard?.twoOffPerFortnight !== false;
        document.getElementById('rule_offGapMax').value = r.hard?.offGapMax || 12;
        document.getElementById('rule_weekStartDay').value = r.hard?.weekStartDay || "1";

        // Policy
        document.getElementById('rule_reqOffWeight').value = r.policy?.reqOffWeight || 'must';
        document.getElementById('rule_reqBanWeight').value = r.policy?.reqBanWeight || 'must';
        document.getElementById('rule_limitConsecutive').checked = r.policy?.limitConsecutive !== false;
        document.getElementById('rule_maxConsDays').value = r.policy?.maxConsDays || 6;
        document.getElementById('rule_longLeaveAdjust').checked = r.policy?.longLeaveAdjust !== false;
        document.getElementById('rule_longLeaveThres').value = r.policy?.longLeaveThres || 5;
        document.getElementById('rule_longLeaveMaxCons').value = r.policy?.longLeaveMaxCons || 7;
        document.getElementById('rule_bundleNightOnly').checked = r.policy?.bundleNightOnly !== false;
        document.getElementById('rule_noNightAfterOff').checked = r.policy?.noNightAfterOff !== false;
        document.getElementById('rule_noNightAfterOff_N').checked = r.policy?.noNightAfterOff_N !== false;
        document.getElementById('rule_noNightAfterOff_E').checked = r.policy?.noNightAfterOff_E !== false;
        document.getElementById('rule_newbie_noNight3m').checked = r.policy?.newbie_noNight3m || false;
        document.getElementById('rule_newbie_noBigNight1m').checked = r.policy?.newbie_noBigNight1m || false;
        document.getElementById('rule_newbie_noSolo1m').checked = r.policy?.newbie_noSolo1m || false;

        // Pattern
        document.getElementById('rule_dayStartShift').value = r.pattern?.dayStartShift || 'D';
        document.getElementById('rule_consecutivePref').checked = r.pattern?.consecutivePref !== false;
        document.getElementById('rule_minConsecutive').value = r.pattern?.minConsecutive || 2;
        document.getElementById('rule_avoidLonelyOff').checked = r.pattern?.avoidLonelyOff !== false;
        document.getElementById('rule_monthBuffer').checked = r.pattern?.monthBuffer !== false;
        document.getElementById('rule_monthBufferDays').value = r.pattern?.monthBufferDays || 7;

        // [核心修改] 渲染拖曳排序編輯器
        const savedOrder = r.pattern?.rotationOrder || 'OFF,N,D,E';
        this.renderRotationEditor(savedOrder);

        // Fairness
        document.getElementById('rule_fairOff').checked = r.fairness?.fairOff !== false;
        document.getElementById('rule_fairOffVar').value = r.fairness?.fairOffVar || 2;
        document.getElementById('rule_fairOffExcludeLong').checked = r.fairness?.fairOffExcludeLong !== false;
        document.getElementById('rule_fairOffExcludeDays').value = r.fairness?.fairOffExcludeDays || 6;
        document.getElementById('rule_fairHoliday').checked = r.fairness?.fairHoliday !== false;
        document.getElementById('rule_fairHolidayVar').value = r.fairness?.fairHolidayVar || 2;
        document.getElementById('rule_fairHolidayIncNational').checked = r.fairness?.fairHolidayIncNational !== false;
        document.getElementById('rule_fairNight').checked = r.fairness?.fairNight !== false;
        document.getElementById('rule_fairNightVar').value = r.fairness?.fairNightVar || 2;
    },

    // [新增] 渲染拖曳編輯器
    renderRotationEditor: function(savedOrderStr) {
        const container = document.getElementById('rotationContainer');
        container.innerHTML = '';

        // 1. 準備所有項目：OFF + 本單位所有班別
        let items = [{ code: 'OFF', name: '休' }];
        this.activeShifts.forEach(s => {
            items.push({ code: s.code, name: s.name, color: s.color });
        });

        // 2. 依照儲存的順序排序
        const savedArr = savedOrderStr.split(',').map(s => s.trim());
        items.sort((a, b) => {
            let idxA = savedArr.indexOf(a.code);
            let idxB = savedArr.indexOf(b.code);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
        });

        // 3. 產生 DOM
        items.forEach((item, index) => {
            // 加入箭頭 (除了第一個)
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
            
            // 顏色標記
            let colorDot = '';
            if (item.code === 'OFF') colorDot = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#2ecc71; margin-right:5px;"></span>`;
            else if (item.color) colorDot = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${item.color}; margin-right:5px;"></span>`;

            div.innerHTML = `${colorDot} ${item.name} (${item.code})`;
            container.appendChild(div);
        });

        // 4. 綁定拖曳事件
        this.setupDragAndDrop();
    },

    setupDragAndDrop: function() {
        const container = document.getElementById('rotationContainer');
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
                this.refreshArrows(); // 重新整理箭頭
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault(); 
                e.dataTransfer.dropEffect = 'move';
                
                const target = e.target.closest('.sortable-item');
                if (target && target !== draggedItem) {
                    const rect = target.getBoundingClientRect();
                    const next = (e.clientX - rect.left) / (rect.right - rect.left) > 0.5;
                    // 交換位置
                    if(next) container.insertBefore(draggedItem, target.nextSibling);
                    else container.insertBefore(draggedItem, target);
                }
            });
        });
    },

    refreshArrows: function() {
        const container = document.getElementById('rotationContainer');
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

        const rules = {
            hard: {
                minGap11: document.getElementById('rule_minGap11').checked,
                maxDiversity3: document.getElementById('rule_maxDiversity3').checked,
                protectPregnant: document.getElementById('rule_protectPregnant').checked,
                twoOffPerFortnight: document.getElementById('rule_twoOffPerFortnight').checked,
                offGapMax: parseInt(document.getElementById('rule_offGapMax').value) || 12,
                weekStartDay: document.getElementById('rule_weekStartDay').value
            },
            policy: {
                reqOffWeight: document.getElementById('rule_reqOffWeight').value,
                reqBanWeight: document.getElementById('rule_reqBanWeight').value,
                limitConsecutive: document.getElementById('rule_limitConsecutive').checked,
                maxConsDays: parseInt(document.getElementById('rule_maxConsDays').value) || 6,
                longLeaveAdjust: document.getElementById('rule_longLeaveAdjust').checked,
                longLeaveThres: parseInt(document.getElementById('rule_longLeaveThres').value) || 5,
                longLeaveMaxCons: parseInt(document.getElementById('rule_longLeaveMaxCons').value) || 7,
                bundleNightOnly: document.getElementById('rule_bundleNightOnly').checked,
                noNightAfterOff: document.getElementById('rule_noNightAfterOff').checked,
                noNightAfterOff_N: document.getElementById('rule_noNightAfterOff_N').checked,
                noNightAfterOff_E: document.getElementById('rule_noNightAfterOff_E').checked,
                newbie_noNight3m: document.getElementById('rule_newbie_noNight3m').checked,
                newbie_noBigNight1m: document.getElementById('rule_newbie_noBigNight1m').checked,
                newbie_noSolo1m: document.getElementById('rule_newbie_noSolo1m').checked
            },
            pattern: {
                dayStartShift: document.getElementById('rule_dayStartShift').value,
                rotationOrder: this.getRotationOrderString(), // [修改] 從拖曳區取得字串
                consecutivePref: document.getElementById('rule_consecutivePref').checked,
                minConsecutive: parseInt(document.getElementById('rule_minConsecutive').value) || 2,
                avoidLonelyOff: document.getElementById('rule_avoidLonelyOff').checked,
                monthBuffer: document.getElementById('rule_monthBuffer').checked,
                monthBufferDays: parseInt(document.getElementById('rule_monthBufferDays').value) || 7
            },
            fairness: {
                fairOff: document.getElementById('rule_fairOff').checked,
                fairOffVar: parseInt(document.getElementById('rule_fairOffVar').value) || 2,
                fairOffExcludeLong: document.getElementById('rule_fairOffExcludeLong').checked,
                fairOffExcludeDays: parseInt(document.getElementById('rule_fairOffExcludeDays').value) || 6,
                fairHoliday: document.getElementById('rule_fairHoliday').checked,
                fairHolidayVar: parseInt(document.getElementById('rule_fairHolidayVar').value) || 2,
                fairHolidayIncNational: document.getElementById('rule_fairHolidayIncNational').checked,
                fairNight: document.getElementById('rule_fairNight').checked,
                fairNightVar: parseInt(document.getElementById('rule_fairNightVar').value) || 2
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
        wrapper.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(tabName)) btn.classList.add('active');
        });
    }
};
