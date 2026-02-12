// js/scheduler/algorithms/BacktrackSolver.js

const BacktrackSolver = {
    
    solve: function(assignments, gapList, staff, rules, dailyCount, daysInMonth, shiftTimeMap) {
        const maxDepth = rules.aiParams?.backtrack_depth || 3;
        const maxAttempts = rules.aiParams?.max_attempts || 20;
        
        console.log(`🔄 回溯求解啟動: ${gapList.length} 個缺額, 最大深度: ${maxDepth}`);
        
        const sortedGaps = this.prioritizeGaps(gapList, rules);
        
        let attempts = 0;
        const solved = [];
        const failed = [];
        
        for (let gap of sortedGaps) {
            if (attempts >= maxAttempts) {
                console.warn(`⚠️ 達到最大嘗試次數 ${maxAttempts}，停止回溯`);
                break;
            }
            
            const result = this.solveGap(
                gap, 
                assignments, 
                staff, 
                rules, 
                dailyCount, 
                daysInMonth, 
                shiftTimeMap, 
                maxDepth, 
                0
            );
            
            attempts++;
            
            if (result.success) {
                this.applyAdjustments(assignments, result.adjustments);
                solved.push(gap);
                console.log(`✅ 缺額已解決: ${gap.date} ${gap.shift}`);
            } else {
                failed.push(gap);
                console.warn(`❌ 無法解決: ${gap.date} ${gap.shift}`);
            }
        }
        
        return {
            solved: solved,
            failed: failed,
            attempts: attempts
        };
    },
    
    prioritizeGaps: function(gapList, rules) {
        const priorityOrder = rules.policy?.shortageHandling?.priorityOrder || [];
        
        return gapList.sort((a, b) => {
            const aIdx = priorityOrder.indexOf(a.shift);
            const bIdx = priorityOrder.indexOf(b.shift);
            
            const aPriority = aIdx === -1 ? 999 : aIdx;
            const bPriority = bIdx === -1 ? 999 : bIdx;
            
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            return a.day - b.day;
        });
    },
    
    solveGap: function(gap, assignments, staff, rules, dailyCount, daysInMonth, shiftTimeMap, maxDepth, currentDepth) {
        if (currentDepth >= maxDepth) {
            return { success: false, reason: '達到最大深度' };
        }
        
        // 1. 嘗試直接填補 (找當天休假且能上班的人)
        const directCandidates = this.findCandidates(gap, assignments, staff, rules, dailyCount, daysInMonth, shiftTimeMap);
        
        for (let candidate of directCandidates) {
            const adjustments = [{ uid: candidate.uid, day: gap.day, shift: gap.shift }];
            const testAssignments = this.simulateAdjustments(assignments, adjustments);
            
            if (this.isValidSolution(testAssignments, staff, rules, daysInMonth, shiftTimeMap)) {
                return { success: true, adjustments: adjustments };
            }
        }

        // 2. 嘗試「換班」填補 (如果直接填補失敗)
        // 邏輯：找一個當天「已經在上班」的人 A，如果 A 換到另一天 B 上班，而原本在 B 上班的人 C 可以換到當天來...
        // 簡化版：找一個當天「已經在上班」的人 A，看他能不能改排 gap.shift，或者找一個當天休假但因為規則不能排的人，嘗試調整他的前後天。
        // 這裡實作一個「二階換班」：找一個當天休假的人 A，雖然他今天不能排，但如果我們改掉他昨天的班，他今天就能排了。
        
        if (currentDepth < maxDepth) {
            for (let person of staff) {
                const uid = person.uid || person.id;
                const currentShift = assignments[uid]?.[`current_${gap.day}`];
                
                // 只針對當天休假但被硬性規則擋住的人
                if (currentShift === 'OFF' || currentShift === 'REQ_OFF') {
                    // 嘗試調整前一天的班別
                    if (gap.day > 1) {
                        const prevDay = gap.day - 1;
                        const originalPrevShift = assignments[uid][`current_${prevDay}`];
                        
                        // 如果前一天有上班，嘗試讓他前一天休假，看今天能不能上班
                        if (originalPrevShift && originalPrevShift !== 'OFF' && originalPrevShift !== 'REQ_OFF') {
                            const adjustments = [
                                { uid: uid, day: prevDay, shift: 'OFF' },
                                { uid: uid, day: gap.day, shift: gap.shift }
                            ];
                            const testAssignments = this.simulateAdjustments(assignments, adjustments);
                            if (this.isValidSolution(testAssignments, staff, rules, daysInMonth, shiftTimeMap)) {
                                // 注意：這會造成 prevDay 產生新的缺額，所以需要遞迴解決
                                const newGap = { day: prevDay, date: this.getDateKey(prevDay, rules.year, rules.month), shift: originalPrevShift };
                                const subResult = this.solveGap(newGap, testAssignments, staff, rules, dailyCount, daysInMonth, shiftTimeMap, maxDepth, currentDepth + 1);
                                
                                if (subResult.success) {
                                    return { success: true, adjustments: [...adjustments, ...subResult.adjustments] };
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return { success: false, reason: '所有路徑都不可行' };
    },

    getDateKey: function(day, year, month) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },
    
    findCandidates: function(gap, assignments, staff, rules, dailyCount, daysInMonth, shiftTimeMap) {
        const candidates = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            const currentShift = assignments[uid]?.[`current_${gap.day}`];
            
            if (currentShift && currentShift !== 'OFF' && currentShift !== 'REQ_OFF') {
                continue;
            }
            
            const lastDay = gap.day - 1;
            const lastShift = lastDay >= 1 ? assignments[uid]?.[`current_${lastDay}`] : null;
            
            // 使用 WhitelistCalculator 檢查候選人是否可以排入此班別
            const whitelist = WhitelistCalculator.calculate(
                person,
                assignments,
                gap.day,
                rules.year, // 假設 rules 中包含 year
                rules.month, // 假設 rules 中包含 month
                rules,
                dailyCount[gap.day], // 傳遞當天的 dailyCount
                daysInMonth,
                shiftTimeMap
            );
            
            if (!whitelist.includes(gap.shift)) {
                continue;
            }
            
            const score = this.calculateCandidateScore(person, gap, assignments);
            
            candidates.push({
                uid: uid,
                name: person.name,
                score: score,
                needsSwap: false
            });
        }
        
        candidates.sort((a, b) => b.score - a.score);
        
        return candidates;
    },
    
    calculateCandidateScore: function(person, gap, assignments) {
        let score = 100;
        
        const uid = person.uid || person.id;
        const prefs = person.preferences || {};
        
        if (prefs.favShift === gap.shift) score += 50;
        if (prefs.favShift2 === gap.shift) score += 30;
        if (prefs.favShift3 === gap.shift) score += 20;
        
        const params = person.schedulingParams || {};
        if (params[`current_${gap.day}`] === gap.shift) {
            score += 100;
        }
        
        if (person.level === 'N3' || person.level === 'N4') {
            score += 10;
        }
        
        return score;
    },
    
    simulateAdjustments: function(assignments, adjustments) {
        const testAssignments = JSON.parse(JSON.stringify(assignments));
        
        for (let adj of adjustments) {
            if (!testAssignments[adj.uid]) {
                testAssignments[adj.uid] = {};
            }
            testAssignments[adj.uid][`current_${adj.day}`] = adj.shift;
        }
        
        return testAssignments;
    },
    
    applyAdjustments: function(assignments, adjustments) {
        for (let adj of adjustments) {
            if (!assignments[adj.uid]) {
                assignments[adj.uid] = {};
            }
            assignments[adj.uid][`current_${adj.day}`] = adj.shift;
        }
    },
    
    isValidSolution: function(assignments, staff, rules, daysInMonth, shiftTimeMap) {
        for (let person of staff) {
            const uid = person.uid || person.id;
            
            for (let day = 1; day <= daysInMonth; day++) {
                const shift = assignments[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') continue;
                
                // 使用 WhitelistCalculator 檢查此班別是否合法
                const whitelist = WhitelistCalculator.calculate(
                    person,
                    assignments,
                    day,
                    rules.year, // 假設 rules 中包含 year
                    rules.month, // 假設 rules 中包含 month
                    rules,
                    {}, // 在 isValidSolution 中，我們只檢查個人排班的合法性，不考慮當日需求，因此 dailyCount 傳空對象
                    daysInMonth,
                    shiftTimeMap
                );
                
                if (!whitelist.includes(shift)) {
                    return false;
                }
            }
        }
        
        return true;
    }
};

console.log('✅ BacktrackSolver 已載入');
