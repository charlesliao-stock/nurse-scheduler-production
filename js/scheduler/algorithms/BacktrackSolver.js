// js/scheduler/algorithms/BacktrackSolver.js

const BacktrackSolver = {
    
    solve: function(assignments, gapList, staff, rules, dailyCount, daysInMonth, shiftTimeMap) {
        console.log(`🔄 回溯求解啟動，缺額數: ${gapList.length}`);
        
        const solved = [];
        const failed = [];
        
        for (let gap of gapList) {
            const candidates = this.findCandidates(gap, assignments, staff, rules, daysInMonth, shiftTimeMap);
            
            if (candidates.length > 0) {
                const chosen = candidates[0];
                const uid = chosen.uid || chosen.id;
                
                const oldShift = assignments[uid][`current_${gap.day}`];
                assignments[uid][`current_${gap.day}`] = gap.shift;
                
                dailyCount[gap.day][gap.shift] = (dailyCount[gap.day][gap.shift] || 0) + 1;
                if (oldShift && oldShift !== 'OFF' && oldShift !== 'REQ_OFF') {
                    dailyCount[gap.day][oldShift] = Math.max(0, (dailyCount[gap.day][oldShift] || 0) - 1);
                }
                
                solved.push(gap);
            } else {
                failed.push(gap);
            }
        }
        
        return { solved, failed };
    },
    
    findCandidates: function(gap, assignments, staff, rules, daysInMonth, shiftTimeMap) {
        const candidates = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            const currentShift = assignments[uid][`current_${gap.day}`];
            
            if (currentShift && currentShift !== 'OFF' && currentShift !== 'REQ_OFF') {
                continue;
            }
            
            const whitelist = WhitelistCalculator.calculate(
                person,
                assignments,
                gap.day,
                rules.year,
                rules.month,
                rules,
                {},
                daysInMonth,
                shiftTimeMap,
                rules.lastMonthData
            );
            
            if (whitelist.includes(gap.shift)) {
                candidates.push(person);
            }
        }
        
        candidates.sort((a, b) => {
            const uidA = a.uid || a.id;
            const uidB = b.uid || b.id;
            
            const offA = this.countOffDays(assignments, uidA, gap.day - 1);
            const offB = this.countOffDays(assignments, uidB, gap.day - 1);
            
            return offB - offA;
        });
        
        return candidates;
    },
    
    countOffDays: function(assignments, uid, upToDay) {
        let count = 0;
        for (let d = 1; d <= upToDay; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                count++;
            }
        }
        return count;
    },
    
    isValidSolution: function(assignments, staff, rules, daysInMonth, shiftTimeMap) {
        for (let person of staff) {
            const uid = person.uid || person.id;
            
            for (let day = 1; day <= daysInMonth; day++) {
                const shift = assignments[uid][`current_${day}`];
                if (!shift) continue;
                
                const whitelist = WhitelistCalculator.calculate(
                    person,
                    assignments,
                    day,
                    rules.year,
                    rules.month,
                    rules,
                    {},
                    daysInMonth,
                    shiftTimeMap,
                    rules.lastMonthData
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
