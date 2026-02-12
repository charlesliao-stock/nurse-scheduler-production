// js/scheduler/algorithms/BalanceAdjuster.js

const BalanceAdjuster = {
    
    adjust: function(assignments, staff, rules, daysInMonth, shiftTimeMap) {
        const segments = rules.aiParams?.balancingSegments || 1;
        const rounds = rules.fairness?.balanceRounds || 100;
        
        console.log(`⚖️ 平衡調整啟動: ${segments} 段, ${rounds} 輪`);
        
        if (segments === 1) {
            return this.adjustFullMonth(assignments, staff, rules, daysInMonth, shiftTimeMap, rounds);
        } else {
            return this.adjustBySegments(assignments, staff, rules, daysInMonth, shiftTimeMap, segments, rounds);
        }
    },
    
    adjustFullMonth: function(assignments, staff, rules, daysInMonth, shiftTimeMap, maxRounds) {
        let improved = 0;
        
        for (let round = 0; round < maxRounds; round++) {
            const stats = this.calculateOffStats(assignments, staff, daysInMonth);
            
            if (stats.stdDev < 1.0) {
                console.log(`✅ 平衡已達標準 (SD: ${stats.stdDev.toFixed(2)})`);
                break;
            }
            
            const swapped = this.trySwapOff(assignments, staff, stats, rules, daysInMonth, shiftTimeMap);
            
            if (!swapped) break;
            
            improved++;
        }
        
        console.log(`✅ 平衡調整完成: ${improved} 次改善`);
        return { improved: improved };
    },
    
    adjustBySegments: function(assignments, staff, rules, daysInMonth, shiftTimeMap, segments, maxRounds) {
        const segmentSize = Math.ceil(daysInMonth / segments);
        let totalImproved = 0;
        
        for (let seg = 0; seg < segments; seg++) {
            const startDay = seg * segmentSize + 1;
            const endDay = Math.min((seg + 1) * segmentSize, daysInMonth);
            
            console.log(`⚖️ 調整第 ${seg + 1} 段: 第 ${startDay}-${endDay} 日`);
            
            const result = this.adjustSegment(
                assignments, 
                staff, 
                rules, 
                startDay, 
                endDay, 
                daysInMonth, 
                shiftTimeMap, 
                maxRounds
            );
            
            totalImproved += result.improved;
        }
        
        console.log(`✅ 分段調整完成: 共 ${totalImproved} 次改善`);
        return { improved: totalImproved };
    },
    
    adjustSegment: function(assignments, staff, rules, startDay, endDay, daysInMonth, shiftTimeMap, maxRounds) {
        let improved = 0;
        
        for (let round = 0; round < maxRounds; round++) {
            const stats = this.calculateOffStatsInRange(assignments, staff, startDay, endDay);
            
            if (stats.stdDev < 1.0) break;
            
            const swapped = this.trySwapOffInRange(
                assignments, 
                staff, 
                stats, 
                rules, 
                startDay, 
                endDay, 
                daysInMonth, 
                shiftTimeMap
            );
            
            if (!swapped) break;
            
            improved++;
        }
        
        return { improved: improved };
    },
    
    calculateOffStats: function(assignments, staff, daysInMonth) {
        const offCounts = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            let count = 0;
            
            for (let day = 1; day <= daysInMonth; day++) {
                const shift = assignments[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    count++;
                }
            }
            
            offCounts.push(count);
        }
        
        const mean = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / offCounts.length;
        const stdDev = Math.sqrt(variance);
        
        return {
            mean: mean,
            stdDev: stdDev,
            min: Math.min(...offCounts),
            max: Math.max(...offCounts)
        };
    },
    
    calculateOffStatsInRange: function(assignments, staff, startDay, endDay) {
        const offCounts = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            let count = 0;
            
            for (let day = startDay; day <= endDay; day++) {
                const shift = assignments[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    count++;
                }
            }
            
            offCounts.push(count);
        }
        
        const mean = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / offCounts.length;
        const stdDev = Math.sqrt(variance);
        
        return {
            mean: mean,
            stdDev: stdDev,
            min: Math.min(...offCounts),
            max: Math.max(...offCounts)
        };
    },
    
    trySwapOff: function(assignments, staff, stats, rules, daysInMonth, shiftTimeMap) {
        const richPeople = [];
        const poorPeople = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            let offCount = 0;
            
            for (let day = 1; day <= daysInMonth; day++) {
                const shift = assignments[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    offCount++;
                }
            }
            
            if (offCount > stats.mean + 0.5) {
                richPeople.push({ person: person, offCount: offCount });
            } else if (offCount < stats.mean - 0.5) {
                poorPeople.push({ person: person, offCount: offCount });
            }
        }
        
        for (let rich of richPeople) {
            for (let poor of poorPeople) {
                if (this.attemptSwap(rich.person, poor.person, assignments, rules, daysInMonth, shiftTimeMap)) {
                    return true;
                }
            }
        }
        
        return false;
    },
    
    trySwapOffInRange: function(assignments, staff, stats, rules, startDay, endDay, daysInMonth, shiftTimeMap) {
        const richPeople = [];
        const poorPeople = [];
        
        for (let person of staff) {
            const uid = person.uid || person.id;
            let offCount = 0;
            
            for (let day = startDay; day <= endDay; day++) {
                const shift = assignments[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    offCount++;
                }
            }
            
            if (offCount > stats.mean + 0.5) {
                richPeople.push({ person: person, offCount: offCount });
            } else if (offCount < stats.mean - 0.5) {
                poorPeople.push({ person: person, offCount: offCount });
            }
        }
        
        for (let rich of richPeople) {
            for (let poor of poorPeople) {
                if (this.attemptSwapInRange(
                    rich.person, 
                    poor.person, 
                    assignments, 
                    rules, 
                    startDay, 
                    endDay, 
                    daysInMonth, 
                    shiftTimeMap
                )) {
                    return true;
                }
            }
        }
        
        return false;
    },
    
    attemptSwap: function(richPerson, poorPerson, assignments, rules, daysInMonth, shiftTimeMap) {
        const richUid = richPerson.uid || richPerson.id;
        const poorUid = poorPerson.uid || poorPerson.id;
        
        for (let day = 1; day <= daysInMonth; day++) {
            const richShift = assignments[richUid]?.[`current_${day}`];
            const poorShift = assignments[poorUid]?.[`current_${day}`];
            
            if ((richShift === 'OFF' || richShift === 'REQ_OFF') && 
                poorShift && poorShift !== 'OFF' && poorShift !== 'REQ_OFF') {
                
                if (this.canSwap(richPerson, poorPerson, day, poorShift, assignments, rules, daysInMonth, shiftTimeMap)) {
                    assignments[richUid][`current_${day}`] = poorShift;
                    assignments[poorUid][`current_${day}`] = 'OFF';
                    return true;
                }
            }
        }
        
        return false;
    },
    
    attemptSwapInRange: function(richPerson, poorPerson, assignments, rules, startDay, endDay, daysInMonth, shiftTimeMap) {
        const richUid = richPerson.uid || richPerson.id;
        const poorUid = poorPerson.uid || poorPerson.id;
        
        for (let day = startDay; day <= endDay; day++) {
            const richShift = assignments[richUid]?.[`current_${day}`];
            const poorShift = assignments[poorUid]?.[`current_${day}`];
            
            if ((richShift === 'OFF' || richShift === 'REQ_OFF') && 
                poorShift && poorShift !== 'OFF' && poorShift !== 'REQ_OFF') {
                
                if (this.canSwap(richPerson, poorPerson, day, poorShift, assignments, rules, daysInMonth, shiftTimeMap)) {
                    assignments[richUid][`current_${day}`] = poorShift;
                    assignments[poorUid][`current_${day}`] = 'OFF';
                    return true;
                }
            }
        }
        
        return false;
    },
    
    canSwap: function(richPerson, poorPerson, day, shift, assignments, rules, daysInMonth, shiftTimeMap) {
        const richUid = richPerson.uid || richPerson.id;
        const poorUid = poorPerson.uid || poorPerson.id;
        
        // 【核心修正】平衡調整必須同時滿足：
        // 1. HardRuleValidator (勞基法/硬性規則)
        // 2. WhitelistCalculator (包班/志願/白名單)

        // 檢查 richPerson 是否可以從 OFF 改為排 shift 班
        const richWhitelist = WhitelistCalculator.calculate(
            richPerson,
            assignments,
            day,
            rules.year,
            rules.month,
            rules,
            {}, // dailyCount 在此階段僅作參考，傳空物件
            daysInMonth,
            shiftTimeMap
        );
        
        if (!richWhitelist.includes(shift)) return false;

        // 檢查 poorPerson 是否可以從 shift 改為排 OFF
        const poorWhitelist = WhitelistCalculator.calculate(
            poorPerson,
            assignments,
            day,
            rules.year,
            rules.month,
            rules,
            {}, 
            daysInMonth,
            shiftTimeMap
        );
        
        if (!poorWhitelist.includes('OFF') && !poorWhitelist.includes('REQ_OFF')) return false;
        
        return true;
    }
};

console.log('✅ BalanceAdjuster 已載入');
