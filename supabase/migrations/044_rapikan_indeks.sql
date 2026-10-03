-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- 044 — Rapikan indeks (temuan Supabase Advisor, audit 3 Okt 2026)
--
-- 1. idx_daily_reports_customer (042) identik dengan idx_laporan_customer (013):
--    setiap simpan laporan harian memperbarui dua indeks yang sama. Yang lebih
--    baru dihapus; yang lama tetap melayani kueri per customer.
-- 2. Relasi sm_impor → users (dibuat_oleh, dibatalkan_oleh) belum berindeks:
--    menghapus/menonaktifkan pengguna memindai seluruh riwayat impor.
-- Tidak mengubah data. Aman dijalankan ulang.
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_daily_reports_customer;

CREATE INDEX IF NOT EXISTS idx_impor_dibuat_oleh     ON public.sm_impor (dibuat_oleh);
CREATE INDEX IF NOT EXISTS idx_impor_dibatalkan_oleh ON public.sm_impor (dibatalkan_oleh);
