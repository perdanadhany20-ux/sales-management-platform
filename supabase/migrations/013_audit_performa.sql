-- ════════════════════════════════════════════════════════════════════════════
-- 013 — Perbaikan dari audit performa (§108)
--
-- Dua temuan nyata dari database linter Supabase, keduanya diperbaiki di sini.
-- Temuan ketiga ("unused index") sengaja TIDAK ditindaklanjuti: indeks itu
-- terbaca belum terpakai semata karena platformnya baru berisi data contoh.
-- Membuang indeks yang memang dirancang untuk penyaringan sehari-hari hanya
-- karena belum ada yang menyaring apa pun adalah kesimpulan yang terbalik.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Temuan 1: foreign key tanpa indeks penutup ──────────────────────────────
--
-- Setiap kolom di bawah menunjuk ke tabel lain tanpa indeks di sisi anaknya.
-- Akibatnya bukan hanya join yang lambat: menghapus SATU baris induk memaksa
-- Postgres memindai seluruh tabel anak untuk memastikan tidak ada yang
-- menggantung. Menonaktifkan pengguna memang lazim, tapi menghapusnya — saat
-- salah input, misalnya — akan menyentuh delapan tabel sekaligus.

CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON public.audit_trail (actor_id);

CREATE INDEX IF NOT EXISTS idx_customers_pembuat
  ON public.sm_customers (created_by);

CREATE INDEX IF NOT EXISTS idx_laporan_customer
  ON public.sm_daily_reports (customer_id);

CREATE INDEX IF NOT EXISTS idx_evidence_user
  ON public.sm_evidence (user_id);

CREATE INDEX IF NOT EXISTS idx_exceptions_penyetuju
  ON public.sm_exceptions (approved_by);

CREATE INDEX IF NOT EXISTS idx_gps_attendance
  ON public.sm_gps_events (attendance_id);

CREATE INDEX IF NOT EXISTS idx_locations_pembuat
  ON public.sm_locations (created_by);

CREATE INDEX IF NOT EXISTS idx_schedules_pembuat
  ON public.sm_schedules (created_by);

-- Yang ini paling sering dipakai: halaman Meeting menempelkan sm_locations ke
-- setiap jadwal berkehadiran lewat kolom ini.
CREATE INDEX IF NOT EXISTS idx_schedules_lokasi
  ON public.sm_schedules (location_id);

CREATE INDEX IF NOT EXISTS idx_settings_pengubah
  ON public.sm_settings (updated_by);

-- ── Temuan 2: dua policy permisif untuk SELECT yang sama ────────────────────
--
-- `FOR ALL` mencakup SELECT. Karena tabel-tabel ini juga punya policy baca
-- sendiri, setiap SELECT dievaluasi DUA kali: sekali oleh policy baca, sekali
-- lagi oleh policy kelola yang hasilnya tidak menambah apa pun — pemanggilnya
-- sudah lolos lewat policy pertama.
--
-- Policy kelola dipecah menjadi INSERT/UPDATE/DELETE. Hak yang diberikan sama
-- persis seperti sebelumnya; yang hilang hanya pekerjaan ganda pada SELECT.
-- Ini bukan pelonggaran: kemampuan membaca tabel-tabel ini memang sudah
-- diberikan policy `*_baca` kepada seluruh peran yang login.

-- sm_locations — dikelola Manager & Admin
DROP POLICY IF EXISTS lok_kelola ON public.sm_locations;

CREATE POLICY lok_tambah ON public.sm_locations
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_pengawas());

CREATE POLICY lok_ubah ON public.sm_locations
  FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

CREATE POLICY lok_hapus ON public.sm_locations
  FOR DELETE TO authenticated USING (public.sm_is_pengawas());

-- sm_settings — hanya Admin
DROP POLICY IF EXISTS settings_admin ON public.sm_settings;

CREATE POLICY settings_tambah ON public.sm_settings
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());

CREATE POLICY settings_ubah ON public.sm_settings
  FOR UPDATE TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

CREATE POLICY settings_hapus ON public.sm_settings
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- users — hanya Admin
DROP POLICY IF EXISTS users_admin_kelola ON public.users;

CREATE POLICY users_admin_tambah ON public.users
  FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());

CREATE POLICY users_admin_ubah ON public.users
  FOR UPDATE TO authenticated
  USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());

CREATE POLICY users_admin_hapus ON public.users
  FOR DELETE TO authenticated USING (public.sm_is_admin());
