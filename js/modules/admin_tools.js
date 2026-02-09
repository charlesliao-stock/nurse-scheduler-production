// js/modules/admin_tools.js
// 🛠️ 系統管理工具核心模組

const AdminTools = {
    // ========================================
    // 初始化
    // ========================================
    init: function() {
        console.log('🛠️ 系統管理工具已載入');

    },

    // 檢查管理員權限
checkAdminPermission: async function() {
    const user = firebase.auth().currentUser;
    if (!user) {
        console.warn('未登入');  // 只在 console 顯示
        return false;
    }

        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            const userData = userDoc.data();
            
            if (userData.role !== 'admin' && userData.role !== 'supervisor') {
                alert('您沒有系統管理權限');
                window.location.href = '/';
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('權限檢查失敗:', error);
            return false;
        }
    },

    // ========================================
    // Modal 控制
    // ========================================
    showModal: function(title, content) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('adminModal').classList.add('active');
    },

    closeModal: function() {
        document.getElementById('adminModal').classList.remove('active');
    },

    // 顯示載入中
    showLoading: function(message = '載入中...') {
        const content = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 48px; margin-bottom: 20px;">⏳</div>
                <p style="font-size: 18px; color: #7f8c8d;">${message}</p>
            </div>
        `;
        this.showModal('處理中', content);
    },

    // ========================================
    // 班表管理
    // ========================================
    
    // 掃描班表問題
    scanSchedules: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('掃描班表中...');
        
        try {
            const snapshot = await db.collection('schedules').get();
            const issues = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const problems = [];
                
                // 檢查無效 UID
                if (data.staffList) {
                    const nullStaff = data.staffList.filter(s => 
                        !s.uid || s.uid === 'null' || s.uid === null
                    );
                    if (nullStaff.length > 0) {
                        problems.push(`staffList 有 ${nullStaff.length} 位無效 UID`);
                    }
                }
                
                if (data.assignments) {
                    const nullKeys = Object.keys(data.assignments).filter(key => 
                        key === 'null' || key === 'undefined' || key === ''
                    );
                    if (nullKeys.length > 0) {
                        problems.push(`assignments 有 ${nullKeys.length} 個無效 key`);
                    }
                }
                
                if (problems.length > 0) {
                    issues.push({
                        id: doc.id,
                        year: data.year,
                        month: data.month,
                        unitId: data.unitId,
                        status: data.status,
                        problems: problems
                    });
                }
            });
            
            // 顯示結果
            let content = `
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">總班表數</div>
                        <div class="stat-value">${snapshot.size}</div>
                    </div>
                    <div class="stat-card" style="background: ${issues.length > 0 ? 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)' : 'linear-gradient(135deg, #27ae60 0%, #229954 100%)'};">
                        <div class="stat-label">問題班表</div>
                        <div class="stat-value">${issues.length}</div>
                    </div>
                </div>
            `;
            
            if (issues.length > 0) {
                content += `
                    <div style="margin: 20px 0;">
                        <h3 style="color: #e74c3c;">⚠️ 發現以下問題：</h3>
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>單位</th>
                                    <th>年月</th>
                                    <th>狀態</th>
                                    <th>問題</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                issues.forEach(issue => {
                    content += `
                        <tr>
                            <td>${issue.unitId}</td>
                            <td>${issue.year}/${issue.month}</td>
                            <td><span class="status-badge ${issue.status}">${issue.status}</span></td>
                            <td style="font-size: 12px;">${issue.problems.join('<br>')}</td>
                            <td>
                                <button class="action-btn primary" style="padding: 5px 10px; font-size: 12px;" 
                                        onclick="AdminTools.fixSingleSchedule('${issue.id}')">
                                    修復
                                </button>
                            </td>
                        </tr>
                    `;
                });
                
                content += `
                            </tbody>
                        </table>
                    </div>
                    <div class="btn-group">
                        <button class="action-btn success" onclick="AdminTools.fixAllSchedulesConfirm(${issues.length})">
                            🔧 修復所有問題
                        </button>
                        <button class="action-btn warning" onclick="AdminTools.closeModal()">
                            取消
                        </button>
                    </div>
                `;
            } else {
                content += `
                    <div style="text-align: center; padding: 40px;">
                        <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                        <h3 style="color: #27ae60;">所有班表狀態正常！</h3>
                        <p style="color: #7f8c8d;">未發現任何問題</p>
                    </div>
                `;
            }
            
            this.showModal('📊 班表掃描結果', content);
            
        } catch (error) {
            console.error('掃描失敗:', error);
            alert('掃描失敗: ' + error.message);
            this.closeModal();
        }
    },

    // 修復單個班表
    fixSingleSchedule: async function(docId) {
        if (!confirm('確定要修復此班表？')) return;
        
        try {
            const doc = await db.collection('schedules').doc(docId).get();
            if (!doc.exists) {
                alert('班表不存在');
                return;
            }
            
            const data = doc.data();
            let fixed = false;
            
            // 修復 staffList
            if (data.staffList) {
                const cleanStaffList = data.staffList.filter(s => 
                    s.uid && s.uid !== 'null' && s.uid !== null
                );
                
                if (cleanStaffList.length !== data.staffList.length) {
                    data.staffList = cleanStaffList;
                    fixed = true;
                }
            }
            
            // 修復 assignments
            if (data.assignments) {
                const cleanAssignments = {};
                Object.keys(data.assignments).forEach(key => {
                    if (key && key !== 'null' && key !== 'undefined' && key !== '') {
                        cleanAssignments[key] = data.assignments[key];
                    }
                });
                
                if (Object.keys(cleanAssignments).length !== Object.keys(data.assignments).length) {
                    data.assignments = cleanAssignments;
                    fixed = true;
                }
            }
            
            if (fixed) {
                await db.collection('schedules').doc(docId).update({
                    staffList: data.staffList,
                    assignments: data.assignments,
                    fixedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                alert('✅ 修復完成');
                this.scanSchedules(); // 重新掃描
            } else {
                alert('ℹ️ 此班表無需修復');
            }
            
        } catch (error) {
            console.error('修復失敗:', error);
            alert('修復失敗: ' + error.message);
        }
    },

    // 修復所有問題班表
    fixAllSchedulesConfirm: async function(count) {
        if (!confirm(`確定要修復 ${count} 個問題班表？`)) return;
        
        this.showLoading(`正在修復 ${count} 個班表...`);
        
        try {
            const snapshot = await db.collection('schedules').get();
            let fixCount = 0;
            
            for (const doc of snapshot.docs) {
                const data = doc.data();
                let needFix = false;
                
                // 檢查並修復 staffList
                if (data.staffList) {
                    const cleanStaffList = data.staffList.filter(s => 
                        s.uid && s.uid !== 'null' && s.uid !== null
                    );
                    
                    if (cleanStaffList.length !== data.staffList.length) {
                        data.staffList = cleanStaffList;
                        needFix = true;
                    }
                }
                
                // 檢查並修復 assignments
                if (data.assignments) {
                    const cleanAssignments = {};
                    Object.keys(data.assignments).forEach(key => {
                        if (key && key !== 'null' && key !== 'undefined' && key !== '') {
                            cleanAssignments[key] = data.assignments[key];
                        }
                    });
                    
                    if (Object.keys(cleanAssignments).length !== Object.keys(data.assignments).length) {
                        data.assignments = cleanAssignments;
                        needFix = true;
                    }
                }
                
                if (needFix) {
                    await db.collection('schedules').doc(doc.id).update({
                        staffList: data.staffList,
                        assignments: data.assignments,
                        fixedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    fixCount++;
                }
            }
            
            alert(`✅ 修復完成！共修復 ${fixCount} 個班表`);
            this.scanSchedules(); // 重新掃描
            
        } catch (error) {
            console.error('批次修復失敗:', error);
            alert('批次修復失敗: ' + error.message);
            this.closeModal();
        }
    },

    // 修復班表（對外接口）
    fixSchedules: async function() {
        if (!await this.checkAdminPermission()) return;
        this.scanSchedules(); // 先掃描，讓使用者看到問題後再決定是否修復
    },

    // 刪除重複班表
    deleteDuplicates: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('搜尋重複班表中...');
        
        try {
            const snapshot = await db.collection('schedules').get();
            const scheduleMap = {};
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const key = `${data.unitId}-${data.year}-${data.month}`;
                
                if (!scheduleMap[key]) {
                    scheduleMap[key] = [];
                }
                
                scheduleMap[key].push({
                    id: doc.id,
                    updatedAt: data.updatedAt?.toDate() || new Date(0),
                    status: data.status,
                    staffCount: (data.staffList || []).length
                });
            });
            
            const duplicates = [];
            Object.entries(scheduleMap).forEach(([key, docs]) => {
                if (docs.length > 1) {
                    docs.sort((a, b) => b.updatedAt - a.updatedAt);
                    const [unitId, year, month] = key.split('-');
                    
                    duplicates.push({
                        unitId, year, month,
                        keep: docs[0],
                        delete: docs.slice(1)
                    });
                }
            });
            
            if (duplicates.length === 0) {
                const content = `
                    <div style="text-align: center; padding: 40px;">
                        <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                        <h3 style="color: #27ae60;">沒有重複的班表</h3>
                        <p style="color: #7f8c8d;">系統狀態正常</p>
                    </div>
                `;
                this.showModal('🔍 重複班表檢查', content);
                return;
            }
            
            let content = `
                <div class="stats-grid">
                    <div class="stat-card" style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);">
                        <div class="stat-label">重複組數</div>
                        <div class="stat-value">${duplicates.length}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">將刪除</div>
                        <div class="stat-value">${duplicates.reduce((sum, d) => sum + d.delete.length, 0)}</div>
                    </div>
                </div>
                
                <div style="margin: 20px 0;">
                    <h3 style="color: #e74c3c;">⚠️ 發現以下重複班表：</h3>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>單位</th>
                                <th>年月</th>
                                <th>重複數量</th>
                                <th>保留</th>
                                <th>刪除</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            duplicates.forEach(dup => {
                content += `
                    <tr>
                        <td>${dup.unitId}</td>
                        <td>${dup.year}/${dup.month}</td>
                        <td>${dup.delete.length + 1}</td>
                        <td style="color: #27ae60; font-weight: 600;">最新版 (${dup.keep.staffCount} 人)</td>
                        <td style="color: #e74c3c;">${dup.delete.length} 個舊版</td>
                    </tr>
                `;
            });
            
            content += `
                        </tbody>
                    </table>
                </div>
                
                <div style="background: #fff3cd; border-left: 4px solid #f39c12; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <strong>⚠️ 注意：</strong> 將保留最新更新的班表，刪除舊版本。此操作無法復原！
                </div>
                
                <div class="btn-group">
                    <button class="action-btn danger" onclick="AdminTools.executeDuplicateDeletion()">
                        🗑️ 確認刪除
                    </button>
                    <button class="action-btn warning" onclick="AdminTools.closeModal()">
                        取消
                    </button>
                </div>
            `;
            
            this.showModal('🔍 重複班表檢查', content);
            
            // 儲存待刪除清單
            this._duplicatesToDelete = duplicates;
            
        } catch (error) {
            console.error('檢查失敗:', error);
            alert('檢查失敗: ' + error.message);
            this.closeModal();
        }
    },

    // 執行刪除重複班表
    executeDuplicateDeletion: async function() {
        if (!this._duplicatesToDelete) return;
        
        const totalCount = this._duplicatesToDelete.reduce((sum, d) => sum + d.delete.length, 0);
        if (!confirm(`確定要刪除 ${totalCount} 個重複班表？此操作無法復原！`)) return;
        
        this.showLoading(`正在刪除 ${totalCount} 個重複班表...`);
        
        try {
            let deleteCount = 0;
            
            for (const dup of this._duplicatesToDelete) {
                for (const doc of dup.delete) {
                    await db.collection('schedules').doc(doc.id).delete();
                    deleteCount++;
                }
            }
            
            alert(`✅ 刪除完成！共刪除 ${deleteCount} 個重複班表`);
            this.closeModal();
            delete this._duplicatesToDelete;
            
        } catch (error) {
            console.error('刪除失敗:', error);
            alert('刪除失敗: ' + error.message);
            this.closeModal();
        }
    },

    // 查看所有班表
    viewSchedules: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('載入班表清單...');
        
        try {
            const snapshot = await db.collection('schedules')
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .limit(100)
                .get();
            
            let content = `
                <div class="filter-bar">
                    <input type="text" id="filterUnit" placeholder="過濾單位..." onkeyup="AdminTools.filterScheduleTable()">
                    <select id="filterStatus" onchange="AdminTools.filterScheduleTable()">
                        <option value="">所有狀態</option>
                        <option value="published">已發布</option>
                        <option value="draft">草稿</option>
                    </select>
                    <button class="action-btn info" style="padding: 8px 16px;" onclick="AdminTools.viewSchedules()">
                        🔄 重新整理
                    </button>
                </div>
                
                <table class="data-table" id="scheduleTable">
                    <thead>
                        <tr>
                            <th>單位</th>
                            <th>年月</th>
                            <th>狀態</th>
                            <th>人數</th>
                            <th>更新時間</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const updatedAt = data.updatedAt?.toDate();
                const formattedDate = updatedAt ? 
                    `${updatedAt.getFullYear()}/${(updatedAt.getMonth()+1).toString().padStart(2, '0')}/${updatedAt.getDate().toString().padStart(2, '0')}` : 
                    '未知';
                
                content += `
                    <tr data-unit="${data.unitId}" data-status="${data.status}">
                        <td>${data.unitId}</td>
                        <td>${data.year}/${data.month}</td>
                        <td><span class="status-badge ${data.status}">${data.status}</span></td>
                        <td>${(data.staffList || []).length} 位</td>
                        <td style="font-size: 12px;">${formattedDate}</td>
                        <td>
                            <button class="action-btn danger" style="padding: 5px 10px; font-size: 12px;" 
                                    onclick="AdminTools.deleteScheduleById('${doc.id}', '${data.unitId}', '${data.year}/${data.month}')">
                                刪除
                            </button>
                        </td>
                    </tr>
                `;
            });
            
            content += `
                    </tbody>
                </table>
            `;
            
            this.showModal('📋 所有班表', content);
            
        } catch (error) {
            console.error('載入失敗:', error);
            alert('載入失敗: ' + error.message);
            this.closeModal();
        }
    },

    // 過濾班表表格
    filterScheduleTable: function() {
        const filterUnit = document.getElementById('filterUnit').value.toLowerCase();
        const filterStatus = document.getElementById('filterStatus').value;
        const table = document.getElementById('scheduleTable');
        const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
        
        for (let row of rows) {
            const unit = row.getAttribute('data-unit').toLowerCase();
            const status = row.getAttribute('data-status');
            
            const unitMatch = unit.includes(filterUnit);
            const statusMatch = !filterStatus || status === filterStatus;
            
            row.style.display = (unitMatch && statusMatch) ? '' : 'none';
        }
    },

    // 刪除指定班表
    deleteScheduleById: async function(docId, unitId, yearMonth) {
        if (!confirm(`確定要刪除此班表？\n\n單位: ${unitId}\n年月: ${yearMonth}\n\n此操作無法復原！`)) return;
        
        try {
            await db.collection('schedules').doc(docId).delete();
            alert('✅ 已刪除');
            this.viewSchedules(); // 重新載入
        } catch (error) {
            console.error('刪除失敗:', error);
            alert('刪除失敗: ' + error.message);
        }
    },

    // ========================================
    // 人員管理
    // ========================================
    
    viewUsers: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('載入使用者清單...');
        
        try {
            const snapshot = await db.collection('users').get();
            
            let content = `
                <div class="filter-bar">
                    <input type="text" id="filterUserName" placeholder="搜尋姓名..." onkeyup="AdminTools.filterUserTable()">
                    <select id="filterUserRole" onchange="AdminTools.filterUserTable()">
                        <option value="">所有角色</option>
                        <option value="admin">系統管理員</option>
                        <option value="supervisor">督導</option>
                        <option value="user">一般使用者</option>
                    </select>
                </div>
                
                <table class="data-table" id="userTable">
                    <thead>
                        <tr>
                            <th>姓名</th>
                            <th>Email</th>
                            <th>角色</th>
                            <th>單位</th>
                            <th>狀態</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const status = data.disabled ? 'inactive' : 'active';
                
                content += `
                    <tr data-name="${data.name || ''}" data-role="${data.role || 'user'}">
                        <td>${data.name || '未設定'}</td>
                        <td style="font-size: 12px;">${data.email || doc.id}</td>
                        <td>${data.role || 'user'}</td>
                        <td>${data.unitId || '-'}</td>
                        <td><span class="status-badge ${status}">${data.disabled ? '已停用' : '正常'}</span></td>
                        <td>
                            <button class="action-btn warning" style="padding: 5px 10px; font-size: 12px; margin: 2px;" 
                                    onclick="AdminTools.toggleUserStatus('${doc.id}', ${!data.disabled})">
                                ${data.disabled ? '啟用' : '停用'}
                            </button>
                        </td>
                    </tr>
                `;
            });
            
            content += `
                    </tbody>
                </table>
            `;
            
            this.showModal('👥 所有使用者', content);
            
        } catch (error) {
            console.error('載入失敗:', error);
            alert('載入失敗: ' + error.message);
            this.closeModal();
        }
    },

    filterUserTable: function() {
        const filterName = document.getElementById('filterUserName').value.toLowerCase();
        const filterRole = document.getElementById('filterUserRole').value;
        const table = document.getElementById('userTable');
        const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
        
        for (let row of rows) {
            const name = row.getAttribute('data-name').toLowerCase();
            const role = row.getAttribute('data-role');
            
            const nameMatch = name.includes(filterName);
            const roleMatch = !filterRole || role === filterRole;
            
            row.style.display = (nameMatch && roleMatch) ? '' : 'none';
        }
    },

    toggleUserStatus: async function(uid, disable) {
        const action = disable ? '停用' : '啟用';
        if (!confirm(`確定要${action}此帳號？`)) return;
        
        try {
            await db.collection('users').doc(uid).update({
                disabled: disable,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert(`✅ 已${action}`);
            this.viewUsers(); // 重新載入
        } catch (error) {
            console.error(`${action}失敗:`, error);
            alert(`${action}失敗: ` + error.message);
        }
    },

    checkInvalidUIDs: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('檢查無效 UID...');
        
        try {
            const staffSnapshot = await db.collection('staff').get();
            const invalidStaff = [];
            
            staffSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.uid || data.uid === 'null' || data.uid === null) {
                    invalidStaff.push({
                        id: doc.id,
                        name: data.name,
                        unitId: data.unitId,
                        uid: data.uid
                    });
                }
            });
            
            if (invalidStaff.length === 0) {
                const content = `
                    <div style="text-align: center; padding: 40px;">
                        <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                        <h3 style="color: #27ae60;">所有人員 UID 正常</h3>
                    </div>
                `;
                this.showModal('✅ 檢查結果', content);
                return;
            }
            
            let content = `
                <div style="background: #fff3cd; border-left: 4px solid #f39c12; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <strong>⚠️ 發現 ${invalidStaff.length} 位人員的 UID 無效</strong>
                </div>
                
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>姓名</th>
                            <th>單位</th>
                            <th>UID</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            invalidStaff.forEach(staff => {
                content += `
                    <tr>
                        <td>${staff.name}</td>
                        <td>${staff.unitId}</td>
                        <td style="color: #e74c3c;">${staff.uid || '(空)'}</td>
                        <td>
                            <button class="action-btn danger" style="padding: 5px 10px; font-size: 12px;" 
                                    onclick="AdminTools.deleteStaffById('${staff.id}', '${staff.name}')">
                                刪除
                            </button>
                        </td>
                    </tr>
                `;
            });
            
            content += `
                    </tbody>
                </table>
            `;
            
            this.showModal('⚠️ 無效 UID 檢查', content);
            
        } catch (error) {
            console.error('檢查失敗:', error);
            alert('檢查失敗: ' + error.message);
            this.closeModal();
        }
    },

    deleteStaffById: async function(staffId, staffName) {
        if (!confirm(`確定要刪除人員「${staffName}」？\n\n此操作無法復原！`)) return;
        
        try {
            await db.collection('staff').doc(staffId).delete();
            alert('✅ 已刪除');
            this.checkInvalidUIDs(); // 重新檢查
        } catch (error) {
            console.error('刪除失敗:', error);
            alert('刪除失敗: ' + error.message);
        }
    },

    resetPassword: function() {
        alert('密碼重設功能開發中...\n請使用 Firebase Console 或 Authentication 頁面進行密碼重設');
    },

    disableUser: function() {
        this.viewUsers(); // 導向使用者列表，可以在那裡停用
    },

    // ========================================
    // 班別/單位管理 (placeholder)
    // ========================================
    
    viewShifts: function() {
        alert('班別管理功能開發中...');
    },

    addShift: function() {
        alert('新增班別功能開發中...');
    },

    editShift: function() {
        alert('編輯班別功能開發中...');
    },

    deleteShift: function() {
        alert('刪除班別功能開發中...');
    },

    viewUnits: function() {
        alert('單位管理功能開發中...');
    },

    addUnit: function() {
        alert('新增單位功能開發中...');
    },

    editUnit: function() {
        alert('編輯單位功能開發中...');
    },

    syncUnitStaff: function() {
        alert('同步單位人員功能開發中...');
    },

    // ========================================
    // 系統資訊 (placeholder)
    // ========================================
    
    viewStats: async function() {
        if (!await this.checkAdminPermission()) return;
        
        this.showLoading('載入統計資訊...');
        
        try {
            const [schedules, users, staff, units] = await Promise.all([
                db.collection('schedules').get(),
                db.collection('users').get(),
                db.collection('staff').get(),
                db.collection('units').get()
            ]);
            
            const content = `
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">班表總數</div>
                        <div class="stat-value">${schedules.size}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">使用者帳號</div>
                        <div class="stat-value">${users.size}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">人員資料</div>
                        <div class="stat-value">${staff.size}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">單位數量</div>
                        <div class="stat-value">${units.size}</div>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 30px; color: #7f8c8d;">
                    <p>更多詳細統計功能開發中...</p>
                </div>
            `;
            
            this.showModal('📊 系統統計', content);
            
        } catch (error) {
            console.error('載入失敗:', error);
            alert('載入失敗: ' + error.message);
            this.closeModal();
        }
    },

    viewFirebaseUsage: function() {
        alert('Firebase 用量監控功能開發中...\n請前往 Firebase Console 查看詳細用量');
    },

    viewActivityLog: function() {
        alert('操作記錄功能開發中...');
    },

    exportData: function() {
        alert('資料匯出功能開發中...');
    },

    // ========================================
    // 備份與還原 (placeholder)
    // ========================================
    
    backupAll: function() {
        alert('完整備份功能開發中...');
    },

    restoreBackup: function() {
        alert('還原備份功能開發中...');
    },

    viewBackups: function() {
        alert('備份紀錄功能開發中...');
    },

    cleanupOldBackups: function() {
        alert('清理舊備份功能開發中...');
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', function() {
    AdminTools.init();
});

// Modal 點擊外部關閉
document.addEventListener('click', function(e) {
    if (e.target.id === 'adminModal') {
        AdminTools.closeModal();
    }
});
