// js/modules/shift_exchange_manager.js

const shiftExchangeManager = {
    currentTab: 'my_requests', // 'my_requests', 'to_me', 'manager', 'all'
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
            // 移除所有標籤的 active class
            tabs.forEach(t => t.classList.remove('active'));
            
            // 添加 active class 到當前標籤
            tab.classList.add('active');
            
            // 更新當前標籤狀態
            this.currentTab = tab.dataset.tab;
            
            // 重新載入資料
            this.loadData();
        };
    });
},

loadData: async function() {
    const tbody = document.getElementById('exchangeTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> 載入中...</td></tr>';

    try {
        let snapshot;
        const type = this.currentTab;

        const activeUid = app.getUid();
        const activeRole = app.impersonatedRole || app.userRole;
        const activeUnitId = app.getUnitId();

        if (type === 'my_requests') {
            // ✅ 我發出的申請（全部狀態）
            snapshot = await db.collection('shift_requests')
                .where('requesterUid', '==', activeUid)
                .orderBy('createdAt', 'desc')
                .get();
        } 
        else if (type === 'to_me') {
            // ✅ 待我同意的申請（只顯示 pending_target 狀態）
            snapshot = await db.collection('shift_requests')
                .where('targetUid', '==', activeUid)
                .where('status', '==', 'pending_target')
                .orderBy('createdAt', 'desc')
                .get();
        } 
        else if (type === 'manager') {
            // ✅ 等待護理長審核
            let query = db.collection('shift_requests')
                .where('status', '==', 'pending_manager')
                .orderBy('createdAt', 'desc');
            
            // 如果是單位護理長，只顯示該單位的申請
            if (activeRole === 'unit_manager' && activeUnitId) {
                query = query.where('unitId', '==', activeUnitId);
            }
            
            snapshot = await query.get();
        }
        else if (type === 'all') {
            // ✅ 全部申請記錄
            if (activeRole === 'system_admin') {
                // 系統管理員：看所有單位
                snapshot = await db.collection('shift_requests')
                    .orderBy('createdAt', 'desc')
                    .limit(100)
                    .get();
            } 
            else if (activeRole === 'unit_manager' && activeUnitId) {
                // 單位護理長：看該單位所有申請
                snapshot = await db.collection('shift_requests')
                    .where('unitId', '==', activeUnitId)
                    .orderBy('createdAt', 'desc')
                    .limit(100)
                    .get();
            } 
            else {
                // 一般員工：只看與自己有關的申請（我發出的 + 對象是我的）
                const myRequestsSnap = await db.collection('shift_requests')
                    .where('requesterUid', '==', activeUid)
                    .orderBy('createdAt', 'desc')
                    .get();
                
                const toMeSnap = await db.collection('shift_requests')
                    .where('targetUid', '==', activeUid)
                    .orderBy('createdAt', 'desc')
                    .get();
                
                // 合併兩個查詢結果並去重
                const allDocs = new Map();
                myRequestsSnap.forEach(doc => allDocs.set(doc.id, doc));
                toMeSnap.forEach(doc => allDocs.set(doc.id, doc));
                
                // 轉換為類似 QuerySnapshot 的結構
                snapshot = {
                    empty: allDocs.size === 0,
                    docs: Array.from(allDocs.values()).sort((a, b) => {
                        const aTime = a.data().createdAt?.toMillis() || 0;
                        const bTime = b.data().createdAt?.toMillis() || 0;
                        return bTime - aTime; // 降序排列
                    }),
                    forEach: function(callback) {
                        this.docs.forEach(callback);
                    }
                };
            }
        }

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#999;">目前沒有資料</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            const row = document.createElement('tr');
            
            // ✅ 根據狀態和角色決定可執行的操作
            const actions = this.getActionsHTML(id, data);
            
            // ✅ 根據狀態設定列的樣式
            const rowStyle = this.getRowStyle(data.status);
            row.style.cssText = rowStyle;
            
            // ✅ 格式化時間
            const createdTime = data.createdAt ? this.formatTimestamp(data.createdAt) : '-';

            row.innerHTML = `
                <td>${data.date}</td>
                <td>${data.requesterName}</td>
                <td style="font-weight:bold; color:#2c3e50;">${data.requesterShift}</td>
                <td><i class="fas fa-exchange-alt" style="color:#95a5a6;"></i></td>
                <td>${data.targetName}</td>
                <td style="font-weight:bold; color:#2c3e50;">${data.targetShift}</td>
                <td><span class="status-badge ${this.getStatusClass(data.status)}">${this.translateStatus(data.status)}</span></td>
                <td>${data.reason || '-'}</td>
                <td style="font-size:0.85rem; color:#7f8c8d;">${createdTime}</td>
                <td style="white-space:nowrap;">${actions}</td>
            `;
            tbody.appendChild(row);
        });

    } catch (e) {
        console.error("Load Exchange Data Error:", e);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red;">載入失敗: ' + e.message + '</td></tr>';
    }
},

/**
 * ✅ 根據狀態和角色決定可執行的操作
 */
getActionsHTML: function(id, data) {
    const activeUid = app.getUid();
    const activeRole = app.impersonatedRole || app.userRole;
    const activeUnitId = app.getUnitId();
    const isRequester = data.requesterUid === activeUid;
    const isTarget = data.targetUid === activeUid;
    
    // 待對方同意階段
    if (data.status === 'pending_target') {
        if (isTarget) {
            return `
                <button class="action-btn approve-btn" onclick="shiftExchangeManager.approveRequest('${id}', 'target')" style="margin-right:5px;">
                    <i class="fas fa-check"></i> 同意
                </button>
                <button class="action-btn reject-btn" onclick="shiftExchangeManager.rejectRequest('${id}')">
                    <i class="fas fa-times"></i> 拒絕
                </button>
            `;
        } else if (isRequester) {
            return `
                <button class="action-btn cancel-btn" onclick="shiftExchangeManager.cancelRequest('${id}')">
                    <i class="fas fa-ban"></i> 取消申請
                </button>
            `;
        }
    }
    
    // 待護理長審核階段
    if (data.status === 'pending_manager') {
        const canApprove = (activeRole === 'system_admin') || (activeRole === 'unit_manager' && activeUnitId === data.unitId);
        
        if (canApprove) {
            return `
                <button class="action-btn approve-btn" onclick="shiftExchangeManager.approveRequest('${id}', 'manager')" style="margin-right:5px;">
                    <i class="fas fa-check"></i> 核准
                </button>
                <button class="action-btn reject-btn" onclick="shiftExchangeManager.rejectRequest('${id}')">
                    <i class="fas fa-times"></i> 退回
                </button>
            `;
        } else {
            return '<span style="color:#999; font-size:0.85rem;">審核中...</span>';
        }
    }
    
    // 已完成
    if (data.status === 'approved') {
        return '<span style="color:#27ae60; font-size:0.85rem;"><i class="fas fa-check-circle"></i> 已完成</span>';
    }
    
    // 已拒絕
    if (data.status === 'rejected') {
        const reason = data.rejectReason ? `<br><small style="color:#e74c3c;">原因: ${data.rejectReason}</small>` : '';
        return `<span style="color:#e74c3c; font-size:0.85rem;"><i class="fas fa-times-circle"></i> 已拒絕${reason}</span>`;
    }
    
    // 已取消
    if (data.status === 'cancelled') {
        return '<span style="color:#95a5a6; font-size:0.85rem;"><i class="fas fa-ban"></i> 已取消</span>';
    }
    
    return '<span style="color:#ccc;">-</span>';
},

    /**
     * ✅ 根據狀態返回列樣式
     */
    getRowStyle: function(status) {
        const styles = {
            'pending_target': 'background:#fff9e6;',
            'pending_manager': 'background:#e8f4fd;',
            'approved': 'background:#e8f5e9;',
            'rejected': 'background:#ffebee;',
            'cancelled': 'background:#f5f5f5;'
        };
        return styles[status] || '';
    },

    /**
     * ✅ 根據狀態返回 CSS class
     */
    getStatusClass: function(status) {
        const classes = {
            'pending_target': 'status-pending',
            'pending_manager': 'status-review',
            'approved': 'status-approved',
            'rejected': 'status-rejected',
            'cancelled': 'status-cancelled'
        };
        return classes[status] || '';
    },

    /**
     * ✅ 格式化時間戳
     */
    formatTimestamp: function(timestamp) {
        if (!timestamp) return '-';
        
        let date;
        if (timestamp.toDate) {
            date = timestamp.toDate();
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else {
            return '-';
        }
        
        const now = new Date();
        const diff = now - date;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (hours < 1) {
            const minutes = Math.floor(diff / (1000 * 60));
            return `${minutes} 分鐘前`;
        } else if (hours < 24) {
            return `${hours} 小時前`;
        } else if (days < 7) {
            return `${days} 天前`;
        } else {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            return `${month}/${day} ${hour}:${minute}`;
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

    /**
     * ✅ 取消申請（申請人可在待對方同意階段取消）
     */
    cancelRequest: async function(id) {
        if (!confirm("確定要取消此換班申請嗎？")) return;
        
        try {
            await db.collection('shift_requests').doc(id).update({
                status: 'cancelled',
                cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
                cancelledBy: app.currentUser.uid
            });
            
            alert("已取消申請");
            this.loadData();
        } catch (e) {
            console.error(e);
            alert("操作失敗: " + e.message);
        }
    },

    approveRequest: async function(id, step) {
        if (!confirm("確定要核准此調班申請嗎？")) return;
        
        try {
            const reqDoc = await db.collection('shift_requests').doc(id).get();
            if (!reqDoc.exists) {
                alert("找不到此申請");
                return;
            }
            
            const reqData = reqDoc.data();
            
            if (step === 'target') {
                // 對方同意 -> 進入護理長審核
                await db.collection('shift_requests').doc(id).update({
                    status: 'pending_manager',
                    targetApprovedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    targetApprovedBy: app.currentUser.uid
                });
                
                console.log('✅ 對方已同意，進入護理長審核階段');
            } else if (step === 'manager') {
                // 護理長核准 -> 正式交換班表
                
                // 檢查是否有權限核准此單位的申請
                const activeRole = app.impersonatedRole || app.userRole;
                const activeUnitId = app.impersonatedUnitId || app.userUnitId;
                
                if (activeRole === 'unit_manager' && activeUnitId !== reqData.unitId) {
                    alert("您無權核准此申請（非您的單位）");
                    return;
                }

                // 執行班表交換
                await this.executeShiftSwap(reqData);
                
                await db.collection('shift_requests').doc(id).update({
                    status: 'approved',
                    managerApprovedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    managerApprovedBy: app.currentUser.uid
                });
                
                console.log('✅ 護理長已核准，班表已交換');
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
        if (reason === null || reason.trim() === '') {
            alert("請輸入拒絕原因");
            return;
        }

        try {
            await db.collection('shift_requests').doc(id).update({
                status: 'rejected',
                rejectReason: reason,
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
                rejectedBy: app.currentUser.uid
            });
            
            alert("已拒絕申請");
            this.loadData();
        } catch (e) {
            console.error(e);
            alert("操作失敗: " + e.message);
        }
    },

    /**
     * ✅ 執行班表交換
     */
    executeShiftSwap: async function(data) {
        try {
            console.log("🔄 開始執行班表交換...", data);
            
            // 1. 找到對應的排班表
            const dateObj = new Date(data.date);
            const year = dateObj.getFullYear();
            const month = dateObj.getMonth() + 1;
            
            const scheduleSnap = await db.collection('schedules')
                .where('unitId', '==', data.unitId)
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .limit(1)
                .get();
            
            if (scheduleSnap.empty) {
                throw new Error("找不到對應的已發布班表");
            }
            
            const scheduleDoc = scheduleSnap.docs[0];
            const scheduleData = scheduleDoc.data();
            const assignments = scheduleData.assignments || {};
            
            // 2. 計算日期對應的 key
            const day = dateObj.getDate();
            const dayKey = `current_${day}`;
            
            // 3. 交換班別
            const requesterAssign = assignments[data.requesterUid] || {};
            const targetAssign = assignments[data.targetUid] || {};
            
            const tempShift = requesterAssign[dayKey];
            requesterAssign[dayKey] = targetAssign[dayKey];
            targetAssign[dayKey] = tempShift;
            
            assignments[data.requesterUid] = requesterAssign;
            assignments[data.targetUid] = targetAssign;
            
            // 4. 更新資料庫
            await scheduleDoc.ref.update({
                assignments: assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastExchangeBy: app.currentUser.uid,
                lastExchangeAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ 班表交換完成: ${data.requesterName} (${data.requesterShift}) ↔ ${data.targetName} (${data.targetShift})`);
            
        } catch (e) {
            console.error("❌ 班表交換失敗:", e);
            throw e;
        }
    }
};
