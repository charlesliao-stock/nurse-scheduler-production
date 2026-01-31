// js/modules/staff_pre_schedule_list_manager.js

const staffPreScheduleListManager = {
    unitsMap: {},
    allSchedules: [], // 暫存撈出的原始資料，方便前端快速篩選

    init: async function() {
        console.log("Staff Pre-Schedule List Init");
        if (!app.currentUser) {
            document.getElementById('content-area').innerHTML = '<div style="padding:30px; text-align:center;">請先登入</div>';
            return;
        }
        await this.loadUnits();
        await this.loadMySchedules();
    },

    // 1. 預載入單位名稱對照表
    loadUnits: async function() {
        try {
            const snapshot = await db.collection('units').get();
            snapshot.forEach(doc => {
                this.unitsMap[doc.id] = doc.data().name;
            });
        } catch(e) { console.error("Load Units Error:", e); }
    },

    // 2. 渲染單位篩選器 (根據權限過濾選項)
    renderUnitFilter: function() {
        const filterContainer = document.getElementById('unitFilterContainer');
        if (!filterContainer) return;

        // 找出目前列表資料中所有出現過的單位 ID
        const activeUnitIds = [...new Set(this.allSchedules.map(s => s.unitId))];
        
        let html = `
            <div style="margin-bottom: 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; display: flex; align-items: center; gap: 10px;">
                <label style="font-weight: bold; color: #555;"><i class="fas fa-filter"></i> 單位篩選：</label>
                <select id="staffPreUnitFilter" class="form-control" style="width: 200px;" onchange="staffPreScheduleListManager.applyFilter()">
                    <option value="all">全部單位</option>`;
        
        activeUnitIds.forEach(uid => {
            html += `<option value="${uid}">${this.unitsMap[uid] || uid}</option>`;
        });

        html += `</select></div>`;
        filterContainer.innerHTML = html;
    },

    // 3. 載入原始數據
    loadMySchedules: async function() {
        const tbody = document.getElementById('myScheduleTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const snapshot = await db.collection('pre_schedules')
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(100)
                .get();

            const uid = app.getUid();
            const unitId = app.getUnitId();
            const isSystemAdmin = (app.userRole === 'system_admin');

            // 存入 allSchedules
            this.allSchedules = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                const isMember = (d.unitId === unitId) || (d.staffList || []).some(s => s.uid === uid);
                
                // 系統管理員看全部，一般使用者只看有關聯的
                if (isSystemAdmin || isMember) {
                    this.allSchedules.push({ id: doc.id, ...d });
                }
            });

            this.renderUnitFilter();
            this.applyFilter(); // 執行初次渲染

        } catch(e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    // 4. 執行篩選與渲染表格
    applyFilter: function() {
        const tbody = document.getElementById('myScheduleTableBody');
        const filterValue = document.getElementById('staffPreUnitFilter')?.value || 'all';
        if(!tbody) return;

        const filtered = filterValue === 'all' 
            ? this.allSchedules 
            : this.allSchedules.filter(s => s.unitId === filterValue);

        tbody.innerHTML = '';
        const isSystemAdmin = (app.userRole === 'system_admin');

        filtered.forEach(d => {
            const unitName = this.unitsMap[d.unitId] || d.unitId;
            const period = `${d.settings?.openDate || ''} ~ ${d.settings?.closeDate || ''}`;
            
            // 🟢 調用全域統一狀態判定
            const statusInfo = app.getPreScheduleStatus(d);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:bold; color:#2c3e50;">${unitName}</td>
                <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                <td><small>${period}</small></td>
                <td><span class="badge" style="background:${statusInfo.color};">${statusInfo.text}</span></td>
                <td>
                    <div style="display:flex; gap:5px;">
                        <button class="btn ${statusInfo.canEdit ? 'btn-add' : ''}" 
                                style="${!statusInfo.canEdit ? 'background:#95a5a6;' : ''}"
                                onclick="staffPreScheduleManager.open('${d.id}')">
                            <i class="fas ${statusInfo.canEdit ? 'fa-edit' : 'fa-eye'}"></i> 
                            ${statusInfo.canEdit ? '填寫預班' : '檢視'}
                        </button>
                        ${isSystemAdmin ? `
                        <button class="btn btn-danger" onclick="staffPreScheduleListManager.deleteSchedule('${d.id}')">
                            <i class="fas fa-trash"></i> 刪除
                        </button>` : ''}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">沒有符合條件的預班表</td></tr>';
        }
    },

    // 5. [系統管理員] 刪除預班表
    deleteSchedule: async function(docId) {
        if (!confirm("⚠️ 警告：系統管理員權限\n確定要刪除此預班表嗎？相關的所有填寫資料也將一併刪除且無法恢復！")) return;

        try {
            await db.collection('pre_schedules').doc(docId).delete();
            alert("✅ 預班表已成功刪除");
            await this.loadMySchedules(); // 重新載入
        } catch(e) {
            console.error("Delete Error:", e);
            alert("刪除失敗: " + e.message);
        }
    }
};
