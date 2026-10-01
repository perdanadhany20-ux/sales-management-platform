-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- 043 — Impor data lama dari Excel
--
-- Data sebelum platform ada (customer, laporan harian, pipeline, riwayat
-- jadwal) tersimpan di spreadsheet. Admin kini bisa memasukkannya lewat
-- Admin Panel → Impor Data. Penulisan dilakukan route handler server
-- (app/api/admin/impor) dengan service role setelah memeriksa peran Admin —
-- karena baris itu milik Sales lain, sesuatu yang memang tidak boleh
-- dilakukan klien lewat RLS.
--
-- Setiap baris hasil impor membawa impor_id. Gunanya dua:
--   1. Satu kali impor bisa DIBATALKAN utuh (salah berkas, salah kolom)
--      tanpa menyentuh data yang diketik langsung di platform.
--   2. Data lama tetap bisa dibedakan dari data yang lahir di platform.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sm_impor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jenis           text NOT NULL CHECK (jenis IN ('customer', 'daily_report', 'pipeline', 'schedule')),
  nama_berkas     text,
  jumlah          integer NOT NULL DEFAULT 0,
  dilewati        integer NOT NULL DEFAULT 0,
  dibuat_oleh     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  dibatalkan_at   timestamptz,
  dibatalkan_oleh uuid REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.sm_impor ENABLE ROW LEVEL SECURITY;

-- Hanya Admin yang melihat riwayat impor; menulis hanya lewat server.
DROP POLICY IF EXISTS impor_baca ON public.sm_impor;
CREATE POLICY impor_baca ON public.sm_impor FOR SELECT TO authenticated USING (public.sm_is_admin());

CREATE INDEX IF NOT EXISTS idx_impor_dibuat ON public.sm_impor (created_at DESC);

ALTER TABLE public.sm_customers     ADD COLUMN IF NOT EXISTS impor_id uuid REFERENCES public.sm_impor(id) ON DELETE SET NULL;
ALTER TABLE public.sm_daily_reports ADD COLUMN IF NOT EXISTS impor_id uuid REFERENCES public.sm_impor(id) ON DELETE SET NULL;
ALTER TABLE public.sm_pipeline      ADD COLUMN IF NOT EXISTS impor_id uuid REFERENCES public.sm_impor(id) ON DELETE SET NULL;
ALTER TABLE public.sm_schedules     ADD COLUMN IF NOT EXISTS impor_id uuid REFERENCES public.sm_impor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_impor     ON public.sm_customers (impor_id)     WHERE impor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_reports_impor ON public.sm_daily_reports (impor_id) WHERE impor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_impor      ON public.sm_pipeline (impor_id)      WHERE impor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_impor     ON public.sm_schedules (impor_id)     WHERE impor_id IS NOT NULL;
