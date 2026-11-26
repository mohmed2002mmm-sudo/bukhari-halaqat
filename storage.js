// =========================================================
// ملف التخزين السحابي - مشروع حلقات البخاري (storage.js)
// ملاحظة: يتم تمرير كائن supabase المهيأ مسبقاً من ملف التهيئة
// =========================================================

const COLOR_MAP = {
  green: { code: 'green', hex: '#16a34a' },
  yellow: { code: 'yellow', hex: '#eab308' },
  red: { code: 'red', hex: '#dc2626' },
};

function normalizeColor(statusColor) {
  return COLOR_MAP[statusColor] || COLOR_MAP.green;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isValidDateString(dateStr) {
  return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

function isValidAttendanceStatus(status) {
  return ['present', 'absent', 'late', 'excused'].includes(status);
}

function isValidSelectionType(type) {
  return ['ideal_halaqa', 'halaqat_knight', 'tajweed'].includes(type);
}

function createBukhariStorage(supabaseClient) {
  if (!supabaseClient || !supabaseClient.auth || !supabaseClient.from || !supabaseClient.rpc) {
    throw new Error('عميل Supabase غير مهيأ بشكل صحيح');
  }

  // -------------------------------------------------------
  // 1. المصادقة وملف الموظف الحالي
  // -------------------------------------------------------
  async function loginWithStaffId(staffId, password) {
    const cleanStaffId = cleanId(staffId);
    const cleanPassword = typeof password === 'string' ? password : '';

    if (!cleanStaffId || !cleanPassword) {
      throw new Error('يرجى إدخال رقم المعرف وكلمة المرور');
    }

    const internalEmail = `${cleanStaffId.toLowerCase()}@bukhari.local`;
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: internalEmail,
      password: cleanPassword,
    });

    if (error) {
      throw new Error('بيانات الدخول غير صحيحة أو الحساب مجمّد');
    }

    const profile = await getCurrentStaffProfile();
    return { session: data.session, profile };
  }

  async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    return true;
  }

  async function getCurrentStaffProfile() {
    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    const user = authData?.user;

    if (authError || !user) {
      throw new Error('يجب تسجيل الدخول أولاً');
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('staff_profiles')
      .select('user_id, staff_id, full_name, role, halaqa_id, is_active')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('تعذر العثور على ملف الموظف');
    }

    if (!profile.is_active) {
      throw new Error('الحساب مجمّد حالياً، يرجى مراجعة الإدارة');
    }

    return profile;
  }

  async function requireRole(allowedRoles) {
    const profile = await getCurrentStaffProfile();
    if (!allowedRoles.includes(profile.role)) {
      throw new Error('ليست لديك صلاحية لتنفيذ هذا الإجراء');
    }
    return profile;
  }

  // -------------------------------------------------------
  // 2. دوال الأدمن (الموظفين، الحلقات وربطها بالشيخ، الإحصائيات)
  // -------------------------------------------------------
  async function adminListStaff() {
    await requireRole(['admin']);
    const { data, error } = await supabaseClient
      .from('staff_profiles')
      .select('user_id, staff_id, full_name, role, halaqa_id, is_active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function adminCreateStaff({ staffId, fullName, role, password, halaqaId = null }) {
    await requireRole(['admin']);

    const cleanStaffId = cleanId(staffId);
    const cleanName = cleanText(fullName);
    const allowedRoles = ['admin', 'supervisor', 'teacher', 'monitor'];

    if (!cleanStaffId || !cleanName || !allowedRoles.includes(role)) {
      throw new Error('يرجى إدخال بيانات الموظف بشكل صحيح');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('كلمة المرور يجب أن تكون 6 أحرف أو أكثر');
    }

    const parsedHalaqaId = halaqaId ? Number(halaqaId) : null;

    const { data, error } = await supabaseClient.rpc('admin_create_staff', {
      p_staff_id: cleanStaffId,
      p_full_name: cleanName,
      p_role: role,
      p_password: password,
      p_halaqa_id: parsedHalaqaId,
    });

    if (error) throw error;
    return data;
  }

  async function adminUpdateStaffProfile(userId, { fullName, role, halaqaId = null }) {
    await requireRole(['admin']);

    const cleanName = cleanText(fullName);
    const allowedRoles = ['admin', 'supervisor', 'teacher', 'monitor'];

    if (!userId || !cleanName || !allowedRoles.includes(role)) {
      throw new Error('بيانات التعديل غير مكتملة');
    }

    const { data, error } = await supabaseClient
      .from('staff_profiles')
      .update({
        full_name: cleanName,
        role: role,
        halaqa_id: halaqaId ? Number(halaqaId) : null,
      })
      .eq('user_id', userId)
      .select('user_id, staff_id, full_name, role, halaqa_id, is_active')
      .single();

    if (error) throw error;
    return data;
  }

  async function adminToggleStaffFreeze(userId, freeze) {
    await requireRole(['admin']);
    if (!userId) throw new Error('معرف الموظف مطلوب');

    const { error } = await supabaseClient.rpc('admin_toggle_staff_freeze', {
      p_user_id: userId,
      p_freeze: Boolean(freeze),
    });

    if (error) throw error;
    return true;
  }

  async function adminDeleteStaff(userId) {
    await requireRole(['admin']);
    if (!userId) throw new Error('معرف الموظف مطلوب');

    const { error } = await supabaseClient.rpc('admin_delete_staff', {
      p_user_id: userId,
    });

    if (error) throw error;
    return true;
  }

  async function adminListHalaqat() {
    await requireRole(['admin']);
    const { data, error } = await supabaseClient
      .from('halaqat')
      .select('id, name, teacher_staff_id, created_at')
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function adminCreateHalaqa({ name, teacherStaffId = null }) {
    await requireRole(['admin']);
    const cleanName = cleanText(name);
    if (!cleanName) throw new Error('يرجى إدخال اسم الحلقة');

    const cleanTeacherId = teacherStaffId ? cleanId(teacherStaffId) : null;

    const { data, error } = await supabaseClient.rpc('admin_create_halaqa_with_teacher', {
      p_name: cleanName,
      p_teacher_staff_id: cleanTeacherId,
    });

    if (error) throw error;
    return data;
  }

  async function adminUpdateHalaqa(halaqaId, { name, teacherStaffId = null }) {
    await requireRole(['admin']);
    const cleanName = cleanText(name);
    if (!halaqaId || !cleanName) {
      throw new Error('يرجى تحديد الحلقة وإدخال اسمها');
    }

    const cleanTeacherId = teacherStaffId ? cleanId(teacherStaffId) : null;

    const { error } = await supabaseClient.rpc('admin_update_halaqa_teacher', {
      p_halaqa_id: Number(halaqaId),
      p_name: cleanName,
      p_teacher_staff_id: cleanTeacherId,
    });

    if (error) throw error;
    return true;
  }

  async function adminDeleteHalaqa(halaqaId) {
    await requireRole(['admin']);
    if (!halaqaId) throw new Error('معرف الحلقة مطلوب');

    const { error } = await supabaseClient
      .from('halaqat')
      .delete()
      .eq('id', Number(halaqaId));

    if (error) throw error;
    return true;
  }

  // قراءة نسب الغياب (للطلاب والموظفين) وعدد غياب الموظفين ونسبة السداد فقط
  async function adminGetSummaryStats() {
    await requireRole(['admin']);

    const [{ data: attendanceRows, error: attErr }, { data: paymentRows, error: payErr }] =
      await Promise.all([
        supabaseClient.from('attendance').select('person_type, person_id, status'),
        supabaseClient.from('payments').select('is_paid, amount_due, amount_paid'),
      ]);

    if (attErr) throw attErr;
    if (payErr) throw payErr;

    const attList = attendanceRows || [];
    const studentAtt = attList.filter((r) => r.person_type === 'student');
    const staffAtt = attList.filter((r) => r.person_type === 'staff');

    const studentAbsences = studentAtt.filter((r) => r.status === 'absent').length;
    const staffAbsencesCount = staffAtt.filter((r) => r.status === 'absent').length;

    const studentAbsenceRate =
      studentAtt.length > 0 ? Number(((studentAbsences / studentAtt.length) * 100).toFixed(1)) : 0;

    const staffAbsenceRate =
      staffAtt.length > 0 ? Number(((staffAbsencesCount / staffAtt.length) * 100).toFixed(1)) : 0;

    const payList = paymentRows || [];
    const paidCount = payList.filter((p) => Boolean(p.is_paid)).length;
    const paymentRate =
      payList.length > 0 ? Number(((paidCount / payList.length) * 100).toFixed(1)) : 0;

    return {
      studentAbsenceRate,
      staffAbsenceRate,
      staffAbsencesCount,
      paymentRate,
    };
  }

  // -------------------------------------------------------
  // 3. دوال الإداري (الطلاب، النقاط، الاختيارات، التحضير، الرسائل، التصفير)
  // -------------------------------------------------------
  async function supervisorListStudents() {
    await requireRole(['supervisor']);
    const { data, error } = await supabaseClient
      .from('students')
      .select('id, full_name, birth_date, status_color, guardian_phone, academic_stage, is_paid, points, halaqa_id')
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function supervisorAddStudent({
    id,
    fullName,
    birthDate = null,
    statusColor = 'green',
    guardianPhone = '',
    academicStage = '',
    isPaid = false,
    halaqaId = null,
  }) {
    await requireRole(['supervisor']);

    const cleanStudentId = cleanText(id);
    const cleanName = cleanText(fullName);
    const validColor = ['green', 'yellow', 'red', 'orange'].includes(statusColor)
      ? statusColor
      : 'green';

    if (!cleanStudentId || !cleanName) {
      throw new Error('رقم هوية الطالب واسمه مطلوبان');
    }

    const { data, error } = await supabaseClient
      .from('students')
      .insert({
        id: cleanStudentId,
        full_name: cleanName,
        birth_date: birthDate && isValidDateString(birthDate) ? birthDate : null,
        status_color: validColor,
        guardian_phone: cleanText(guardianPhone) || null,
        academic_stage: cleanText(academicStage) || null,
        is_paid: Boolean(isPaid),
        points: 0,
        halaqa_id: halaqaId ? Number(halaqaId) : null,
      })
      .select('id, full_name, birth_date, status_color, guardian_phone, academic_stage, is_paid, points, halaqa_id')
      .single();

    if (error) throw error;
    return data;
  }

  async function supervisorDeleteStudent(studentId) {
    await requireRole(['supervisor']);
    const cleanStudentId = cleanText(studentId);
    if (!cleanStudentId) throw new Error('رقم هوية الطالب مطلوب');

    const { error } = await supabaseClient
      .from('students')
      .delete()
      .eq('id', cleanStudentId);

    if (error) throw error;
    return true;
  }

  async function supervisorAdjustPoints({ studentId, pointsDelta, reason = '' }) {
    const profile = await requireRole(['supervisor']);
    const cleanStudentId = cleanText(studentId);
    const delta = Number(pointsDelta);

    if (!cleanStudentId || !Number.isInteger(delta) || delta === 0) {
      throw new Error('يرجى تحديد الطالب وإدخال قيمة نقاط صحيحة (موجبة أو سالبة)');
    }

    const { data, error } = await supabaseClient
      .from('student_points')
      .insert({
        student_id: cleanStudentId,
        points_delta: delta,
        reason: cleanText(reason) || null,
        recorded_by: profile.user_id,
      })
      .select('id, student_id, points_delta, reason, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async function supervisorAddSelection({ selectionType, halaqaId = null, studentId = null, periodDate = null, notes = '' }) {
    const profile = await requireRole(['supervisor']);

    if (!isValidSelectionType(selectionType)) {
      throw new Error('نوع الاختيار غير صحيح');
    }

    const dateVal = periodDate && isValidDateString(periodDate)
      ? periodDate
      : new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseClient
      .from('weekly_selections')
      .insert({
        selection_type: selectionType,
        halaqa_id: halaqaId ? Number(halaqaId) : null,
        student_id: studentId ? cleanText(studentId) : null,
        period_date: dateVal,
        notes: cleanText(notes) || null,
        selected_by: profile.user_id,
      })
      .select('id, selection_type, halaqa_id, student_id, period_date, notes, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async function supervisorMarkStudentAttendance({ studentId, halaqaId = null, status, recordDate = null, guardianMessage = '' }) {
    const profile = await requireRole(['supervisor']);
    const cleanStudentId = cleanText(studentId);

    if (!cleanStudentId || !isValidAttendanceStatus(status)) {
      throw new Error('بيانات التحضير غير صحيحة');
    }

    const dateVal = recordDate && isValidDateString(recordDate)
      ? recordDate
      : new Date().toISOString().split('T')[0];

    const { data: attRecord, error: attError } = await supabaseClient
      .from('attendance')
      .upsert(
        {
          record_date: dateVal,
          person_type: 'student',
          person_id: cleanStudentId,
          halaqa_id: halaqaId ? Number(halaqaId) : null,
          status: status,
          recorded_by: profile.user_id,
        },
        { onConflict: 'record_date,person_type,person_id' }
      )
      .select('id, record_date, person_id, status, created_at')
      .single();

    if (attError) throw attError;

    let messageRecord = null;
    const cleanMsg = cleanText(guardianMessage);
    if (cleanMsg) {
      const { data: studentRow } = await supabaseClient
        .from('students')
        .select('guardian_phone')
        .eq('id', cleanStudentId)
        .single();

      const { data: msgData, error: msgError } = await supabaseClient
        .from('guardian_messages')
        .insert({
          student_id: cleanStudentId,
          guardian_phone: studentRow?.guardian_phone || null,
          message_body: cleanMsg,
          delivery_status: 'queued',
          sent_by: profile.user_id,
        })
        .select('id, student_id, guardian_phone, message_body, delivery_status, created_at')
        .single();

      if (msgError) throw msgError;
      messageRecord = msgData;
    }

    return { attendance: attRecord, guardianMessage: messageRecord };
  }

  async function supervisorListStaffMessages() {
    await requireRole(['supervisor']);
    const { data, error } = await supabaseClient
      .from('teacher_messages')
      .select('id, teacher_user_id, sender_role, subject, message_body, reply_body, replied_at, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function supervisorReplyToMessage(messageId, replyBody) {
    const profile = await requireRole(['supervisor']);
    const cleanReply = cleanText(replyBody);

    if (!messageId || !cleanReply) {
      throw new Error('يرجى كتابة نص الرد أولاً');
    }

    const { data, error } = await supabaseClient
      .from('teacher_messages')
      .update({
        reply_body: cleanReply,
        replied_by: profile.user_id,
        replied_at: new Date().toISOString(),
      })
      .eq('id', Number(messageId))
      .select('id, message_body, reply_body, replied_at')
      .single();

    if (error) throw error;
    return data;
  }

  // نسب الحضور والغياب وتقدم النقاط للطلاب فقط
  async function supervisorGetStudentProgressStats() {
    await requireRole(['supervisor']);

    const [{ data: students, error: stuErr }, { data: attendance, error: attErr }] =
      await Promise.all([
        supabaseClient.from('students').select('id, full_name, points').order('points', { ascending: false }),
        supabaseClient.from('attendance').select('status').eq('person_type', 'student'),
      ]);

    if (stuErr) throw stuErr;
    if (attErr) throw attErr;

    const attList = attendance || [];
    const total = attList.length;
    const presentCount = attList.filter((r) => r.status === 'present').length;
    const absentCount = attList.filter((r) => r.status === 'absent').length;

    return {
      attendanceRate: total > 0 ? Number(((presentCount / total) * 100).toFixed(1)) : 0,
      absenceRate: total > 0 ? Number(((absentCount / total) * 100).toFixed(1)) : 0,
      studentsPointsProgress: (students || []).map((s) => ({
        id: s.id,
        full_name: s.full_name,
        points: s.points ?? 0,
      })),
    };
  }

  // تصفير شامل عند تصفير النقاط (النقاط + حضور/غياب/تأخير الطلاب + السداد يرجع لم يسدد)
  async function supervisorResetCycleWithPoints() {
    await requireRole(['supervisor', 'admin']);
    const { error } = await supabaseClient.rpc('reset_cycle_with_points');
    if (error) throw error;
    return true;
  }

  // -------------------------------------------------------
  // 4. دوال المشرف (monitor)
  // -------------------------------------------------------
  async function monitorListHalaqat() {
    await requireRole(['monitor', 'supervisor']);
    const { data, error } = await supabaseClient
      .from('halaqat')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // يعرض الاسم، النقاط، واللون فقط (بدون أي نصوص تشخيصية)
  async function monitorGetHalaqaStudents(halaqaId) {
    await requireRole(['monitor', 'supervisor']);
    if (!halaqaId) throw new Error('يرجى اختيار حلقة أولاً');

    const { data, error } = await supabaseClient.rpc('get_halaqa_students_color_only', {
      p_halaqa_id: Number(halaqaId),
    });

    if (error) throw error;

    return (data || []).map((row) => {
      const colorMeta = normalizeColor(row.status_color);
      return {
        full_name: row.full_name,
        points: row.points ?? 0,
        status_color: colorMeta.code,
        color_hex: colorMeta.hex,
      };
    });
  }

  // -------------------------------------------------------
  // 5. دوال المعلم (teacher)
  // -------------------------------------------------------
  // يعرض اسم الحلقة وتحتها الطلاب: الاسم، رقم ولي الأمر، واللون فقط
  async function teacherGetMyHalaqaAndStudents() {
    await requireRole(['teacher']);

    const { data, error } = await supabaseClient.rpc('get_teacher_halaqa_and_students');
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) {
      return { halaqa: null, students: [] };
    }

    const first = rows[0];
    const students = rows
      .filter((r) => Boolean(r.student_name))
      .map((r) => {
        const colorMeta = normalizeColor(r.status_color);
        return {
          full_name: r.student_name,
          guardian_phone: r.guardian_phone || '',
          status_color: colorMeta.code,
          color_hex: colorMeta.hex,
        };
      });

    return {
      halaqa: {
        id: first.halaqa_id,
        name: first.halaqa_name,
        teacher_name: first.teacher_name,
      },
      students,
    };
  }

  // -------------------------------------------------------
  // 6. دوال مشتركة لحضور الموظف ورسائله للإدارة (مشرف / معلم / إداري)
  // -------------------------------------------------------
  async function recordOwnStaffAttendance(status, recordDate = null) {
    const profile = await getCurrentStaffProfile();
    if (!isValidAttendanceStatus(status)) {
      throw new Error('حالة الحضور غير صحيحة');
    }

    const dateVal = recordDate && isValidDateString(recordDate)
      ? recordDate
      : new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseClient
      .from('attendance')
      .upsert(
        {
          record_date: dateVal,
          person_type: 'staff',
          person_id: profile.staff_id,
          status: status,
          recorded_by: profile.user_id,
        },
        { onConflict: 'record_date,person_type,person_id' }
      )
      .select('id, record_date, status, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async function sendMessageToAdministration(messageBody, subject = '') {
    const profile = await getCurrentStaffProfile();
    const cleanBody = cleanText(messageBody);
    if (!cleanBody) {
      throw new Error('يرجى كتابة نص الرسالة قبل الإرسال');
    }

    const { data, error } = await supabaseClient
      .from('teacher_messages')
      .insert({
        teacher_user_id: profile.user_id,
        sender_role: profile.role,
        subject: cleanText(subject) || `رسالة من ${profile.full_name}`,
        message_body: cleanBody,
      })
      .select('id, subject, message_body, reply_body, replied_at, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async function listMySentMessages() {
    const profile = await getCurrentStaffProfile();
    const { data, error } = await supabaseClient
      .from('teacher_messages')
      .select('id, subject, message_body, reply_body, replied_at, created_at')
      .eq('teacher_user_id', profile.user_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  return {
    loginWithStaffId,
    logout,
    getCurrentStaffProfile,
    adminListStaff,
    adminCreateStaff,
    adminUpdateStaffProfile,
    adminToggleStaffFreeze,
    adminDeleteStaff,
    adminListHalaqat,
    adminCreateHalaqa,
    adminUpdateHalaqa,
    adminDeleteHalaqa,
    adminGetSummaryStats,
    supervisorListStudents,
    supervisorAddStudent,
    supervisorDeleteStudent,
    supervisorAdjustPoints,
    supervisorAddSelection,
    supervisorMarkStudentAttendance,
    supervisorListStaffMessages,
    supervisorReplyToMessage,
    supervisorGetStudentProgressStats,
    supervisorResetCycleWithPoints,
    monitorListHalaqat,
    monitorGetHalaqaStudents,
    teacherGetMyHalaqaAndStudents,
    recordOwnStaffAttendance,
    sendMessageToAdministration,
    listMySentMessages,
  };
}

if (typeof window !== 'undefined') {
  window.createBukhariStorage = createBukhariStorage;
}
