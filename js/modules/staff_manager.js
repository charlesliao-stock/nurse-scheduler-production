// js/modules/staff_manager.js

const staffManager = {
    allData: [],
    unitCache: {}, 
    sortState: { field: 'employeeId', order: 'asc' },
    isLoading: false, 

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

    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">載入中...</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        try {
            const units = await DataLoader.loadUnits();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            let filteredUnits = units;
            if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && activeUnitId) {
                filteredUnits = units.filter(u => u.id === activeUnitId);
            }

            selectFilter.innerHTML = '<option value="all">所有單位</option>';
            filteredUnits.forEach(u => {
                this.unitCache[u.id] = { name: u.name, groups: u.groups || [] };
                const option = `<option value="${u.id}">${u.name}</option>`;
                selectFilter.innerHTML += option;
                selectInput.innerHTML += option;
            });
            
            selectFilter.onchange = () => this.renderTable();
        } catch (e) {
            console.error("載入單位失敗:", e);
            selectFilter.innerHTML = '<option value="all">載入失敗</option>';
        }
    },

    onUnitChange: async function() {
        const unitId = document.getElementById('inputUnit').value;
        const groupSelect = document.getElementById('inputGroup');
        
        if (groupSelect) {
            const currentGroup = groupSelect.value;
            groupSelect.innerHTML = '<option value="">(無)</option>';
            
            if (unitId && this.unitCache[unitId]) {
                const groups = this.unitCache[unitId].groups;
                if (groups && groups.length > 0) {
                    groupSelect.innerHTML = '<option value="">請選擇組別</option>';
                    groups.forEach(g => {
                        groupSelect.innerHTML += `<option value="${g}">${g}</option>`;
                    });
                    if (currentGroup) groupSelect.value = currentGroup;
                } else {
                    groupSelect.innerHTML = '<option value="">(此單位未設定組別)</option>';
                }
            }
        }

        // ✅ 確保教師名單載入完成
        await this.loadClinicalTeachers();
        // ✅ 載入後更新選單啟用狀態
        this.updateIndependenceFieldState();
    },

    loadClinicalTeachers: async function() {
        const unitId = document.getElementById('inputUnit').value;
        const teacherSelect = document.getElementById('selectClinicalTeacher');
        if(!teacherSelect || !unitId) {
            if(teacherSelect) teacherSelect.innerHTML = '<option value="">(請先選擇單位)</option>';
            return;
        }

        const currentValue = teacherSelect.value;

        try {
            const staff = await DataLoader.loadStaff(unitId);
            
            teacherSelect.innerHTML = '<option value="">(請選擇臨床教師)</option>';
            const currentUserId = document.getElementById('staffDocId').value;
            
            staff.forEach(s => {
                if (s.uid !== currentUserId) {
                    const option = document.createElement('option');
                    option.value = s.uid;
                    option.textContent = `${s.displayName} (${s.employeeId})`;
                    teacherSelect.appendChild(option);
                }
            });

            if (currentValue) {
                teacherSelect.value = currentValue;
            }

        } catch (e) {
            console.error("載入臨床教師失敗:", e);
            teacherSelect.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    updateDateFieldState: function() {
        const datePregnant = document.getElementById('datePregnant');
        const dateBreastfeeding = document.getElementById('dateBreastfeeding');
        const datePGY = document.getElementById('datePGY');
        const checkPregnant = document.getElementById('checkPregnant');
        const checkBreastfeeding = document.getElementById('checkBreastfeeding');
        const checkPGY = document.getElementById('checkPGY');
        
        if(datePregnant) {
            datePregnant.disabled = !checkPregnant.checked;
            if (!checkPregnant.checked) datePregnant.value = '';
        }
        
        if(dateBreastfeeding) {
            dateBreastfeeding.disabled = !checkBreastfeeding.checked;
            if (!checkBreastfeeding.checked) dateBreastfeeding.value = '';
        }
        
        if(datePGY) {
            datePGY.disabled = !checkPGY.checked;
            if (!checkPGY.checked) datePGY.value = '';
        }
    },

    updateIndependenceFieldState: function() {
        const radioDependent = document.getElementById('radioDependent');
        const selectClinicalTeacher = document.getElementById('selectClinicalTeacher');
        
        if(!selectClinicalTeacher) return;
        
        const isDependentSelected = radioDependent && radioDependent.checked;
        
        selectClinicalTeacher.disabled = !isDependentSelected;
        
        if (!isDependentSelected) {
            selectClinicalTeacher.value = '';
        } else {
            this.loadClinicalTeachers();
        }
    },

    validateAndSave: function() {
        const radioDependent = document.getElementById('radioDependent');
        const selectClinicalTeacher = document.getElementById('selectClinicalTeacher');
        
        if (radioDependent.checked && !selectClinicalTeacher.value) {
            alert('當選擇「未獨立」時，必須選擇臨床教師\n\n說明：未獨立的員工不列入排班人力，排班將與其臨床教師一致。');
            selectClinicalTeacher.focus();
            return;
        }
        
        this.saveData();
    },

    fetchData: async function() {
        if(this.isLoading) return;
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</td></tr>';
        this.isLoading = true;

        try {
            const users = await DataLoader.loadAllUsers();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && activeUnitId) {
                this.allData = users.filter(u => u.unitId === activeUnitId);
            } else {
                this.allData = users;
            }
            
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
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#999;">無符合資料</td></tr>';
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(u => {
            const unitName = (this.unitCache[u.unitId]?.name) || u.unitId || '未知單位';
            const roleName = app.translateRole(u.role);
            
            const rowStyle = u.isActive ? '' : 'opacity:0.5;background:#f8f9fa;';
            const nameDisplay = u.isActive 
                ? u.displayName || '-'
                : `${u.displayName || '-'} <span style="color:#e74c3c;font-size:0.8rem;">(已停用)</span>`;
            
            let actionButtons = '';
            const currentRole = app.impersonatedRole || app.userRole;
            const isSystemAdmin = (currentRole === 'system_admin');
            
            if (!u.isActive) {
                actionButtons = `
                    <button class="btn" style="background:#28a745;color:white;padding:5px 10px;margin-right:5px;" 
                            onclick="staffManager.activateUser('${u.uid}')" title="啟用">
                        <i class="fas fa-check-circle"></i> 啟用
                    </button>
                    <button class="btn" style="background:#3498db;color:white;padding:5px 10px;margin-right:5px;" 
                            onclick="staffManager.resetPassword('${u.uid}')" 
                            title="重設密碼">
                        <i class="fas fa-key"></i>
                    </button>
                `;
                
                if (isSystemAdmin) {
                    actionButtons += `
                        <button class="btn" style="background:#dc3545;color:white;padding:5px 10px;" 
                                onclick="staffManager.deleteUser('${u.uid}', '${(u.displayName || '').replace(/'/g, "\\'")}', '${u.employeeId}')" 
                                title="永久刪除">
                            <i class="fas fa-trash-alt"></i> 刪除
                        </button>
                    `;
                }
            } else {
                let deactivateBtn = u.role === 'system_admin' 
                    ? `<button class="btn" style="background:#95a5a6;color:white;padding:5px 10px;" disabled title="超級管理員無法停用">
                        <i class="fas fa-ban"></i> 停用
                      </button>`
                    : `<button class="btn" style="background:#e67e22;color:white;padding:5px 10px;" 
                              onclick="staffManager.deactivateUser('${u.uid}')" title="停用">
                        <i class="fas fa-ban"></i> 停用
                      </button>`;
                
                actionButtons = `
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.uid}')" title="編輯">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn" style="background:#3498db;color:white;padding:5px 10px;margin:0 5px;" 
                            onclick="staffManager.resetPassword('${u.uid}')" 
                            title="重設密碼">
                        <i class="fas fa-key"></i>
                    </button>
                    ${deactivateBtn}
                `;
            }

            const tr = document.createElement('tr');
            tr.style.cssText = rowStyle;
            const params = u.schedulingParams || {};
            let pregStatus = '';
            if (params.isPregnant) pregStatus += '<span style="color:#e91e63; font-weight:bold; margin-right:5px;">孕</span>';
            if (params.isBreastfeeding) pregStatus += '<span style="color:#2196f3; font-weight:bold;">哺</span>';
            
            const pgyStatus = params.isPGY ? '<span style="font-weight:bold; color:#27ae60;">V</span>' : '';
            const independenceStatus = params.independence === 'dependent' ? '<span style="font-weight:bold; color:#f39c12;">V</span>' : '';

            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || '-'}</td>
                <td>${nameDisplay}</td>
                <td>${u.level || '-'}</td>
                <td style="text-align:center;">${pregStatus || '-'}</td>
                <td style="text-align:center;">${pgyStatus || '-'}</td>
                <td style="text-align:center;">${independenceStatus || '-'}</td>
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

    openModal: async function(docId = null) {
        const modal = document.getElementById('staffModal');
        if(!modal) return;
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            const u = this.allData.find(d => d.uid === docId);
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

            const params = u.schedulingParams || {};
            
            // ✅ 修正：改用 async/await 確保單位變更與教師名單載入完成
            (async () => {
                await this.onUnitChange();
                
                const groupInput = document.getElementById('inputGroup');
                if (groupInput) groupInput.value = u.groupId || '';
                
                const teacherSelect = document.getElementById('selectClinicalTeacher');
                if (teacherSelect && params.clinicalTeacherId) {
                    teacherSelect.value = params.clinicalTeacherId;
                }
                // 再次確保狀態正確
                this.updateIndependenceFieldState();
            })();
            document.getElementById('checkPregnant').checked = params.isPregnant || false;
            document.getElementById('datePregnant').value = params.pregnantExpiry || '';
            
            document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
            document.getElementById('dateBreastfeeding').value = params.breastfeedingExpiry || '';
            
            document.getElementById('checkPGY').checked = params.isPGY || false;
            document.getElementById('datePGY').value = params.pgyExpiry || '';
            
            document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            
            const independence = params.independence || 'independent';
            if (independence === 'independent') {
                document.getElementById('radioIndependent').checked = true;
            } else {
                document.getElementById('radioDependent').checked = true;
            }

            this.updateDateFieldState();
            this.updateIndependenceFieldState();
            
        } else {
            document.querySelectorAll('#staffModal input:not([type="hidden"]), #staffModal select').forEach(i => {
                if(i.type !== 'checkbox') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            document.getElementById('inputRole').value = 'user';
            document.getElementById('inputRole').disabled = false;
            document.getElementById('inputLevel').value = 'N';
            const groupInput = document.getElementById('inputGroup');
            if (groupInput) groupInput.innerHTML = '<option value="">(請先選擇單位)</option>';
            document.getElementById('radioIndependent').checked = true;
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

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
            groupId: document.getElementById('inputGroup')?.value || '',
            hireDate: document.getElementById('inputHireDate').value,
            role: selectedRole,
            isActive: true,
            schedulingParams: {
                isPregnant: document.getElementById('checkPregnant').checked,
                pregnantExpiry: document.getElementById('datePregnant').value,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                breastfeedingExpiry: document.getElementById('dateBreastfeeding').value,
                isPGY: document.getElementById('checkPGY').checked,
                pgyExpiry: document.getElementById('datePGY').value,
                canBundleShifts: document.getElementById('checkBundle').checked,
                independence: document.querySelector('input[name="independence"]:checked')?.value || 'independent',
                clinicalTeacherId: document.getElementById('selectClinicalTeacher').value || null
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const batch = db.batch();
            let userRef;
            let emailCheck = null;
            
            if(docId) {
                const existingDoc = await db.collection('users').doc(docId).get();
                const existingData = existingDoc.data();
                
                if (existingData.email !== email) {
                    emailCheck = await db.collection('users')
                        .where('email', '==', email)
                        .get();
                    
                    if (!emailCheck.empty) {
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
                emailCheck = await db.collection('users')
                    .where('email', '==', email)
                    .get();
                
                if (!emailCheck.empty) {
                    const existingDoc = emailCheck.docs[0];
                    const existingData = existingDoc.data();
                    
                    if (existingData.isActive) {
                        alert(
                            `❌ 此 Email 已被使用\n\n` +
                            `員工：${existingData.displayName} (${existingData.employeeId})\n` +
                            `單位：${existingData.unitId}\n` +
                            `狀態：啟用中\n\n` +
                            `無法建立重複的 Email`
                        );
                        return;
                    } else {
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
                            userRef = db.collection('users').doc(existingDoc.id);
                            data.isActive = true;
                            data.reactivatedAt = firebase.firestore.FieldValue.serverTimestamp();
                            batch.update(userRef, data);
                            
                            alert(
                                `✅ 將重新啟用此員工\n\n` +
                                `提醒：\n` +
                                `• 員工可使用員工編號登入\n` +
                                `• 如果忘記密碼，可使用「重設密碼」功能`
                            );
                        } else {
                            return;
                        }
                    }
                } else {
                    userRef = db.collection('users').doc();
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    batch.set(userRef, data);
                }
            }
            
            const targetUid = docId || userRef.id;
            
            if (selectedRole !== 'system_admin') {
                const unitRef = db.collection('units').doc(selectedUnitId);
                const unitDoc = await unitRef.get();
                if (unitDoc.exists) {
                    let { managers, schedulers } = unitDoc.data();
                    managers = (managers || []).filter(id => id !== targetUid);
                    schedulers = (schedulers || []).filter(id => id !== targetUid);
                    
                    if (selectedRole === 'unit_manager') {
                        managers.push(targetUid);
                        console.log(`✅ 同步：加入單位管理者列表 (${selectedUnitId})`);
                    } else if (selectedRole === 'unit_scheduler') {
                        schedulers.push(targetUid);
                        console.log(`✅ 同步：加入單位排班者列表 (${selectedUnitId})`);
                    }
                    
                    batch.update(unitRef, { 
                        managers, 
                        schedulers,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
            
            await batch.commit();
            
            CacheManager.invalidate('staff', selectedUnitId);
            CacheManager.invalidate('users');
            
            if (!docId && !emailCheck.empty) {
                alert("✅ 員工重新啟用成功！");
            } else if (!docId) {
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

    deactivateUser: async function(id) {
        const u = this.allData.find(d => d.uid === id);
        if (u && u.role === 'system_admin') { 
            alert("無法停用超級管理員！"); 
            return; 
        }
        
        const confirmMsg = `確定要停用 ${u?.displayName}？\n\n` +
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
            
            CacheManager.invalidate('staff', u.unitId);
            CacheManager.invalidate('users');
            
            await this.fetchData();
            alert("✅ 已停用\n\n員工資料已保留，如需重新啟用請點擊「啟用」按鈕");
            
        } catch(e) { 
            alert("❌ 操作失敗：" + e.message); 
        }
    },

    activateUser: async function(id) {
        const u = this.allData.find(d => d.uid === id);
        if (!u) return;
        
        const confirmMsg = `確定要啟用 ${u.displayName}？\n\n` +
            `啟用後：\n` +
            `• 員工可以正常登入系統\n` +
            `• 可以進行排班等操作\n` +
            `• 預設密碼為員工編號：${u.employeeId}`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await db.collection('users').doc(id).update({
                isActive: true,
                reactivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            CacheManager.invalidate('staff', u.unitId);
            CacheManager.invalidate('users');
            
            await this.fetchData();
            alert("✅ 員工已啟用");
            
        } catch(e) {
            alert("❌ 操作失敗：" + e.message);
        }
    },

    resetPassword: function(userId) {
        const user = this.allData.find(u => u.uid === userId);
        if (!user) {
            alert('❌ 找不到員工資料');
            return;
        }
        
        const message = `重設密碼\n\n` +
            `員工：${user.displayName}\n` +
            `Email：${user.email}\n` +
            `員工編號：${user.employeeId}\n\n` +
            `新密碼將設為：${user.employeeId}\n\n` +
            `請通知員工使用以下方式登入：\n` +
            `• Email：${user.email}\n` +
            `• 密碼：${user.employeeId}\n\n` +
            `確定要重設嗎？`;
        
        if (confirm(message)) {
            this.openResetPasswordModal(userId);
        }
    },

    openResetPasswordModal: function(userId) {
        const user = this.allData.find(u => u.uid === userId);
        if (!user) return;
        
        const modalHtml = `
            <div id="resetPasswordModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:500px;">
                    <h2 style="margin-bottom:20px;">
                        <i class="fas fa-key" style="color:#3498db;"></i> 重設密碼
                    </h2>
                    
                    <div style="background:#f8f9fa;padding:15px;border-radius:8px;margin-bottom:20px;">
                        <p style="margin:5px 0;"><strong>員工：</strong> ${user.displayName}</p>
                        <p style="margin:5px 0;"><strong>Email：</strong> ${user.email}</p>
                        <p style="margin:5px 0;"><strong>員工編號：</strong> ${user.employeeId}</p>
                    </div>
                    
                    <div style="background:#fff3cd;border:1px solid#ffc107;padding:15px;border-radius:8px;margin-bottom:20px;">
                        <p style="margin:0;color:#856404;"><i class="fas fa-info-circle"></i> <strong>請輸入以下資訊以確認身份：</strong></p>
                    </div>
                    
                    <div style="margin-bottom:15px;">
                        <label style="display:block;margin-bottom:5px;font-weight:bold;">員工編號</label>
                        <input type="text" id="confirmEmployeeId" placeholder="請輸入員工編號" 
                               style="width:100%;padding:10px;border:2px solid #ddd;border-radius:4px;font-size:1rem;">
                    </div>
                    
                    <div style="margin-bottom:20px;">
                        <label style="display:block;margin-bottom:5px;font-weight:bold;">Email</label>
                        <input type="email" id="confirmEmail" placeholder="請輸入 Email" 
                               style="width:100%;padding:10px;border:2px solid #ddd;border-radius:4px;font-size:1rem;">
                    </div>
                    
                    <div style="background:#e8f5e9;border:1px solid#4caf50;padding:15px;border-radius:8px;margin-bottom:20px;">
                        <p style="margin:0;color:#2e7d32;">
                            <i class="fas fa-check-circle"></i> 
                            重設後，員工可使用 <strong>員工編號</strong> 作為密碼登入
                        </p>
                    </div>
                    
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button class="btn" style="background:#95a5a6;" onclick="staffManager.closeResetPasswordModal()">
                            取消
                        </button>
                        <button class="btn" style="background:#3498db;" onclick="staffManager.confirmResetPassword('${userId}')">
                            <i class="fas fa-key"></i> 確認重設
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        const oldModal = document.getElementById('resetPasswordModal');
        if (oldModal) oldModal.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        setTimeout(() => {
            document.getElementById('confirmEmployeeId').focus();
        }, 100);
    },

    closeResetPasswordModal: function() {
        const modal = document.getElementById('resetPasswordModal');
        if (modal) modal.remove();
    },

    confirmResetPassword: async function(userId) {
        const user = this.allData.find(u => u.uid === userId);
        if (!user) return;
        
        const inputEmployeeId = document.getElementById('confirmEmployeeId').value.trim();
        const inputEmail = document.getElementById('confirmEmail').value.trim();
        
        if (!inputEmployeeId || !inputEmail) {
            alert('❌ 請填寫所有欄位');
            return;
        }
        
        if (inputEmployeeId !== user.employeeId) {
            alert('❌ 員工編號不正確');
            document.getElementById('confirmEmployeeId').focus();
            return;
        }
        
        if (inputEmail.toLowerCase() !== user.email.toLowerCase()) {
            alert('❌ Email 不正確');
            document.getElementById('confirmEmail').focus();
            return;
        }
        
        if (user.employeeId.length < 6) {
            alert(
                `❌ 員工編號不足 6 個字元\n\n` +
                `員工編號：${user.employeeId} (${user.employeeId.length} 字元)\n\n` +
                `Firebase Auth 要求密碼至少 6 個字元。\n` +
                `請修改員工編號後再試。`
            );
            this.closeResetPasswordModal();
            return;
        }
        
        try {
            await db.collection('users').doc(userId).update({
                passwordResetAt: firebase.firestore.FieldValue.serverTimestamp(),
                passwordResetBy: auth.currentUser ? auth.currentUser.uid : 'admin',
                useEmployeeIdAsPassword: true,
                forcePasswordReset: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            CacheManager.invalidate('users');
            
            this.closeResetPasswordModal();
            
            alert(
                `✅ 密碼已重設！\n\n` +
                `請通知 ${user.displayName}：\n\n` +
                `登入方式：\n` +
                `• Email：${user.email}\n` +
                `• 密碼：${user.employeeId}\n\n` +
                `首次登入後系統會要求設定新密碼。`
            );
            
            await this.fetchData();
            
        } catch (error) {
            console.error('重設失敗:', error);
            alert(`❌ 重設失敗：${error.message}`);
        }
    },

    batchResetPasswords: async function() {
        const confirm1 = confirm(
            `⚠️ 批次重設密碼\n\n` +
            `此功能將：\n` +
            `1. 找出所有「啟用中」的員工\n` +
            `2. 將密碼重設為「員工編號」\n` +
            `3. 員工下次登入會被要求修改密碼\n\n` +
            `⚠️ 注意：\n` +
            `• 員工編號必須至少 6 個字元\n` +
            `• 需要逐一確認\n\n` +
            `確定要繼續嗎？`
        );
        
        if (!confirm1) return;
        
        try {
            const snapshot = await db.collection('users')
                .where('isActive', '==', true)
                .get();
            
            if (snapshot.empty) {
                alert('✅ 沒有需要重設的帳號');
                return;
            }
            
            const validUsers = [];
            const invalidUsers = [];
            
            snapshot.docs.forEach(doc => {
                const user = doc.data();
                if (user.employeeId && user.employeeId.length >= 6) {
                    validUsers.push({
                        id: doc.id,
                        email: user.email,
                        employeeId: user.employeeId,
                        displayName: user.displayName
                    });
                } else {
                    invalidUsers.push({
                        displayName: user.displayName,
                        employeeId: user.employeeId || '(無)',
                        length: (user.employeeId || '').length
                    });
                }
            });
            
            let message = `找到 ${snapshot.size} 位員工\n\n`;
            message += `可重設：${validUsers.length} 位\n`;
            
            if (invalidUsers.length > 0) {
                message += `無法重設：${invalidUsers.length} 位\n`;
                message += `（員工編號不足 6 字元）\n\n`;
                
                if (invalidUsers.length <= 5) {
                    message += `無法重設的員工：\n`;
                    invalidUsers.forEach(u => {
                        message += `• ${u.displayName} (${u.employeeId}, ${u.length}字元)\n`;
                    });
                }
            }
            
            message += `\n確定要重設 ${validUsers.length} 位員工的密碼嗎？`;
            
            if (!confirm(message)) return;
            
            const batch = db.batch();
            validUsers.forEach(user => {
                const userRef = db.collection('users').doc(user.id);
                batch.update(userRef, {
                    passwordResetAt: firebase.firestore.FieldValue.serverTimestamp(),
                    passwordResetBy: auth.currentUser ? auth.currentUser.uid : 'admin',
                    useEmployeeIdAsPassword: true,
                    forcePasswordReset: true,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            
            await batch.commit();
            
            CacheManager.invalidate('users');
            
            let resultMessage = `✅ 批次重設完成\n\n`;
            resultMessage += `成功：${validUsers.length} 位\n`;
            if (invalidUsers.length > 0) {
                resultMessage += `跳過：${invalidUsers.length} 位（編號不足6字元）\n`;
            }
            resultMessage += `\n請通知員工：\n`;
            resultMessage += `1. 使用 Email + 員工編號登入\n`;
            resultMessage += `2. 首次登入會要求設定新密碼\n`;
            resultMessage += `3. 設定一個安全的密碼`;
            
            alert(resultMessage);
            await this.fetchData();
            
        } catch (error) {
            console.error('批次重設失敗:', error);
            alert(`❌ 操作失敗：${error.message}`);
        }
    },

    openImportModal: function() {
        document.getElementById('importModal').classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        document.getElementById('csvFileInput').value = ''; 
    },
    
    closeImportModal: function() { 
        document.getElementById('importModal').classList.remove('show'); 
    },
    
    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,員工編號,姓名,Email,進階層級,到職日(YYYY-MM-DD)";
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
                const rows = e.target.result.split(/\r\n|\n|\r/);
                
                const existingStaffMap = {};
                const snapshot = await db.collection('users').get();
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.employeeId) {
                        existingStaffMap[data.employeeId] = doc.id;
                    }
                });

                let batch = db.batch();
                let count = 0;
                let totalProcessed = 0;
                let newCount = 0;
                let updateCount = 0;

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim();
                    if (!row) continue;

                    const cols = row.includes(';') ? row.split(';') : row.split(',');
                    if (cols.length < 4) continue;

                    const unitId = cols[0].trim();
                    const employeeId = cols[1].trim();
                    const displayName = cols[2].trim();
                    const email = cols[3].trim();
                    const level = (cols[4] || 'N').trim();
                    const hireDate = (cols[5] || '').trim();

                    const existingDocId = existingStaffMap[employeeId];
                    const docRef = existingDocId ? db.collection('users').doc(existingDocId) : db.collection('users').doc();
                    
                    const staffData = {
                        unitId,
                        employeeId,
                        displayName,
                        email,
                        level,
                        hireDate,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    if (existingDocId) {
                        batch.update(docRef, staffData);
                        updateCount++;
                    } else {
                        Object.assign(staffData, {
                            role: 'user',
                            isActive: true,
                            schedulingParams: { isPregnant: false, isBreastfeeding: false, canBundleShifts: false },
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        batch.set(docRef, staffData);
                        newCount++;
                    }
                    
                    count++;
                    totalProcessed++;

                    if (count === 450) {
                        await batch.commit();
                        batch = db.batch();
                        count = 0;
                    }
                }
                
                if (count > 0) {
                    await batch.commit();
                }
                
                CacheManager.clear();

                alert(`匯入完成！\n總計處理：${totalProcessed} 筆\n新增：${newCount} 筆\n更新：${updateCount} 筆`);
                this.closeImportModal(); 
                await this.fetchData();
            } catch(error) { 
                console.error("匯入失敗詳情:", error);
                alert("匯入失敗: " + error.message); 
            }
        };
        reader.readAsText(file);
    },

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

    deleteUser: async function(userId, displayName, employeeId) {
        const currentRole = app.impersonatedRole || app.userRole;
        
        if (currentRole !== 'system_admin') {
            alert('❌ 權限不足\n\n只有系統管理者可以刪除帳號。\n單位管理者僅能停用帳號。');
            return;
        }
        
        const confirm1 = confirm(
            `⚠️ 永久刪除帳號\n\n` +
            `姓名：${displayName}\n` +
            `員工編號：${employeeId}\n\n` +
            `⚠️ 警告：\n` +
            `• 此操作將永久刪除帳號資料\n` +
            `• 刪除後無法復原\n` +
            `• 建議僅刪除已停用的帳號\n\n` +
            `確定要刪除嗎？`
        );
        
        if (!confirm1) return;
        
        const confirm2 = confirm(
            `⚠️ 最後確認\n\n` +
            `即將永久刪除：${displayName} (${employeeId})\n\n` +
            `此操作無法復原！\n\n` +
            `確定要繼續嗎？`
        );
        
        if (!confirm2) return;
        
        try {
            await db.collection('users').doc(userId).delete();
            
            CacheManager.invalidate('users');
            
            alert(
                `✅ 刪除成功\n\n` +
                `已永久刪除帳號：${displayName} (${employeeId})`
            );
            
            await this.fetchData();
            
        } catch (error) {
            console.error('刪除失敗:', error);
            alert(`❌ 刪除失敗：${error.message}`);
        }
    }
};
