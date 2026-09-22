-- ════════════════════════════════════════════════════════════════════════════
-- 005 — Row Level Security
--
-- Inilah lapisan penegak wewenang yang sebenarnya (§7, §55). Menyembunyikan
-- tombol di frontend tidak menghalangi siapa pun memanggil PostgREST langsung
-- dengan curl; policy di berkas inilah yang menghalanginya.
--
-- KEPUTUSAN PENTING — kenapa Sales TIDAK punya policy UPDATE pada
-- sm_schedules, sm_attendance, dan sm_gps_events:
--
--   §37 menuntut `UPDATE sm_schedules SET status='completed'` tidak boleh
--   cukup untuk menyelesaikan Meeting. Cara paling kokoh memenuhinya bukan
--   menulis policy UPDATE yang rumit dan berusaha menebak niat penulisnya,
--   melainkan TIDAK MEMBERI jalur UPDATE sama sekali. Satu-satunya pintu
--   menuju COMPLETED adalah sm_complete_schedule() — yang SECURITY DEFINER,
--   memeriksa ulang semua prasyarat, dan mencatat jejaknya.
--
--   Konsekuensinya disengaja: tidak ada kombinasi permintaan PostgREST yang
--   bisa disusun Sales untuk menembus urutan check-in → GPS → foto.
-- ════════════════════════════════════════════════════════════════════════════

-- Klien membawa JWT terbitan server dengan klaim role = 'authenticated'
-- (lihat lib/db-token.ts). Permintaan tanpa token berjalan sebagai `anon` dan
-- sengaja tidak diberi hak apa pun.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_pipeline      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_attendance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_evidence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_gps_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_exceptions    ENABLE ROW LEVEL SECURITY;

-- ── users ───────────────────────────────────────────────────────────────────

-- Semua yang login boleh melihat daftar user: dropdown "tugaskan ke" dan
-- penyaringan "per Sales" tidak bisa jalan tanpanya. Kolom rahasia tidak ada
-- di tabel ini — hash password tinggal di user_credentials.
DROP POLICY IF EXISTS users_baca ON public.users;
CREATE POLICY users_baca ON public.users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS users_admin_kelola ON public.users;
CREATE POLICY users_admin_kelola ON public.users
  FOR ALL TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

-- Kredensial & sesi: tidak ada policy untuk siapa pun. Keduanya hanya boleh
-- disentuh route handler lewat service role, yang melewati RLS. Tanpa policy,
-- klien mana pun membacanya sebagai tabel kosong.
-- (login_attempts sama — hanya ditulis server.)

-- ── audit_trail — append-only (§65) ─────────────────────────────────────────

DROP POLICY IF EXISTS audit_baca ON public.audit_trail;
CREATE POLICY audit_baca ON public.audit_trail
  FOR SELECT TO authenticated
  USING (public.sm_is_pengawas() OR actor_id = public.sm_uid());

-- Sengaja TIDAK ada policy UPDATE maupun DELETE, untuk siapa pun — termasuk
-- Admin. Jejak audit yang bisa disunting bukan jejak audit.
DROP POLICY IF EXISTS audit_tulis ON public.audit_trail;
CREATE POLICY audit_tulis ON public.audit_trail
  FOR INSERT TO authenticated WITH CHECK (actor_id = public.sm_uid());

-- ── sm_settings (§47) ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS settings_baca ON public.sm_settings;
CREATE POLICY settings_baca ON public.sm_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS settings_admin ON public.sm_settings;
CREATE POLICY settings_admin ON public.sm_settings
  FOR ALL TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

-- ── Customer & kontak — data master bersama ─────────────────────────────────

DROP POLICY IF EXISTS customers_baca ON public.sm_customers;
CREATE POLICY customers_baca ON public.sm_customers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS customers_tulis ON public.sm_customers;
CREATE POLICY customers_tulis ON public.sm_customers
  FOR INSERT TO authenticated WITH CHECK (public.sm_uid() IS NOT NULL);

DROP POLICY IF EXISTS customers_ubah ON public.sm_customers;
CREATE POLICY customers_ubah ON public.sm_customers
  FOR UPDATE TO authenticated
  USING (created_by = public.sm_uid() OR public.sm_is_pengawas())
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS customers_hapus ON public.sm_customers;
CREATE POLICY customers_hapus ON public.sm_customers
  FOR DELETE TO authenticated USING (public.sm_is_admin());

DROP POLICY IF EXISTS contacts_baca ON public.sm_contacts;
CREATE POLICY contacts_baca ON public.sm_contacts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS contacts_tulis ON public.sm_contacts;
CREATE POLICY contacts_tulis ON public.sm_contacts
  FOR INSERT TO authenticated WITH CHECK (public.sm_uid() IS NOT NULL);

DROP POLICY IF EXISTS contacts_ubah ON public.sm_contacts;
CREATE POLICY contacts_ubah ON public.sm_contacts
  FOR UPDATE TO authenticated
  USING (public.sm_uid() IS NOT NULL) WITH CHECK (public.sm_uid() IS NOT NULL);

-- ── Daily Report (§49) ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS dr_baca ON public.sm_daily_reports;
CREATE POLICY dr_baca ON public.sm_daily_reports
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

-- WITH CHECK mengunci sales_user_id ke pemanggil: tanpa ini, Sales A bisa
-- menyisipkan laporan atas nama Sales B dan merusak angka kepatuhan.
DROP POLICY IF EXISTS dr_tulis ON public.sm_daily_reports;
CREATE POLICY dr_tulis ON public.sm_daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (sales_user_id = public.sm_uid());

-- USING memutuskan baris mana yang boleh disentuh; WITH CHECK memutuskan
-- bentuk baris SESUDAH diubah. Keduanya diperlukan — tanpa WITH CHECK,
-- laporan sendiri bisa "dioper" ke user lain lewat satu UPDATE.
DROP POLICY IF EXISTS dr_ubah ON public.sm_daily_reports;
CREATE POLICY dr_ubah ON public.sm_daily_reports
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid())
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS dr_hapus ON public.sm_daily_reports;
CREATE POLICY dr_hapus ON public.sm_daily_reports
  FOR DELETE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Pipeline (§49) ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS pl_baca ON public.sm_pipeline;
CREATE POLICY pl_baca ON public.sm_pipeline
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS pl_tulis ON public.sm_pipeline;
CREATE POLICY pl_tulis ON public.sm_pipeline
  FOR INSERT TO authenticated
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS pl_ubah ON public.sm_pipeline;
CREATE POLICY pl_ubah ON public.sm_pipeline
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid())
  WITH CHECK (sales_user_id = public.sm_uid());

DROP POLICY IF EXISTS pl_hapus ON public.sm_pipeline;
CREATE POLICY pl_hapus ON public.sm_pipeline
  FOR DELETE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Lokasi (§78) ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS lok_baca ON public.sm_locations;
CREATE POLICY lok_baca ON public.sm_locations
  FOR SELECT TO authenticated USING (true);

-- Radius dan koordinat menentukan lolos-tidaknya verifikasi GPS. Kalau Sales
-- boleh menyuntingnya, seluruh pemeriksaan jarak kehilangan arti — cukup
-- lebarkan radius jadi 5000 m dan check-in dari mana pun akan lolos.
DROP POLICY IF EXISTS lok_kelola ON public.sm_locations;
CREATE POLICY lok_kelola ON public.sm_locations
  FOR ALL TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

-- ── Request Schedule (§76) ──────────────────────────────────────────────────

DROP POLICY IF EXISTS sch_baca ON public.sm_schedules;
CREATE POLICY sch_baca ON public.sm_schedules
  FOR SELECT TO authenticated
  USING (assigned_to = public.sm_uid()
         OR created_by = public.sm_uid()
         OR public.sm_is_pengawas());

-- Sales boleh MENGAJUKAN jadwal, tapi tidak boleh menugaskannya ke dirinya
-- sendiri maupun langsung menandainya selesai: assigned_to wajib kosong dan
-- status wajib UPCOMING. Penugasan adalah wewenang Manager/Admin (§76).
DROP POLICY IF EXISTS sch_ajukan ON public.sm_schedules;
CREATE POLICY sch_ajukan ON public.sm_schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid()
        AND assigned_to IS NULL
        AND status = 'UPCOMING')
  );

-- Hanya Manager/Admin yang punya jalur UPDATE langsung. Sales tidak — lihat
-- catatan panjang di kepala berkas ini. Jalan Sales menuju COMPLETED hanya
-- lewat sm_complete_schedule().
DROP POLICY IF EXISTS sch_kelola ON public.sm_schedules;
CREATE POLICY sch_kelola ON public.sm_schedules
  FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS sch_hapus ON public.sm_schedules;
CREATE POLICY sch_hapus ON public.sm_schedules
  FOR DELETE TO authenticated USING (public.sm_is_pengawas());

-- ── Attendance — hanya baca; penulisan lewat RPC ────────────────────────────

DROP POLICY IF EXISTS att_baca ON public.sm_attendance;
CREATE POLICY att_baca ON public.sm_attendance
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- ── Evidence (§101) ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ev_baca ON public.sm_evidence;
CREATE POLICY ev_baca ON public.sm_evidence
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- Tiga syarat sekaligus, dan ketiganya perlu:
--   user_id = pemanggil     → foto tidak bisa diunggah atas nama orang lain
--   kehadiran memang miliknya → tidak bisa menempel ke jadwal orang lain
--   gps_verified = true     → foto tanpa lokasi terverifikasi tidak diterima,
--                             sehingga urutan GPS → foto tidak bisa dibalik
DROP POLICY IF EXISTS ev_tulis ON public.sm_evidence;
CREATE POLICY ev_tulis ON public.sm_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.sm_uid()
    AND EXISTS (
      SELECT 1 FROM public.sm_attendance a
       WHERE a.id = attendance_id
         AND a.user_id = public.sm_uid()
         AND a.schedule_id = sm_evidence.schedule_id
         AND a.gps_verified = true
    )
  );

-- Bukti yang bisa dihapus pemiliknya bukan bukti. Hanya Admin, dan itu pun
-- meninggalkan jejak di audit_trail lewat aplikasi.
DROP POLICY IF EXISTS ev_hapus ON public.sm_evidence;
CREATE POLICY ev_hapus ON public.sm_evidence
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- ── Jejak GPS — hanya baca ──────────────────────────────────────────────────

-- §42: Sales melihat jejaknya sendiri, pengawas melihat semua. Tidak ada
-- policy INSERT: satu-satunya penulis adalah sm_check_in() yang SECURITY
-- DEFINER, sehingga jejak tidak bisa dikarang dari klien.
DROP POLICY IF EXISTS gps_baca ON public.sm_gps_events;
CREATE POLICY gps_baca ON public.sm_gps_events
  FOR SELECT TO authenticated
  USING (user_id = public.sm_uid() OR public.sm_is_pengawas());

-- ── Exception (§39) ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS exc_baca ON public.sm_exceptions;
CREATE POLICY exc_baca ON public.sm_exceptions
  FOR SELECT TO authenticated
  USING (public.sm_is_pengawas()
         OR EXISTS (SELECT 1 FROM public.sm_schedules s
                     WHERE s.id = schedule_id AND s.assigned_to = public.sm_uid()));

-- Tidak ada policy INSERT: override hanya lewat sm_override_completion(),
-- yang menuntut alasan tertulis dan mencatat penyetujunya.
