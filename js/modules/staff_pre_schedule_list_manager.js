// js/modules/staff_pre_schedule_list_manager.js

const staffPreScheduleListManager = {
    unitsMap: {},
    isLoading: false,

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

    // 2. 載入與過濾預班表
    loadMySchedules: async function() {
        const tbody = document.getElementById('myScheduleTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';
        
        try {
            // 策略：撈取所有最新的預班表 (例如最近 20 筆，跨所有單位)，然後在前端過濾
            // 這樣可以解決 "如何查詢我在哪個 array 裡" 的問題 (Firestore array-contains 限制)
            const snapshot = await db.collection('pre_schedules')
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(50) // 假設全院預班表數量，取 50 筆通常足夠覆蓋近期活躍的
                .get();

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">目前沒有預班表</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            const uid = app.getUid();
            const today = new Date().toISOString().split('T')[0];
            let count = 0;

            snapshot.forEach(doc => {
                const d = doc.data();
                const staffList = d.staffList || [];
                
                // [關鍵] 過濾：只有我是參與者才顯示
                // 這裡實現了 "鎖定自己相關" + "支援單位也能看到"
                const isParticipant = staffList.some(u => u.uid === uid);
                
                // 系統管理員可以看到全部 (方便測試)，或只看自己
                const isSystemAdmin = (app.userRole === 'system_admin');

                if (isParticipant || isSystemAdmin) {
                    count++;
                    const unitName = this.unitsMap[d.unitId] || d.unitId;
                    const s = d.settings || {};
                    const openDate = s.openDate || '9999-12-31';
                    const closeDate = s.closeDate || '1970-01-01';
                    const period = `${openDate} ~ ${closeDate}`;

                    // 狀態判斷
                    let statusText = '未知';
                    let statusColor = '#95a5a6';
                    let canEdit = false;

                    if (d.status === 'closed') {
                        statusText = '已截止 (鎖定)';
                        statusColor = '#e74c3c';
                    } else if (today < openDate) {
                        statusText = '準備中';
                        statusColor = '#f39c12';
                    } else if (today > closeDate) {
                        statusText = '已截止 (日期)';
                        statusColor = '#e74c3c';
                    } else {
                        statusText = '開放中';
                        statusColor = '#2ecc71';
                        canEdit = true;
                    }

                    // 按鈕
                    let btnHtml = '';
                    if (canEdit) {
                        btnHtml = `<button class="btn btn-add" onclick="staffPreScheduleManager.open('${doc.id}')"><i class="fas fa-edit"></i> 填寫預班</button>`;
                    } else {
                        btnHtml = `<button class="btn" style="background:#95a5a6;" onclick="staffPreScheduleManager.open('${doc.id}')"><i class="fas fa-eye"></i> 檢視</button>`;
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight:bold; color:#2c3e50;">${unitName}</td>
                        <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                        <td><small>${period}</small></td>
                        <td><span class="badge" style="background:${statusColor};">${statusText}</span></td>
                        <td>${btnHtml}</td>
                    `;
                    tbody.appendChild(tr);
                }
            });

            if (count === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">目前沒有您需要參與的預班表</td></tr>';
            }

        } catch(e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="5" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    }
};
