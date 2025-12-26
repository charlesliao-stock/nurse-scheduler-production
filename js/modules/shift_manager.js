// js/modules/shift_manager.js

const shiftManager = {
    allShifts: [],
    unitList: [], 
    // [排序狀態]
    sortState: { field: 'code', order: 'asc' },

    // --- 初始化 ---
    init: async function() {
        console.log("Shift Manager Loaded.");
        
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足：一般使用者無法管理班別</h3>';
            return;
        }

        const colorInput = document.getElementById('inputShiftColor');
        if(colorInput) {
            colorInput.onchange = (e) => {
                document.getElementById('colorHexCode').textContent = e.target.value;
            };
        }

        await this.loadUnits();
        await this.fetchData();
    },

    // --- 1. 載入單位列表 ---
    loadUnits: async function() {
        const filterSelect = document.getElementById('filterShiftUnit');
        const modalSelect = document.getElementById('inputShiftUnit');
        
        filterSelect.innerHTML = '<option value="">請選擇單位</option>';
        modalSelect.innerHTML = '';
        this.unitList = [];

        try {
            let query = db.collection('units');
            
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
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

            if (this.unitList.length === 1) {
                filterSelect.value = this.unitList[0].id;
                modalSelect.value = this.unitList[0].id;
                modalSelect.disabled = true; 
            } else {
                modalSelect.disabled = false;
            }

            filterSelect.onchange = () => this.renderTable();

        } catch (e) {
            console.error("Load Units Error:", e);
        }
    },

    // --- 2. 讀取班別資料 ---
    fetchData: async function() {
        const tbody = document.getElementById('shiftTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';

        try {
            const snapshot = await db.collection('shifts').get();
            this.allShifts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            this.renderTable();
        } catch (e) {
            console.error("Fetch Shifts Error:", e);
            tbody.innerHTML = '<tr><td colspan="6" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- [新增] 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 3. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('shiftTableBody');
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_shift_"]').forEach(i => i.className = 'fas fa-sort');
        const activeIcon = document.getElementById(`sort_icon_shift_${this.sortState.field}`);
        if(activeIcon) activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const selectedUnitId = document.getElementById('filterShiftUnit').value;
        if (!selectedUnitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">請先選擇單位以檢視班別</td></tr>';
            return;
        }

        // 1. 篩選
        let filtered = this.allShifts.filter(s => s.unitId === selectedUnitId);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">此單位尚無班別設定</td></tr>';
            return;
        }

        // 2. 排序
        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        filtered.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><div class="color-dot" style="background-color:${s.color};"></div></td>
                <td><span style="font-weight:bold;">${s.code}</span></td>
                <td>${s.name}</td>
                <td>${s.startTime} - ${s.endTime}</td>
                <td>${s.hours}</td>
                <td>
                    <button class="btn btn-edit" onclick="shiftManager.openModal('${s.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="shiftManager.deleteShift('${s.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- 4. Modal 操作 ---
    openModal: function(shiftId = null) {
        const modal = document.getElementById('shiftModal');
        const currentUnitId = document.getElementById('filterShiftUnit').value;
        const modalUnitSelect = document.getElementById('inputShiftUnit');

        if (!currentUnitId && !shiftId && app.userRole !== 'system_admin') {
            alert("請先在上方選擇一個單位！");
            return;
        }

        modal.classList.add('show');
        document.getElementById('shiftDocId').value = shiftId || '';
        document.getElementById('currentMode').value = shiftId ? 'edit' : 'add';

        if (shiftId) {
            // [編輯]
            const s = this.allShifts.find(x => x.id === shiftId);
            if (s) {
                modalUnitSelect.value = s.unitId;
                document.getElementById('inputShiftCode').value = s.code;
                document.getElementById('inputShiftName').value = s.name;
                document.getElementById('inputStartTime').value = s.startTime;
                document.getElementById('inputEndTime').value = s.endTime;
                document.getElementById('inputWorkHours').value = s.hours;
                document.getElementById('inputShiftColor').value = s.color || '#3498db';
                document.getElementById('colorHexCode').textContent = s.color || '#3498db';
                modalUnitSelect.disabled = true;
            }
        } else {
            // [新增]
            if (currentUnitId) modalUnitSelect.value = currentUnitId;
            modalUnitSelect.disabled = (app.userRole !== 'system_admin');
            document.getElementById('inputShiftCode').value = '';
            document.getElementById('inputShiftName').value = '';
            document.getElementById('inputStartTime').value = '08:00';
            document.getElementById('inputEndTime').value = '16:00';
            document.getElementById('inputWorkHours').value = '8';
            document.getElementById('inputShiftColor').value = '#3498db';
            document.getElementById('colorHexCode').textContent = '#3498db';
        }
    },

    closeModal: function() {
        document.getElementById('shiftModal').classList.remove('show');
    },

    autoCalcHours: function() {
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        if(!start || !end) return;

        let s = parseInt(start.split(':')[0]) + parseInt(start.split(':')[1])/60;
        let e = parseInt(end.split(':')[0]) + parseInt(end.split(':')[1])/60;

        let diff = e - s;
        if (diff < 0) diff += 24; 

        document.getElementById('inputWorkHours').value = diff;
    },

    // --- 5. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('shiftDocId').value;
        const unitId = document.getElementById('inputShiftUnit').value;
        const code = document.getElementById('inputShiftCode').value.trim();
        const name = document.getElementById('inputShiftName').value.trim();
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        const hours = document.getElementById('inputWorkHours').value;
        const color = document.getElementById('inputShiftColor').value;

        if (!unitId || !code || !name || !start || !end) {
            alert("請填寫所有必填欄位 (*) ");
            return;
        }

        const data = {
            unitId: unitId,
            code: code,
            name: name,
            startTime: start,
            endTime: end,
            hours: parseFloat(hours) || 0,
            color: color,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) {
                await db.collection('shifts').doc(docId).update(data);
            } else {
                const dupCheck = this.allShifts.find(s => s.unitId === unitId && s.code === code);
                if(dupCheck) { alert(`此單位已存在代號 [${code}] 的班別！`); return; }
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('shifts').add(data);
            }
            alert("儲存成功");
            this.closeModal();
            await this.fetchData();
            document.getElementById('filterShiftUnit').value = unitId;
            this.renderTable();
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    deleteShift: async function(id) {
        if(confirm("確定要刪除此班別嗎？\n注意：這可能會影響已排班的資料顯示。")) {
            try {
                await db.collection('shifts').doc(id).delete();
                await this.fetchData();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    }
};
