// js/modules/staff_manager.js (完整版 - 改進版)
// 修改重點：
// 1. 所有人員都有重設密碼按鈕（不論是否已開通）
// 2. 刪除改為停用，可復原
// 3. 已停用的人員可以重新啟用

const staffManager = {
    allData: [],
    unitCache: {}, 
    sortState: { field: 'employeeId', order: 'asc' },
    isLoading: false, 

    // --- 模組初始化 ---
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = this.debounce(() => this.renderTable(), 300);
        }
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">載入中...</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        let query = db.collection('units');
        const activeRole = app.impersonatedRole || app.userRole;
        if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            selectFilter.innerHTML = '<option value="all">所有單位</option>';
            snapshot.forEach(doc => {
                const unit = doc.data();
                this.unitCache[doc.id] = { name: unit.name, groups: unit.groups || [] };
                const option = `<option value="${doc.id}">${unit.name}</option>`;
                selectFilter.innerHTML += option;
                selectInput.innerHTML += option;
            });
            selectFilter.onchange = () => this.renderTable();
        } catch (e) {
            console.error("載入單位失敗:", e);
            selectFilter.innerHTML = '<option value="all">載入失敗</option>';
        }
    },

    onUnitChange: function() {
        const unitId = document.getElementById('inputUnit').value;
        const groupSelect = document.getElementById('inputGroup');
        if(!groupSelect) return;
        groupSelect.innerHTML = '<option value="">(無)</option>';
        if (!unitId || !this.unitCache[unitId]) return;
        const groups = this.unitCache[unitId].groups;
        if (groups && groups.length > 0) {
            groupSelect.innerHTML = '<option value="">請選擇組別</option>';
            groups.forEach(g => {
                groupSelect.innerHTML += `<option value="${g}">${g}</option>`;
            });
        } else {
            groupSelect.innerHTML = '<option value="">(此單位未設定組別)</option>';
        }
    },

    // --- 3. 讀取人員資料（修改：包含已停用的人員） ---
    fetchData: async function() {
        if(this.isLoading) return;
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</td></tr>';
        this.isLoading = true;

        // 修改：移除 isActive 篩選，載入所有人員（包含已停用）
        let query = db.collection('users');
        const activeRole = app.impersonatedRole || app.userRole;
        if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && app.userUnitId) {
            query = query.where('unitId', '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center; padding:30px; color:#e74c3c;">
                        <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:10px;"></i><br>
                        <strong>資料載入失敗</strong><br>
                        <small>錯誤代碼: ${error.message}</small><br>
                        <button class="btn btn-sm" onclick="staffManager.fetchData()" style="margin-top:10px; background:#95a5a6; color:white;">
                            <i class="fas fa-sync"></i> 重試
                        </button>
                    </td>
                </tr>`;
        } finally { this.isLoading = false; }
    },

    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        document.querySelectorAll('th i[id^="sort_icon_staff_"]').forEach(i => i.className = 'fas fa-sort');
        const activeIcon = document.getElementById(`sort_icon_staff_${this.sortState.field}`);
        if(activeIcon) activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const filterUnit = document.getElementById('filterUnitSelect')?.value || 'all';
        const searchTerm = (document.getElementById('searchStaffInput')?.value || '').toLowerCase().trim();

        let filtered = this.allData.filter(u => {
            const matchUnit = filterUnit === 'all' || u.unitId === filterUnit;
            const matchSearch = !searchTerm || 
                                (u.employeeId && u.employeeId.toLowerCase().includes(searchTerm)) || 
                                (u.displayName && u.displayName.toLowerCase().includes(searchTerm));
            return matchUnit && matchSearch;
        });

        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA, valB;
            if (field === 'unitName') {
                valA = (this.unitCache[a.unitId]?.name) || a.unitId || '';
                valB = (this.unitCache[b.unitId]?.name) || b.unitId || '';
            } else if (field === 'role') {
                const roleScore = { 'system_admin':4, 'unit_manager':3, 'unit_scheduler':2, 'user':1 };
                valA = roleScore[a.role] || 0;
                valB = roleScore[b.role] || 0;
            } else {
                valA = a[field] || ''; valB = b[field] || '';
            }
            if(typeof valA === 'string') valA = valA.toLowerCase();
            if(typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">無符合資料</td></tr>';
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(u => {
            const unitName = (this.unitCache[u.unitId]?.name) || u.unitId || '未知單位';
            const roleName = app.translateRole(u.role);
            
            // 停用員工的樣式
            const rowStyle = u.isActive ? '' : 'opacity:0.5;background:#f8f9fa;';
            const nameDisplay = u.isActive 
                ? u.displayName || '-'
                : `${u.displayName || '-'} <span style="color:#e74c3c;font-size:0.8rem;">(已停用)</span>`;
            
            // --- 修改：操作按鈕邏輯 ---
            let actionButtons = '';
            
            if (!u.isActive) {
                // 已停用：顯示啟用按鈕 + 重設密碼按鈕
                actionButtons = `
                    <button class="btn" style="background:#28a745;color:white;padding:5px 10px;margin-right:5px;" 
                            onclick="staffManager.activateUser('${u.id}')" title="啟用">
                        <i class="fas fa-check-circle"></i> 啟用
                    </button>
                    <button class="btn" style="background:#3498db;color:white;padding:5px 10px;" 
                            onclick="staffManager.sendPasswordResetEmail('${u.id}')" 
                            title="發送密碼重設郵件">
                        <i class="fas fa-key"></i>
                    </button>
                `;
            } else {
                // 啟用中：編輯 + 重設密碼 + 停用按鈕
                let deactivateBtn = u.role === 'system_admin' 
                    ? `<button class="btn" style="background:#95a5a6;color:white;padding:5px 10px;" disabled title="超級管理員無法停用">
                        <i class="fas fa-ban"></i> 停用
                      </button>`
                    : `<button class="btn" style="background:#e67e22;color:white;padding:5px 10px;" 
                              onclick="staffManager.deactivateUser('${u.id}')" title="停用">
                        <i class="fas fa-ban"></i> 停用
                      </button>`;
                
                actionButtons = `
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')" title="編輯">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn" style="background:#3498db;color:white;padding:5px 10px;margin:0 5px;" 
                            onclick="staffManager.sendPasswordResetEmail('${u.id}')" 
                            title="發送密碼重設郵件">
                        <i class="fas fa-key"></i>
                    </button>
                    ${deactivateBtn}
                `;
            }

            const tr = document.createElement('tr');
            tr.style.cssText = rowStyle;
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || '-'}</td>
                <td>${nameDisplay}</td>
                <td>${u.level || '-'}</td>
                <td>${u.groupId || '-'}</td>
                <td><span class="role-badge" style="background:${this.getRoleColor(u.role)}">${roleName}</span></td>
                <td style="white-space:nowrap;">${actionButtons}</td>
            `;
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    },

    getRoleColor: function(role) {
        const colors = { 'system_admin': '#2c3e50', 'unit_manager': '#e67e22', 'unit_scheduler': '#27ae60', 'user': '#95a5a6' };
        return colors[role] || '#95a5a6';
    },

    // --- 6. Modal 操作 ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        if(!modal) return;
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            const u = this.allData.find(d => d.id === docId);
            if(!u) { alert("找不到該人員資料"); this.closeModal(); return; }
            
            document.getElementById('inputEmpId').value = u.employeeId || '';
            document.getElementById('inputName').value = u.displayName || '';
            document.getElementById('inputEmail').value = u.email || '';
            document.getElementById('inputLevel').value = u.level || 'N';
            document.getElementById('inputHireDate').value = u.hireDate || '';
            const roleInput = document.getElementById('inputRole');
            roleInput.value = u.role || 'user';
            roleInput.disabled = (u.role === 'system_admin');
            document.getElementById('inputUnit').value = u.unitId || '';
            this.onUnitChange(); 
            document.getElementById('inputGroup').value = u.groupId || '';

            const params = u.schedulingParams || {};
            document.getElementById('checkPregnant').checked = params.isPregnant || false;
            document.getElementById('datePregnant').value = params.pregnantExpiry || '';
            
            document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
            document.getElementById('dateBreastfeeding').value = params.breastfeedingExpiry || '';
            
            document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            
        } else {
            document.querySelectorAll('#staffModal input:not([type="hidden"]), #staffModal select').forEach(i => {
                if(i.type !== 'checkbox') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            document.getElementById('inputRole').value = 'user';
            document.getElementById('inputRole').disabled = false;
            document.getElementById('inputLevel').value = 'N';
            document.getElementById('inputGroup').innerHTML = '<option value="">(請先選擇單位)</option>';
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 7. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value.trim();
        const email = document.getElementById('inputEmail').value.trim();
        const name = document.getElementById('inputName').value.trim();
        const selectedRole = document.getElementById('inputRole').value;
        const selectedUnitId = document.getElementById('inputUnit').value;

        if(!empId || !email || !name || !selectedUnitId) { 
            alert("請填寫所有必填欄位"); 
            return; 
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if(!emailRegex.test(email)) { 
            alert("請輸入有效的電子郵件格式"); 
            return; 
        }
        
        // 檢查員工編號長度（作為預設密碼需至少 6 個字元）
        if (empId.length < 6) {
            const confirm6Chars = confirm(
                `⚠️ 員工編號長度不足 6 個字元\n\n` +
                `員工編號: ${empId} (${empId.length} 字元)\n\n` +
                `Firebase Auth 要求密碼至少 6 個字元。\n` +
                `建議使用較長的員工編號，或稍後手動調整。\n\n` +
                `是否仍要繼續？`
            );
            if (!confirm6Chars) return;
        }

        const data = {
            employeeId: empId,
            displayName: name,
            email: email,
            unitId: selectedUnitId,
            level: document.getElementById('inputLevel').value,
            groupId: document.getElementById('inputGroup').value,
            hireDate: document.getElementById('inputHireDate').value,
            role: selectedRole,
            isActive: true,
            schedulingParams: {
                isPregnant: document.getElementById('checkPregnant').checked,
                pregnantExpiry: document.getElementById('datePregnant').value,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                breastfeedingExpiry: document.getElementById('dateBreastfeeding').value,
                canBundleShifts: document.getElementById('checkBundle').checked
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const batch = db.batch();
            let userRef;
            
            if(docId) {
                // 更新現有記錄
                const existingDoc = await db.collection('users').doc(docId).get();
                const existingData = existingDoc.data();
                
                // 如果修改了 Email，檢查新 Email 是否已被使用
                if (existingData.email !== email) {
                    const emailCheck = await db.collection('users')
                        .where('email', '==', email)
                        .get();
                    
                    if (!emailCheck.empty) {
                        // 找到相同 Email 的記錄
                        const conflictDoc = emailCheck.docs[0];
                        const conflictData = conflictDoc.data();
                        
                        if (conflictData.isActive) {
                            alert(`❌ 此 Email 已被使用\n\n員工：${conflictData.displayName}\n狀態：啟用中`);
                            return;
                        } else {
                            const confirmReactive = confirm(
                                `⚠️ 此 Email 曾經被使用\n\n` +
                                `原員工：${conflictData.displayName}\n` +
                                `狀態：已停用\n\n` +
                                `可能原因：\n` +
                                `1. 離職員工\n` +
                                `2. 重複建立的記錄\n\n` +
                                `建議：\n` +
                                `• 如果是同一個人回任 → 重新啟用舊記錄\n` +
                                `• 如果是不同人 → 需要先處理舊記錄\n\n` +
                                `是否要查看詳細資訊？`
                            );
                            
                            if (confirmReactive) {
                                alert(
                                    `📋 舊記錄詳細資訊\n\n` +
                                    `員工編號：${conflictData.employeeId}\n` +
                                    `姓名：${conflictData.displayName}\n` +
                                    `Email：${conflictData.email}\n` +
                                    `單位：${conflictData.unitId}\n` +
                                    `職級：${conflictData.level}\n` +
                                    `到職日：${conflictData.hireDate || '未設定'}\n\n` +
                                    `建議操作：\n` +
                                    `1. 如果是同一人 → 在列表中找到該記錄並重新啟用\n` +
                                    `2. 如果是不同人 → 聯絡技術人員處理`
                                );
                            }
                            return;
                        }
                    }
                }
                
                userRef = db.collection('users').doc(docId);
                batch.update(userRef, data);
                
            } else {
                // 新增記錄 - 檢查 Email 是否已存在（包含已停用的）
                const emailCheck = await db.collection('users')
                    .where('email', '==', email)
                    .get();
                
                if (!emailCheck.empty) {
                    // 找到相同 Email 的記錄
                    const existingDoc = emailCheck.docs[0];
                    const existingData = existingDoc.data();
                    
                    if (existingData.isActive) {
                        // 啟用中的記錄
                        alert(
                            `❌ 此 Email 已被使用\n\n` +
                            `員工：${existingData.displayName} (${existingData.employeeId})\n` +
                            `單位：${existingData.unitId}\n` +
                            `狀態：啟用中\n\n` +
                            `無法建立重複的 Email`
                        );
                        return;
                    } else {
                        // 已停用的記錄
                        const action = confirm(
                            `⚠️ 此 Email 曾經被使用\n\n` +
                            `原員工：${existingData.displayName} (${existingData.employeeId})\n` +
                            `單位：${existingData.unitId}\n` +
                            `狀態：已停用\n\n` +
                            `是否重新啟用此記錄？\n\n` +
                            `• 確定 → 重新啟用並更新資料\n` +
                            `• 取消 → 停止建立`
                        );
                        
                        if (action) {
                            // 重新啟用舊記錄
                            userRef = db.collection('users').doc(existingDoc.id);
                            data.isActive = true;
                            data.reactivatedAt = firebase.firestore.FieldValue.serverTimestamp();
                            batch.update(userRef, data);
                            
                            alert(
                                `✅ 將重新啟用此員工\n\n` +
                                `提醒：\n` +
                                `• 員工可使用原密碼或員工編號登入\n` +
                                `• 如果忘記密碼，可使用「重設密碼」功能`
                            );
                        } else {
                            return;
                        }
                    }
                } else {
                    // Email 未被使用，正常建立
                    userRef = db.collection('users').doc();
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    batch.set(userRef, data);
                }
            }
            
            const targetUid = docId || userRef.id;
            
            // 更新單位的管理員/排班人員清單
            if (selectedRole !== 'system_admin') {
                const unitRef = db.collection('units').doc(selectedUnitId);
                const unitDoc = await unitRef.get();
                if (unitDoc.exists) {
                    let { managers, schedulers } = unitDoc.data();
                    managers = (managers || []).filter(id => id !== targetUid);
                    schedulers = (schedulers || []).filter(id => id !== targetUid);
                    if (selectedRole === 'unit_manager') managers.push(targetUid);
                    else if (selectedRole === 'unit_scheduler') schedulers.push(targetUid);
                    batch.update(unitRef, { managers, schedulers });
                }
            }
            
            await batch.commit();
            
            if (!docId && !emailCheck.empty) {
                alert("✅ 員工重新啟用成功！");
            } else if (!docId) {
                // 新增成功
                alert(
                    `✅ 員工建立成功！\n\n` +
                    `請將以下資訊告知員工：\n\n` +
                    `Email：${email}\n` +
                    `預設密碼：${empId}\n\n` +
                    `員工可使用 Email + 員工編號登入\n` +
                    `首次登入系統會自動建立帳號並提示修改密碼`
                );
            } else {
                alert("✅ 儲存成功！");
            }
            
            this.closeModal();
            await this.fetchData();
            
        } catch (e) { 
            console.error("Save Error:", e); 
            alert("儲存失敗: " + e.message); 
        }
    },

    // --- 8. 停用員工（取代原本的刪除） ---
    deactivateUser: async function(id) {
        const u = this.allData.find(d => d.id === id);
        if (u && u.role === 'system_admin') { 
            alert("無法停用超級管理員！"); 
            return; 
        }
        
        const confirmMsg = `確定要停用 ${u?.displayName || '此人員'}？\n\n` +
            `停用後：\n` +
            `• 無法登入系統\n` +
            `• 不會出現在排班等功能中\n` +
            `• 資料會保留，可隨時重新啟用\n\n` +
            `💡 這是安全的操作，不會永久刪除資料`;
        
        if(!confirm(confirmMsg)) return;
        
        try {
            await db.collection('users').doc(id).update({ 
                isActive: false,
                deactivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            await this.fetchData();
            alert("✅ 已停用\n\n員工資料已保留，如需重新啟用請點擊「啟用」按鈕");
            
        } catch(e) { 
            alert("❌ 操作失敗：" + e.message); 
        }
    },

    // --- 9. 啟用員工 ---
    activateUser: async function(id) {
        const u = this.allData.find(d => d.id === id);
        if (!u) return;
        
        const confirmMsg = `確定要啟用 ${u.displayName}？\n\n` +
            `啟用後：\n` +
            `• 員工可以正常登入系統\n` +
            `• 可以進行排班等操作\n` +
            `• 如忘記密碼可使用「重設密碼」功能`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await db.collection('users').doc(id).update({
                isActive: true,
                reactivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            await this.fetchData();
            alert("✅ 員工已啟用");
            
        } catch(e) {
            alert("❌ 操作失敗：" + e.message);
        }
    },

    // --- 10. 發送密碼重設郵件（修改：支援所有人員） ---
    sendPasswordResetEmail: async function(userId) {
        const user = this.allData.find(u => u.id === userId);
        if (!user || !user.email) {
            alert('❌ 找不到員工 Email');
            return;
        }
        
        // 檢查是否已開通帳號
        let authExists = false;
        try {
            const signInMethods = await auth.fetchSignInMethodsForEmail(user.email);
            authExists = signInMethods.length > 0;
        } catch (error) {
            console.warn('無法檢查 Auth 狀態:', error);
        }
        
        let confirmMsg = '';
        if (!user.isRegistered || !user.uid) {
            // 未開通的情況
            if (authExists) {
                confirmMsg = `⚠️ 特殊狀況\n\n` +
                    `員工：${user.displayName}\n` +
                    `Email：${user.email}\n\n` +
                    `• Firestore：未開通\n` +
                    `• Auth：帳號存在\n\n` +
                    `仍要發送密碼重設郵件嗎？\n` +
                    `（可能是之前開通失敗導致）`;
            } else {
                confirmMsg = `⚠️ 此員工尚未開通帳號\n\n` +
                    `員工：${user.displayName}\n` +
                    `Email：${user.email}\n\n` +
                    `建議流程：\n` +
                    `1. 員工前往開通頁面註冊\n` +
                    `2. 或使用預設密碼（員工編號）登入\n\n` +
                    `如果員工忘記或無法登入，\n` +
                    `仍可發送重設郵件建立帳號。\n\n` +
                    `是否要發送？`;
            }
        } else {
            // 已開通的情況
            confirmMsg = `發送密碼重設郵件\n\n` +
                `員工：${user.displayName}\n` +
                `Email：${user.email}\n\n` +
                `員工將收到郵件並可自行設定新密碼。\n\n` +
                `確定要發送嗎？`;
        }
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await auth.sendPasswordResetEmail(user.email);
            alert(
                `✅ 已發送密碼重設郵件\n\n` +
                `請通知 ${user.displayName} 檢查信箱：\n` +
                `${user.email}\n\n` +
                `注意事項：\n` +
                `• 郵件可能需要幾分鐘才會送達\n` +
                `• 請檢查垃圾郵件資料夾\n` +
                `• 重設連結有效期 1 小時`
            );
        } catch (error) {
            console.error('發送失敗:', error);
            
            if (error.code === 'auth/user-not-found') {
                const createAccount = confirm(
                    `❌ Auth 系統中找不到此帳號\n\n` +
                    `員工：${user.displayName}\n` +
                    `Email：${user.email}\n\n` +
                    `建議解決方案：\n` +
                    `1. 請員工使用預設密碼（員工編號）首次登入\n` +
                    `2. 系統會自動建立帳號\n` +
                    `3. 登入後可修改密碼\n\n` +
                    `如果員工編號不足 6 字元，\n` +
                    `請使用「帳號診斷工具」協助處理。`
                );
            } else if (error.code === 'auth/too-many-requests') {
                alert(
                    `❌ 請求過於頻繁\n\n` +
                    `請稍後再試，或請員工檢查是否已收到郵件。`
                );
            } else {
                alert('❌ 發送失敗：' + error.message);
            }
        }
    },

    // --- 11. 批次重設密碼（使用員工編號） ---
    batchResetPasswordsByEmployeeId: async function() {
        const confirm1 = confirm(
            `⚠️ 批次重設密碼為員工編號\n\n` +
            `此功能需要後端 Cloud Function 支援。\n\n` +
            `操作說明：\n` +
            `1. 找出所有「已開通」的員工\n` +
            `2. 將密碼統一重設為「員工編號」\n` +
            `3. 需要 Firebase Admin SDK\n\n` +
            `⚠️ 注意：\n` +
            `• 員工編號必須至少 6 個字元\n` +
            `• 此操作無法在前端直接執行\n\n` +
            `建議改用「批次發送重設郵件」功能，\n` +
            `讓員工自行設定密碼更安全。\n\n` +
            `仍要查看實作說明嗎？`
        );
        
        if (!confirm1) return;
        
        alert(
            `📘 批次重設密碼實作說明\n\n` +
            `由於 Firebase 安全限制，\n` +
            `前端無法直接修改 Auth 密碼。\n\n` +
            `需要建立 Cloud Function：\n\n` +
            `1. 安裝 Firebase Admin SDK\n` +
            `2. 建立 HTTPS Function\n` +
            `3. 使用 admin.auth().updateUser()\n\n` +
            `範例程式碼請參考 Firebase 文件：\n` +
            `https://firebase.google.com/docs/auth/admin/manage-users\n\n` +
            `或使用「批次發送重設郵件」功能。`
        );
    },

    // --- 12. 批次發送密碼重設郵件 ---
    batchSendPasswordReset: async function() {
        const confirm1 = confirm(
            `⚠️ 批次發送密碼重設郵件\n\n` +
            `此功能將：\n` +
            `1. 找出所有「已開通且啟用」的員工\n` +
            `2. 發送密碼重設郵件到他們的 Email\n` +
            `3. 員工可自行設定新密碼\n\n` +
            `注意事項：\n` +
            `• 可能需要幾分鐘完成\n` +
            `• 請提醒員工檢查垃圾郵件\n` +
            `• 避免短時間內重複發送\n\n` +
            `確定要繼續嗎？`
        );
        
        if (!confirm1) return;
        
        try {
            // 找出所有已開通且啟用的員工
            const snapshot = await db.collection('users')
                .where('isRegistered', '==', true)
                .where('isActive', '==', true)
                .get();
            
            if (snapshot.empty) {
                alert('✅ 沒有需要重設的帳號\n\n所有員工都尚未開通或已停用。');
                return;
            }
            
            const totalUsers = snapshot.size;
            const confirm2 = confirm(
                `找到 ${totalUsers} 位已開通的員工\n\n` +
                `將對這些員工發送密碼重設郵件。\n\n` +
                `預估時間：約 ${Math.ceil(totalUsers * 0.2)} 秒\n\n` +
                `確定要開始嗎？`
            );
            
            if (!confirm2) return;
            
            let success = 0;
            let failed = 0;
            const failedList = [];
            
            // 顯示進度提示
            const progressDiv = document.createElement('div');
            progressDiv.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 10000; text-align: center; min-width: 300px;
            `;
            progressDiv.innerHTML = `
                <i class="fas fa-spinner fa-spin" style="font-size:3rem;color:#3498db;"></i>
                <p style="margin-top:20px;font-size:1.1rem;font-weight:bold;">批次發送中...</p>
                <p id="batchProgress" style="margin-top:10px;color:#7f8c8d;">0 / ${totalUsers}</p>
            `;
            document.body.appendChild(progressDiv);
            
            // 逐一發送郵件
            let processedCount = 0;
            for (const doc of snapshot.docs) {
                const user = doc.data();
                try {
                    await auth.sendPasswordResetEmail(user.email);
                    success++;
                    
                    // 避免觸發 Firebase 速率限制（每秒約 5-10 封）
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    failed++;
                    const errorMsg = error.code === 'auth/user-not-found' 
                        ? '帳號不存在' 
                        : error.code === 'auth/too-many-requests'
                        ? '請求過於頻繁'
                        : error.code;
                    failedList.push(`${user.displayName} (${user.email}): ${errorMsg}`);
                }
                
                // 更新進度
                processedCount++;
                const progressText = document.getElementById('batchProgress');
                if (progressText) {
                    progressText.textContent = `${processedCount} / ${totalUsers}`;
                }
            }
            
            // 移除進度提示
            document.body.removeChild(progressDiv);
            
            // 顯示結果
            let message = `✅ 批次發送完成\n\n`;
            message += `成功：${success} 筆\n`;
            message += `失敗：${failed} 筆\n\n`;
            
            if (failedList.length > 0) {
                message += `失敗清單：\n${failedList.slice(0, 10).join('\n')}`;
                if (failedList.length > 10) {
                    message += `\n... 還有 ${failedList.length - 10} 筆`;
                }
            }
            
            message += `\n\n請提醒員工：\n`;
            message += `1. 檢查信箱（包含垃圾郵件）\n`;
            message += `2. 點擊郵件中的連結重設密碼\n`;
            message += `3. 如未收到，可使用「重設密碼」按鈕`;
            
            alert(message);
            
        } catch (error) {
            console.error('批次發送失敗:', error);
            alert(`❌ 批次發送失敗\n\n錯誤訊息：${error.message}`);
        }
    },

    openImportModal: function() {
        document.getElementById('importModal').classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        document.getElementById('csvFileInput').value = ''; 
    },
    closeImportModal: function() { document.getElementById('importModal').classList.remove('show'); },
    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,員工編號,姓名,Email,層級,到職日(YYYY-MM-DD),組別";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = "人員匯入範例.csv";
        link.click();
    },
    processImport: async function() {
        const file = document.getElementById('csvFileInput')?.files[0];
        if (!file) { alert("請選擇 CSV 檔案"); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = e.target.result.split(/\r\n|\n/);
                const batch = db.batch();
                let count = 0;
                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i].trim().split(',');
                    if (cols.length < 4) continue;
                    const docRef = db.collection('users').doc();
                    batch.set(docRef, {
                        unitId: cols[0].trim(), employeeId: cols[1].trim(), displayName: cols[2].trim(), email: cols[3].trim(),
                        level: cols[4]||'N', hireDate: cols[5]||'', groupId: cols[6]||'', role: 'user', isActive: true,
                        schedulingParams: { isPregnant: false, isBreastfeeding: false, canBundleShifts: false },
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                    if (count % 450 === 0) await batch.commit();
                }
                if(count > 0) await batch.commit();
                alert(`匯入完成！共 ${count} 筆`);
                this.closeImportModal(); await this.fetchData();
            } catch(error) { alert("匯入失敗: " + error.message); }
        };
        reader.readAsText(file);
    },

    // --- 13. 故障排查工具：修復資料不同步 (完整增強版) ---
    fixAuthFirestoreSync: async function(email) {
        if (!email) { 
            alert("請輸入 Email"); 
            return; 
        }
        
        try {
            console.log(`[修復] 開始檢查 Email: ${email}`);
            
            const firestoreDocs = await db.collection('users')
                .where('email', '==', email)
                .get();
            
            console.log(`[修復] Firestore 中找到 ${firestoreDocs.size} 筆記錄`);
            
            if (firestoreDocs.empty) {
                alert("❌ Firestore 中找不到此 Email 的記錄\n\n請確認：\n1. Email 是否正確\n2. 是否已由管理員建立員工資料");
                return;
            }
            
            console.log(`[修復] 檢查 Auth 系統狀態...`);
            let authExists = false;
            let authUid = null;
            
            try {
                const signInMethods = await auth.fetchSignInMethodsForEmail(email);
                authExists = signInMethods.length > 0;
                console.log(`[修復] Auth 帳號存在: ${authExists}`);
            } catch (authError) {
                console.warn(`[修復] 無法檢查 Auth 狀態:`, authError);
            }
            
            if (firestoreDocs.size > 1) {
                console.warn(`[修復] 警告：找到 ${firestoreDocs.size} 筆相同 Email 的記錄`);
                
                const registeredDocs = [];
                const unregisteredDocs = [];
                
                firestoreDocs.forEach(doc => {
                    const data = doc.data();
                    const timestamp = data.activatedAt?.toMillis?.() || data.createdAt?.toMillis?.() || 0;
                    
                    if (data.isRegistered && data.uid) {
                        registeredDocs.push({ doc, data, timestamp });
                    } else {
                        unregisteredDocs.push({ doc, data, timestamp });
                    }
                });
                
                console.log(`[修復] 已開通: ${registeredDocs.length}, 未開通: ${unregisteredDocs.length}`);
                
                if (registeredDocs.length === 0) {
                    if (!authExists) {
                        const confirmCleanup = confirm(
                            `找到 ${firestoreDocs.size} 筆相同 Email 的重複記錄，但都未開通。\n\n` +
                            `建議刪除所有舊記錄，只保留一筆最新的。\n\n` +
                            `確定要繼續嗎？`
                        );
                        
                        if (!confirmCleanup) return;
                        
                        const sortedDocs = unregisteredDocs.sort((a, b) => b.timestamp - a.timestamp);
                        const keepDoc = sortedDocs[0];
                        const deleteDocs = sortedDocs.slice(1);
                        
                        const batch = db.batch();
                        deleteDocs.forEach(item => {
                            batch.delete(item.doc.ref);
                            console.log(`[修復] 刪除重複記錄: ${item.doc.id}`);
                        });
                        
                        batch.update(keepDoc.doc.ref, {
                            isActive: true,
                            isRegistered: false,
                            uid: null,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        
                        await batch.commit();
                        alert(`✅ 清理完成！\n\n保留記錄: ${keepDoc.doc.id}\n刪除記錄: ${deleteDocs.length} 筆\n\n員工現在可以重新開通帳號。`);
                        
                    } else {
                        alert(
                            `❌ 檢測到資料嚴重不同步\n\n` +
                            `• Firestore: ${firestoreDocs.size} 筆記錄（都未開通）\n` +
                            `• Auth: 帳號已存在\n\n` +
                            `這種情況需要手動處理：\n` +
                            `1. 聯絡技術人員\n` +
                            `2. 或先刪除 Auth 帳號（需要 Admin SDK）\n` +
                            `3. 再清理 Firestore 重複記錄`
                        );
                    }
                    return;
                }
                
                registeredDocs.sort((a, b) => b.timestamp - a.timestamp);
                const latestDoc = registeredDocs[0];
                
                const docsToDelete = [
                    ...registeredDocs.slice(1),
                    ...unregisteredDocs
                ];
                
                if (docsToDelete.length > 0) {
                    const deleteList = docsToDelete.map((item, idx) => {
                        return `${idx + 1}. ${item.doc.id} (${item.data.isRegistered ? '已開通' : '未開通'})`;
                    }).join('\n');
                    
                    const confirmDelete = confirm(
                        `找到 ${firestoreDocs.size} 筆相同 Email 的記錄。\n\n` +
                        `將保留最新的已開通記錄：\n${latestDoc.doc.id}\n\n` +
                        `將刪除以下 ${docsToDelete.length} 筆記錄：\n${deleteList}\n\n` +
                        `確定要繼續嗎？`
                    );
                    
                    if (!confirmDelete) return;
                    
                    const batch = db.batch();
                    docsToDelete.forEach(item => {
                        batch.delete(item.doc.ref);
                        console.log(`[修復] 刪除重複記錄: ${item.doc.id}`);
                    });
                    
                    batch.update(latestDoc.doc.ref, {
                        isActive: true,
                        isRegistered: true,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    await batch.commit();
                    alert(`✅ 修復完成！\n\n保留記錄: ${latestDoc.doc.id}\n刪除記錄: ${docsToDelete.length} 筆`);
                } else {
                    alert(`✅ 資料狀態正常\n\n只有一筆已開通的記錄，無需修復。`);
                }
            } else {
                const doc = firestoreDocs.docs[0];
                const data = doc.data();
                
                console.log(`[修復] 記錄詳情:`, {
                    docId: doc.id,
                    isRegistered: data.isRegistered,
                    isActive: data.isActive,
                    uid: data.uid,
                    authExists: authExists
                });
                
                if (!data.isRegistered || !data.uid) {
                    if (!authExists) {
                        alert(
                            `✅ 資料狀態正常\n\n` +
                            `此員工尚未開通帳號。\n` +
                            `請員工前往開通頁面完成開通流程。`
                        );
                    } else {
                        alert(
                            `⚠️ 檢測到不一致狀態\n\n` +
                            `• Firestore: 未開通\n` +
                            `• Auth: 帳號已存在\n\n` +
                            `可能原因：之前開通失敗\n\n` +
                            `建議操作：\n` +
                            `1. 刪除 Auth 帳號（需要 Admin SDK 或 Firebase Console）\n` +
                            `2. 讓員工重新開通`
                        );
                    }
                    return;
                }
                
                if (!data.isActive) {
                    const confirmFix = confirm(
                        `此記錄已開通但狀態為「停用」。\n\n` +
                        `確定要將其恢復為「啟用」嗎？`
                    );
                    if (!confirmFix) return;
                    
                    await db.collection('users').doc(doc.id).update({
                        isActive: true,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    alert("✅ 修復完成！已將員工狀態恢復為啟用。");
                } else {
                    if (doc.id !== data.uid) {
                        const confirmMigrate = confirm(
                            `⚠️ 檢測到文件 ID 與 UID 不一致\n\n` +
                            `文件 ID: ${doc.id}\n` +
                            `UID: ${data.uid}\n\n` +
                            `建議將資料遷移到正確的文件 ID。\n\n` +
                            `確定要進行遷移嗎？`
                        );
                        
                        if (!confirmMigrate) return;
                        
                        const batch = db.batch();
                        
                        const newDocRef = db.collection('users').doc(data.uid);
                        batch.set(newDocRef, {
                            ...data,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        
                        batch.delete(doc.ref);
                        
                        await batch.commit();
                        alert(`✅ 遷移完成！\n\n新文件 ID: ${data.uid}\n已刪除舊文件: ${doc.id}`);
                    } else {
                        alert(
                            `✅ 資料狀態正常\n\n` +
                            `UID: ${data.uid}\n` +
                            `isRegistered: ${data.isRegistered}\n` +
                            `isActive: ${data.isActive}\n\n` +
                            `無需修復。`
                        );
                    }
                }
            }
            
            await this.fetchData();
            
        } catch (error) {
            console.error("[修復] 出錯:", error);
            alert(`❌ 修復失敗\n\n錯誤訊息: ${error.message}`);
        }
    },

    // --- 故障排查工具：UI 輔助函數 ---
    openTroubleshootModal: function() {
        const modal = document.getElementById('troubleshootModal');
        if(modal) {
            modal.classList.add('show');
            document.getElementById('troubleshootEmail').value = '';
            const resultDiv = document.getElementById('troubleshootResult');
            if(resultDiv) resultDiv.style.display = 'none';
        }
    },

    closeTroubleshootModal: function() {
        const modal = document.getElementById('troubleshootModal');
        if(modal) modal.classList.remove('show');
    },

    startTroubleshoot: async function() {
        const email = document.getElementById('troubleshootEmail').value.trim();
        const resultDiv = document.getElementById('troubleshootResult');
        
        if (!email) {
            if(resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.style.padding = '15px';
                resultDiv.style.borderRadius = '4px';
                resultDiv.style.marginTop = '10px';
                resultDiv.textContent = '❌ 請輸入 Email';
            }
            return;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if(resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.style.padding = '15px';
                resultDiv.style.borderRadius = '4px';
                resultDiv.style.marginTop = '10px';
                resultDiv.textContent = '❌ Email 格式不正確';
            }
            return;
        }
        
        if(resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = '#d1ecf1';
            resultDiv.style.color = '#0c5460';
            resultDiv.style.padding = '15px';
            resultDiv.style.borderRadius = '4px';
            resultDiv.style.marginTop = '10px';
            resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在檢查並修復...';
        }
        
        try {
            await this.fixAuthFirestoreSync(email);
            if(resultDiv) resultDiv.style.display = 'none';
        } catch (error) {
            if(resultDiv) {
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.innerHTML = `❌ 修復失敗<br><small>${error.message}</small>`;
            }
        }
    }
};
