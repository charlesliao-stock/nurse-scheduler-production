// js/modules/shift_exchange_manager.js

const shiftExchangeManager = {
    currentTab: 'my_requests', // 'my_requests', 'to_me', 'manager'
    allData: [],

    init: async function() {
        console.log("Shift Exchange Manager Module Loaded.");
        this.setupEventListeners();
        await this.loadData();
    },

    setupEventListeners: function() {
        const tabs = document.querySelectorAll('.exchange-tabs .tab');
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentTab = tab.dataset.tab;
                this.loadData();
            };
        });
    },

    loadData: async function() {
        const tbody = document.getElementById('exchangeTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> 載入中...</td></tr>';

        try {
            let query = db.collection('shift_exchanges');
            const type = this.currentTab;

            if (type === 'my_requests') {
                // ✅ 我發出的申請
                query = query.where('requesterUid', '==', app.currentUser.uid)
                             .orderBy('createdAt', 'desc');
            } 
            else if (type === 'to_me') {
                // ✅ 待我同意的申請 (我是對象)
                query = query.where('targetUid', '==', app.currentUser.uid)
                             .where('status', '==', 'pending_target')
                             .orderBy('createdAt', 'desc');
            } 
            else if (type === 'manager') {
                // ✅ 等待護理長審核 (限制只看自己單位的申請)
                query = query.where('status', '==', 'pending_manager')
                             .orderBy('createdAt', 'desc');
                
                // 如果是單位護理長，只顯示該單位的申請
                const activeRole = app.impersonatedRole || app.userRole;
                const activeUnitId = app.impersonatedUnitId || app.userUnitId;
                if (activeRole === 'unit_manager' && activeUnitId) {
                    query = query.where('unitId', '==', activeUnitId);
                }
            }

            const snapshot = await query.get();
            
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">目前沒有資料</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const data = doc.data();
                const id = doc.id;
                const row = document.createElement('tr');
                
                let actions = '';
                if (this.currentTab === 'to_me' && data.status === 'pending_target') {
                    actions = `
                        <button class="btn btn-sm btn-success" onclick="shiftExchangeManager.approveRequest('${id}', 'target')">同意</button>
                        <button class="btn btn-sm btn-danger" onclick="shiftExchangeManager.rejectRequest('${id}')">拒絕</button>
                    `;
                } else if (this.currentTab === 'manager' && data.status === 'pending_manager') {
                    // ✅ 權限檢查：只有該單位護理長或系統管理員可以核准
                    const activeRole = app.impersonatedRole || app.userRole;
                    const activeUnitId = app.impersonatedUnitId || app.userUnitId;
                    const canApprove = (activeRole === 'system_admin') || (activeRole === 'unit_manager' && activeUnitId === data.unitId);
                    
                    if (canApprove) {
                        actions = `
                            <button class="btn btn-sm btn-success" onclick="shiftExchangeManager.approveRequest('${id}', 'manager')">核准</button>
                            <button class="btn btn-sm btn-danger" onclick="shiftExchangeManager.rejectRequest('${id}')">退回</button>
                        `;
                    } else {
                        actions = '<span style="color:#999;">非權責單位</span>';
                    }
                } else {
                    actions = '<span style="color:#ccc;">-</span>';
                }

                row.innerHTML = `
                    <td>${data.date}</td>
                    <td>${data.requesterName}</td>
                    <td>${data.requesterShift}</td>
                    <td>${data.targetName}</td>
                    <td>${data.targetShift}</td>
                    <td>${this.translateStatus(data.status)}</td>
                    <td>${data.reason || '-'}</td>
                    <td>${actions}</td>
                `;
                tbody.appendChild(row);
            });

        } catch (e) {
            console.error("Load Exchange Data Error:", e);
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red;">載入失敗</td></tr>';
        }
    },

    translateStatus: function(status) {
        const map = {
            'pending_target': '待對方同意',
            'pending_manager': '待護理長核准',
            'approved': '已完成',
            'rejected': '已拒絕',
            'cancelled': '已取消'
        };
        return map[status] || status;
    },

    approveRequest: async function(id, step) {
        if (!confirm("確定要核准此調班申請嗎？")) return;
        
        try {
            const reqDoc = await db.collection('shift_exchanges').doc(id).get();
            if (!reqDoc.exists) return;
            
            const reqData = reqDoc.data();
            
            if (step === 'target') {
                // 對方同意 -> 進入護理長審核
                await db.collection('shift_exchanges').doc(id).update({
                    status: 'pending_manager',
                    targetApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else if (step === 'manager') {
                // 護理長核准 -> 正式交換班表
                
                // 檢查是否有權限核准此單位的申請
                const activeRole = app.impersonatedRole || app.userRole;
                const activeUnitId = app.impersonatedUnitId || app.userUnitId;
                if (activeRole === 'unit_manager' && activeUnitId !== reqData.unitId) {
                    alert("您無權核准此申請（非您的單位）");
                    return;
                }

                await this.executeShiftSwap(reqData);
                await db.collection('shift_exchanges').doc(id).update({
                    status: 'approved',
                    managerApprovedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    managerUid: app.currentUser.uid
                });
            }
            
            alert("操作成功");
            this.loadData();
        } catch (e) {
            console.error(e);
            alert("操作失敗: " + e.message);
        }
    },

    rejectRequest: async function(id) {
        const reason = prompt("請輸入拒絕原因:");
        if (reason === null) return;

        try {
            await db.collection('shift_exchanges').doc(id).update({
                status: 'rejected',
                rejectReason: reason,
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
                rejectedBy: app.currentUser.uid
            });
            alert("已拒絕申請");
            this.loadData();
        } catch (e) {
            console.error(e);
            alert("操作失敗");
        }
    },

    executeShiftSwap: async function(data) {
        // 這裡實作真正的班表資料交換邏輯
        // 1. 找到該月份的排班表
        // 2. 更新兩個人的班別
        console.log("Executing shift swap in database...", data);
        // (省略具體實作，通常會呼叫後端或直接操作 schedules 集合)
    }
};
