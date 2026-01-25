// js/modules/staff_schedule_manager.js
// 🚀 最終嚴格版：精確身分驗證 + 拒絕隨機資料 + 完整模擬支援

const staffScheduleManager = {
    currentSchedule: null,
    currentAssignments: {},
    allShifts: [],
    uid: null, 
    isSimulating: false, 
    unitId: null,

    // --- 初始化 ---
    init: async function() {
        if (!app.currentUser) { alert("請先登入"); return; }
        
        // 1. 決定身分 (模擬優先)
        const simUid = sessionStorage.getItem('simulation_uid');
        const simName = sessionStorage.getItem('simulation_name');

        if (simUid) {
            // A. 開發者深度模擬
            this.uid = simUid.trim();
            this.isSimulating = true;
            this.showSimulationBadge(simName || simUid);
            console.warn(`🎭 [模擬模式] 使用身分: ${simName} (${this.uid})`);
        } else {
            // B. APP 層級模擬 (例如護理長切換視角)
            const appImpUid = (typeof app !== 'undefined' && app.getUid) ? app.getUid() : null;
            
            if (appImpUid && appImpUid !== app.currentUser.uid) {
                 this.uid = appImpUid.trim();
                 this.isSimulating = true;
                 this.showSimulationBadge('管理員預覽');
            } else {
                 // C. 本人登入
                 this.uid = app.currentUser.uid.trim();
                 this.isSimulating = false;
                 this.removeSimulationBadge();
            }
        }

        this.unitId = app.getUnitId();
        
        // 設定預設月份
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const monthInput = document.getElementById('scheduleMonth');
        if(monthInput && !monthInput.value) monthInput.value = monthStr;
        
        await this.loadShifts();
        await this.loadData();
    },

    // --- 載入班別設定 (用於顯示顏色/名稱) ---
    loadShifts: async function() {
        try {
            // 這裡不限定 unitId，避免跨單位支援時看不到班別顏色
            const snap = await db.collection('shifts').get();
            this.allShifts = snap.docs.map(d => d.data());
        } catch(e) { console.error("Load Shifts Error:", e); }
    },

    // --- 核心：載入班表資料 ---
    loadData: async function() {
        const ym = document.getElementById('scheduleMonth').value;
        if(!ym) return;
        const [year, month] = ym.split('-').map(Number);
        
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        const infoAlert = document.getElementById('scheduleInfoAlert');
        if(infoAlert) infoAlert.remove(); // 清除舊提示
        
        console.log(`🔍 查詢班表: ${year}/${month}, 目標 UID: '${this.uid}'`);
        
        // 先隱藏介面，避免閃爍
        if(wrapper) wrapper.style.display = 'none';
        if(noData) noData.style.display = 'block';
        if(noData) noData.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> 資料讀取中...</div>';

        try {
            // 1. 從 Firebase 撈取該月份所有已發布的班表
            const snap = await db.collection('schedules')
                .where('year', '==', year)
                .where('month', '==', month)
                .where('status', '==', 'published')
                .get();

            if (snap.empty) {
                this.renderNoDataState("本月尚未發布任何班表。");
                return;
            }

            console.log(`📂 找到 ${snap.size} 份已發布班表，正在進行身分比對...`);

            // 2. 精確匹配：找出「包含我」的那一份班表
            // 不再隨便抓第一份，而是檢查我的 UID 是否在裡面
            let targetDoc = snap.docs.find(doc => {
                const data = doc.data();
                const cleanUid = this.uid;

                // 驗證 A: 檢查 assignments 物件 (最快)
                if (data.assignments && data.assignments[cleanUid]) return true;
                
                // 驗證 B: 檢查 staffList 陣列 (備用)
                if (data.staffList && Array.isArray(data.staffList)) {
                    if (data.staffList.some(s => s.uid.trim() === cleanUid)) return true;
                }

                // 驗證 C: 檢查 schedule 矩陣 (最後手段，防止 assignments 損壞)
                if (this.checkMatrixForUid(data.schedule, cleanUid)) return true;

                return false;
            });

            // 3. 處理「找不到資料」的情況
            if (!targetDoc) {
                // 如果是管理員，給予明確提示
                if (app.userRole === 'system_admin' || app.userRole === 'unit_manager') {
                     console.warn("User is Admin/Manager but not in schedule.");
                     this.renderNoDataState(`您 (${app.userRole}) 不在本月排班名單中。<br>請使用「深度身分模擬」功能查看員工班表。`, true);
                } else {
                     // 一般員工真的沒班表
                     console.warn("User not found in any schedule.");
                     this.renderNoDataState("您不在本月的排班名單中 (或班表非您所屬單位)。");
                }
                this.resetStats();
                return;
            }

            console.log(`✅ 成功匹配班表 ID: ${targetDoc.id}`);
            
            // 4. 資料準備
            this.currentSchedule = { id: targetDoc.id, ...targetDoc.data() };
            this.currentAssignments = this.currentSchedule.assignments || {};
            
            // 取得「我」的資料
            let myData = this.currentAssignments[this.uid];

            // 防呆：如果 assignments[uid] 是空的或只有 preferences，嘗試從矩陣補救
            const hasShiftKeys = myData && Object.keys(myData).some(k => k.startsWith('current_'));
            
            if (!hasShiftKeys) {
                console.warn(`⚠️ Assignments 缺漏，嘗試從矩陣還原資料...`);
                if (this.currentSchedule.schedule) {
                    const recoveredData = this.extractShiftsFromMatrix(this.currentSchedule.schedule, this.uid);
                    // 如果矩陣裡有資料，才補回去
                    if (Object.keys(recoveredData).length > 0) {
                        this.currentAssignments[this.uid] = recoveredData;
                        myData = recoveredData;
                    }
                }
            }

            // 二次確認：如果補救後還是沒資料，顯示全空狀態 (但這是正確的，代表真的沒排班，而不是系統壞掉)
            if (!myData) {
                 this.currentAssignments[this.uid] = { preferences: {} }; // 避免報錯
            }

            // 5. 渲染畫面
            if(wrapper) wrapper.style.display = 'block';
            if(noData) noData.style.display = 'none';
            
            this.renderHorizontalTable(year, month);
            this.calculateStats(year, month);
            
        } catch(e) {
            console.error("❌ Load Data Error:", e);
            this.renderNoDataState(`讀取失敗: ${e.message}`);
        }
    },

    // --- 輔助：顯示無資料狀態 ---
    renderNoDataState: function(msg, isAdminHint = false) {
        const wrapper = document.getElementById('horizontalScheduleWrapper');
        const noData = document.getElementById('noDataMessage');
        
        if(wrapper) wrapper.style.display = 'none';
        if(noData) {
            noData.style.display = 'block';
            let html = `<div style="padding:40px; text-align:center; color:#7f8c8d;">
                <i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:15px; color:#bdc3c7;"></i>
                <h3>${msg}</h3>`;
            
            if (isAdminHint) {
                html += `
                <div style="margin-top:15px; background:#f8f9fa; padding:10px; border-radius:5px; display:inline-block; text-align:left;">
                    <strong><i class="fas fa-lightbulb"></i> 管理員提示：</strong>
                    <ul style="margin:5px 0 0 20px; padding:0; font-size:0.9rem;">
                        <li>管理員帳號通常不參與排班，因此查無資料是正常的。</li>
                        <li>若要測試員工視角，請按 F12 開啟 Console 輸入：<br>
                            <code>staffScheduleManager.startSimulation('員工UID', '姓名')</code>
                        </li>
                    </ul>
                </div>`;
            }
            html += `</div>`;
            noData.innerHTML = html;
        }
    },

    // --- 輔助：從矩陣反查 (Backup) ---
    checkMatrixForUid: function(matrix, uid) {
        if (!matrix) return false;
        return Object.values(matrix).some(dayShifts => {
            return Object.values(dayShifts).some(uids => Array.isArray(uids) && uids.some(u => u.trim() === uid));
        });
    },

    extractShiftsFromMatrix: function(matrix, targetUid) {
        if (!matrix) return {};
        const result = {};
        Object.entries(matrix).forEach(([dateStr, dayShifts]) => {
            Object.entries(dayShifts).forEach(([shiftCode, uids]) => {
                if (Array.isArray(uids) && uids.some(u => u.trim() === targetUid)) {
                    const dayPart = parseInt(dateStr.split('-')[2]);
                    if (!isNaN(dayPart)) result[`current_${dayPart}`] = shiftCode;
                }
            });
        });
        return result;
    },

    // --- 渲染：水平班表 ---
    renderHorizontalTable: function(year, month) {
        const rowWeekday = document.getElementById('row-weekday');
        const rowDate = document.getElementById('row-date');
        const rowShift = document.getElementById('row-shift');
        if(!rowWeekday || !rowDate || !rowShift) return;

        // 清空表格 (保留標題欄)
        while(rowWeekday.cells.length > 1) rowWeekday.deleteCell(1);
        while(rowDate.cells.length > 1) rowDate.deleteCell(1);
        while(rowShift.cells.length > 1) rowShift.deleteCell(1);

        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date();
        today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const weekStr = ['日','一','二','三','四','五','六'][dayOfWeek];
            
            // 讀取班別 (支援 current_1 或 current_01 或 YYYY-MM-DD)
            let shiftCode = myAssign[`current_${d}`] || 
                            myAssign[`current_${String(d).padStart(2, '0')}`] || 
                            'OFF';
            
            // 1. 星期列
            const tdW = document.createElement('td');
            tdW.textContent = weekStr;
            tdW.className = 'weekday-cell';
            if(dayOfWeek === 0) tdW.classList.add('weekend-sun');
            else if(dayOfWeek === 6) tdW.classList.add('weekend-sat');
            else tdW.classList.add('weekday-normal');
            rowWeekday.appendChild(tdW);

            // 2. 日期列
            const tdD = document.createElement('td');
            tdD.textContent = String(d).padStart(2, '0');
            tdD.className = 'date-cell';
            // 標記今天
            if (dateObj.getTime() === today.getTime()) tdD.style.backgroundColor = '#fff3cd'; 
            rowDate.appendChild(tdD);

            // 3. 班別列
            const tdS = document.createElement('td');
            tdS.className = 'shift-cell';
            
            const shiftBox = document.createElement('div');
            shiftBox.className = 'shift-box';
            shiftBox.textContent = shiftCode;
            
            // 樣式處理
            if (shiftCode === 'N') shiftBox.classList.add('shift-n');
            else if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') shiftBox.classList.add('shift-off');
            else if (shiftCode !== 'D' && shiftCode !== 'E') {
                // 特殊班別顏色 (嘗試從 allShifts 對照)
                const shiftDef = this.allShifts.find(s => s.code === shiftCode);
                if (shiftDef && shiftDef.color) {
                    shiftBox.style.backgroundColor = shiftDef.color;
                    shiftBox.style.color = '#fff';
                    shiftBox.style.border = 'none';
                }
            }

            // 換班點擊事件 (僅限未來日期)
            if (dateObj > today) {
                shiftBox.onclick = () => this.openExchangeModal(d, shiftCode);
                shiftBox.title = "點擊申請換班";
            } else {
                shiftBox.style.cursor = 'default';
                shiftBox.style.opacity = '0.8';
            }
            tdS.appendChild(shiftBox);
            rowShift.appendChild(tdS);
        }
    },

    // --- 統計計算 ---
    calculateStats: function(year, month) {
        const myAssign = this.currentAssignments[this.uid] || {};
        const daysInMonth = new Date(year, month, 0).getDate();
        let totalShifts = 0, totalOff = 0, holidayOff = 0, evening = 0, night = 0, exchangeCount = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            let code = myAssign[`current_${d}`] || 'OFF';
            
            if (code === 'OFF' || code === 'REQ_OFF') {
                totalOff++;
                const date = new Date(year, month-1, d);
                if (date.getDay() === 0 || date.getDay() === 6) holidayOff++;
            } else {
                totalShifts++;
                if (code === 'E' || code === 'EN') evening++;
                if (code === 'N') night++;
            }
        }

        // 統計換班數 (僅統計該次排班內的)
        if (this.currentSchedule.exchanges) {
            // 注意：這裡是舊資料結構，如果有新 collection 結構需調整，目前先保留
        }

        const safeSet = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
        safeSet('statTotalShifts', totalShifts);
        safeSet('statTotalOff', totalOff);
        safeSet('statHolidayOff', holidayOff);
        safeSet('statEvening', evening);
        safeSet('statNight', night);
    },

    resetStats: function() {
        ['statTotalShifts','statTotalOff','statHolidayOff','statEvening','statNight','statExchangeCount'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerText = '0';
        });
    },

    // --- 換班功能 ---
    exchangeData: null,
    openExchangeModal: function(day, myShift) {
        if (this.isSimulating) {
            alert("⚠️ 模擬模式下無法申請換班，請切換回本人帳號。");
            return;
        }

        this.exchangeData = { day, myShift };
        const dateStr = `${this.currentSchedule.year}/${this.currentSchedule.month}/${day}`;
        
        const infoEl = document.getElementById('exchangeInfo');
        if(infoEl) infoEl.innerHTML = `<strong>日期：</strong> ${dateStr} <br><strong>您的班別：</strong> <span class="badge badge-warning">${myShift}</span>`;
        
        const select = document.getElementById('exchangeTargetSelect');
        if(!select) return;
        select.innerHTML = '<option value="">載入中...</option>';
        
        // 載入可交換對象 (排除自己)
        const staffList = this.currentSchedule.staffList || [];
        const options = [];
        
        staffList.forEach(staff => {
            const targetUid = staff.uid.trim();
            if (targetUid === this.uid) return;
            
            // 取得對方的班表
            let targetAssign = this.currentAssignments[targetUid];
            
            // 如果這一包 assignments 裡沒有對方的資料，嘗試去 Assignments 全局找
            if (!targetAssign) {
                 targetAssign = this.currentSchedule.assignments ? this.currentSchedule.assignments[targetUid] : null;
            }

            // 如果 assignments 還是找不到，嘗試從矩陣提取
            if (!targetAssign) {
                 targetAssign = this.extractShiftsFromMatrix(this.currentSchedule.schedule, targetUid);
            }
            
            targetAssign = targetAssign || {};
            const targetShift = targetAssign[`current_${day}`] || 'OFF';
            
            // 只有班別不同才列出
            if (targetShift !== myShift) {
                options.push(`<option value="${targetUid}" data-shift="${targetShift}">${staff.name} (班別: ${targetShift})</option>`);
            }
        });

        if (options.length === 0) select.innerHTML = '<option value="">無可交換對象</option>';
        else select.innerHTML = '<option value="">請選擇對象</option>' + options.join('');
        
        const modal = document.getElementById('exchangeModal');
        if(modal) modal.classList.add('show');
    },

    closeExchangeModal: function() {
        const modal = document.getElementById('exchangeModal');
        if(modal) modal.classList.remove('show');
        this.exchangeData = null;
    },

    toggleOtherReason: function() {
        const val = document.getElementById('exchangeReasonCategory').value;
        const group = document.getElementById('otherReasonGroup');
        if(group) group.style.display = (val === 'other') ? 'block' : 'none';
    },

    submitExchange: async function() {
        const targetSelect = document.getElementById('exchangeTargetSelect');
        const targetUid = targetSelect.value;
        if (!targetUid) { alert("請選擇交換對象"); return; }
        
        const targetName = targetSelect.options[targetSelect.selectedIndex].text.split(' ')[0];
        const targetShift = targetSelect.options[targetSelect.selectedIndex].getAttribute('data-shift');
        const reasonCategory = document.getElementById('exchangeReasonCategory').value;
        const otherReasonText = document.getElementById('otherReasonText').value;
        const reason = document.getElementById('exchangeReason').value;

        if (!reasonCategory) { alert("請選擇換班事由分類"); return; }
        if (reasonCategory === 'other' && !otherReasonText) { alert("請填寫其他原因說明"); return; }

        try {
            const requestData = {
                unitId: this.currentSchedule.unitId,
                scheduleId: this.currentSchedule.id,
                year: this.currentSchedule.year,
                month: this.currentSchedule.month,
                day: this.exchangeData.day,
                requesterId: this.uid,
                requesterName: app.currentUser.displayName || '我',
                requesterShift: this.exchangeData.myShift,
                targetId: targetUid,
                targetName: targetName,
                targetShift: targetShift,
                reasonCategory: reasonCategory,
                otherReason: reasonCategory === 'other' ? otherReasonText : null,
                reason: reason,
                status: 'pending_target',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            await db.collection('shift_requests').add(requestData);
            alert("✅ 申請已送出！");
            this.closeExchangeModal();
        } catch(e) { console.error(e); alert("申請失敗: " + e.message); }
    },

    // --- 模擬工具 UI ---
    startSimulation: function(targetUid, targetName = '模擬員工') {
        sessionStorage.setItem('simulation_uid', targetUid);
        sessionStorage.setItem('simulation_name', targetName);
        alert(`已切換為模擬視角：${targetName}\n網頁將重新整理...`);
        location.reload();
    },

    endSimulation: function() {
        sessionStorage.removeItem('simulation_uid');
        sessionStorage.removeItem('simulation_name');
        if (typeof app !== 'undefined' && app.clearImpersonation) app.clearImpersonation(); 
        alert("已結束模擬，恢復為原始身分。\n網頁將重新整理...");
        location.reload();
    },

    showSimulationBadge: function(name) {
        let badge = document.getElementById('sim-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'sim-badge';
            badge.style.cssText = "position:fixed; bottom:10px; right:10px; background:#e74c3c; color:white; padding:8px 12px; z-index:9999; border-radius:30px; font-weight:bold; box-shadow:0 2px 10px rgba(0,0,0,0.3); font-size:14px; display:flex; align-items:center; gap:10px;";
            badge.innerHTML = `<span>🎭 模擬視角: ${name}</span> <button onclick="staffScheduleManager.endSimulation()" style="background:white; color:#e74c3c; border:none; padding:2px 8px; border-radius:10px; cursor:pointer; font-weight:bold;">退出</button>`;
            document.body.appendChild(badge);
        }
    },

    removeSimulationBadge: function() {
        const badge = document.getElementById('sim-badge');
        if (badge) badge.remove();
    }
};
