// js/modules/shift_manager.js (優化版)

const shiftManager = {
    allShifts: [],
    unitList: [], 
    sortState: { field: 'code', order: 'asc' },
    isLoading: false,

    // --- 初始化 ---
    init: async function() {
        console.log("Shift Manager Loaded.");
        
        // 權限檢查
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理班別設定</p>
                </div>
            `;
            return;
        }

        // 顏色選擇器監聽
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

    // --- 1. 載入單位列表 ---
    loadUnits: async function() {
        const filterSelect = document.getElementById('filterShiftUnit');
        const modalSelect = document.getElementById('inputShiftUnit');
        
        if(!filterSelect || !modalSelect) {
            console.error("找不到單位選擇器");
            return;
        }
        
        filterSelect.innerHTML = '<option value="">請選擇單位</option>';
        modalSelect.innerHTML = '';
        this.unitList = [];

        try {
            let query = db.collection('units');
            
            // 權限過濾
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

            // 如果只有一個單位,自動選擇
            if (this.unitList.length === 1) {
                filterSelect.value = this.unitList[0].id;
                modalSelect.value = this.unitList[0].id;
                modalSelect.disabled = true;
                this.renderTable(); // 自動顯示
            } else {
                modalSelect.disabled = false;
            }

            filterSelect.onchange = () => this.renderTable();
            
            console.log(`載入 ${this.unitList.length} 個單位`);

        } catch (e) {
            console.error("Load Units Error:", e);
            filterSelect.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    // --- 2. 讀取班別資料 ---
    fetchData: async function() {
        if(this.isLoading) {
            console.log("資料載入中...");
            return;
        }

        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) {
            console.error("找不到表格 tbody");
            return;
        }

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        this.isLoading = true;

        try {
            const snapshot = await db.collection('shifts').get();
            this.allShifts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            console.log(`成功載入 ${this.allShifts.length} 個班別`);
            this.renderTable();
            
        } catch (e) {
            console.error("Fetch Shifts Error:", e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        } finally {
            this.isLoading = false;
        }
    },

    // --- 3. 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 4. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('shiftTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_shift_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_shift_${this.sortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        const selectedUnitId = document.getElementById('filterShiftUnit')?.value;
        
        if (!selectedUnitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;"><i class="fas fa-arrow-up" style="font-size:2rem; display:block; margin-bottom:10px;"></i>請先選擇單位以檢視班別</td></tr>';
            return;
        }

        // 1. 篩選
        let filtered = this.allShifts.filter(s => s.unitId === selectedUnitId);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">此單位尚無班別設定<br><button class="btn btn-add" style="margin-top:10px;" onclick="shiftManager.openModal()">立即新增</button></td></tr>';
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

        // 3. 渲染
        const fragment = document.createDocumentFragment();
        
        filtered.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><div class="color-dot" style="background-color:${s.color || '#ccc'};"></div></td>
                <td><span style="font-weight:bold; color:${s.color || '#333'};">${s.code}</span></td>
                <td>${s.name}</td>
                <td>${s.startTime} - ${s.endTime}</td>
                <td>${s.hours || 0}</td>
                <td>
                    <button class="btn btn-edit" onclick="shiftManager.openModal('${s.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="shiftManager.deleteShift('${s.id}')">刪除</button>
                </td>
            `;
            fragment.appendChild(tr);
        });
        
        tbody.appendChild(fragment);
    },

    // --- 5. Modal 操作 ---
    openModal: function(shiftId = null) {
        const modal = document.getElementById('shiftModal');
        if(!modal) {
            console.error("找不到 Modal");
            return;
        }

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
            // 編輯模式
            const s = this.allShifts.find(x => x.id === shiftId);
            if (!s) {
                alert("找不到該班別資料");
                this.closeModal();
                return;
            }
            
            modalUnitSelect.value = s.unitId;
            document.getElementById('inputShiftCode').value = s.code;
            document.getElementById('inputShiftName').value = s.name;
            document.getElementById('inputStartTime').value = s.startTime;
            document.getElementById('inputEndTime').value = s.endTime;
            document.getElementById('inputWorkHours').value = s.hours || 0;
            document.getElementById('inputShiftColor').value = s.color || '#3498db';
            document.getElementById('colorHexCode').textContent = s.color || '#3498db';
            modalUnitSelect.disabled = true;
            
        } else {
            // 新增模式
            if (currentUnitId) {
                modalUnitSelect.value = currentUnitId;
            }
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
        const modal = document.getElementById('shiftModal');
        if(modal) modal.classList.remove('show');
    },

    autoCalcHours: function() {
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        
        if(!start || !end) {
            alert("請先輸入上下班時間");
            return;
        }

        const [startHour, startMin] = start.split(':').map(Number);
        const [endHour, endMin] = end.split(':').map(Number);

        let startDecimal = startHour + startMin / 60;
        let endDecimal = endHour + endMin / 60;

        let diff = endDecimal - startDecimal;
        if (diff < 0) diff += 24; // 跨日班

        document.getElementById('inputWorkHours').value = diff.toFixed(1);
    },

    // --- 6. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('shiftDocId').value;
        const unitId = document.getElementById('inputShiftUnit').value;
        const code = document.getElementById('inputShiftCode').value.trim();
        const name = document.getElementById('inputShiftName').value.trim();
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        const hours = document.getElementById('inputWorkHours').value;
        const color = document.getElementById('inputShiftColor').value;

        // 驗證
        if (!unitId) { 
            alert("請選擇所屬單位"); 
            return; 
        }
        if (!code) { 
            alert("請輸入班別代號"); 
            document.getElementById('inputShiftCode').focus();
            return; 
        }
        if (!name) { 
            alert("請輸入班別名稱"); 
            document.getElementById('inputShiftName').focus();
            return; 
        }
        if (!start || !end) { 
            alert("請設定上下班時間"); 
            return; 
        }

        // 代號格式驗證（建議1-3個字元）
        if (code.length > 3) {
            if(!confirm("班別代號建議不超過3個字元,是否繼續？")) {
                document.getElementById('inputShiftCode').focus();
                return;
            }
        }

        // 檢查重複（同單位同代號）
        if (!docId) {
            const duplicate = this.allShifts.find(s => 
                s.unitId === unitId && s.code.toLowerCase() === code.toLowerCase()
            );
            if(duplicate) { 
                alert(`此單位已存在代號 [${code}] 的班別！`); 
                document.getElementById('inputShiftCode').focus();
                return; 
            }
        }

        const data = {
            unitId: unitId,
            code: code.toUpperCase(), // 統一大寫
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
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('shifts').add(data);
            }
            
            alert("儲存成功！");
            this.closeModal();
            await this.fetchData();
            
            // 保持單位選擇
            document.getElementById('filterShiftUnit').value = unitId;
            this.renderTable();
            
        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    deleteShift: async function(id) {
        const shift = this.allShifts.find(s => s.id === id);
        
        if(!confirm(`確定要刪除班別「${shift?.name || ''}」嗎？\n\n注意：這可能會影響已排班的資料顯示。`)) {
            return;
        }

        try {
            await db.collection('shifts').doc(id).delete();
            alert("刪除成功");
            await this.fetchData();
        } catch(e) {
            console.error("Delete Error:", e);
            alert("刪除失敗: " + e.message);
        }
    }
};
