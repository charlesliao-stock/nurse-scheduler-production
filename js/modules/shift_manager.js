// js/modules/shift_manager.js

const shiftManager = {
    allShifts: [],
    unitList: [], 
    sortState: { field: 'code', order: 'asc' },
    isLoading: false,

    init: async function() {
        console.log("Shift Manager Loaded.");
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<div class="empty-state"><h3>權限不足</h3></div>';
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
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
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
                this.renderTable();
            } else {
                modalSelect.disabled = false;
            }
            filterSelect.onchange = () => this.renderTable();
        } catch (e) { console.error(e); }
    },

    fetchData: async function() {
        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">載入中...</td></tr>';
        this.isLoading = true;

        try {
            const snapshot = await db.collection('shifts').get();
            this.allShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch (e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="7" style="color:red;">載入失敗</td></tr>`;
        } finally { this.isLoading = false; }
    },

    sortData: function(field) {
        if (this.sortState.field === field) this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        else { this.sortState.field = field; this.sortState.order = 'asc'; }
        this.renderTable();
    },

    renderTable: function() {
        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        const selectedUnitId = document.getElementById('filterShiftUnit')?.value;
        if (!selectedUnitId) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#999;">請先選擇單位</td></tr>';
            return;
        }

        let filtered = this.allShifts.filter(s => s.unitId === selectedUnitId);
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#999;">無班別資料<br><button class="btn btn-add" style="margin-top:10px;" onclick="shiftManager.openModal()">新增</button></td></tr>';
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
            const bundleIcon = s.isBundleAvailable ? '<i class="fas fa-check" style="color:#27ae60;"></i>' : '<span style="color:#eee;">-</span>';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><div class="color-dot" style="background-color:${s.color || '#ccc'};"></div></td>
                <td><span style="font-weight:bold; color:${s.color || '#333'};">${s.code}</span></td>
                <td>${s.name}</td>
                <td>${s.startTime} - ${s.endTime}</td>
                <td>${s.hours || 0}</td>
                <td style="text-align:center;">${bundleIcon}</td>
                <td>
                    <button class="btn btn-edit" onclick="shiftManager.openModal('${s.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="shiftManager.deleteShift('${s.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    openModal: function(shiftId = null) {
        const modal = document.getElementById('shiftModal');
        const modalUnitSelect = document.getElementById('inputShiftUnit');
        const currentUnitId = document.getElementById('filterShiftUnit').value;

        if (!currentUnitId && !shiftId && app.userRole !== 'system_admin') {
            alert("請先在上方選擇一個單位！"); return;
        }

        modal.classList.add('show');
        document.getElementById('shiftDocId').value = shiftId || '';
        document.getElementById('currentMode').value = shiftId ? 'edit' : 'add';

        if (shiftId) {
            const s = this.allShifts.find(x => x.id === shiftId);
            modalUnitSelect.value = s.unitId;
            document.getElementById('inputShiftCode').value = s.code;
            document.getElementById('inputShiftName').value = s.name;
            document.getElementById('inputStartTime').value = s.startTime;
            document.getElementById('inputEndTime').value = s.endTime;
            document.getElementById('inputWorkHours').value = s.hours || 0;
            document.getElementById('inputShiftColor').value = s.color || '#3498db';
            document.getElementById('colorHexCode').textContent = s.color || '#3498db';
            document.getElementById('checkIsBundle').checked = s.isBundleAvailable || false; // [新增]
            modalUnitSelect.disabled = true;
        } else {
            if (currentUnitId) modalUnitSelect.value = currentUnitId;
            modalUnitSelect.disabled = (app.userRole !== 'system_admin');
            document.getElementById('inputShiftCode').value = '';
            document.getElementById('inputShiftName').value = '';
            document.getElementById('inputStartTime').value = '08:00';
            document.getElementById('inputEndTime').value = '16:00';
            document.getElementById('inputWorkHours').value = '8';
            document.getElementById('inputShiftColor').value = '#3498db';
            document.getElementById('checkIsBundle').checked = false; // [新增]
        }
    },

    closeModal: function() { document.getElementById('shiftModal').classList.remove('show'); },

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
        const isBundle = document.getElementById('checkIsBundle').checked; // [新增]

        if (!unitId || !code || !name || !start || !end) { alert("請填寫完整資訊"); return; }

        if (!docId) {
            const dup = this.allShifts.find(s => s.unitId === unitId && s.code.toLowerCase() === code.toLowerCase());
            if(dup) { alert("代號重複"); return; }
        }

        const data = {
            unitId, code: code.toUpperCase(), name, startTime: start, endTime: end,
            hours: parseFloat(hours) || 0, color,
            isBundleAvailable: isBundle, // [新增]
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) await db.collection('shifts').doc(docId).update(data);
            else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('shifts').add(data);
            }
            alert("儲存成功");
            this.closeModal();
            await this.fetchData();
            document.getElementById('filterShiftUnit').value = unitId;
            this.renderTable();
        } catch (e) { alert("失敗: " + e.message); }
    },

    deleteShift: async function(id) {
        if(confirm("確定刪除？")) {
            await db.collection('shifts').doc(id).delete();
            this.fetchData();
        }
    }
};
