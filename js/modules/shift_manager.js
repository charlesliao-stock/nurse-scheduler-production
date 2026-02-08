// js/modules/shift_manager.js
/**
 * 班別管理模組
 * Updated: 2026-02-08
 * 新增功能：
 * - 預班可用 (isPreScheduleAvailable)
 * - 排班可用 (isScheduleAvailable)
 * - 包班可用 (isBundleAvailable) - 原名「包班」
 * - 排班志願可用 (isPreferenceAvailable) - 原名「排班志願」
 */

const shiftManager = {
    allShifts: [],
    unitList: [], 
    sortState: { field: 'code', order: 'asc' },
    isLoading: false,

    init: async function() {
        console.log("Shift Manager Loaded.");
        
        // ✅ 權限檢查 - 使用當前有效角色
        const activeRole = app.impersonatedRole || app.userRole;
        
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理班別設定</p>
                </div>
            `;
            return;
        }
        
        const colorInput = document.getElementById('inputShiftColor');
        if(colorInput) {
            colorInput.onchange = (e) => {
                const hexCode = document.getElementById('colorHexCode');
                if(hexCode) hexCode.textContent = e.target.value;
            };
        }
        
        await this.loadUnits();
        await this.fetchData();
    },

    loadUnits: async function() {
        const filterSelect = document.getElementById('filterShiftUnit');
        const modalSelect = document.getElementById('inputShiftUnit');
        if(!filterSelect || !modalSelect) return;
        
        filterSelect.innerHTML = '<option value="">請選擇單位</option>';
        modalSelect.innerHTML = '';
        this.unitList = [];

        try {
            let query = db.collection('units');
            
            // ✅ 權限過濾 - 使用當前有效角色和單位
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
                }
            }
            
            const snapshot = await query.get();
            
            snapshot.forEach(doc => {
                const u = doc.data();
                this.unitList.push({ id: doc.id, name: u.name });
                const option = `<option value="${doc.id}">${u.name}</option>`;
                filterSelect.innerHTML += option;
                modalSelect.innerHTML += option;
            });

            // ✅ 如果只有一個單位，自動選取並限制
            if (this.unitList.length === 1) {
                filterSelect.value = this.unitList[0].id;
                modalSelect.value = this.unitList[0].id;
                modalSelect.disabled = true;
                
                // 單位護理長不需要看到篩選器
                if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                    filterSelect.disabled = true;
                    filterSelect.style.backgroundColor = '#f5f5f5';
                }
                
                this.renderTable();
            } else {
                modalSelect.disabled = false;
            }
            
            filterSelect.onchange = () => this.renderTable();
            
        } catch (e) { 
            console.error(e); 
        }
    },

    fetchData: async function() {
        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;">載入中...</td></tr>';
        this.isLoading = true;

        try {
            // ✅ 加入權限過濾 - 使用當前有效角色和單位
            let query = db.collection('shifts');
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where('unitId', '==', activeUnitId);
                }
            }
            
            const snapshot = await query.get();
            this.allShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch (e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="11" style="color:red;">載入失敗</td></tr>`;
        } finally { 
            this.isLoading = false; 
        }
    },

    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else { 
            this.sortState.field = field; 
            this.sortState.order = 'asc'; 
        }
        this.renderTable();
    },

    renderTable: function() {
        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        const selectedUnitId = document.getElementById('filterShiftUnit')?.value;
        if (!selectedUnitId) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:30px; color:#999;">請先選擇單位</td></tr>';
            return;
        }

        let filtered = this.allShifts.filter(s => s.unitId === selectedUnitId);
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:30px; color:#999;">無班別資料<br><button class="btn btn-add" style="margin-top:10px;" onclick="shiftManager.openModal()">新增班別</button></td></tr>';
            return;
        }

        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA = a[field] || '', valB = b[field] || '';
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        filtered.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:center;">
                    <div class="color-dot" style="background-color:${s.color || '#ccc'}; width:30px; height:20px; border-radius:4px; margin:0 auto; border:1px solid #ddd;"></div>
                </td>
                <td style="text-align:center;">
                    <span style="font-weight:bold; color:${s.color || '#333'}; font-size:1.1rem;">${s.code}</span>
                </td>
                <td>${s.name}</td>
                <td style="color:#7f8c8d; font-size:0.9rem;">${s.startTime} - ${s.endTime}</td>
                <td style="text-align:center; color:#7f8c8d;">${s.hours || 0}h</td>
                
                <!-- ✅ 預班可用 -->
                <td style="text-align:center;">
                    ${this.renderToggle(s.id, 'isPreScheduleAvailable', s.isPreScheduleAvailable)}
                </td>
                
                <!-- ✅ 排班可用 -->
                <td style="text-align:center;">
                    ${this.renderToggle(s.id, 'isScheduleAvailable', s.isScheduleAvailable !== false)}
                </td>
                
                <!-- ✅ 包班可用 -->
                <td style="text-align:center;">
                    ${this.renderToggle(s.id, 'isBundleAvailable', s.isBundleAvailable)}
                </td>
                
                <!-- ✅ 排班志願可用 -->
                <td style="text-align:center;">
                    ${this.renderToggle(s.id, 'isPreferenceAvailable', s.isPreferenceAvailable !== false)}
                </td>
                
                <td style="text-align:center; white-space:nowrap;">
                    <button class="btn btn-edit btn-sm" onclick="shiftManager.openModal('${s.id}')" style="margin-right:5px;">
                        <i class="fas fa-edit"></i> 編輯
                    </button>
                    <button class="btn btn-delete btn-sm" onclick="shiftManager.deleteShift('${s.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    /**
     * ✅ 新增：渲染切換開關
     */
    renderToggle: function(shiftId, field, value) {
        const isChecked = value === true;
        const toggleId = `toggle_${shiftId}_${field}`;
        
        return `
            <label class="toggle-switch" style="display:inline-block; position:relative; width:44px; height:22px; cursor:pointer; margin:0;">
                <input type="checkbox" 
                       id="${toggleId}"
                       ${isChecked ? 'checked' : ''} 
                       onchange="shiftManager.toggleField('${shiftId}', '${field}', this.checked)"
                       style="opacity:0; width:0; height:0;">
                <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:${isChecked ? '#27ae60' : '#ccc'}; border-radius:22px; transition:0.3s;">
                    <span style="position:absolute; height:16px; width:16px; left:${isChecked ? '24px' : '3px'}; bottom:3px; background-color:white; border-radius:50%; transition:0.3s;"></span>
                </span>
            </label>
        `;
    },

    /**
     * ✅ 新增：切換欄位狀態
     */
    toggleField: async function(shiftId, field, value) {
        try {
            await db.collection('shifts').doc(shiftId).update({
                [field]: value,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // 更新本地資料
            const shift = this.allShifts.find(s => s.id === shiftId);
            if (shift) {
                shift[field] = value;
            }
            
            // 更新切換器外觀
            const toggle = document.getElementById(`toggle_${shiftId}_${field}`);
            if (toggle && toggle.nextElementSibling) {
                const slider = toggle.nextElementSibling;
                slider.style.backgroundColor = value ? '#27ae60' : '#ccc';
                const dot = slider.querySelector('span');
                if (dot) dot.style.left = value ? '24px' : '3px';
            }
            
            const fieldNames = {
                'isPreScheduleAvailable': '預班可用',
                'isScheduleAvailable': '排班可用',
                'isBundleAvailable': '包班可用',
                'isPreferenceAvailable': '排班志願可用'
            };
            
            console.log(`✅ ${shift.code} - ${fieldNames[field]} 已更新為: ${value ? '啟用' : '停用'}`);
            
            // ✅ 重新渲染選單，以更新功能的顯示狀態
            if (typeof app !== 'undefined' && app.renderMenu) {
                app.renderMenu();
            }
            
        } catch (error) {
            console.error('更新失敗:', error);
            alert('更新失敗: ' + error.message);
            this.fetchData(); // 重新載入以還原狀態
        }
    },

    openModal: function(shiftId = null) {
        const modal = document.getElementById('shiftModal');
        const modalUnitSelect = document.getElementById('inputShiftUnit');
        const currentUnitId = document.getElementById('filterShiftUnit').value;
        
        // ✅ 使用當前有效角色
        const activeRole = app.impersonatedRole || app.userRole;

        if (!currentUnitId && !shiftId && activeRole !== 'system_admin') {
            alert("請先在上方選擇一個單位！"); 
            return;
        }

        modal.classList.add('show');
        document.getElementById('shiftDocId').value = shiftId || '';
        document.getElementById('currentMode').value = shiftId ? 'edit' : 'add';

        if (shiftId) {
            const s = this.allShifts.find(x => x.id === shiftId);
            if (!s) return;
            
            modalUnitSelect.value = s.unitId;
            document.getElementById('inputShiftCode').value = s.code;
            document.getElementById('inputShiftName').value = s.name;
            document.getElementById('inputStartTime').value = s.startTime;
            document.getElementById('inputEndTime').value = s.endTime;
            document.getElementById('inputWorkHours').value = s.hours || 0;
            document.getElementById('inputShiftColor').value = s.color || '#3498db';
            document.getElementById('colorHexCode').textContent = s.color || '#3498db';
            
            // ✅ 設定四個可用性欄位
            document.getElementById('checkIsPreSchedule').checked = s.isPreScheduleAvailable === true;
            document.getElementById('checkIsSchedule').checked = s.isScheduleAvailable !== false;
            document.getElementById('checkIsBundle').checked = s.isBundleAvailable === true;
            document.getElementById('checkIsPreference').checked = s.isPreferenceAvailable !== false;
            
            modalUnitSelect.disabled = true;
        } else {
            if (currentUnitId) modalUnitSelect.value = currentUnitId;
            modalUnitSelect.disabled = (activeRole !== 'system_admin');
            
            document.getElementById('inputShiftCode').value = '';
            document.getElementById('inputShiftName').value = '';
            document.getElementById('inputStartTime').value = '08:00';
            document.getElementById('inputEndTime').value = '16:00';
            document.getElementById('inputWorkHours').value = '8';
            document.getElementById('inputShiftColor').value = '#3498db';
            document.getElementById('colorHexCode').textContent = '#3498db';
            
            // ✅ 預設值：排班可用和志願可用預設啟用
            document.getElementById('checkIsPreSchedule').checked = false;
            document.getElementById('checkIsSchedule').checked = true;
            document.getElementById('checkIsBundle').checked = false;
            document.getElementById('checkIsPreference').checked = true;
        }
    },

    closeModal: function() { 
        document.getElementById('shiftModal').classList.remove('show'); 
    },

    autoCalcHours: function() {
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        if(!start || !end) return;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let diff = (eh + em/60) - (sh + sm/60);
        if (diff < 0) diff += 24;
        document.getElementById('inputWorkHours').value = diff.toFixed(1);
    },

    saveData: async function() {
        const docId = document.getElementById('shiftDocId').value;
        const unitId = document.getElementById('inputShiftUnit').value;
        const code = document.getElementById('inputShiftCode').value.trim();
        const name = document.getElementById('inputShiftName').value.trim();
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        const hours = document.getElementById('inputWorkHours').value;
        const color = document.getElementById('inputShiftColor').value;
        
        // ✅ 讀取四個可用性欄位
        const isPreSchedule = document.getElementById('checkIsPreSchedule').checked;
        const isSchedule = document.getElementById('checkIsSchedule').checked;
        const isBundle = document.getElementById('checkIsBundle').checked;
        const isPreference = document.getElementById('checkIsPreference').checked;

        if (!unitId || !code || !name || !start || !end) { 
            alert("請填寫完整資訊"); 
            return; 
        }
        
        // ✅ 權限檢查：確保只能操作自己單位的資料 - 使用當前有效角色和單位
        const activeRole = app.impersonatedRole || app.userRole;
        const activeUnitId = app.impersonatedUnitId || app.userUnitId;
        
        if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
            if (activeUnitId && unitId !== activeUnitId) {
                alert("您只能管理自己單位的班別！");
                return;
            }
        }

        if (!docId) {
            const dup = this.allShifts.find(s => s.unitId === unitId && s.code.toLowerCase() === code.toLowerCase());
            if(dup) { 
                alert("班別代碼重複"); 
                return; 
            }
        }

        const data = {
            unitId, 
            code: code.toUpperCase(), 
            name, 
            startTime: start, 
            endTime: end,
            hours: parseFloat(hours) || 0, 
            color,
            
            // ✅ 儲存四個可用性欄位
            isPreScheduleAvailable: isPreSchedule,
            isScheduleAvailable: isSchedule,
            isBundleAvailable: isBundle,
            isPreferenceAvailable: isPreference,
            
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) {
                await db.collection('shifts').doc(docId).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('shifts').add(data);
            }
            alert("儲存成功");
            this.closeModal();
            await this.fetchData();
            document.getElementById('filterShiftUnit').value = unitId;
            this.renderTable();
            
            // ✅ 重新渲染選單，以更新功能的顯示狀態
            if (typeof app !== 'undefined' && app.renderMenu) {
                app.renderMenu();
            }
        } catch (e) { 
            alert("儲存失敗: " + e.message); 
        }
    },

    deleteShift: async function(id) {
        // ✅ 權限檢查：確保只能刪除自己單位的班別 - 使用當前有效角色和單位
        const shift = this.allShifts.find(s => s.id === id);
        if (!shift) return;
        
        const activeRole = app.impersonatedRole || app.userRole;
        const activeUnitId = app.impersonatedUnitId || app.userUnitId;
        
        if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
            if (activeUnitId && shift.unitId !== activeUnitId) {
                alert("您只能刪除自己單位的班別！");
                return;
            }
        }
        
        if(confirm(`確定要刪除班別「${shift.code} - ${shift.name}」嗎？\n\n此操作無法復原。`)) {
            try {
                await db.collection('shifts').doc(id).delete();
                await this.fetchData();
                
                // ✅ 重新渲染選單，以更新功能的顯示狀態
                if (typeof app !== 'undefined' && app.renderMenu) {
                    app.renderMenu();
                }
            } catch (error) {
                console.error('刪除失敗:', error);
                alert('刪除失敗: ' + error.message);
            }
        }
    }
};
