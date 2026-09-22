-- ════════════════════════════════════════════════════════════════════════════
-- 015 — Data akun lengkap, peran Director & Finance, dan pendaftaran mandiri
--       yang menunggu persetujuan admin
--
-- Tiga hal sekaligus, dan ketiganya saling bergantung sehingga dipisah jadi
-- migrasi terpisah hanya akan membuat salah satunya sempat berjalan tanpa yang
-- lain:
--
-- 1. Kolom identitas organisasi (divisi, sales division, jabatan) supaya
--    profil benar-benar menggambarkan posisi orangnya, bukan sekadar peran
--    teknis di aplikasi.
-- 2. Peran DIRECTOR dan FINANCE, yang dituntut rantai persetujuan GP
--    Calculation — formulir aslinya memang bertanda tangan empat pihak:
--    Sales, Manager Sales, Director, Finance.
-- 3. Pendaftaran mandiri. Akun baru masuk dalam keadaan MENUNGGU dan tidak
--    bisa dipakai masuk sampai admin menyetujuinya.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Peran baru ──────────────────────────────────────────────────────────────
--
-- CHECK diganti, bukan enum di-ALTER — inilah alasan §48 memilih CHECK sejak
-- awal: menambah peran tidak mengunci tabelnya.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SALES', 'MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE'));

-- ── Identitas organisasi ────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS division       text,
  ADD COLUMN IF NOT EXISTS sales_division text,
  ADD COLUMN IF NOT EXISTS position       text,
  ADD COLUMN IF NOT EXISTS event_code     text,
  ADD COLUMN IF NOT EXISTS joined_at      date;

-- ── Persetujuan akun ────────────────────────────────────────────────────────
--
-- Dipisah dari kolom `active` yang sudah ada, dan pemisahan ini disengaja.
-- Keduanya menjawab pertanyaan berbeda: `approval_status` menjawab "apakah
-- akun ini pernah disetujui", `active` menjawab "apakah akun ini boleh dipakai
-- sekarang". Menonaktifkan sementara seseorang yang sedang cuti panjang tidak
-- boleh menghapus fakta bahwa akunnya dulu sudah diperiksa dan disetujui.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DISETUJUI',
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_approval_check;
ALTER TABLE public.users ADD CONSTRAINT users_approval_check
  CHECK (approval_status IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK'));

-- Bawaannya DISETUJUI supaya akun yang sudah ada sebelum migrasi ini tidak
-- tiba-tiba terkunci. Yang mendaftar sendiri disisipkan dengan MENUNGGU secara
-- eksplisit oleh route handler.

CREATE INDEX IF NOT EXISTS idx_users_approval
  ON public.users (approval_status) WHERE approval_status = 'MENUNGGU';

-- ── Daftar pilihan organisasi (§47: bisa diubah admin tanpa deploy) ─────────

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('divisions',
   '["Sales","Marketing","Teknis","Finance","Operasional","Manajemen"]'::jsonb,
   'Pilihan Divisi pada pendaftaran dan profil.'),

  ('sales_divisions',
   '["Corporate","Government","Retail","Project","Channel Partner"]'::jsonb,
   'Pilihan Sales Division. Hanya relevan bagi yang divisinya Sales.'),

  ('positions',
   '["Staff","Senior Staff","Supervisor","Manager","Senior Manager","Director"]'::jsonb,
   'Pilihan Jabatan / Posisi.'),

  ('registration_open',
   'true'::jsonb,
   'Bila false, pendaftaran mandiri ditutup dan akun hanya bisa dibuat admin.')
ON CONFLICT (key) DO NOTHING;

-- ── sm_is_pengawas() ikut mengenal peran baru ──────────────────────────────
--
-- Director dan Finance memang harus melihat data seluruh tim: keduanya
-- menandatangani GP Calculation, dan tanda tangan di atas angka yang tidak
-- boleh ia baca adalah tanda tangan kosong.
--
-- Yang TIDAK berubah: mereka tetap bukan Admin. Pengelolaan akun dan
-- konfigurasi platform tetap tertutup bagi keduanya, karena sm_is_admin()
-- tidak disentuh sama sekali.
CREATE OR REPLACE FUNCTION public.sm_is_pengawas()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.sm_role() IN ('MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE');
$$;
