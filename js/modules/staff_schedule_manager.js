// js/modules/staff_schedule_manager.js
// 🎯 修正版：統計橫向顯示、同仁端預休黃底、換班預休提示

const staffScheduleManager = {
    uid: null,
    shifts: [],
    scheduleData: null,
    
    init: function() {
        if (!app.currentUser) return;
        this.uid = app.currentUser.uid;
        
        // 預設當前月份
        const today = new Date();
        const monthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
        document.getElementById('scheduleMonth').value = monthStr;
        
        // 載入班別定義
        this.loadShifts().then(() => {
            this.loadData();
        });
    },

    loadShifts: async function() {
        const unitId = app.currentUser.unitId;
        if(!unitId) return;
        const snap = await db.collection('shifts').where('unitId','==',unitId).get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadData: async function() {
        const dateVal = document.getElementById('scheduleMonth').value;
        if (!dateVal) return;
        const [year, month] = dateVal.split('-').map(Number);
        const unitId = app.currentUser.unitId;

        document.getElementById('noDataMessage').style.display = 'none';
        document.getElementById('personalStatsContainer').style.display = 'none'; // 先隱藏
        document.getElementById('horizontalScheduleWrapper').style.display = 'none';

        try {
            // 查詢已發布班表
            const snap = await db.collection('schedules')
                .where('unitId', '==', unitId)
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .limit(1)
                .get();

            if (snap.empty) {
                document.getElementById('noDataMessage').style.display = 'block';
                document.getElementById('noDataMessage').innerText = '尚未發布此月份班表';
                return;
            }

            this.scheduleData = snap.docs[0].data();
            
            // 顯示區塊
            document.getElementById('personalStatsContainer').style.display = 'grid'; 
            document.getElementById('horizontalScheduleWrapper').style.display = 'block';

            this.renderPersonalStats(year, month);
            this.renderPersonalSchedule(year, month);
            
            // 若勾選顯示全單位，則渲染大表
            if (document.getElementById('checkShowAllStaff').checked) {
                this.renderUnitSchedule(year, month);
            }

        } catch (e) {
            console.error(e);
            alert("載入失敗");
        }
    },

    // 渲染個人統計 (橫向卡片)
    renderPersonalStats: function(year, month) {
        const assign = this.scheduleData.assignments?.[this.uid] || {};
        const days = new Date(year, month, 0).getDate();
        
        let totalShifts = 0;
        let totalOff = 0;
        let holidayOff = 0;
        let dayCount = 0;
        let eveningCount = 0;
        let nightCount = 0;

        for (let d = 1; d <= days; d++) {
            const val = assign[`current_${d}`];
            if (!val) continue;

            if (val === 'OFF' || val === 'REQ_OFF') {
                totalOff++;
                const w = new Date(year, month-1, d).getDay();
                if (w === 0 || w === 6) holidayOff++;
            } else {
                totalShifts++;
                if (val === 'D') dayCount++;
                else if (val === 'E') eveningCount++;
                else if (val === 'N') nightCount++;
            }
        }

        // 更新 HTML 數值
        document.getElementById('statTotalShifts').innerText = totalShifts;
        document.getElementById('statTotalOff').innerText = totalOff;
        document.getElementById('statHolidayOff').innerText = holidayOff;
        document.getElementById('statDay').innerText = dayCount;
        document.getElementById('statEvening').innerText = eveningCount;
        document.getElementById('statNight').innerText = nightCount;
    },

    // 渲染個人橫向班表
    renderPersonalSchedule: function(year, month) {
        const assign = this.scheduleData.assignments?.[this.uid] || {};
        const days = new Date(year, month, 0).getDate();
        const weeks = ['日','一','二','三','四','五','六'];

        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');

        // 清空並重建
        rowWeekday.innerHTML = '<th style="width:100px; background:#fff; border:1px solid #ddd;">星期</th>';
        rowDate.innerHTML = '<th style="width:100px; background:#fff; border:1px solid #ddd;">日期</th>';
        rowShift.innerHTML = '<th style="width:100px; background:#eef2f3; vertical-align:middle; border:1px solid #ddd;">我的班別</th>';

        for (let d = 1; d <= days; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const val = assign[`current_${d}`] || '';
            const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

            // 星期樣式
            const colorStyle = (w === 0 || w === 6) ? 'color:red;' : '';
            
            rowWeekday.insertAdjacentHTML('beforeend', 
                `<td style="${colorStyle} background:#f9f9f9; border:1px solid #ddd;">${weeks[w]}</td>`);
            
            rowDate.insertAdjacentHTML('beforeend', 
                `<td style="${colorStyle} background:#fff; border:1px solid #ddd;">${d}</td>`);

            // 班別樣式
            let cellContent = val;
            let cellStyle = 'background:#fff;';
            let clickAction = '';

            // 🟡 [視覺] 預休顯示黃底
            if (val === 'REQ_OFF') {
                cellContent = '預休';
                cellStyle = 'background:#fff3cd; color:#856404; font-weight:bold;';
            } else if (val === 'OFF') {
                cellContent = 'OFF';
                cellStyle = 'background:#fff;';
            } else {
                // 找班別顏色
                const s = this.shifts.find(x => x.code === val);
                if (s && s.color) cellStyle = `color:${s.color}; font-weight:bold;`;
                
                // 只有非 OFF 且非過期日期可換班
                if (date >= new Date().setHours(0,0,0,0)) {
                    cellStyle += 'cursor:pointer; background:#f0f8ff;';
                    clickAction = `onclick="staffScheduleManager.openExchangeModal('${dateStr}', '${val}')"`;
                }
            }

            rowShift.insertAdjacentHTML('beforeend', 
                `<td style="${cellStyle} border:1px solid #ddd; padding:10px;" ${clickAction}>${cellContent}</td>`);
        }
    },

    // 渲染全單位大表
    renderUnitSchedule: function(year, month) {
        document.getElementById('unitScheduleView').style.display = 'block';
        const thead = document.getElementById('unitHead');
        const tbody = document.getElementById('unitBody');
        const days = new Date(year, month, 0).getDate();

        // 表頭
        let h = `<tr><th style="position:sticky; left:0; z-index:20; border:1px solid #bbb;">姓名</th>`;
        for (let d = 1; d <= days; d++) {
            const w = new Date(year, month-1, d).getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h += `<th style="${color} border:1px solid #bbb;">${d}</th>`;
        }
        h += `</tr>`;
        thead.innerHTML = h;

        // 表身
        let b = '';
        this.scheduleData.staffList.forEach(staff => {
            const uid = staff.uid;
            const assign = this.scheduleData.assignments?.[uid] || {};
            const isMe = (uid === this.uid);
            const rowStyle = isMe ? 'background:#e8f4fd;' : '';

            b += `<tr style="${rowStyle}">
                <td style="position:sticky; left:0; background:${isMe?'#e8f4fd':'#fff'}; z-index:10; font-weight:bold; border:1px solid #bbb;">${staff.name}</td>`;
            
            for (let d = 1; d <= days; d++) {
                const val = assign[`current_${d}`] || '';
                let display = val;
                let style = 'border:1px solid #bbb;';

                // 🟡 [視覺] 預休顯示黃底
                if (val === 'REQ_OFF') {
                    display = 'FF';
                    style += 'background:#fff3cd; color:#856404;';
                } else if (val === 'OFF') {
                    display = 'FF';
                } else {
                    const s = this.shifts.find(x => x.code === val);
                    if (s && s.color) style += `color:${s.color}; font-weight:bold;`;
                }
                
                b += `<td style="${style}">${display}</td>`;
            }
            b += `</tr>`;
        });
        tbody.innerHTML = b;
    },

    toggleViewMode: function() {
        const showAll = document.getElementById('checkShowAllStaff').checked;
        const unitView = document.getElementById('unitScheduleView');
        
        if (showAll) {
            // 如果資料還沒渲染，重新載入
            if (unitView.innerHTML.trim() === '' || unitView.style.display === 'none') {
                 const dateVal = document.getElementById('scheduleMonth').value;
                 if (dateVal) {
                     const [y, m] = dateVal.split('-').map(Number);
                     this.renderUnitSchedule(y, m);
                 }
            }
            unitView.style.display = 'block';
        } else {
            unitView.style.display = 'none';
        }
    },

    // --- 換班邏輯 ---

    openExchangeModal: function(dateStr, myShift) {
        document.getElementById('exchangeModal').style.display = 'flex';
        document.getElementById('exchangeInfo').innerHTML = `
            <strong>申請日期：</strong> ${dateStr} <br>
            <strong>我的班別：</strong> ${myShift}
        `;
        // 儲存當前操作狀態
        this.currentExchange = { date: dateStr, myShift: myShift };
        
        this.loadExchangeTargets(dateStr, myShift);
    },

    loadExchangeTargets: function(dateStr, myShift) {
        const select = document.getElementById('exchangeTargetSelect');
        select.innerHTML = '<option value="">載入中...</option>';
        
        const [y, m, d] = dateStr.split('-').map(Number);
        const targets = [];

        this.scheduleData.staffList.forEach(staff => {
            if (staff.uid === this.uid) return; // 排除自己
            
            const assign = this.scheduleData.assignments?.[staff.uid] || {};
            const theirShift = assign[`current_${d}`];

            if (theirShift && theirShift !== myShift) {
                // 🟡 檢查對方是否為預休 REQ_OFF
                const isReqOff = (theirShift === 'REQ_OFF');
                
                // 顯示邏輯：如果是預休，顯示 (預休)
                const shiftDisplay = (theirShift === 'OFF' || theirShift === 'REQ_OFF') ? 'OFF' : theirShift;
                const note = isReqOff ? ' (預休)' : '';
                
                targets.push({
                    uid: staff.uid,
                    name: staff.name,
                    shift: shiftDisplay,
                    isReqOff: isReqOff // 標記用
                });
            }
        });

        // 渲染選項
        if (targets.length === 0) {
            select.innerHTML = '<option value="">無可交換對象</option>';
        } else {
            select.innerHTML = '<option value="">請選擇對象...</option>' + 
                targets.map(t => {
                    const style = t.isReqOff ? 'color:#d35400; font-weight:bold;' : ''; // 預休顯示橘色警告
                    return `<option value="${t.uid}" style="${style}">
                                ${t.name} (班別: ${t.shift}${t.isReqOff ? ' - 預休' : ''})
                            </option>`;
                }).join('');
        }
    },

    closeExchangeModal: function() {
        document.getElementById('exchangeModal').style.display = 'none';
        document.getElementById('otherReasonBox').style.display = 'none';
        document.getElementById('validationResult').style.display = 'none';
    },

    submitExchange: async function() {
        const targetUid = document.getElementById('exchangeTargetSelect').value;
        const reasons = document.getElementsByName('reason');
        let selectedReason = '';
        for (const r of reasons) { if (r.checked) selectedReason = r.value; }
        
        if (selectedReason === 'other') {
            selectedReason = document.getElementById('otherReasonBox').value;
        }

        if (!targetUid || !selectedReason) {
            alert("請完整填寫對象與原因");
            return;
        }

        // 送出申請邏輯 (此處僅示範，需配合後端)
        try {
            await db.collection('shift_exchanges').add({
                requesterId: this.uid,
                targetId: targetUid,
                date: this.currentExchange.date,
                originalShift: this.currentExchange.myShift,
                status: 'pending',
                reason: selectedReason,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("申請已送出！");
            this.closeExchangeModal();
        } catch(e) {
            alert("申請失敗：" + e.message);
        }
    }
};
