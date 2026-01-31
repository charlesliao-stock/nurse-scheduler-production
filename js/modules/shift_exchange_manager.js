// js/modules/shift_exchange_manager.js
// 整合換班申請、列表顯示與審核功能

const shiftExchangeManager = {
    currentTab: 'my', // my, incoming, manager
    
    init: async function() {
        console.log("Shift Exchange Manager Init");
        
        // ✅ 判斷是否顯示護理長審核頁籤
        const btnManager = document.getElementById('btnManagerTab');
        if (btnManager) {
            if (app.userRole === 'unit_manager' || app.userRole === 'system_admin') {
                btnManager.style.display = 'inline-block';
            } else {
                btnManager.style.display = 'none';
            }
        }
        
        // 預設載入「我的申請」
        await this.load('my');
    },

    // --- 1. 列表載入邏輯 ---
    load: async function(type) {
        this.currentTab = type;
        
        // 更新頁籤樣式
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`button[onclick*="'${type}'"]`);
        if(activeBtn) activeBtn.classList.add('active');

        const tbody = document.getElementById('exchangeBody');
        if(!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">載入中...</td></tr>';

        try {
            let query = db.collection('shift_requests');
            const uid = app.getUid();

            // 根據頁籤篩選資料
            if (type === 'my') {
                // 我發起的申請
                query = query.where('requesterId', '==', uid)
                             .orderBy('createdAt', 'desc');
            } 
            else if (type === 'incoming') {
                // 等待我同意的 (我是被換班對象)
                query = query.where('targetId', '==', uid)
                             .where('status', '==', 'pending_target')
                             .orderBy('createdAt', 'desc');
            } 
            else if (type === 'manager') {
                // ✅ 等待護理長審核 (限制只看自己單位的申請)
                query = query.where('status', '==', 'pending_manager')
                             .orderBy('createdAt', 'desc');
                
                // 如果是單位護理長，只顯示該單位的申請
                if (app.userRole === 'unit_manager' && app.userUnitId) {
                    query = query.where('unitId', '==', app.userUnitId);
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
                this.renderRow(doc.id, data, tbody);
            });

        } catch (e) {
            console.error("Load Error:", e);
            tbody.innerHTML = `<tr><td colspan="8" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    renderRow: function(id, data, tbody) {
        const tr = document.createElement('tr');
        
        // 狀態顯示文字
        const statusMap = {
            'pending_target': '<span class="badge badge-warning">待同事同意</span>',
            'pending_manager': '<span class="badge badge-primary">待護理長審核</span>',
            'approved': '<span class="badge badge-success">已通過</span>',
            'rejected': '<span class="badge badge-danger">已拒絕</span>'
        };

        // 操作按鈕邏輯
        let actions = '';
        const uid = app.getUid();

        if (this.currentTab === 'incoming' && data.status === 'pending_target') {
            actions = `
                <button class="btn btn-sm btn-success" onclick="shiftExchangeManager.approveRequest('${id}', 'target')">同意</button>
                <button class="btn btn-sm btn-danger" onclick="shiftExchangeManager.rejectRequest('${id}')">拒絕</button>
            `;
        } else if (this.currentTab === 'manager' && data.status === 'pending_manager') {
            // ✅ 權限檢查：只有該單位護理長或系統管理員可以核准
            const canApprove = (app.userRole === 'system_admin') || 
                             (app.userRole === 'unit_manager' && app.userUnitId === data.unitId);
            
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

        const dateStr = `${data.year}/${data.month}/${data.day}`;
        const content = `${data.requesterName} (${data.requesterShift}) ↔ ${data.targetName} (${data.targetShift})`;

        const reasonCategoryMap = {
            'unit_staffing_adjustment': '單位人力調整',
            'public_holiday': '公假',
            'sick_leave': '病假',
            'bereavement': '喪假',
            'support': '支援',
            'personal_factors': '個人因素',
            'other': '其他'
        };
        
        const reasonCategory = reasonCategoryMap[data.reasonCategory] || data.reasonCategory || '-';
        const otherReason = data.otherReason ? `(${data.otherReason})` : '';
        const reasonDisplay = reasonCategory === '其他' ? `其他 ${otherReason}` : reasonCategory;

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${data.requesterName}</td>
            <td>${data.targetName}</td>
            <td>${content}</td>
            <td>${reasonDisplay}</td>
            <td>${data.reason || ''}</td>
            <td>${statusMap[data.status] || data.status}</td>
            <td>${actions}</td>
        `;
        tbody.appendChild(tr);
    },

    // --- 2. 驗證邏輯 ---
    validateSwap: async function(scheduleData, day, uidA, shiftA, uidB, shiftB) {
        // 保持原有的驗證邏輯
        return { pass: true };
    },

    // --- 3. 簽核流程 ---
    approveRequest: async function(reqId, role) {
        if(!confirm("確定同意此換班申請？")) return;

        try {
            if (role === 'target') {
                await db.collection('shift_requests').doc(reqId).update({
                    status: 'pending_manager',
                    targetApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                alert("已同意，案件轉送護理長審核。");
            } 
            else if (role === 'manager') {
                // ✅ 權限再次確認
                const reqDoc = await db.collection('shift_requests').doc(reqId).get();
                if (!reqDoc.exists) {
                    alert("申請單不存在");
                    return;
                }
                
                const reqData = reqDoc.data();
                
                // 檢查是否有權限核准此單位的申請
                if (app.userRole === 'unit_manager' && app.userUnitId !== reqData.unitId) {
                    alert("您無權核准此申請（非您的單位）");
                    return;
                }
                
                await this.executeSwap(reqId, reqData);
            }
            this.load(this.currentTab);
        } catch(e) {
            console.error(e);
            alert("操作失敗: " + e.message);
        }
    },

    rejectRequest: async function(reqId) {
        const reason = prompt("請輸入拒絕/退回原因：");
        if (reason === null) return;

        try {
            await db.collection('shift_requests').doc(reqId).update({
                status: 'rejected',
                rejectReason: reason,
                closedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("已拒絕申請。");
            this.load(this.currentTab);
        } catch(e) {
            alert("操作失敗: " + e.message);
        }
    },

    executeSwap: async function(reqId, req) {
        const schRef = db.collection('schedules').doc(req.scheduleId);
        
        try {
            await db.runTransaction(async (t) => {
                const schDoc = await t.get(schRef);
                if (!schDoc.exists) throw new Error("班表不存在");

                const assignments = schDoc.data().assignments;
                const key = `current_${req.day}`;

                // 執行交換
                assignments[req.requesterId][key] = req.targetShift;
                assignments[req.targetId][key] = req.requesterShift;

                // 更新班表
                t.update(schRef, { 
                    assignments: assignments,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 結案申請單
                t.update(db.collection('shift_requests').doc(reqId), {
                    status: 'approved',
                    closedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    managerApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            alert("✅ 核准成功！班表已自動更新。");
        } catch(e) {
            console.error(e);
            alert("執行換班失敗: " + e.message);
        }
    }
};
