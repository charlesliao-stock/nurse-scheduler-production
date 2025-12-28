// js/modules/schedule_rule_manager.js

const scheduleRuleManager = {
    currentUnitId: null,
    
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
            
            // 權限控制：單位管理者只能看自己的單位
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

            // 若只有一個單位，自動選取
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadRules(select.value);
            }

            select.onchange = () => {
                if(select.value) this.loadRules(select.value);
                else document.getElementById('rulesContainer').style.display = 'none';
            };

        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    loadRules: async function(unitId) {
        this.currentUnitId = unitId;
        const container = document.getElementById('rulesContainer');
        container.style.display = 'block';
        
        try {
            const doc = await db.collection('units').doc(unitId).get();
            if(!doc.exists) return;
            
            const unitData = doc.data();
            const rules = unitData.schedulingRules || {};
            
            this.fillForm(rules);
            console.log("規則載入完成", rules);

        } catch(e) {
            console.error("Load Rules Error:", e);
            alert("規則載入失敗");
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
        document.getElementById('rule_rotationOrder').value = r.pattern?.rotationOrder || 'OFF,N,D,E';
        document.getElementById('rule_consecutivePref').checked = r.pattern?.consecutivePref !== false;
        document.getElementById('rule_minConsecutive').value = r.pattern?.minConsecutive || 2;
        document.getElementById('rule_avoidLonelyOff').checked = r.pattern?.avoidLonelyOff !== false;
        document.getElementById('rule_monthBuffer').checked = r.pattern?.monthBuffer !== false;
        document.getElementById('rule_monthBufferDays').value = r.pattern?.monthBufferDays || 7;

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
                rotationOrder: document.getElementById('rule_rotationOrder').value,
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
