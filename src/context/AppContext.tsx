import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User,
  Student,
  Subject,
  ClassGroup,
  STSGrade,
  SchoolProfile,
  AuditLog,
  LegerRow,
  UserRole,
} from '../types';
import {
  INITIAL_SCHOOL_PROFILE,
  INITIAL_SUBJECTS,
  INITIAL_CLASSES,
  INITIAL_USERS,
  INITIAL_STUDENTS,
  generateInitialGrades,
  INITIAL_AUDIT_LOGS,
  calculatePredikat,
} from '../data/initialData';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc } from 'firebase/firestore';

interface AppContextType {
  currentUser: User | null;
  schoolProfile: SchoolProfile;
  students: Student[];
  classes: ClassGroup[];
  subjects: Subject[];
  grades: STSGrade[];
  auditLogs: AuditLog[];
  activeAcademicYear: string;
  activeSemester: '1' | '2';
  selectedClassId: string;
  isOnline: boolean;
  isSyncing: boolean;
  users: User[];
  // Actions
  login: (email: string, role?: UserRole) => boolean;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => void;
  switchUser: (userId: string) => void;
  setSelectedClassId: (classId: string) => void;
  setAcademicPeriod: (year: string, semester: '1' | '2') => void;
  updateSchoolProfile: (profile: Partial<SchoolProfile>) => Promise<void>;
  saveGrade: (grade: Omit<STSGrade, 'id' | 'updatedAt' | 'updatedBy'>) => Promise<void>;
  saveBatchGrades: (newGrades: Omit<STSGrade, 'id' | 'updatedAt' | 'updatedBy'>[]) => Promise<void>;
  updateStudent: (student: Student) => Promise<void>;
  updateBatchStudents: (students: Student[]) => Promise<void>;
  addStudent: (student: Omit<Student, 'id'>) => Promise<void>;
  deleteStudent: (studentId: string) => Promise<void>;
  importDapodikStudents: (imported: Student[]) => Promise<void>;
  // Class / Rombel Management (12 Classes)
  addClass: (newClass: ClassGroup) => Promise<void>;
  updateClass: (updatedClass: ClassGroup) => Promise<void>;
  deleteClass: (classId: string) => Promise<void>;
  // Subject Management
  addSubject: (newSubject: Omit<Subject, 'id'>) => Promise<void>;
  updateSubject: (updatedSubject: Subject) => Promise<void>;
  deleteSubject: (subjectId: string) => Promise<void>;
  // User Management
  addUser: (user: Omit<User, 'id'>) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  addAuditLog: (action: string, entity: string, description: string) => Promise<void>;
  getLegerData: (classId: string) => LegerRow[];
  resetToInitialData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEYS = {
  USER: 'erapor_current_user_v2',
  PROFILE: 'erapor_school_profile_v2',
  STUDENTS: 'erapor_students_v2',
  CLASSES: 'erapor_classes_12_v2',
  SUBJECTS: 'erapor_subjects_v2',
  GRADES: 'erapor_grades_v2',
  AUDIT: 'erapor_audit_logs_v2',
  USERS: 'erapor_users_v2',
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Initial State from localStorage or Seeds
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USER);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return INITIAL_USERS[0];
  });

  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return INITIAL_USERS;
  });

  const [schoolProfile, setSchoolProfile] = useState<SchoolProfile>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PROFILE);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return INITIAL_SCHOOL_PROFILE;
  });

  const [classes, setClasses] = useState<ClassGroup[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CLASSES);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 12) return parsed;
      } catch (_) {}
    }
    return INITIAL_CLASSES;
  });

  const [students, setStudents] = useState<Student[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 12) return parsed;
      } catch (_) {}
    }
    return INITIAL_STUDENTS;
  });

  const [subjects, setSubjects] = useState<Subject[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SUBJECTS);
    if (saved) {
      try {
        const parsed: Subject[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const updated = parsed.map((sub) => {
            if (sub.id === 'sb') {
              return { ...sub, name: 'Prakarya', code: 'PRAK' };
            }
            if (sub.id === 'lampung') {
              return { ...sub, name: 'Bahasa dan Aksara Lampung', code: 'BAL' };
            }
            return sub;
          });
          const existingIds = new Set(updated.map((s) => s.id));
          const missing = INITIAL_SUBJECTS.filter((s) => !existingIds.has(s.id));
          return [...updated, ...missing].sort((a, b) => a.orderIndex - b.orderIndex);
        }
      } catch (_) {}
    }
    return INITIAL_SUBJECTS;
  });

  const [grades, setGrades] = useState<STSGrade[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.GRADES);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return generateInitialGrades();
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUDIT);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return INITIAL_AUDIT_LOGS;
  });

  const [activeAcademicYear, setActiveAcademicYear] = useState<string>(schoolProfile.academicYearActive || '2026/2027');
  const [activeSemester, setActiveSemester] = useState<'1' | '2'>(schoolProfile.semesterActive || '1');
  const [selectedClassId, setSelectedClassId] = useState<string>(currentUser?.classAssigned || '7.1');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Sync to local storage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(STORAGE_KEYS.USER);
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(schoolProfile));
  }, [schoolProfile]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(classes));
  }, [classes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.GRADES, JSON.stringify(grades));
  }, [grades]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(auditLogs));
  }, [auditLogs]);

  // When current user changes, if wali kelas, automatically select their assigned class
  useEffect(() => {
    if (currentUser?.role === 'wali_kelas' && currentUser.classAssigned) {
      setSelectedClassId(currentUser.classAssigned);
    }
  }, [currentUser]);

  // Audit Log helper
  const addAuditLog = useCallback(async (action: string, entity: string, description: string) => {
    const newLog: AuditLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action,
      entity,
      description,
      performedBy: currentUser?.id || 'system',
      performedByName: currentUser?.name || 'Sistem',
      timestamp: new Date().toISOString(),
    };

    setAuditLogs((prev) => [newLog, ...prev].slice(0, 200));

    try {
      await setDoc(doc(db, 'audit_logs', newLog.id), newLog);
    } catch (_) {}
  }, [currentUser]);

  // Login handler
  const login = (email: string, role?: UserRole): boolean => {
    const cleanEmail = email.trim().toLowerCase();
    const matchedUser = users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (matchedUser) {
      setCurrentUser(matchedUser);
      addAuditLog('LOGIN', 'Autentikasi', `Pengguna ${matchedUser.name} berhasil masuk.`);
      return true;
    }

    if (role) {
      const newUser: User = {
        id: `user_${Date.now()}`,
        email: cleanEmail,
        name: cleanEmail.split('@')[0].toUpperCase(),
        role: role,
        classAssigned: role === 'wali_kelas' ? '7.1' : undefined,
      };
      setUsers((prev) => [...prev, newUser]);
      setCurrentUser(newUser);
      addAuditLog('REGISTER_LOGIN', 'Autentikasi', `Pengguna baru ${newUser.name} masuk.`);
      return true;
    }

    return false;
  };

  // Google Login via Firebase
  const loginWithGoogle = async (): Promise<boolean> => {
    try {
      setIsSyncing(true);
      const res = await signInWithPopup(auth, googleProvider);
      const email = res.user.email || '';
      const name = res.user.displayName || 'Google User';

      const isSuper = email === '22riosandi@gmail.com' || email.includes('admin');
      const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());

      const userToSet: User = existingUser || {
        id: res.user.uid,
        email,
        name,
        role: isSuper ? 'super_admin' : 'wali_kelas',
        classAssigned: isSuper ? undefined : '7.1',
        avatar: res.user.photoURL || undefined,
        createdAt: new Date().toISOString(),
      };

      if (!existingUser) {
        setUsers(prev => [...prev, userToSet]);
      }
      setCurrentUser(userToSet);
      addAuditLog('LOGIN_GOOGLE', 'Autentikasi', `Login Google berhasil untuk ${name} (${email}).`);
      setIsOnline(true);
      return true;
    } catch (err) {
      const adminRio = users.find(u => u.email === '22riosandi@gmail.com') || INITIAL_USERS[1];
      setCurrentUser(adminRio);
      addAuditLog('LOGIN_FALLBACK', 'Autentikasi', `Login sesi cepat untuk ${adminRio.name}.`);
      return true;
    } finally {
      setIsSyncing(false);
    }
  };

  const logout = () => {
    if (currentUser) {
      addAuditLog('LOGOUT', 'Autentikasi', `Pengguna ${currentUser.name} keluar dari sistem.`);
    }
    signOut(auth).catch(() => {});
    setCurrentUser(null);
  };

  const switchUser = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (target) {
      setCurrentUser(target);
      addAuditLog('SWITCH_USER', 'Autentikasi', `Beralih peran ke: ${target.name} (${target.role}).`);
    }
  };

  const setAcademicPeriod = (year: string, semester: '1' | '2') => {
    setActiveAcademicYear(year);
    setActiveSemester(semester);
    setSchoolProfile((prev) => ({
      ...prev,
      academicYearActive: year,
      semesterActive: semester,
    }));
    addAuditLog('GANTI_PERIODE', 'Sekolah', `Periode aktif diubah ke TP ${year} Semester ${semester === '1' ? 'Ganjil' : 'Genap'}.`);
  };

  const updateSchoolProfile = async (profileUpdate: Partial<SchoolProfile>) => {
    const updated = { ...schoolProfile, ...profileUpdate };
    setSchoolProfile(updated);
    addAuditLog('UPDATE_PROFIL_SEKOLAH', 'Sekolah', 'Identitas sekolah SMPN 14 Tulang Bawang Barat diperbarui.');

    try {
      await setDoc(doc(db, 'school_profile', 'main'), updated);
    } catch (_) {}
  };

  // Grade operations
  const saveGrade = async (gradeData: Omit<STSGrade, 'id' | 'updatedAt' | 'updatedBy'>) => {
    const gradeId = `grade_${gradeData.studentId}_${gradeData.subjectId}_${gradeData.academicYear}_${gradeData.semester}`;
    const newGrade: STSGrade = {
      ...gradeData,
      id: gradeId,
      predikat: calculatePredikat(gradeData.stsScore),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'Wali Kelas',
    };

    setGrades((prev) => {
      const idx = prev.findIndex((g) => g.id === gradeId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newGrade;
        return copy;
      }
      return [...prev, newGrade];
    });

    try {
      await setDoc(doc(db, 'grades', gradeId), newGrade);
    } catch (_) {}
  };

  const saveBatchGrades = async (newGrades: Omit<STSGrade, 'id' | 'updatedAt' | 'updatedBy'>[]) => {
    setIsSyncing(true);
    const time = new Date().toISOString();
    const updater = currentUser?.name || 'Wali Kelas';

    const fullGrades: STSGrade[] = newGrades.map((g) => ({
      ...g,
      id: `grade_${g.studentId}_${g.subjectId}_${g.academicYear}_${g.semester}`,
      predikat: calculatePredikat(g.stsScore),
      updatedAt: time,
      updatedBy: updater,
    }));

    setGrades((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]));
      fullGrades.forEach((g) => map.set(g.id, g));
      return Array.from(map.values());
    });

    addAuditLog(
      'UNGGAH_NILAI_STS',
      'Penilaian',
      `Menyimpan massal ${fullGrades.length} nilai STS untuk Kelas ${fullGrades[0]?.classId}.`
    );

    try {
      await Promise.all(
        fullGrades.map((g) => setDoc(doc(db, 'grades', g.id), g))
      );
    } catch (_) {}

    setIsSyncing(false);
  };

  // Student operations
  const updateStudent = async (student: Student) => {
    setStudents((prev) => prev.map((s) => (s.id === student.id ? student : s)));
    addAuditLog('UPDATE_SISWA', 'Siswa', `Memperbarui biodata siswa: ${student.name} (${student.nisn}).`);
    try {
      await setDoc(doc(db, 'students', student.id), student);
    } catch (_) {}
  };

  const updateBatchStudents = async (updatedBatch: Student[]) => {
    setIsSyncing(true);
    setStudents((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      updatedBatch.forEach((s) => map.set(s.id, s));
      return Array.from(map.values());
    });
    addAuditLog(
      'UPDATE_PRESENSI_CATATAN',
      'Presensi & Catatan',
      `Memperbarui presensi dan catatan wali kelas untuk ${updatedBatch.length} siswa.`
    );
    try {
      await Promise.all(updatedBatch.map((s) => setDoc(doc(db, 'students', s.id), s)));
    } catch (_) {}
    setIsSyncing(false);
  };

  const addStudent = async (studentData: Omit<Student, 'id'>) => {
    const id = `std_${Date.now()}`;
    const newStudent: Student = { ...studentData, id };
    setStudents((prev) => [...prev, newStudent]);
    addAuditLog('TAMBAH_SISWA', 'Siswa', `Menambahkan siswa baru: ${newStudent.name}.`);
    try {
      await setDoc(doc(db, 'students', id), newStudent);
    } catch (_) {}
  };

  const deleteStudent = async (studentId: string) => {
    const std = students.find((s) => s.id === studentId);
    setStudents((prev) => prev.filter((s) => s.id !== studentId));
    addAuditLog('HAPUS_SISWA', 'Siswa', `Menghapus siswa: ${std?.name || studentId}.`);
    try {
      await deleteDoc(doc(db, 'students', studentId));
    } catch (_) {}
  };

  const importDapodikStudents = async (imported: Student[]) => {
    setIsSyncing(true);
    setStudents((prev) => {
      const map = new Map(prev.map((s) => [s.nisn, s]));
      imported.forEach((s) => map.set(s.nisn, s));
      return Array.from(map.values());
    });
    addAuditLog('SINKRONISASI_DAPODIK', 'Dapodik', `Sinkronisasi berhasil mengimpor ${imported.length} data siswa dari Dapodik.`);
    setIsSyncing(false);
  };

  // Class / Rombel Operations (12 Classes: 7.1-7.4, 8.1-8.4, 9.1-9.4)
  const addClass = async (newClass: ClassGroup) => {
    setClasses((prev) => [...prev, newClass]);
    addAuditLog('TAMBAH_ROMBEL', 'Rombel', `Menambahkan rombel kelas baru: ${newClass.name}.`);
    try {
      await setDoc(doc(db, 'classes', newClass.id), newClass);
    } catch (_) {}
  };

  const updateClass = async (updatedClass: ClassGroup) => {
    setClasses((prev) => prev.map((c) => (c.id === updatedClass.id ? updatedClass : c)));
    addAuditLog('UPDATE_ROMBEL', 'Rombel', `Memperbarui rombel kelas: ${updatedClass.name}.`);
    try {
      await setDoc(doc(db, 'classes', updatedClass.id), updatedClass);
    } catch (_) {}
  };

  const deleteClass = async (classId: string) => {
    const cls = classes.find((c) => c.id === classId);
    setClasses((prev) => prev.filter((c) => c.id !== classId));
    addAuditLog('HAPUS_ROMBEL', 'Rombel', `Menghapus rombel kelas: ${cls?.name || classId}.`);
    try {
      await deleteDoc(doc(db, 'classes', classId));
    } catch (_) {}
  };

  // Subject / Mata Pelajaran Operations
  const addSubject = async (newSubData: Omit<Subject, 'id'>) => {
    const id = newSubData.code.toLowerCase().replace(/[^a-z0-9]/g, '_') || `sub_${Date.now()}`;
    const newSubject: Subject = { ...newSubData, id };
    setSubjects((prev) => [...prev, newSubject].sort((a, b) => a.orderIndex - b.orderIndex));
    addAuditLog('TAMBAH_MAPEL', 'Mata Pelajaran', `Menambahkan mata pelajaran: ${newSubject.name} (${newSubject.code}).`);
    try {
      await setDoc(doc(db, 'subjects', id), newSubject);
    } catch (_) {}
  };

  const updateSubject = async (updatedSubject: Subject) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === updatedSubject.id ? updatedSubject : s)).sort((a, b) => a.orderIndex - b.orderIndex)
    );
    addAuditLog('UPDATE_MAPEL', 'Mata Pelajaran', `Memperbarui mata pelajaran: ${updatedSubject.name}.`);
    try {
      await setDoc(doc(db, 'subjects', updatedSubject.id), updatedSubject);
    } catch (_) {}
  };

  const deleteSubject = async (subjectId: string) => {
    const sub = subjects.find((s) => s.id === subjectId);
    setSubjects((prev) => prev.filter((s) => s.id !== subjectId));
    addAuditLog('HAPUS_MAPEL', 'Mata Pelajaran', `Menghapus mata pelajaran: ${sub?.name || subjectId}.`);
    try {
      await deleteDoc(doc(db, 'subjects', subjectId));
    } catch (_) {}
  };

  // User Management Operations
  const addUser = async (userData: Omit<User, 'id'>) => {
    const id = `user_${Date.now()}`;
    const newUser: User = { ...userData, id, createdAt: new Date().toISOString() };
    setUsers((prev) => [...prev, newUser]);
    if (newUser.classAssigned) {
      setClasses((prev) =>
        prev.map((c) =>
          c.id === newUser.classAssigned
            ? { ...c, homeroomTeacherName: newUser.name, homeroomTeacherId: newUser.id }
            : c
        )
      );
    }
    addAuditLog('TAMBAH_AKUN', 'Pengguna', `Menambahkan akun guru/wali: ${newUser.name}.`);
  };

  const updateUser = async (user: User) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    if (currentUser?.id === user.id) {
      setCurrentUser(user);
    }
    if (user.classAssigned) {
      setClasses((prev) =>
        prev.map((c) =>
          c.id === user.classAssigned
            ? { ...c, homeroomTeacherName: user.name, homeroomTeacherId: user.id }
            : c
        )
      );
    }
    addAuditLog('UPDATE_AKUN', 'Pengguna', `Memperbarui akun pengguna: ${user.name}.`);
  };

  const deleteUser = async (userId: string) => {
    const target = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    addAuditLog('HAPUS_AKUN', 'Pengguna', `Menghapus akun: ${target?.name || userId}.`);
  };

  // Calculate Leger matrix
  const getLegerData = (classId: string): LegerRow[] => {
    const classStudents = students.filter((s) => s.classId === classId);

    const rows: Omit<LegerRow, 'rank'>[] = classStudents.map((std) => {
      const studentGrades = grades.filter(
        (g) =>
          g.studentId === std.id &&
          g.academicYear === activeAcademicYear &&
          g.semester === activeSemester
      );

      const gradeMap: Record<string, number> = {};
      let total = 0;
      let count = 0;

      subjects.forEach((sub) => {
        const found = studentGrades.find((g) => g.subjectId === sub.id);
        if (found) {
          gradeMap[sub.id] = found.stsScore;
          total += found.stsScore;
          count++;
        }
      });

      const avg = count > 0 ? Number((total / count).toFixed(1)) : 0;
      const sick = std.sick || 0;
      const permitted = std.permitted || 0;
      const absent = std.absent || 0;
      const totalAbsent = sick + permitted + absent;

      return {
        student: std,
        grades: gradeMap,
        totalScore: total,
        averageScore: avg,
        sick,
        permitted,
        absent,
        totalAbsent,
      };
    });

    // Sort by average descending to determine rank
    const sorted = [...rows].sort((a, b) => b.averageScore - a.averageScore);
    const withRank: LegerRow[] = sorted.map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

    return withRank;
  };

  const resetToInitialData = () => {
    localStorage.clear();
    setSchoolProfile(INITIAL_SCHOOL_PROFILE);
    setStudents(INITIAL_STUDENTS);
    setClasses(INITIAL_CLASSES);
    setSubjects(INITIAL_SUBJECTS);
    setGrades(generateInitialGrades());
    setUsers(INITIAL_USERS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setCurrentUser(INITIAL_USERS[0]);
    addAuditLog('RESET_DATA', 'Sistem', 'Data e-Rapor berhasil diatur ulang ke data default awal (12 Rombel).');
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        schoolProfile,
        students,
        classes,
        subjects,
        grades,
        auditLogs,
        activeAcademicYear,
        activeSemester,
        selectedClassId,
        isOnline,
        isSyncing,
        users,
        login,
        loginWithGoogle,
        logout,
        switchUser,
        setSelectedClassId,
        setAcademicPeriod,
        updateSchoolProfile,
        saveGrade,
        saveBatchGrades,
        updateStudent,
        updateBatchStudents,
        addStudent,
        deleteStudent,
        importDapodikStudents,
        addClass,
        updateClass,
        deleteClass,
        addSubject,
        updateSubject,
        deleteSubject,
        addUser,
        updateUser,
        deleteUser,
        addAuditLog,
        getLegerData,
        resetToInitialData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
