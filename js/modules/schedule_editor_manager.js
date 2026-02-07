// js/modules/schedule_editor_manager.js
// 🚀 最終完整版 v6：顯示 FF、新增狀態欄（孕/哺/P/D）+ 包班配額檢查功能 + 權限控管

const scheduleEditorManager = {
    scheduleId: null, 
    data: null, 
    shifts: [], 
    assignments: {}, 
    unitRules: {}, 
    staffMap: {}, 
    usersMap: {}, 
    isLoading: false,
    lastMonthData: {}, 
    lastMonthDays: 31,
    lastScoreResult: null,
    contextMenuHandler: null,

    init: async function(id) { 
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        
        if (!app.currentUser) { 
            alert("請先登入"); 
            return; 
        }
        
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法編輯排班表</p>
                </div>
            `;
            return;
        }
        
        this.showLoading();
        
        try {
            const schDoc = await db.collection('schedules').doc(id).get();
            if (!schDoc.exists) {
                alert("找不到此排班表");
                return;
            }
            
            const schData = schDoc.data();
            
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if (activeUnitId !== schData.unitId) {
                    document.getElementById('content-area').innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-lock"></i>
                            <h3>權限不足</h3>
                            <p>您無權編輯其他單位的排班表</p>
                        </div>
                    `;
                    return;
                }
            }
            
            await this.loadContext(); 
            await Promise.all([
                this.loadShifts(), 
                this.loadUsers(), 
                this.loadUnitRules(),
                this.loadLastMonthSchedule()
            ]);
            
            if(typeof scoringManager !== 'undefined') {
                await scoringManager.loadSettings(this.data.unitId);
            }
            
            if (!this.data.assignments || typeof this.data.assignments !== 'object') {
                this.data.assignments = {};
            }
            this.assignments = this.data.assignments;
            
            if (!this.data.staffList || !Array.isArray(this.data.staffList)) {
                throw new Error("人員名單 (StaffList) 資料損毀，無法載入排班表。");
            }

            this.renderToolbar(); 
            this.renderScoreBoardContainer(); 
            this.renderMatrix();
            this.updateRealTimeStats(); 
            this.updateScheduleScore(); 
            this.setupEvents();
            this.initContextMenu();
            
        } catch (e) { 
            console.error("❌ 初始化失敗:", e);
            const body = document.getElementById('schBody');
            if (body) {
                body.innerHTML = `<tr><td colspan="20" style="color:red; text-align:center; padding:20px;">
                    初始化失敗: ${e.message}<br>
                    <button onclick="location.reload()" style="margin-top:10px; padding:5px 15px;">重新載入</button>
                </td></tr>`;
            }
        }
        finally { 
            this.isLoading = false; 
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
        }
    },

    initContextMenu: function() {
        if (!document.getElementById('schContextMenu')) {
            const menu = document.createElement('div');
            menu.id = 'schContextMenu';
            menu.className = 'context-menu';
            document.body.appendChild(menu);
        }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("資料不存在");
        
        this.data = doc.data();
        this.data.staffList.forEach(s => { 
            if (s.uid) {
                s.uid = s.uid.trim();
                this.staffMap[s.uid] = s; 
            }
        });
    },

    loadLastMonthSchedule: async function() {
        const { year, month } = this.data;
        let ly = year, lm = month - 1;
        
        if (lm === 0) { 
            lm = 12; 
            ly--; 
        }
        
        this.lastMonthDays = new Date(ly, lm, 0).getDate();

        if (this.data.lastMonthData && Object.keys(this.data.lastMonthData).length > 0) {
            this.lastMonthData = this.data.lastMonthData;
            return;
        }

        const snap = await db.collection('schedules')
            .where('unitId', '==', this.data.unitId)
            .where('year', '==', ly)
            .where('month', '==', lm)
            .where('status', '==', 'published')
            .limit(1)
            .get();

        if (!snap.empty) {
            this.lastMonthData = snap.docs[0].data().assignments || {};
            console.log(`✅ 已載入上個月班表 (${ly}-${lm})`);
        } else {
            this.lastMonthData = {};
            console.warn(`⚠️ 找不到上個月 (${ly}-${lm}) 已發布班表`);
        }
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts')
            .where('unitId', '==', this.data.unitId)
            .orderBy('startTime')
            .get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(d => this.usersMap[d.id] = d.data());
    },

    loadUnitRules: async function() {
        const doc = await db.collection('units').doc(this.data.unitId).get();
        this.unitRules = doc.data() || {};
    },

    // 🆕 取得人員狀態標記
    getStaffStatusBadges: function(uid) {
        const user = this.usersMap[uid];
        if (!user) return '';
        
        const badges = [];
        const params = user.schedulingParams || {};
        const today = new Date();
        
        // 檢查懷孕
        if (params.isPregnant && params.pregnantExpiry) {
            const expiry = new Date(params.pregnantExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#ff9800; color:white;">孕</span>');
            }
        }
        
        // 檢查哺乳
        if (params.isBreastfeeding && params.breastfeedingExpiry) {
            const expiry = new Date(params.breastfeedingExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#4caf50; color:white;">哺</span>');
            }
        }
        
        // 檢查 PGY
        if (params.isPGY && params.pgyExpiry) {
            const expiry = new Date(params.pgyExpiry);
            if (expiry >= today) {
                badges.push('<span class="status-badge" style="background:#2196f3; color:white;">P</span>');
            }
        }
        
        // 檢查未獨立
        if (params.independence === 'dependent') {
            badges.push('<span class="status-badge" style="background:#9c27b0; color:white;">D</span>');
        }
        
        return badges.join('');
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const weeks = ['日','一','二','三','四','五','六'];
        
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:50px; position:sticky; left:140px; z-index:110; background:#f8f9fa;">狀態</th>
            <th rowspan="2" style="width:60px;">偏好</th>
            <th colspan="6" style="background:#eee; font-size:0.8rem;">上月月底</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th style="${color}">${d}</th>`;
        }
        h1 += `<th colspan="4" style="background:#e8f4fd;">統計</th></tr>`;

        let h2 = `<tr>`;
        const lastDays = this.lastMonthDays || 31;
        for(let d = lastDays - 5; d <= lastDays; d++) {
            h2 += `<th style="background:#f5f5f5; font-size:0.7rem; color:#999;">${d}</th>`;
        }
        
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `<th style="width:40px; background:#f0f7ff; font-size:0.75rem;">總OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">假OFF</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">E</th>
               <th style="width:40px; background:#f0f7ff; font-size:0.75rem;">N</th></tr>`;
        
        thead.innerHTML = h1 + h2;

        let bodyHtml = '';
        this.data.staffList.forEach(staff => {
            const uid = staff.uid;
            const ua = this.assignments[uid] || {};
            const empId = this.usersMap[uid]?.employeeId || '';
            
            const prefs = staff.prefs || ua.preferences || {};
            let prefDisplay = '';
            
            if (prefs.bundleShift || staff.packageType) {
                prefDisplay += `<div style="font-weight:bold; font-size:0.85rem;">包${prefs.bundleShift || staff.packageType}</div>`;
            }
            
            let favs = [];
            if (prefs.favShift) favs.push(prefs.favShift);
            if (prefs.favShift2) favs.push(prefs.favShift2);
            if (favs.length > 0) {
                prefDisplay += `<div style="font-size:0.75rem; color:#666;">${favs.join('→')}</div>`;
            } else if (!prefDisplay) {
                prefDisplay = '-';
            }

            // 🆕 取得狀態標記
            const statusBadges = this.getStaffStatusBadges(uid);

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:10;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10;">${staff.name}</td>
                <td style="position:sticky; left:140px; background:#fff; z-index:10; text-align:center; line-height:1.2;">
                    ${statusBadges || '<span style="color:#ccc;">-</span>'}
                </td>
                <td style="text-align:center;">${prefDisplay}</td>`;
            
            const lastData = this.lastMonthData[uid] || {};
            for(let d = lastDays - 5; d <= lastDays; d++) {
                const v = lastData[`last_${d}`];
                const c = this.shifts.find(s => s.code === v)?.color || '#fff';
                bodyHtml += `<td class="last-month-cell" style="background:${c}; font-size:0.7rem;">${v === 'OFF' ? 'FF' : (v || '-')}</td>`;
            }
            
            let offCnt = 0, reqCnt = 0, eCnt = 0, nCnt = 0;
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = ua[key];
                let cellStyle = '';
                let cellClass = 'cell-clickable';
                let text = val || '';
                
                if(val === 'OFF') { offCnt++; cellClass += ' cell-off'; text = 'FF'; }
                else if(val === 'REQ_OFF') { offCnt++; reqCnt++; cellClass += ' cell-req-off'; text = 'V'; }
                else if(val === 'E') { eCnt++; cellStyle = 'background:#BBDEFB;'; }
                else if(val === 'N') { nCnt++; cellStyle = 'background:#CE93D8;'; }
                else if(val) {
                    const sh = this.shifts.find(s => s.code === val);
                    if(sh) cellStyle = `background:${sh.color};`;
                }
                
                bodyHtml += `<td class="${cellClass}" data-uid="${uid}" data-day="${d}" style="${cellStyle}" 
                    oncontextmenu="scheduleEditorManager.showContextMenu(event,'${uid}',${d}); return false;">
                    ${text}
                </td>`;
            }
            
            bodyHtml += `<td style="background:#f0f7ff; font-weight:bold;">${offCnt}</td>
                         <td style="background:#fff3cd;">${reqCnt}</td>
                         <td style="background:#e3f2fd;">${eCnt}</td>
                         <td style="background:#f3e5f5;">${nCnt}</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
        this.bindEvents();
    },

    showLoading: function() { 
        document.body.insertAdjacentHTML('beforeend', '<div id="globalLoader" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:99999; display:flex; justify-content:center; align-items:center;"><div style="background:white; padding:20px; border-radius:8px;">載入中...</div></div>'); 
    },

    renderToolbar: function() {
        const right = document.getElementById('toolbarRight');
        if(!right) return;
        document.getElementById('schTitle').innerText = `${this.data.year}/${this.data.month} 排班`;
        const statusMap = { draft: '草稿', published: '已發布' };
        const badge = document.getElementById('schStatus');
        badge.innerText = statusMap[this.data.status] || '未知';
        badge.style.background = this.data.status === 'published' ? '#2ecc71' : '#f39c12';
        
        let html = '';
        if(this.data.status === 'draft') {
            html += `<button class="btn btn-primary" onclick="scheduleEditorManager.runAI()"><i class="fas fa-magic"></i> AI 自動排班</button>`;
            html += `<button class="btn" style="background:#95a5a6;" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置</button>`;
            html += `<button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-check"></i> 確認發布</button>`;
        } else {
            html += `<button class="btn" style="background:#e67e22;" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-times"></i> 取消發布</button>`;
        }
        right.innerHTML = html;
        
        const loader = document.getElementById('globalLoader'); 
        if(loader) loader.remove();
    },

    runAI: async function() {
        if (typeof SchedulerFactory === 'undefined') { 
            alert("AI 模組未載入"); 
            return; 
        }
        
        const checkResult = await this.analyzeBundleQuota();
        this.showBundleCheckModal(checkResult);
    },

    analyzeBundleQuota: async function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        const demandByShift = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const date = new Date(year, month - 1, d);
            const dayIdx = (date.getDay() + 6) % 7;
            
            this.shifts.forEach(shift => {
                const code = shift.code;
                if (!demandByShift[code]) demandByShift[code] = 0;
                
                if (this.data.specificNeeds?.[dateStr]?.[code] !== undefined) {
                    demandByShift[code] += this.data.specificNeeds[dateStr][code];
                } else {
                    const key = `${code}_${dayIdx}`;
                    const need = this.data.dailyNeeds?.[key] || 0;
                    demandByShift[code] += need;
                }
            });
        }
        
        const analysis = {};
        
        ['E', 'N', 'D'].forEach(shiftCode => {
            const bundleStaff = [];
            const nonBundleStaff = [];
            
            this.data.staffList.forEach(staff => {
                const prefs = staff.prefs || {};
                const bundleShift = staff.packageType || prefs.bundleShift;
                
                if (bundleShift === shiftCode) {
                    bundleStaff.push({
                        uid: staff.uid,
                        name: staff.name,
                        empId: this.usersMap[staff.uid]?.employeeId || ''
                    });
                } else if (prefs.favShift === shiftCode || 
                          prefs.favShift2 === shiftCode || 
                          prefs.favShift3 === shiftCode) {
                    nonBundleStaff.push({
                        uid: staff.uid,
                        name: staff.name,
                        empId: this.usersMap[staff.uid]?.employeeId || '',
                        prefs: `偏好${prefs.favShift === shiftCode ? '1' : prefs.favShift2 === shiftCode ? '2' : '3'}`
                    });
                }
            });
            
            const totalDemand = demandByShift[shiftCode] || 0;
            const bundleCount = bundleStaff.length;
            const nonBundleCount = nonBundleStaff.length;
            
            let bundleQuota = 0;
            let nonBundleQuota = 0;
            let status = 'ok';
            let warningLevel = 0;
            let warningMsg = '';
            
            if (bundleCount > 0) {
                bundleQuota = totalDemand / bundleCount;
                
                if (bundleQuota < 18) {
                    status = 'low';
                    warningLevel = 1;
                    warningMsg = `配額過低（< 18班），將導致休假過多`;
                } else if (bundleQuota > 26) {
                    status = 'critical';
                    warningLevel = 2;
                    warningMsg = `配額過高（> 26班），可能導致工作過量`;
                } else if (bundleQuota > 22) {
                    status = 'high';
                    warningLevel = 1;
                    warningMsg = `配額偏高（> 22班），建議關注`;
                }
                
                if (nonBundleCount > 0 && bundleQuota < 22) {
                    const shortage = Math.max(0, bundleCount * 22 - totalDemand);
                    nonBundleQuota = shortage / nonBundleCount;
                }
            }
            
            analysis[shiftCode] = {
                totalDemand: totalDemand,
                bundleCount: bundleCount,
                bundleQuota: bundleQuota.toFixed(1),
                bundleStaff: bundleStaff,
                nonBundleCount: nonBundleCount,
                nonBundleQuota: nonBundleQuota.toFixed(1),
                nonBundleStaff: nonBundleStaff,
                status: status,
                warningLevel: warningLevel,
                warningMsg: warningMsg
            };
        });
        
        const maxWarningLevel = Math.max(...Object.values(analysis).map(a => a.warningLevel));
        
        return {
            canExecute: true,
            hasWarning: maxWarningLevel > 0,
            analysis: analysis,
            daysInMonth: daysInMonth
        };
    },

    showBundleCheckModal: function(checkResult) {
        const oldModal = document.getElementById('bundleCheckModal');
        if (oldModal) oldModal.remove();
        
        const { analysis, canExecute, hasWarning } = checkResult;
        
        let modalHtml = `
        <div id="bundleCheckModal" style="display:flex; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5); align-items:center; justify-content:center;">
            <div style="background:white; padding:30px; border-radius:12px; width:900px; max-height:85vh; overflow-y:auto; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 10px 0; color:#2c3e50;">📊 包班班數配額預估</h3>
                <p style="color:#666; margin-bottom:25px; font-size:0.95rem;">
                    執行 AI 排班前，請先確認包班人員配置是否合理
                </p>`;
        
        ['E', 'N'].forEach(code => {
            const data = analysis[code];
            const shiftName = code === 'E' ? '小夜班' : '大夜班';
            const shiftIcon = code === 'E' ? '🌙' : '🌃';
            const shiftColor = code === 'E' ? '#3498db' : '#9b59b6';
            
            modalHtml += `
            <div style="border:2px solid ${shiftColor}; border-radius:8px; padding:20px; margin-bottom:20px;">
                <h4 style="margin:0 0 15px 0; color:${shiftColor}; font-size:1.2rem;">
                    ${shiftIcon} ${shiftName}配額分析
                </h4>
                
                <table style="width:100%; border-collapse:collapse;">
                    <tbody>
                        <tr style="background:#f8f9fa;">
                            <td style="padding:12px; font-weight:bold; width:200px;">${shiftName}總班數</td>
                            <td style="padding:12px;">
                                <span style="font-size:1.3rem; font-weight:bold; color:#2c3e50;">${data.totalDemand}</span> 班
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:12px; border-top:1px solid #ddd;">包班</td>
                            <td style="padding:12px; border-top:1px solid #ddd;">
                                <span style="font-size:1.3rem; font-weight:bold; color:#e74c3c;">${data.bundleCount}</span> 人，
                                預估每人配額 
                                <span style="font-size:1.4rem; font-weight:bold; color:#e67e22;">${data.bundleQuota}</span> 班
                            </td>
                        </tr>
                        <tr style="background:#fff3cd;">
                            <td style="padding:12px; border-top:1px solid #ddd;">非包班<br><small style="font-weight:normal; color:#666;">(有列排班偏好)</small></td>
                            <td style="padding:12px; border-top:1px solid #ddd;">
                                <span style="font-size:1.3rem; font-weight:bold;">${data.nonBundleCount}</span> 人，
                                預估每人配額 
                                <span style="font-size:1.4rem; font-weight:bold; color:#27ae60;">${data.nonBundleQuota}</span> 班
                            </td>
                        </tr>
                    </tbody>
                </table>`;
            
            if (data.warningLevel > 0) {
                const bgColor = data.warningLevel === 2 ? '#ffebee' : '#fff3cd';
                const borderColor = data.warningLevel === 2 ? '#e74c3c' : '#ff9800';
                const icon = data.warningLevel === 2 ? '🚫' : '⚠️';
                const title = data.warningLevel === 2 ? '嚴重警告' : '警告';
                
                modalHtml += `
                <div style="margin-top:15px; padding:15px; border-radius:6px; background:${bgColor}; border-left:4px solid ${borderColor};">
                    ${icon} <strong>${title}：</strong>${data.warningMsg}<br>
                    <strong>建議：</strong>${data.warningLevel === 2 ? '請返回調整包班人數或人力需求設定' : '建議調整，或點擊「強制執行」繼續'}
                </div>`;
            }
            
            modalHtml += `
                <details style="margin-top:15px;">
                    <summary style="cursor:pointer; color:${shiftColor}; font-weight:bold; user-select:none;">
                        👥 查看包班人員名單 ▼
                    </summary>
                    <ul style="margin:10px 0; padding-left:20px; line-height:1.8;">`;
            
            if (data.bundleStaff.length === 0) {
                modalHtml += '<li style="color:#999;">無包班人員</li>';
            } else {
                data.bundleStaff.forEach(s => {
                    modalHtml += `<li><strong>${s.empId}</strong> - ${s.name}</li>`;
                });
            }
            
            modalHtml += `</ul></details>`;
            
            modalHtml += `
                <details style="margin-top:10px;">
                    <summary style="cursor:pointer; color:#666; font-weight:bold; user-select:none;">
                        👥 查看非包班（偏好）人員名單 ▼
                    </summary>
                    <ul style="margin:10px 0; padding-left:20px; line-height:1.8;">`;
            
            if (data.nonBundleStaff.length === 0) {
                modalHtml += '<li style="color:#999;">無非包班（偏好）人員</li>';
            } else {
                data.nonBundleStaff.forEach(s => {
                    modalHtml += `<li><strong>${s.empId}</strong> - ${s.name} <span style="color:#666;">(${s.prefs})</span></li>`;
                });
            }
            
            modalHtml += `</ul></details>`;
            modalHtml += `</div>`;
        });
        
        modalHtml += `<div style="background:#f5f5f5; padding:20px; border-radius:8px; margin-bottom:20px;">
            <h4 style="margin-top:0;">📋 配置總結</h4>`;
        
        const issues = Object.entries(analysis).filter(([_, data]) => data.warningLevel > 0);
        
        if (issues.length === 0) {
            modalHtml += '<p style="color:#4caf50; font-size:1.1rem; margin:0;">✅ 所有包班配置均在合理範圍內，可以執行排班</p>';
        } else {
            modalHtml += `<ul style="margin:10px 0; padding-left:20px;">`;
            issues.forEach(([code, data]) => {
                const color = data.warningLevel === 2 ? '#e74c3c' : '#ff9800';
                const icon = data.warningLevel === 2 ? '🚫' : '⚠️';
                modalHtml += `<li style="color:${color}; margin-bottom:8px;">
                    ${icon} <strong>${code}班：</strong>${data.warningMsg}
                </li>`;
            });
            modalHtml += '</ul>';
            
            modalHtml += '<p style="color:#ff9800; margin:10px 0 0 0;">⚠️ 建議返回調整包班設定，或點擊「確認執行排班」繼續</p>';
        }
        
        modalHtml += `</div>`;
        
        modalHtml += `
            <div style="display:flex; gap:15px; justify-content:flex-end;">
                <button onclick="scheduleEditorManager.closeBundleCheck()" style="padding:10px 20px; border:1px solid #95a5a6; background:#fff; border-radius:4px; cursor:pointer; font-size:1rem;">
                    <i class="fas fa-arrow-left"></i> 返回調整
                </button>`;
        
        if (hasWarning) {
            const btnColor = issues.some(([_, data]) => data.warningLevel === 2) ? '#e74c3c' : '#ff9800';
            const btnText = issues.some(([_, data]) => data.warningLevel === 2) ? '⚠️ 確認執行排班（有嚴重警告）' : '⚠️ 確認執行排班';
            modalHtml += `
                <button onclick="scheduleEditorManager.forceExecuteAI()" style="padding:10px 20px; border:none; background:${btnColor}; color:white; border-radius:4px; cursor:pointer; font-size:1rem; font-weight:bold;">
                    ${btnText}
                </button>`;
        } else {
            modalHtml += `
                <button onclick="scheduleEditorManager.confirmExecuteAI()" style="padding:10px 20px; border:none; background:#2ecc71; color:white; border-radius:4px; cursor:pointer; font-size:1rem; font-weight:bold;">
                    ✅ 確認執行排班
                </button>`;
        }
        
        modalHtml += `
            </div>
            <p style="font-size:0.85rem; color:#999; margin-top:15px; text-align:center;">
                註：非包班人員的配額為「補充性質」，實際班數會依需求動態調整
            </p>
        </div></div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    closeBundleCheck: function() {
        const modal = document.getElementById('bundleCheckModal');
        if (modal) modal.remove();
    },

    forceExecuteAI: function() {
        if (confirm('⚠️ 確定要執行排班嗎？\n\n目前包班配額有警告：\n• 可能導致休假天數分配不均\n• 可能導致工作負擔過重或過輕\n• 排班結果可能需要較多手動調整\n\n建議：返回調整包班人數或人力需求設定')) {
            this.closeBundleCheck();
            this.executeAI();
        }
    },

    confirmExecuteAI: function() {
        this.closeBundleCheck();
        this.executeAI();
    },

// ✅ schedule_editor_manager.js - executeAI 方法完整修正版
// 關鍵修正：正確傳遞完整的 schedulingParams 給 AI 排班引擎

executeAI: async function() {
    if (!confirm("確定執行 AI 排班? (將覆蓋目前的草稿)")) return;
    
    this.isLoading = true;
    this.showLoading();
    
    try {
        const year = this.data.year;
        const month = this.data.month;
        
        // ✅ 關鍵修正：正確建立 staffListForAI
        const staffListForAI = this.data.staffList.map(s => {
            const ua = this.assignments[s.uid] || {};
            
            // 1. 收集預假資料
            const preReq = {};
            for(let d=1; d<=31; d++) {
                const k = `current_${d}`;
                if(ua[k] === 'REQ_OFF') {
                    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    preReq[dateStr] = 'REQ_OFF';
                }
            }
            
            // 2. ✅ 從 usersMap 取得完整的使用者資訊（包含特殊身分）
            const userInfo = this.usersMap[s.uid] || {};
            const userParams = userInfo.schedulingParams || {};
            
            // 記錄日誌以便追蹤
            console.log(`📋 載入人員資料: ${s.name}`, {
                hasPregnant: !!userParams.isPregnant,
                hasBreastfeeding: !!userParams.isBreastfeeding,
                hasPGY: !!userParams.isPGY,
                independence: userParams.independence
            });
            
            return {
                id: s.uid, 
                uid: s.uid, 
                name: s.name, 
                group: s.group,
                prefs: s.prefs || ua.preferences || {},
                packageType: (s.prefs||{}).bundleShift || null,
                preferences: s.prefs || ua.preferences || {},  // ✅ 新增：志願資訊
                
                // ✅ 3. 完整的 schedulingParams（預假 + 特殊身分）
                schedulingParams: {
                    // 預假資料
                    ...preReq,
                    
                    // ✅ 特殊身分資訊（從 usersMap 取得）
                    isPregnant: userParams.isPregnant || false,
                    pregnantExpiry: userParams.pregnantExpiry || null,
                    
                    isBreastfeeding: userParams.isBreastfeeding || false,
                    breastfeedingExpiry: userParams.breastfeedingExpiry || null,
                    
                    isPGY: userParams.isPGY || false,
                    pgyExpiry: userParams.pgyExpiry || null,
                    
                    independence: userParams.independence || 'independent',
                    clinicalTeacherId: userParams.clinicalTeacherId || null,
                    
                    // ✅ 其他可能的設定
                    canBundleShifts: userParams.canBundleShifts || false
                }
            };
        });

        // ✅ 驗證：檢查是否有特殊身分人員
        const specialStaff = staffListForAI.filter(s => {
            const p = s.schedulingParams;
            return p.isPregnant || p.isBreastfeeding || p.isPGY || p.independence === 'dependent';
        });
        
        console.log(`✅ 特殊身分人員: ${specialStaff.length} 人`, 
            specialStaff.map(s => `${s.name}(${
                s.schedulingParams.isPregnant ? '孕' : ''
            }${
                s.schedulingParams.isBreastfeeding ? '哺' : ''
            }${
                s.schedulingParams.isPGY ? 'P' : ''
            }${
                s.schedulingParams.independence === 'dependent' ? 'D' : ''
            })`));

        // 建立規則物件
        const rules = {
            dailyNeeds: this.data.dailyNeeds || {},
            specificNeeds: this.data.specificNeeds || {}, 
            groupLimits: this.data.groupLimits || {}, 
            shiftCodes: this.shifts.map(s => s.code),
            shifts: this.shifts, 
            ...this.unitRules, 
            ...(this.data.settings || {})
        };

        // ✅ 記錄規則載入情況
        console.log('📝 規則載入:', {
            protectPregnant: rules.hard?.protectPregnant,
            protectPGY: rules.policy?.protectPGY,
            protectPGY_List: rules.policy?.protectPGY_List,
            minGap11: rules.hard?.minGap11,
            minGapHours: rules.hard?.minGapHours
        });

        // 建立排班引擎並執行
        console.log('🚀 開始執行 AI 排班引擎...');
        const scheduler = SchedulerFactory.create('V2', staffListForAI, year, month, this.lastMonthData, rules);
        const aiResult = scheduler.run();
        
        this.applyAIResult(aiResult);
        
        this.renderMatrix();
        this.updateRealTimeStats();
        if(typeof scoringManager !== 'undefined') scoringManager.setBase(null);
        this.updateScheduleScore();

        await this.saveDraft(true);
        
        alert("AI 排班完成!");
    } catch (e) { 
        console.error("❌ AI 排班失敗:", e); 
        alert("AI 失敗: " + e.message); 
        this.renderMatrix(); 
    }
    finally { 
        this.isLoading = false;
        const loader = document.getElementById('globalLoader');
        if (loader) loader.remove();
    }
},

    applyAIResult: function(res) {
        if (res.assignments) {
            Object.keys(res.assignments).forEach(uid => {
                const cleanUid = uid.trim();
                if(!this.assignments[cleanUid]) this.assignments[cleanUid] = {};
                this.assignments[cleanUid] = { 
                    ...this.assignments[cleanUid], 
                    ...res.assignments[uid] 
                };
            });
        } else {
            const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
            this.data.staffList.forEach(s => {
                if (!s.uid) return;
                const uid = s.uid.trim();
                if(!this.assignments[uid]) this.assignments[uid] = {};
                for(let d=1; d<=daysInMonth; d++) {
                    if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') delete this.assignments[uid][`current_${d}`];
                }
            });
            Object.keys(res).forEach(dateStr => {
                const day = parseInt(dateStr.split('-')[2]);
                if (isNaN(day)) return;
                const daySch = res[dateStr];
                Object.keys(daySch).forEach(code => {
                    if (Array.isArray(daySch[code])) {
                        daySch[code].forEach(rawUid => {
                            if (!rawUid) return;
                            const uid = rawUid.trim();
                            if (this.assignments[uid] && this.assignments[uid][`current_${day}`] !== 'REQ_OFF') {
                                this.assignments[uid][`current_${day}`] = code;
                            }
                        });
                    }
                });
            });
        }
    },

    saveDraft: async function(silent) {
        try {
            console.log("💾 開始儲存草稿...");
            
            if (!this.scheduleId || !this.data) {
                throw new Error("排班資料不完整，無法儲存");
            }
            
            if (!this.data.staffList || this.data.staffList.length === 0) {
                throw new Error("人員名單為空，無法儲存");
            }
            
            const cleanAssignments = {};
            Object.keys(this.assignments).forEach(uid => {
                cleanAssignments[uid] = {};
                
                if (this.assignments[uid].preferences) {
                    cleanAssignments[uid].preferences = this.assignments[uid].preferences;
                }
                
                Object.keys(this.assignments[uid]).forEach(key => {
                    if (key.startsWith('current_')) {
                        const val = this.assignments[uid][key];
                        if (val !== undefined && val !== null) {
                            cleanAssignments[uid][key] = val;
                        }
                    }
                });
            });
            
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: cleanAssignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.assignments = cleanAssignments;
            
            if (!silent) alert("✅ 草稿已儲存");
            console.log("✅ 儲存成功");
            
        } catch (e) {
            console.error("❌ 儲存失敗:", e);
            if (!silent) alert("儲存失敗: " + e.message);
        }
    },

    publishSchedule: async function() {
        if(!confirm("確定發布？")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                publishedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("已發布");
        } catch(e) { 
            console.error("❌ 發布失敗:", e);
            alert("失敗: " + e.message); 
        }
    },

    getDateStr: function(day) {
        return `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    },

    showContextMenu: function(event, uid, day) {
        event.preventDefault();
        const menu = document.getElementById('schContextMenu');
        const ul = menu.querySelector('ul');
        ul.innerHTML = '';
        
        const current = this.assignments[uid]?.[`current_${day}`];
        
        if(current === 'REQ_OFF') {
            ul.innerHTML = '<li onclick="scheduleEditorManager.clearCell(\''+uid+'\','+day+')">清除</li>';
        } else {
            ul.innerHTML = '<li onclick="scheduleEditorManager.setOff(\''+uid+'\','+day+')">設為 FF</li>';
            this.shifts.forEach(s => {
                ul.innerHTML += `<li onclick="scheduleEditorManager.setShift('${uid}',${day},'${s.code}')">${s.name} (${s.code})</li>`;
            });
            if(current) ul.innerHTML += '<li onclick="scheduleEditorManager.clearCell(\''+uid+'\','+day+')">清除</li>';
        }
        
        menu.style.display = 'block';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
    },

    setOff: function(uid, day) {
        if(!this.assignments[uid]) this.assignments[uid] = {};
        this.assignments[uid][`current_${day}`] = 'OFF';
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        document.getElementById('schContextMenu').style.display = 'none';
    },

    setShift: function(uid, day, code) {
        if(!this.assignments[uid]) this.assignments[uid] = {};
        this.assignments[uid][`current_${day}`] = code;
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        document.getElementById('schContextMenu').style.display = 'none';
    },

    clearCell: function(uid, day) {
        if(this.assignments[uid] && this.assignments[uid][`current_${day}`] !== 'REQ_OFF') {
            delete this.assignments[uid][`current_${day}`];
        }
        this.renderMatrix();
        this.updateRealTimeStats();
        this.updateScheduleScore();
        document.getElementById('schContextMenu').style.display = 'none';
    },
    
    bindEvents: function() {
        if (this.contextMenuHandler) {
            document.removeEventListener('click', this.contextMenuHandler);
        }
        
        this.contextMenuHandler = () => { 
            const m = document.getElementById('schContextMenu'); 
            if(m) m.style.display='none'; 
        };
        
        document.addEventListener('click', this.contextMenuHandler);
    },
    
    cleanup: function() {
        console.log("🧹 開始清理排班編輯器資源...");
        
        if (this.contextMenuHandler) {
            document.removeEventListener('click', this.contextMenuHandler);
            this.contextMenuHandler = null;
        }
        
        this.assignments = {};
        this.staffMap = {};
        this.usersMap = {};
        this.lastMonthData = {};
        this.shifts = [];
        this.data = null;
        
        const menu = document.getElementById('schContextMenu');
        if (menu) menu.remove();
        
        console.log("✅ 資源清理完成");
    },
    
    updateRealTimeStats: function() {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};
        const specificNeeds = this.data.specificNeeds || {}; 
        const countMap = {};
        for(let d=1; d<=daysInMonth; d++) countMap[d] = {};
        this.data.staffList.forEach(s => {
            const uid = s.uid;
            const assign = this.assignments[uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val && val !== 'OFF' && val !== 'REQ_OFF') {
                    if(!countMap[d][val]) countMap[d][val] = 0;
                    countMap[d][val]++;
                }
            }
        });
        let fHtml = '';
        this.shifts.forEach((s, idx) => {
            fHtml += `<tr class="stat-monitor-row">`;
            if(idx === 0) fHtml += `<td colspan="4" rowspan="${this.shifts.length}" style="text-align:right; font-weight:bold; background:#f8f9fa; position:sticky; left:0; z-index:10;">每日缺額<br>監控</td>`;
            for(let i=0; i<6; i++) fHtml += `<td style="background:#f0f0f0;"></td>`; 
            for(let d=1; d<=daysInMonth; d++) {
                const actual = countMap[d][s.code] || 0;
                const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const jsDay = new Date(year, month-1, d).getDay(); 
                const needKeyIndex = (jsDay === 0) ? 6 : jsDay - 1; 
                let need = 0;
                if (specificNeeds[dateStr] && specificNeeds[dateStr][s.code] !== undefined) need = specificNeeds[dateStr][s.code];
                else need = dailyNeeds[`${s.code}_${needKeyIndex}`] || 0;
                let statusClass = '';
                let cellStyle = '';
                if(need > 0) {
                    if(actual < need) {
                        statusClass = 'stat-cell-shortage';
                        cellStyle = 'color: #e74c3c; font-weight: bold;';
                    }
                    else if(actual > need) statusClass = 'stat-cell-over';
                    else statusClass = 'stat-cell-ok';
                }
                const display = (need > 0) ? `${actual}/${need}` : (actual > 0 ? actual : '-');
                fHtml += `<td class="${statusClass}" style="${cellStyle}">${display}</td>`;
            }
            fHtml += `<td colspan="4" style="background:#f0f0f0;"></td>`;
            fHtml += `<td style="background:#f0f0f0; font-weight:bold;">${s.code}</td></tr>`;
        });
        tfoot.innerHTML = fHtml;
    },
    
    renderScoreBoardContainer: function() {
        const container = document.getElementById('matrixContainer');
        if (!container) return;
        const parent = container.parentElement; 
        if(document.getElementById('scoreDashboard')) return;
        
        const html = `
        <div id="scoreDashboard" style="background:#fff; padding:10px 20px; border-bottom:1px solid #ddd; display:flex; align-items:center; gap:20px;">
            <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="scheduleEditorManager.showDetailedScore()">
                <div style="position:relative; width:50px; height:50px; border-radius:50%; background:#ecf0f1; display:flex; justify-content:center; align-items:center;" id="scoreCircleBg">
                    <div style="width:42px; height:42px; background:#fff; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:2;">
                        <span id="scoreValue" style="font-size:1rem; font-weight:bold; color:#2c3e50;">-</span>
                    </div>
                </div>
                <div>
                    <h4 style="margin:0; font-size:0.9rem;">評分 (點擊查看詳情)</h4>
                    <div id="scoreCompareBadge" style="font-size:0.75rem; color:#999; background:#f5f5f5; padding:2px 6px; border-radius:4px;">AI原始</div>
                </div>
            </div>
        </div>`;
        parent.insertBefore(this.createElementFromHTML(html), container);
        
        if(!document.getElementById('scoreDetailModal')) {
            const modalHtml = `
            <div id="scoreDetailModal" class="modal" style="display:none; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.5);">
                <div style="background:white; margin:5% auto; padding:20px; border-radius:8px; width:600px; max-height:80vh; overflow-y:auto; position:relative;">
                    <span onclick="document.getElementById('scoreDetailModal').style.display='none'" style="position:absolute; right:20px; top:10px; font-size:24px; cursor:pointer;">&times;</span>
                    <h3 style="border-bottom:2px solid #3498db; padding-bottom:10px;">排班評分詳情</h3>
                    <div id="scoreDetailContent" style="margin-top:20px;"></div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
    },
    
    createElementFromHTML: function(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; },
    
    updateScheduleScore: function() {
        if (typeof scoringManager === 'undefined') return;
        const res = scoringManager.calculate(this.assignments, this.data.staffList, this.data.year, this.data.month);
        const score = res.total;
        document.getElementById('scoreValue').innerText = Math.round(score);
        document.getElementById('scoreCircleBg').style.background = `conic-gradient(#3498db 0% ${score}%, #ecf0f1 ${score}% 100%)`;
        this.lastScoreResult = res; 
    },
    
    showDetailedScore: function() {
        if(!this.lastScoreResult) return;
        const res = this.lastScoreResult;
        let html = '';
        html += `<h4>總分: ${res.total.toFixed(1)}</h4>`;
        document.getElementById('scoreDetailContent').innerHTML = html;
        document.getElementById('scoreDetailModal').style.display = 'block';
    },
    
    unpublishSchedule: async function() {
        if(!confirm("取消發布?")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'draft',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("已取消");
        } catch(e) { 
            console.error("❌ 取消發布失敗:", e);
            alert("失敗: " + e.message); 
        }
    },
    
    resetSchedule: async function() {
        if(!confirm("確定要重置嗎？這將會清除目前所有手動排班，並重新從預班表載入預班資料。")) return;
        
        try {
            let sourceAssignments = {};
            if (this.data.sourceId) {
                const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
                if (preDoc.exists) {
                    sourceAssignments = preDoc.data().assignments || {};
                    console.log("✅ 已從預班表重新載入原始資料");
                }
            }

            const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
            
            this.data.staffList.forEach(staff => {
                const uid = staff.uid;
                const preAssign = sourceAssignments[uid] || {};
                
                this.assignments[uid] = {};
                
                if (preAssign.preferences) {
                    this.assignments[uid].preferences = JSON.parse(JSON.stringify(preAssign.preferences));
                }
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    if (preAssign[key]) {
                        this.assignments[uid][key] = preAssign[key];
                    }
                }
            });

            this.renderMatrix();
            this.updateRealTimeStats();
            this.updateScheduleScore();
            await this.saveDraft(true);
            alert("✅ 已重置並重新載入預班資料");
        } catch (e) {
            console.error("❌ 重置失敗:", e);
            alert("重置失敗: " + e.message);
            this.renderMatrix();
        } finally {
            this.isLoading = false;
            const loader = document.getElementById('globalLoader');
            if (loader) loader.remove();
        }
    },
    
    setupEvents: function() { }
};
