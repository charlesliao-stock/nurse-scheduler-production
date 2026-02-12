// js/scheduler/core/DataStructures.js

const DataStructures = {
    
    createStaffMember: function(data) {
        return {
            uid: data.uid || data.id || '',
            empId: data.empId || data.employeeId || '',
            name: data.name || data.displayName || '',
            level: data.level || 'N',
            group: data.group || data.groupId || '',
            isSupport: data.isSupport || false,
            schedulingParams: data.schedulingParams || {},
            preferences: data.preferences || {}
        };
    },
    
    createAssignment: function(uid) {
        return {
            preferences: {}
        };
    },
    
    createDailyNeed: function() {
        return {};
    },
    
    createShiftData: function(shift) {
        return {
            code: shift.code || '',
            name: shift.name || '',
            startTime: shift.startTime || '08:00',
            endTime: shift.endTime || '17:00',
            color: shift.color || '#333',
            duration: shift.duration || 8,
            isNight: shift.isNight || false,
            isEvening: shift.isEvening || false,
            isBundleAvailable: shift.isBundleAvailable || false,
            isScheduleAvailable: shift.isScheduleAvailable !== false,
            isPreScheduleAvailable: shift.isPreScheduleAvailable || false
        };
    },
    
    validateStaff: function(staff) {
        if (!staff.uid && !staff.id) {
            throw new Error('人員資料缺少 uid/id');
        }
        if (!staff.name && !staff.displayName) {
            throw new Error('人員資料缺少 name/displayName');
        }
        return true;
    },
    
    validateShift: function(shift) {
        if (!shift.code) {
            throw new Error('班別資料缺少 code');
        }
        if (!shift.startTime || !shift.endTime) {
            throw new Error('班別資料缺少時間資訊');
        }
        return true;
    },
    
    normalizeStaffList: function(staffList) {
        return staffList.map(staff => this.createStaffMember(staff));
    },
    
    normalizeShiftList: function(shiftList) {
        return shiftList.map(shift => this.createShiftData(shift));
    },
    
    cloneAssignments: function(assignments) {
        return JSON.parse(JSON.stringify(assignments));
    },
    
    mergeAssignments: function(target, source) {
        for (let uid in source) {
            if (!target[uid]) {
                target[uid] = {};
            }
            Object.assign(target[uid], source[uid]);
        }
        return target;
    },
    
    getAssignmentStats: function(assignments, daysInMonth) {
        const stats = {
            totalStaff: 0,
            totalAssignments: 0,
            offDays: 0,
            workDays: 0,
            emptyDays: 0
        };
        
        stats.totalStaff = Object.keys(assignments).length;
        
        for (let uid in assignments) {
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assignments[uid][key];
                
                if (val) {
                    stats.totalAssignments++;
                    if (val === 'OFF' || val === 'REQ_OFF') {
                        stats.offDays++;
                    } else {
                        stats.workDays++;
                    }
                } else {
                    stats.emptyDays++;
                }
            }
        }
        
        return stats;
    }
};

console.log('✅ DataStructures 已載入');
