-- ════════════════════════════════════════════════════════════════════════════
-- 038 — Kode Aktivasi lisensi
--
-- Admin pelanggan kini cukup menempel satu Kode Aktivasi dari Kantor Pusat di
-- Admin → Lisensi; tidak perlu lagi mengisi LICENSE_* di Vercel per pelanggan.
-- Kunci deployment dari kode itu disimpan di sini — tabel sm_lisensi tetap
-- tertutup total bagi pengguna aplikasi (tanpa policy, tanpa grant; migrasi 037),
-- hanya server (service role) yang membacanya.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_lisensi ADD COLUMN IF NOT EXISTS deployment_key text;
