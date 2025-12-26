// js/modules/shift_manager.js

const shiftManager = {
    allShifts: [],
    unitList: [], // 暫存單位列表 {id, name}

    // --- 初始化 ---
    init: async function() {
        console.log("Shift Manager Loaded.");
        
        // 權限檢查：一般使用者無權進入 (Router 可能已擋，這裡雙重保險)
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足：一般使用者無法管理班別</h3>';
            return;
        }

        // 綁定顏色選擇器變更文字
        const colorInput = document.getElementById('inputShiftColor');
        if(colorInput) {
            colorInput.onchange = (e) => {
                document.getElementById('colorHexCode').textContent = e.target.value;
            };
        }

        await this.loadUnits();
        await this.fetchData();
    },

    // --- 1. 載入單位列表 (用於下拉選單) ---
    loadUnits: async function() {
        const filterSelect = document.getElementById('filterShiftUnit');
        const modalSelect = document.getElementById('inputShiftUnit');
        
        filterSelect.innerHTML = '<option value="">請選擇單位</option>';
        modalSelect.innerHTML = '';
        this.unitList = [];

        try {
            let query = db.collection('units');
            
            // 如果是「單位管理者/排班者」，只能看到自己的單位
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                } else {
                    console.warn("User has role but no unitId");
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

            // 如果只有一個單位 (單位管理者)，預設選中
            if (this.unitList.length === 1) {
                filterSelect.value = this.unitList[0].id;
                modalSelect.value = this.unitList[0].id;
                // 單位管理者不可更改 modal 內的單位
                modalSelect.disabled = true; 
            } else {
                // 系統管理員，Modal 內的單位選單可以選
                modalSelect.disabled = false;
            }

            // 綁定篩選事件
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
            // 讀取所有班別 (前端再濾，因為資料量通常不大)
            // 嚴謹一點可以用 .where('unitId', '==', ...) 但為了切換流暢先抓全部
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

    // --- 3. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('shiftTableBody');
        tbody.innerHTML = '';

        const selectedUnitId = document.getElementById('filterShiftUnit').value;

        // 如果未選擇單位，且是管理員，顯示提示
        if (!selectedUnitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">請先選擇單位以檢視班別</td></tr>';
            return;
        }

        // 過濾出該單位的班別
        const filtered = this.allShifts.filter(s => s.unitId === selectedUnitId);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">此單位尚無班別設定</td></tr>';
            return;
        }

        // 排序：習慣上按代號或時間排，這裡簡單按代號排
        filtered.sort((a, b) => a.code.localeCompare(b.code));

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
            // [編輯模式]
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
                
                // 編輯時鎖定單位，不讓班別隨意換單位
                modalUnitSelect.disabled = true;
            }
        } else {
            // [新增模式]
            // 如果上方有選單位，自動帶入
            if (currentUnitId) {
                modalUnitSelect.value = currentUnitId;
            }
            
            // 若是系統管理員且未選單位，開放選擇；否則鎖定
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

    // 工具：自動計算工時
    autoCalcHours: function() {
        const start = document.getElementById('inputStartTime').value;
        const end = document.getElementById('inputEndTime').value;
        if(!start || !end) return;

        // 簡單計算：假設跨夜班
        let s = parseInt(start.split(':')[0]) + parseInt(start.split(':')[1])/60;
        let e = parseInt(end.split(':')[0]) + parseInt(end.split(':')[1])/60;

        let diff = e - s;
        if (diff < 0) diff += 24; // 跨日

        // 扣除休息時間? 目前簡單算總時數
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
                // 編輯
                await db.collection('shifts').doc(docId).update(data);
            } else {
                // 新增
                // 檢查同單位下代號是否重複
                const dupCheck = this.allShifts.find(s => s.unitId === unitId && s.code === code);
                if(dupCheck) {
                    alert(`此單位已存在代號 [${code}] 的班別！`);
                    return;
                }

                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('shifts').add(data);
            }
            
            alert("儲存成功");
            this.closeModal();
            // 重新讀取 (或直接推入 array 更新畫面)
            await this.fetchData();
            
            // 保持篩選器在該單位
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
