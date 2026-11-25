const CLOUD_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxFKEta1EzCCXuoTkVjPmeedMx2i9gHv2Zw2M9FCsEmwR_oAGi4wKaHcPoarp0Dll3r/exec";

const SHEETS_12 = {
    STUDENTS: "students",
    EMPLOYEES: "employees",
    RINGS: "rings",
    ATTENDANCE: "attendance",
    POINTS: "points",
    STAFF_ATTENDANCE: "staff_attendance",
    MESSAGES: "messages",
    ACTIVITY_LOG: "activity_log",
    STAGE_PROGRESS: "stages",
    IDEAL_RING: "ideal_ring",
    RING_KNIGHT: "ring_knight",
    TAJWEED: "tajweed"
};

const SHEET_HEADERS_12 = {
    [SHEETS_12.STUDENTS]: ["ringName", "teacherName", "name", "parentPhone", "identity", "ageBirth", "grade", "status", "paymentStatus", "points"],
    [SHEETS_12.EMPLOYEES]: ["fullname", "username", "password", "role", "status"],
    [SHEETS_12.RINGS]: ["ringName", "teacherName", "studentsCount", "points"],
    [SHEETS_12.ATTENDANCE]: ["ringName", "studentName", "status", "absentDays", "date"],
    [SHEETS_12.POINTS]: ["ringName", "studentName", "points", "date"],
    [SHEETS_12.STAFF_ATTENDANCE]: ["key", "value", "date"],
    [SHEETS_12.MESSAGES]: ["teacher", "text", "time", "date"],
    [SHEETS_12.ACTIVITY_LOG]: ["date", "time", "action", "actor", "details"],
    [SHEETS_12.STAGE_PROGRESS]: ["studentName", "completedStage", "nextStage"],
    [SHEETS_12.IDEAL_RING]: ["ringName", "date"],
    [SHEETS_12.RING_KNIGHT]: ["ringName", "studentName", "date"],
    [SHEETS_12.TAJWEED]: ["ringName", "date"]
};

function getLocalDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function getLocalTimeStr() {
    return new Date().toLocaleTimeString("ar-SA");
}

function normalizeRingKey(name) {
    return String(name || "")
        .trim()
        .replace(/^حلقة\s+/, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function appendActivityLog(action, actor, details) {
    try {
        const logs = JSON.parse(localStorage.getItem("mamma_activity_logs") || "[]");
        logs.unshift({
            date: getLocalDateStr(),
            time: getLocalTimeStr(),
            action: action || "",
            actor: actor || localStorage.getItem("current_user_name") || "النظام",
            details: details || ""
        });
        localStorage.setItem("mamma_activity_logs", JSON.stringify(logs.slice(0, 500)));
    } catch (e) {
        console.error("خطأ في حفظ سجل النشاط المحلي:", e);
    }
}

async function postToCloud(payload) {
    if (!CLOUD_WEB_APP_URL || CLOUD_WEB_APP_URL.includes("PASTE_")) {
        return { ok: false, error: "رابط السكربت السحابي غير محدد" };
    }
    try {
        await fetch(CLOUD_WEB_APP_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        return { ok: true };
    } catch (err) {
        console.error("فشل الإرسال إلى Google Sheets:", err);
        return { ok: false, error: err };
    }
}

function detectTargetSheet(action) {
    const act = String(action || "").trim();
    if (act.includes("دوام") || (act.includes("حضور") && (act.includes("إداري") || act.includes("مدير") || act.includes("موظف") || act.includes("معلم"))) || (act.includes("غياب") && (act.includes("إداري") || act.includes("مدير") || act.includes("موظف") || act.includes("معلم")))) {
        return SHEETS_12.STAFF_ATTENDANCE;
    }
    if (act.includes("حضور") || act.includes("غياب") || act.includes("تحضير")) {
        return SHEETS_12.ATTENDANCE;
    }
    if (act.includes("حلقة")) return SHEETS_12.RINGS;
    if (act.includes("طالب")) return SHEETS_12.STUDENTS;
    if (act.includes("موظف") || act.includes("معلم") || act.includes("صلاحية") || act.includes("تجميد") || act.includes("تنشيط")) {
        return SHEETS_12.EMPLOYEES;
    }
    if (act.includes("نقاط") || act.includes("تصفير")) return SHEETS_12.POINTS;
    if (act.includes("رسالة") || act.includes("بلاغ") || act.includes("رد الإدارة")) return SHEETS_12.MESSAGES;
    if (act.includes("مرحلة") || act.includes("مراحل")) return SHEETS_12.STAGE_PROGRESS;
    if (act.includes("الحلقة المثالية")) return SHEETS_12.IDEAL_RING;
    if (act.includes("فارس الحلقة") || act.includes("فارس")) return SHEETS_12.RING_KNIGHT;
    if (act.includes("تجويد")) return SHEETS_12.TAJWEED;
    return SHEETS_12.ACTIVITY_LOG;
}

function buildRingsSummaryRows(rings) {
    return (Array.isArray(rings) ? rings : []).map(ring => {
        const stList = Array.isArray(ring.studentsData) ? ring.studentsData : [];
        const totalPoints = stList.reduce((sum, st) => sum + Number(st.points || 0), 0);
        return {
            ringName: ring.name || "",
            teacherName: ring.teacher || "",
            studentsCount: stList.length,
            points: totalPoints
        };
    });
}

async function syncToCloud(action, actor, details, extraData = {}) {
    const user = actor || localStorage.getItem("current_user_name") || "مستخدم";
    const detailText = typeof details === "string" ? details : JSON.stringify(details || {});
    const targetSheet = extraData.sheet || detectTargetSheet(action);

    appendActivityLog(action, user, detailText);

    const payload = {
        mode: "sync_action",
        sheet: targetSheet,
        headers: SHEET_HEADERS_12[targetSheet] || [],
        action: action || "",
        actor: user,
        details: detailText,
        date: getLocalDateStr(),
        time: getLocalTimeStr(),
        data: extraData.data || extraData
    };

    await postToCloud(payload);

    if (targetSheet !== SHEETS_12.ACTIVITY_LOG) {
        await postToCloud({
            mode: "sync_action",
            sheet: SHEETS_12.ACTIVITY_LOG,
            headers: SHEET_HEADERS_12[SHEETS_12.ACTIVITY_LOG],
            action: action || "",
            actor: user,
            details: detailText,
            date: getLocalDateStr(),
            time: getLocalTimeStr()
        });
    }
}

async function exportAllDataToCloud() {
    const rings = JSON.parse(localStorage.getItem("mamma_rings") || "[]");
    const employees = JSON.parse(localStorage.getItem("mamma_employees") || "[]");
    const messages = JSON.parse(localStorage.getItem("teachers_messages") || "[]");
    const activityLogs = JSON.parse(localStorage.getItem("mamma_activity_logs") || "[]");
    const stageProgress = JSON.parse(localStorage.getItem("mamma_stage_progress") || "[]");
    const idealRings = JSON.parse(localStorage.getItem("mamma_ideal_rings") || "[]");
    const ringKnights = JSON.parse(localStorage.getItem("mamma_ring_knights") || "[]");
    const tajweedEntries = JSON.parse(localStorage.getItem("mamma_tajweed_entries") || "[]");

    const studentsRows = [];
    const absenceRows = [];
    const pointsRows = [];

    rings.forEach(ring => {
        const ringName = ring.name || "";
        const teacherName = ring.teacher || "";
        const stList = Array.isArray(ring.studentsData) ? ring.studentsData : [];

        stList.forEach(st => {
            studentsRows.push({
                ringName,
                teacherName,
                name: st.name || "",
                parentPhone: st.parentPhone || "",
                identity: st.identity || "",
                ageBirth: st.ageBirth || "",
                grade: st.grade || "",
                status: st.status || "أخضر",
                paymentStatus: st.paymentStatus || "لم يسدد",
                points: Number(st.points || 0)
            });

            pointsRows.push({
                ringName,
                studentName: st.name || "",
                points: Number(st.points || 0),
                date: getLocalDateStr()
            });

            if (Number(st.absentDays || 0) > 0 || st.attendanceStatus === "غائب") {
                absenceRows.push({
                    ringName,
                    studentName: st.name || "",
                    status: st.attendanceStatus || "غائب",
                    absentDays: Number(st.absentDays || 1),
                    date: getLocalDateStr()
                });
            }
        });
    });

    const ringsRows = buildRingsSummaryRows(rings);

    const staffAttendanceRows = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
            k.startsWith("admin_start_time_") ||
            k.startsWith("admin_end_time_") ||
            k.startsWith("manager_start_time_") ||
            k.startsWith("manager_end_time_") ||
            k.startsWith("manager_present_") ||
            k.startsWith("manager_absent_")
        ) {
            staffAttendanceRows.push({
                key: k,
                value: localStorage.getItem(k),
                date: getLocalDateStr()
            });
        }
    }

    const bundle = {
        [SHEETS_12.STUDENTS]: studentsRows,
        [SHEETS_12.EMPLOYEES]: employees,
        [SHEETS_12.RINGS]: ringsRows,
        [SHEETS_12.ATTENDANCE]: absenceRows,
        [SHEETS_12.POINTS]: pointsRows,
        [SHEETS_12.STAFF_ATTENDANCE]: staffAttendanceRows,
        [SHEETS_12.MESSAGES]: messages,
        [SHEETS_12.ACTIVITY_LOG]: activityLogs,
        [SHEETS_12.STAGE_PROGRESS]: stageProgress,
        [SHEETS_12.IDEAL_RING]: idealRings,
        [SHEETS_12.RING_KNIGHT]: ringKnights,
        [SHEETS_12.TAJWEED]: tajweedEntries
    };

    return await postToCloud({
        mode: "export_all",
        date: getLocalDateStr(),
        time: getLocalTimeStr(),
        headers: SHEET_HEADERS_12,
        sheets: bundle,
        rings: rings
    });
}

async function importAllDataFromCloud(options = { reloadPage: false }) {
    if (!CLOUD_WEB_APP_URL || CLOUD_WEB_APP_URL.includes("PASTE_")) {
        return { ok: false, error: "رابط السكربت السحابي غير محدد" };
    }

    try {
        const sep = CLOUD_WEB_APP_URL.includes("?") ? "&" : "?";
        const res = await fetch(`${CLOUD_WEB_APP_URL}${sep}action=import_all&t=${Date.now()}`);
        const json = await res.json();

        if (!json || !json.ok || !json.data) {
            return { ok: false, error: "تعذر قراءة البيانات من السحابة" };
        }

        const d = json.data;

        if (Array.isArray(d[SHEETS_12.EMPLOYEES])) {
            localStorage.setItem("mamma_employees", JSON.stringify(d[SHEETS_12.EMPLOYEES]));
        }

        if (Array.isArray(d[SHEETS_12.MESSAGES])) {
            localStorage.setItem("teachers_messages", JSON.stringify(d[SHEETS_12.MESSAGES]));
        }

        if (Array.isArray(d[SHEETS_12.ACTIVITY_LOG])) {
            localStorage.setItem("mamma_activity_logs", JSON.stringify(d[SHEETS_12.ACTIVITY_LOG]));
        }

        if (Array.isArray(d[SHEETS_12.STAGE_PROGRESS])) {
            localStorage.setItem("mamma_stage_progress", JSON.stringify(d[SHEETS_12.STAGE_PROGRESS]));
        }

        if (Array.isArray(d[SHEETS_12.IDEAL_RING])) {
            localStorage.setItem("mamma_ideal_rings", JSON.stringify(d[SHEETS_12.IDEAL_RING]));
        }

        if (Array.isArray(d[SHEETS_12.RING_KNIGHT])) {
            localStorage.setItem("mamma_ring_knights", JSON.stringify(d[SHEETS_12.RING_KNIGHT]));
        }

        if (Array.isArray(d[SHEETS_12.TAJWEED])) {
            localStorage.setItem("mamma_tajweed_entries", JSON.stringify(d[SHEETS_12.TAJWEED]));
        }

        const absenceByStudent = {};
        if (Array.isArray(d[SHEETS_12.ATTENDANCE])) {
            const importedAttendanceLogs = d[SHEETS_12.ATTENDANCE].map(row => ({
                ringName: row.ringName || row.ring || "",
                studentName: row.studentName || row.name || "",
                status: row.status || "غائب",
                date: row.date || getLocalDateStr()
            }));
            localStorage.setItem("mamma_student_attendance", JSON.stringify(importedAttendanceLogs.slice(0, 1000)));

            d[SHEETS_12.ATTENDANCE].forEach(row => {
                const rKey = normalizeRingKey(row.ringName || row.ring || "");
                const sName = String(row.studentName || row.name || "").trim();
                if (!sName) return;
                const mapKey = `${rKey}__${sName}`;
                const st = String(row.status || "غائب").trim();
                const days = Number(row.absentDays || 1);
                if (!absenceByStudent[mapKey]) {
                    absenceByStudent[mapKey] = { status: st, absentDays: 0 };
                }
                absenceByStudent[mapKey].status = st;
                if (st === "غائب" || st === "غائب بعذر") {
                    absenceByStudent[mapKey].absentDays += days;
                }
            });
        }

        if (Array.isArray(d[SHEETS_12.STAFF_ATTENDANCE])) {
            const staffLogs = [];
            d[SHEETS_12.STAFF_ATTENDANCE].forEach(row => {
                if (row && typeof row.key === "string" && row.key.length > 0) {
                    localStorage.setItem(row.key, row.value || "");
                } else if (row && (row.name || row.employee)) {
                    staffLogs.push({
                        name: row.name || row.employee,
                        role: row.role || "موظف",
                        status: row.status || "حاضر",
                        date: row.date || getLocalDateStr(),
                        time: row.time || ""
                    });
                }
            });
            if (staffLogs.length > 0) {
                localStorage.setItem("mamma_employees_attendance", JSON.stringify(staffLogs.slice(0, 1000)));
            }
        }

        const existingRings = JSON.parse(localStorage.getItem("mamma_rings") || "[]");
        const existingTeacherByRing = {};
        existingRings.forEach(r => {
            if (r && r.name) {
                existingTeacherByRing[normalizeRingKey(r.name)] = r.teacher || "";
            }
        });

        const pointsByStudent = {};
        if (Array.isArray(d[SHEETS_12.POINTS])) {
            d[SHEETS_12.POINTS].forEach(p => {
                const key = `${normalizeRingKey(p.ringName || "")}__${String(p.studentName || "").trim()}`;
                pointsByStudent[key] = Number(p.points || 0);
            });
        }

        const ringsMap = {};

        if (Array.isArray(d[SHEETS_12.RINGS])) {
            d[SHEETS_12.RINGS].forEach(rg => {
                const rawRingName = String(rg.ringName || rg.name || "").trim();
                if (!rawRingName) return;
                const normKey = normalizeRingKey(rawRingName);
                ringsMap[normKey] = {
                    name: rawRingName,
                    teacher: rg.teacherName || rg.teacher || existingTeacherByRing[normKey] || "",
                    attendanceRate: "95%",
                    absenceRate: "5%",
                    totalPoints: `${Number(rg.points || 0)} نقطة`,
                    studentsCount: `${Number(rg.studentsCount || 0)} طالباً`,
                    studentsData: []
                };
            });
        }

        if (Array.isArray(d[SHEETS_12.STUDENTS])) {
            d[SHEETS_12.STUDENTS].forEach(st => {
                const rawRingName = String(st.ringName || "").trim();
                if (!rawRingName) return;

                const normKey = normalizeRingKey(rawRingName);
                if (!ringsMap[normKey]) {
                    ringsMap[normKey] = {
                        name: rawRingName,
                        teacher: st.teacherName || existingTeacherByRing[normKey] || "",
                        attendanceRate: "95%",
                        absenceRate: "5%",
                        totalPoints: "0 نقطة",
                        studentsCount: "0 طالباً",
                        studentsData: []
                    };
                } else if (st.teacherName && !ringsMap[normKey].teacher) {
                    ringsMap[normKey].teacher = st.teacherName;
                }

                const studentName = String(st.name || "").trim();
                if (!studentName) return;

                const ptKey = `${normKey}__${studentName}`;
                const absInfo = absenceByStudent[ptKey];

                const importedStudent = {
                    name: studentName,
                    parentPhone: st.parentPhone || "",
                    identity: st.identity || "",
                    ageBirth: st.ageBirth || "",
                    grade: st.grade || "",
                    status: st.status || "أخضر",
                    paymentStatus: st.paymentStatus || "لم يسدد",
                    attendanceStatus: absInfo ? absInfo.status : (st.attendanceStatus || "حاضر"),
                    absentDays: absInfo ? absInfo.absentDays : Number(st.absentDays || 0),
                    points: pointsByStudent[ptKey] !== undefined ? pointsByStudent[ptKey] : Number(st.points || 0)
                };

                const existingIdx = ringsMap[normKey].studentsData.findIndex(
                    item => String(item.name || "").trim() === studentName
                );
                if (existingIdx !== -1) {
                    ringsMap[normKey].studentsData[existingIdx] = importedStudent;
                } else {
                    ringsMap[normKey].studentsData.push(importedStudent);
                }
            });
        }

        const syncedRings = Object.values(ringsMap).map(r => {
            const stArr = r.studentsData || [];
            const computedPoints = stArr.reduce((acc, s) => acc + Number(s.points || 0), 0);
            return {
                ...r,
                studentsCount: `${stArr.length} طالباً`,
                totalPoints: `${stArr.length > 0 ? computedPoints : parseInt(r.totalPoints, 10) || 0} نقطة`
            };
        });

        localStorage.setItem("mamma_rings", JSON.stringify(syncedRings));

        if (options && options.reloadPage) {
            window.location.reload();
        }

        return { ok: true, data: d };
    } catch (err) {
        console.error("فشل الاستيراد من Google Sheets:", err);
        return { ok: false, error: err };
    }
}
```[cite: 7, 8]

احفظه كـ `storage.js` في مشروعك وأعد رفع الموقع، وبكذا يصير متطابق تماماً مع الرابط الجديد.