// js/modules/staff_pre_schedule_list_manager.js

const staffPreScheduleListManager = {
    unitsMap: {},
    allSchedules: [],

    init: async function() {
        console.log("Staff Pre-Schedule List Init");
        if (!app.currentUser) {
            document.getElementById('content-area').innerHTML = '<div style="padding:30px; text-align:center;">請先登入</div>';
            return;
        }
        await this.loadUnits();
        await this.loadMySchedules();
    },

    loadUnits: async function() {
        try {
            const snapshot = await db.collection('units').get();
            snapshot.forEach(doc => { this.unitsMap[doc.id] = doc.data().name; });
        } catch(e) { console.error("Load Units Error:", e); }
    },

    loadMySchedules: async function() {
        const tbody = document.getElementById('myScheduleTableBody'); if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const snapshot = await db.collection('pre_schedules').orderBy('year', 'desc').orderBy('month', 'desc').limit(50).get();
            const activeRole = app.impersonatedRole || app.userRole;
            const uid = app.getUid(); const userUnitId = app.getUnitId(); const isSystemAdmin = (activeRole === 'system_admin');

            this.allSchedules = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                const isPart = (d.staffList || []).some(s => s.uid === uid) || (d.unitId === userUnitId);
                if (isPart || isSystemAdmin) { this.allSchedules.push({ id: doc.id, ...d }); }
            });

            this.renderUnitFilter();
            this.applyFilter();
        } catch(e) { console.error(e); tbody.innerHTML = `<tr><td colspan="5" style="color:red;">載入失敗: ${e.message}</td></tr>`; }
    },

    renderUnitFilter: function() {
        const container = document.getElementById('unitFilterContainer'); if (!container) return;
        const uids = [...new Set(this.allSchedules.map(s => s.unitId))];
        let html = `<div style="margin-bottom:15px;"><label>單位篩選：</label><select id="staffPreUnitFilter" class="form-control" style="width:200px; display:inline-block;" onchange="staffPreScheduleListManager.applyFilter()"><option value="all">全部單位</option>`;
        uids.forEach(id => { html += `<option value="${id}">${this.unitsMap[id] || id}</option>`; });
        container.innerHTML = html + `</select></div>`;
    },

    applyFilter: function() {
        const tbody = document.getElementById('myScheduleTableBody'); if(!tbody) return;
        const filter = document.getElementById('staffPreUnitFilter')?.value || 'all';
        const filtered = filter === 'all' ? this.allSchedules : this.allSchedules.filter(s => s.unitId === filter);
        const activeRole = app.impersonatedRole || app.userRole;
        const isSystemAdmin = (activeRole === 'system_admin');

        tbody.innerHTML = '';
        filtered.forEach(d => {
            const statusInfo = app.getPreScheduleStatus(d);
            let displayText = statusInfo.text;
            
            // 統一狀態標記修正
            if (statusInfo.code === 'expired' || statusInfo.code === 'closed') displayText = '已鎖定(預班結束)';
            if (statusInfo.code === 'published') displayText = '已鎖定(班表公佈)';
            if (statusInfo.code === 'open' && d.isManualOpen) displayText = '開放中 (管理者開放)';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:bold; color:#2c3e50;">${this.unitsMap[d.unitId] || d.unitId}</td>
                <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                <td><small>${d.settings.openDate} ~ ${d.settings.closeDate}</small></td>
                <td><span class="badge" style="background:${statusInfo.color};">${displayText}</span></td>
                <td>
                    <button class="btn ${statusInfo.canEdit ? 'btn-add' : ''}" style="${!statusInfo.canEdit ? 'background:#95a5a6;' : ''}" onclick="staffPreScheduleManager.open('${d.id}')">
                        <i class="fas ${statusInfo.canEdit ? 'fa-edit' : 'fa-eye'}"></i> ${statusInfo.canEdit ? '填寫預班' : '檢視'}
                    </button>
                    ${isSystemAdmin ? `<button class="btn btn-delete btn-sm" onclick="staffPreScheduleListManager.deleteSchedule('${d.id}')" style="margin-left:5px;"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
        if (filtered.length === 0) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">查無預班表項目</td></tr>';
    },

    deleteSchedule: async function(id) {
        if(confirm("管理員確認：確定刪除此預班表？此操作將同時移除所有相關填寫內容。")) {
            try { await db.collection('pre_schedules').doc(id).delete(); this.loadMySchedules(); }
            catch(e) { alert("刪除失敗: " + e.message); }
        }
    }
};
