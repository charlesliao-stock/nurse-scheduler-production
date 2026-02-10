// js/modules/staff_schedule_manager.js
// 修正版：解決模擬身分查詢班表時的 UID 比對問題 + 黃底預休顯示

const staffScheduleManager = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    scheduleData: null,
    currentUid: null,
    viewMode: 'personal',
    
    selectedCell: null,
    selectedDay: null,
    selectedShift: null,

    init: async function() {
        this.currentUid = app.getUid();
        
        if (!this.currentUid) {
            this.showError('無法取得使用者資訊');
            return;
        }

        console.log(`📋 初始化個人班表查詢 - UID: ${this.currentUid}`);
        console.log(`📍 使用單位: ${app.getUnitId()}`);
        console.log(`👤 使用角色: ${app.impersonatedRole || app.userRole}`);
        
        this.setupMonthPicker();
        await this.loadData();
    },

    setupMonthPicker: function() {
        const input = document.getElementById('scheduleMonth');
        if (!input) {
            console.warn('⚠️ 找不到 scheduleMonth 元素');
            return;
        }

        input.value = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
        
        input.addEventListener('change', (e) => {
            const [year, month] = e.target.value.split('-');
            this.currentYear = parseInt(year);
            this.currentMonth = parseInt(month);
        });
    },

    loadData: async function() {
        const input = document.getElementById('scheduleMonth');
        if (input && input.value) {
            const [year, month] = input.value.split('-');
            this.currentYear = parseInt(year);
            this.currentMonth = parseInt(month);
        }
        
        await this.loadSchedule();
    },

    loadSchedule: async function() {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (!wrapper) {
            console.error('❌ 找不到 horizontalScheduleWrapper');
            return;
        }

        wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><p>載入中...</p>';
        }

        try {
            console.log(`🔍 查詢 ${this.currentYear}/${this.currentMonth} 的班表`);
            
            const unitId = app.getUnitId();
            if (!unitId) {
                this.showError('無法取得單位資訊');
                return;
            }

            console.log(`   單位: ${unitId}, UID: ${this.currentUid}`);

            const snapshot = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .where('year', '==', this.currentYear)
                .where('month', '==', this.currentMonth)
                .where('status', '==', 'published')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('❌ 查無已發布班表');
                this.showNoSchedule();
                return;
            }

            const doc = snapshot.docs[0];
            this.scheduleData = { id: doc.id, ...doc.data() };
            
            console.log(`✅ 找到班表: ${doc.id}`);
            console.log(`📋 班表人員: ${this.scheduleData.staffList?.length || 0} 位`);

            if (this.scheduleData.assignments) {
                const allUids = Object.keys(this.scheduleData.assignments);
                console.log(`📝 班表中的所有 UID (${allUids.length} 位):`, allUids);
                console.log(`🔍 正在查找的 UID: "${this.currentUid}"`);
                console.log(`✅ UID 存在於 assignments?: ${allUids.includes(this.currentUid)}`);
                
                const trimmedCurrentUid = this.currentUid.trim();
                const similarUids = allUids.filter(uid => 
                    uid.trim().toLowerCase() === trimmedCurrentUid.toLowerCase()
                );
                if (similarUids.length > 0 && !allUids.includes(this.currentUid)) {
                    console.warn(`⚠️ 發現格式相似但不完全相同的 UID:`, similarUids);
                    console.warn(`   可能是空格或大小寫問題`);
                }
            }

            if (!this.scheduleData.assignments || !this.scheduleData.assignments[this.currentUid]) {
                console.warn(`⚠️ UID ${this.currentUid} 不在班表中`);
                
                const trimmedUid = this.currentUid.trim();
                let foundAssignment = null;
                
                if (this.scheduleData.assignments) {
                    for (let uid in this.scheduleData.assignments) {
                        if (uid.trim() === trimmedUid) {
                            console.log(`🔧 找到 trim 後符合的 UID: "${uid}"`);
                            foundAssignment = this.scheduleData.assignments[uid];
                            this.currentUid = uid;
                            break;
                        }
                    }
                }
                
                if (!foundAssignment) {
                    this.showError('您不在本月班表中');
                    return;
                }
            }

            console.log(`✅ 找到 UID ${this.currentUid} 的班表資料`);
            
            wrapper.style.display = 'block';
            if (noDataMsg) noDataMsg.style.display = 'none';
            
            if (this.viewMode === 'unit') {
                this.renderUnitSchedule();
            } else {
                this.renderPersonalSchedule();
            }
            
            this.updateStatistics();

        } catch (error) {
            console.error('❌ 載入班表失敗:', error);
            this.showError('載入失敗: ' + error.message);
        }
    },

    renderPersonalSchedule: function() {
        const myView = document.getElementById('myScheduleView');
        const unitView = document.getElementById('unitScheduleView');
        
        if (myView) myView.style.display = 'block';
        if (unitView) unitView.style.display = 'none';

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        
        console.log(`📅 渲染個人班表 - ${daysInMonth} 天`);

        myView.innerHTML = '';
        
        const table = document.createElement('table');
        table.className = 'table table-bordered text-center';
        table.style.margin = '0';
        table.style.fontSize = '0.9rem';
        
        const thead = document.createElement('thead');
        thead.style.background = '#f8f9fa';
        
        const rowWeekday = document.createElement('tr');
        rowWeekday.innerHTML = '<th style="width:80px; background:#fff; position:sticky; left:0; z-index:10;">星期</th>';
        
        const rowDate = document.createElement('tr');
        rowDate.innerHTML = '<th style="width:80px; background:#fff; position:sticky; left:0; z-index:10;">日期</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            const bgColor = isWeekend ? '#ffebee' : '#fff';
            const textColor = isWeekend ? '#d32f2f' : '#333';

            rowWeekday.innerHTML += `<th style="background:${bgColor}; color:${textColor}; min-width:60px; padding:8px;">${weekdayName}</th>`;
            rowDate.innerHTML += `<th style="background:${bgColor}; color:${textColor}; min-width:60px; padding:8px;">${d}</th>`;
        }
        
        thead.appendChild(rowWeekday);
        thead.appendChild(rowDate);
        
        const tbody = document.createElement('tbody');
        const rowShift = document.createElement('tr');
        rowShift.innerHTML = '<th style="width:80px; background:#eef2f3; vertical-align:middle; position:sticky; left:0; z-index:10; font-weight:bold;">我的班別</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            const isReqOff = shift === 'REQ_OFF';
            const isOff = shift === 'OFF';
            
            let cellBg, cellColor, displayText;
            
            if (isReqOff) {
                cellBg = '#fff3cd';
                cellColor = '#856404';
                displayText = 'FF';
            } else if (isOff) {
                cellBg = '#e8f5e9';
                cellColor = '#2e7d32';
                displayText = 'FF';
            } else {
                cellBg = '#e3f2fd';
                cellColor = '#1565c0';
                displayText = shift;
            }
            
            rowShift.innerHTML += `<td style="background:${cellBg}; color:${cellColor}; font-weight:bold; padding:10px; min-width:60px;">${displayText}</td>`;
        }
        
        tbody.appendChild(rowShift);
        
        table.appendChild(thead);
        table.appendChild(tbody);
        myView.appendChild(table);
    },

    renderUnitSchedule: function() {
        const myView = document.getElementById('myScheduleView');
        const unitView = document.getElementById('unitScheduleView');
        const unitHead = document.getElementById('unitHead');
        const unitBody = document.getElementById('unitBody');
        
        if (myView) myView.style.display = 'none';
        if (unitView) unitView.style.display = 'block';
        if (!unitHead || !unitBody) return;

        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        const staffList = this.scheduleData.staffList || [];
        
        console.log(`📋 渲染全單位班表 - ${staffList.length} 位人員`);

        let headHtml = '<tr><th style="position:sticky; left:0; z-index:20; background:#f8f9fa; min-width:100px;">姓名</th>';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
            
            const bgColor = isWeekend ? '#ffebee' : '#fff';
            const textColor = isWeekend ? '#d32f2f' : '#333';
            
            headHtml += `<th style="background:${bgColor}; color:${textColor}; min-width:50px; font-size:0.85rem;">
                ${d}<br><small>${weekdayName}</small>
            </th>`;
        }
        headHtml += '</tr>';
        unitHead.innerHTML = headHtml;

        let bodyHtml = '';
        staffList.forEach(staff => {
            const assignments = this.scheduleData.assignments[staff.uid] || {};
            const isCurrent = staff.uid === this.currentUid;
            
            bodyHtml += `<tr ${isCurrent ? 'style="background:#fff9c4;"' : ''}>`;
            bodyHtml += `<td style="position:sticky; left:0; z-index:10; background:${isCurrent ? '#fff9c4' : '#f5f5f5'}; font-weight:${isCurrent ? 'bold' : 'normal'};">
                ${staff.name || staff.displayName || '未命名'}
                ${isCurrent ? ' ⭐' : ''}
            </td>`;
            
            for (let d = 1; d <= daysInMonth; d++) {
                const shift = assignments[`current_${d}`] || 'OFF';
                const isReqOff = shift === 'REQ_OFF';
                const isOff = shift === 'OFF';
                
                let cellBg, cellColor, displayText;
                
                if (isReqOff) {
                    cellBg = '#fff3cd';
                    cellColor = '#856404';
                    displayText = 'FF';
                } else if (isOff) {
                    cellBg = '#e8f5e9';
                    cellColor = '#2e7d32';
                    displayText = 'FF';
                } else {
                    cellBg = '#e3f2fd';
                    cellColor = '#1565c0';
                    displayText = shift;
                }
                
                bodyHtml += `<td class="shift-cell" 
                    data-uid="${staff.uid}" 
                    data-day="${d}" 
                    data-shift="${shift}"
                    data-name="${staff.name || staff.displayName}"
                    style="background:${cellBg}; color:${cellColor}; cursor:pointer; padding:8px; font-size:0.9rem;"
                    onclick="staffScheduleManager.handleCellClick(this, event)">${displayText}</td>`;
            }
            
            bodyHtml += '</tr>';
        });
        
        unitBody.innerHTML = bodyHtml;
    },

    handleCellClick: function(cell, event) {
        if (event) event.stopPropagation();
        
        const uid = cell.dataset.uid;
        const day = parseInt(cell.dataset.day);
        const shift = cell.dataset.shift;
        const name = cell.dataset.name;
        
        if (shift === 'OFF' || shift === 'REQ_OFF') {
            alert('休假日無法換班');
            return;
        }
        
        if (uid !== this.currentUid) {
            alert('請點擊自己的班別以發起換班申請');
            return;
        }
        
        this.openExchangeModal(day, shift);
    },

openExchangeModal: function(day, myShift) {
    this.selectedDay = day;
    this.selectedShift = myShift;
    
    const modal = document.getElementById('exchangeModal');
    const info = document.getElementById('exchangeInfo');
    const select = document.getElementById('exchangeTargetSelect');
    
    if (!modal || !info || !select) {
        console.error('找不到 Modal 元素');
        return;
    }

    info.innerHTML = `
        <strong>您的班別：</strong> ${this.currentYear}/${this.currentMonth}/${day} - ${myShift} 班
    `;
    
    select.innerHTML = '<option value="">請選擇交換對象</option>';
    
    const staffList = this.scheduleData.staffList || [];
    staffList.forEach(staff => {
        if (staff.uid === this.currentUid) return;
        
        const assignments = this.scheduleData.assignments[staff.uid] || {};
        const theirShift = assignments[`current_${day}`] || 'OFF';
        
        if (theirShift !== 'OFF' && theirShift !== 'REQ_OFF' && theirShift !== myShift) {
            const name = staff.name || staff.displayName || '未命名';
            select.innerHTML += `<option value="${staff.uid}" data-shift="${theirShift}">${name} (${theirShift} 班)</option>`;
        }
    });
    
    if (select.options.length === 1) {
        select.innerHTML = '<option value="">當日無可交換對象</option>';
    }
    
    // ✅ 清空原因選擇
    document.querySelectorAll('input[name="reason"]').forEach(r => r.checked = false);
    document.getElementById('otherReasonBox').style.display = 'none';
    document.getElementById('otherReasonText').value = '';
    
    const validResult = document.getElementById('validationResult');
    if (validResult) validResult.style.display = 'none';
    
    modal.classList.add('show');
},

    closeExchangeModal: function() {
        const modal = document.getElementById('exchangeModal');
        if (modal) modal.classList.remove('show');
    },

submitExchange: async function() {
    const select = document.getElementById('exchangeTargetSelect');
    const targetUid = select.value;
    
    if (!targetUid) {
        alert('請選擇交換對象');
        return;
    }
    
    const targetOption = select.options[select.selectedIndex];
    const targetShift = targetOption.dataset.shift;
    const targetName = targetOption.text.split(' (')[0];
    
    const reasonRadio = document.querySelector('input[name="reason"]:checked');
    if (!reasonRadio) {
        alert('請選擇換班原因');
        return;
    }
    
    let reason = '';
    const reasonMap = {
        'unit_adjustment': '單位人力調整',
        'official_leave': '公假',
        'sick_leave': '病假',
        'bereavement_leave': '喪假',
        'support': '支援',
        'personal': '個人因素',
        'other': '其他'
    };
    
    reason = reasonMap[reasonRadio.value];
    
    // ✅ "其他" 必填說明，其餘選填
    const otherReasonText = document.getElementById('otherReasonText').value.trim();
    
    if (reasonRadio.value === 'other') {
        // "其他" 必填
        if (!otherReasonText) {
            alert('請填寫具體原因');
            return;
        }
        reason += ': ' + otherReasonText;
    } else if (otherReasonText) {
        // 其他選項的說明為選填
        reason += ' (' + otherReasonText + ')';
    }
    
    const myData = await db.collection('users').doc(this.currentUid).get();
    const myName = myData.data().displayName || myData.data().name || '未命名';
    
    const confirmMsg = `確定要申請換班嗎？\n\n您 (${myName}) 的 ${this.selectedShift} 班 ⇄ ${targetName} 的 ${targetShift} 班\n日期: ${this.currentYear}/${this.currentMonth}/${this.selectedDay}\n原因: ${reason}`;
    
    if (!confirm(confirmMsg)) return;
    
    const targetRequesterId = this.currentUid || app.getUid();
    
    const dateStr = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}-${String(this.selectedDay).padStart(2, '0')}`;

    try {
        console.log('--- 換班申請提交流程開始 ---');
        
        const currentUser = firebase.auth().currentUser;
        const isImpersonating = app.impersonatedUid && app.impersonatedUid === targetRequesterId;

        console.log('1. [身分與 Auth 狀態檢查]');
        console.log('   - 實際登入 (Auth UID):', currentUser ? currentUser.uid : '未登入');
        console.log('   - 模擬狀態:', isImpersonating ? '✅ 模擬中' : '❌ 非模擬');
        console.log('   - 最終寫入 (Requester UID):', targetRequesterId);
        
        if (currentUser) {
            try {
                const userDoc = await db.collection('users').doc(currentUser.uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    console.log(`   - 登入者角色 (DB Role): ${userData.role}`);
                    console.log(`   - 是否符合 isSystemAdminAdvanced 條件: ${currentUser.uid === '4h62TGbHD4WP73IFoDbtqf6JHDi2' || userData.role === 'system_admin'}`);
                } else {
                    console.log('   - ⚠️ 找不到登入者的 User Document，這會導致 isSystemAdminAdvanced() 失敗');
                }
            } catch (e) {
                console.warn('   - ⚠️ 無法讀取 User Document 進行診斷:', e.message);
            }
        }
        
        const reqData = {
            scheduleId: this.scheduleData.id || null,
            unitId: this.scheduleData.unitId || null, 
            year: this.currentYear,
            month: this.currentMonth,
            date: dateStr,
            
            requesterUid: targetRequesterId, 
            requesterName: myName || 'Unknown',
            requesterShift: this.selectedShift || '',
            
            targetUid: targetUid,
            targetName: targetName || 'Unknown',
            targetShift: targetShift || '',
            
            status: 'pending_target',
            reasonCategory: reasonRadio.value,
            reason: reason || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        console.log('2. [待提交數據檢查]');
        console.log('   - 數據內容:', JSON.stringify(reqData, null, 2));
        
        if (!reqData.unitId) console.warn('   - ⚠️ 警告：unitId 為空，這可能導致 isMyUnit() 相關規則失敗');
        if (!reqData.scheduleId) console.warn('   - ⚠️ 警告：scheduleId 為空');
        
        console.log('3. [執行 Firestore 寫入] 集合: shift_requests');
        const docRef = await db.collection('shift_requests').add(reqData);
        console.log('   - 寫入成功, 文件 ID:', docRef.id);
        
        alert('✅ 換班申請已送出！\n請等待對方同意及護理長核准。');
        this.closeExchangeModal();
        
    } catch (error) {
        console.error('--- 換班申請提交出錯 ---');
        console.error('錯誤類型:', error.name);
        console.error('錯誤訊息:', error.message);
        if (error.code) console.error('錯誤代碼:', error.code);
        console.error('完整錯誤對象:', error);
        
        if (error.message.includes('permission') || error.code === 'permission-denied') {
            const authUid = (firebase.auth().currentUser) ? firebase.auth().currentUser.uid : '未登入';
            const reqUid = targetRequesterId || '未知';
            
            console.warn('💡 診斷建議: 發生 Firebase 權限錯誤 (Permission Denied)。');
            console.warn(`👉 當前狀態：\n   - 實際登入者 (Auth UID): ${authUid}\n   - 試圖代表寫入者 (Requester UID): ${reqUid}`);
            
            if (authUid !== reqUid) {
                console.warn('❌ 錯誤原因：目前處於「模擬模式」，但您的 Security Rules 第 159 行限制了 `requesterId == request.auth.uid`。');
                console.warn('✅ 修復建議：請將 Rules 第 158-159 行修改為允許管理員建立申請，例如：\n' +
                             '   allow create: if isSignedIn() && (request.resource.data.requesterId == request.auth.uid || isSystemAdminAdvanced());');
            } else {
                console.warn('👉 目前非模擬模式，請檢查資料欄位是否完整（例如 unitId, scheduleId 是否為 null）或符合 Rules 其他限制。');
            }
        }
        
        alert('提交失敗: ' + error.message);
    }
},

    updateStatistics: function() {
        const assignments = this.scheduleData.assignments[this.currentUid] || {};
        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();
        
        let totalShifts = 0, totalOff = 0, holidayOff = 0;
        let countD = 0, countE = 0, countN = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const shift = assignments[`current_${d}`] || 'OFF';
            const date = new Date(this.currentYear, this.currentMonth - 1, d);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                totalOff++;
                if (isWeekend) holidayOff++;
            } else {
                totalShifts++;
                if (shift === 'D') countD++;
                else if (shift === 'E') countE++;
                else if (shift === 'N') countN++;
            }
        }
        
        document.getElementById('statTotalShifts').textContent = totalShifts;
        document.getElementById('statTotalOff').textContent = totalOff;
        document.getElementById('statHolidayOff').textContent = holidayOff;
        document.getElementById('statDay').textContent = countD;
        document.getElementById('statEvening').textContent = countE;
        document.getElementById('statNight').textContent = countN;
    },

    toggleViewMode: function() {
        const checkbox = document.getElementById('checkShowAllStaff');
        if (!checkbox) return;
        
        const isChecked = checkbox.checked;
        
        console.log(`🔄 切換檢視模式: ${isChecked ? '全單位' : '個人'}`);
        
        this.viewMode = isChecked ? 'unit' : 'personal';
        
        if (this.scheduleData) {
            if (this.viewMode === 'unit') {
                this.renderUnitSchedule();
            } else {
                this.renderPersonalSchedule();
            }
        }
    },

    showNoSchedule: function() {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (wrapper) wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = `
                <i class="fas fa-calendar-times" style="font-size:4rem; color:#bbb; margin-bottom:15px;"></i>
                <h3 style="color:#666;">本月尚無已發布班表</h3>
                <p>請聯繫排班人員或護理長</p>
            `;
        }
    },

    showError: function(message) {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noDataMsg = document.getElementById('noDataMessage');
        
        if (wrapper) wrapper.style.display = 'none';
        if (noDataMsg) {
            noDataMsg.style.display = 'block';
            noDataMsg.innerHTML = `
                <i class="fas fa-exclamation-triangle" style="font-size:4rem; color:#f44336; margin-bottom:15px;"></i>
                <h3 style="color:#666;">${message}</h3>
            `;
        }
    }
};
toggleOtherReason: function() {
    const reasonRadio = document.querySelector('input[name="reason"]:checked');
    const otherReasonText = document.getElementById('otherReasonText');
    const requiredMark = document.getElementById('otherReasonRequired');
    
    if (reasonRadio && reasonRadio.value === 'other') {
        // 選擇「其他」時，說明欄必填
        if (otherReasonText) {
            otherReasonText.placeholder = '必填：請說明具體原因';
            otherReasonText.style.borderColor = '#e74c3c';
        }
        if (requiredMark) requiredMark.style.display = 'inline';
    } else {
        // 其他選項，說明欄選填
        if (otherReasonText) {
            otherReasonText.placeholder = '選填：補充說明';
            otherReasonText.style.borderColor = '#ddd';
        }
        if (requiredMark) requiredMark.style.display = 'none';
    }
},
