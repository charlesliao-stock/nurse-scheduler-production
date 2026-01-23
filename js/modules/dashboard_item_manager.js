// js/modules/dashboard_item_manager.js

const dashboardItemManager = {
    allItems: [],
    allRoles: [
        { id: 'system_admin', name: '系統管理員' },
        { id: 'unit_manager', name: '單位護理長' },
        { id: 'unit_scheduler', name: '排班人員' },
        { id: 'user', name: '一般使用者' }
    ],
    dataSources: [
        // 一般使用者
        { id: 'my_schedule_status', name: '班表檢視', category: '一般使用者', desc: '顯示個人本月班表狀態（已發布/未發布）與連結。' },
        { id: 'my_pending_exchanges', name: '待審核項目(個人)', category: '一般使用者', desc: '顯示等待「我」同意或處理的換班申請數量。' },
        { id: 'my_active_pre_schedule', name: '進行中的預班', category: '一般使用者', desc: '顯示目前開放中、等待「我」填寫的預班表數量。' },
        { id: 'my_personal_stats', name: '個人統計資料', category: '一般使用者', desc: '顯示個人本月總班數、休假數、夜班數等摘要。' },
        // 單位管理者
        { id: 'unit_staff_count', name: '單位人員管理', category: '單位管理者', desc: '顯示所屬單位的總人數，連結至人員管理。' },
        { id: 'unit_schedule_status', name: '班表管理', category: '單位管理者', desc: '顯示所屬單位本月班表的編輯/發布狀態。' },
        { id: 'unit_pre_schedule_progress', name: '預班管理', category: '單位管理者', desc: '顯示所屬單位預班收集的進度百分比。' },
        { id: 'unit_pending_approvals', name: '待審核項目(主管)', category: '單位管理者', desc: '顯示等待「護理長」簽核的換班申請數量。' },
        { id: 'unit_statistics_summary', name: '單位統計資料', category: '單位管理者', desc: '顯示單位的缺額率、修正率等核心指標摘要。' },
        // 系統管理者
        { id: 'sys_total_staff_count', name: '人員管理(總數)', category: '系統管理者', desc: '顯示全院所有單位的總護理人員數。' },
        { id: 'sys_total_unit_count', name: '單位管理(總數)', category: '系統管理者', desc: '顯示系統內設定的總單位數量。' },
        { id: 'sys_total_schedules', name: '總排班次數', category: '系統管理者', desc: '統計全系統累計生成的班表總次數。' },
        { id: 'sys_avg_vacancy_rate', name: '全院缺額率', category: '系統管理者', desc: '計算全院平均的班表缺額百分比。' },
        { id: 'sys_avg_adjustment_rate', name: '主管調整率', category: '系統管理者', desc: '統計全院班表生成後，人工手動調整的比例。' },
        { id: 'sys_avg_exchange_rate', name: '同仁換班率', category: '系統管理者', desc: '統計全院已核准的同仁換班頻率。' },
        { id: 'sys_score_min', name: '班表評分(最低)', category: '系統管理者', desc: '找出全院所有班表中的最低評分值。' },
        { id: 'sys_score_max', name: '班表評分(最高)', category: '系統管理者', desc: '找出全院所有班表中的最高評分值。' },
        { id: 'sys_score_avg', name: '班表評分(平均)', category: '系統管理者', desc: '計算全院所有班表的平均評分值。' }
    ],

    init: async function() {
        console.log("Dashboard Item Manager Init");
        this.renderDataSourceOptions();
        await this.fetchItems();
    },

    renderDataSourceOptions: function() {
        const select = document.getElementById('inputDataSource');
        if(!select) return;
        
        let html = '<option value="">請選擇數據源</option>';
        let currentCategory = '';
        
        this.dataSources.forEach(ds => {
            if(ds.category !== currentCategory) {
                if(currentCategory !== '') html += '</optgroup>';
                html += `<optgroup label="${ds.category}">`;
                currentCategory = ds.category;
            }
            html += `<option value="${ds.id}">${ds.name}</option>`;
        });
        html += '</optgroup>';
        select.innerHTML = html;
        
        select.onchange = () => {
            const ds = this.dataSources.find(d => d.id === select.value);
            const descEl = document.getElementById('dataSourceDesc');
            if(descEl) {
                descEl.textContent = ds ? ds.desc : '請選擇數據源以查看說明';
                descEl.style.color = ds ? '#2980b9' : '#999';
            }
        };
    },

    fetchItems: async function() {
        const tbody = document.getElementById('dashboardItemTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';
        
        try {
            const snapshot = await db.collection('system_dashboard_items').orderBy('order').get();
            this.allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch (e) {
            console.error("Fetch Items Error:", e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    renderTable: function() {
        const tbody = document.getElementById('dashboardItemTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        if(this.allItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">目前無儀表板項目</td></tr>';
            return;
        }

        this.allItems.forEach(item => {
            const rolesHtml = (item.allowedRoles || []).map(r => {
                const role = this.allRoles.find(ar => ar.id === r);
                return `<span class="badge badge-info" style="margin-right:4px;">${role ? role.name : r}</span>`;
            }).join('');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.order || 0}</td>
                <td><i class="${item.icon || 'fas fa-cube'}"></i> ${item.label}</td>
                <td><code>${item.dataSource}</code></td>
                <td>${rolesHtml}</td>
                <td><span class="badge ${item.isActive ? 'badge-success' : 'badge-danger'}">${item.isActive ? '啟用' : '停用'}</span></td>
                <td>
                    <button class="btn btn-sm btn-edit" onclick="dashboardItemManager.openModal('${item.id}')">編輯</button>
                    <button class="btn btn-sm btn-delete" onclick="dashboardItemManager.deleteItem('${item.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    openModal: function(id = null) {
        const modal = document.getElementById('dashboardItemModal');
        if(!modal) return;
        
        document.getElementById('modalTitle').textContent = id ? '編輯儀表板項目' : '新增儀表板項目';
        document.getElementById('itemId').value = id || '';
        
        // 重置表單
        document.getElementById('inputLabel').value = '';
        document.getElementById('inputIcon').value = 'fas fa-cube';
        document.getElementById('inputPath').value = '';
        document.getElementById('inputColor').value = '#3498db';
        document.getElementById('inputOrder').value = (this.allItems.length + 1) * 10;
        document.getElementById('inputDataSource').value = '';
        document.getElementById('dataSourceDesc').textContent = '請選擇數據源以查看說明';
        document.getElementById('inputIsActive').checked = true;
        
        // 渲染角色勾選
        const roleContainer = document.getElementById('roleCheckboxContainer');
        roleContainer.innerHTML = this.allRoles.map(role => `
            <label style="display:inline-block; margin-right:15px; cursor:pointer;">
                <input type="checkbox" name="roles" value="${role.id}"> ${role.name}
            </label>
        `).join('');

        if(id) {
            const item = this.allItems.find(i => i.id === id);
            if(item) {
                document.getElementById('inputLabel').value = item.label || '';
                document.getElementById('inputIcon').value = item.icon || 'fas fa-cube';
                document.getElementById('inputPath').value = item.path || '';
                document.getElementById('inputColor').value = item.color || '#3498db';
                document.getElementById('inputOrder').value = item.order || 0;
                document.getElementById('inputDataSource').value = item.dataSource || '';
                document.getElementById('inputIsActive').checked = item.isActive !== false;
                
                const ds = this.dataSources.find(d => d.id === item.dataSource);
                if(ds) document.getElementById('dataSourceDesc').textContent = ds.desc;

                const checkboxes = roleContainer.querySelectorAll('input[name="roles"]');
                checkboxes.forEach(cb => {
                    if((item.allowedRoles || []).includes(cb.value)) cb.checked = true;
                });
            }
        }
        
        modal.classList.add('show');
    },

    closeModal: function() {
        document.getElementById('dashboardItemModal').classList.remove('show');
    },

    saveItem: async function() {
        const id = document.getElementById('itemId').value;
        const label = document.getElementById('inputLabel').value.trim();
        const dataSource = document.getElementById('inputDataSource').value;
        
        if(!label || !dataSource) {
            alert("請填寫名稱並選擇數據源");
            return;
        }

        const roles = Array.from(document.querySelectorAll('input[name="roles"]:checked')).map(cb => cb.value);
        
        const data = {
            label: label,
            icon: document.getElementById('inputIcon').value.trim(),
            path: document.getElementById('inputPath').value.trim(),
            color: document.getElementById('inputColor').value,
            order: parseInt(document.getElementById('inputOrder').value) || 0,
            dataSource: dataSource,
            allowedRoles: roles,
            isActive: document.getElementById('inputIsActive').checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(id) {
                await db.collection('system_dashboard_items').doc(id).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('system_dashboard_items').add(data);
            }
            this.closeModal();
            await this.fetchItems();
        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    deleteItem: async function(id) {
        if(!confirm("確定要刪除此項目嗎？")) return;
        try {
            await db.collection('system_dashboard_items').doc(id).delete();
            await this.fetchItems();
        } catch (e) {
            console.error("Delete Error:", e);
            alert("刪除失敗: " + e.message);
        }
    }
};
