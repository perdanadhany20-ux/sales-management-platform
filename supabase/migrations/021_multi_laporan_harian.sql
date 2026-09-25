-- ════════════════════════════════════════════════════════════════════════════
-- 021 — Sales boleh mengirim lebih dari satu Daily Report per hari
--
-- idx_daily_report_satu_per_hari (migrasi 002, §14) awalnya menegakkan "satu
-- laporan per Sales per hari". Aturan itu ternyata tidak cocok dengan cara
-- kerja lapangan: seorang Sales bisa mengunjungi beberapa customer dalam
-- sehari, dan tiap kunjungan pantas punya laporannya sendiri — bukan
-- dipaksa digabung ke satu baris atau ditolak dengan "sudah membuat laporan
-- untuk tanggal ini".
--
-- Kepatuhan laporan harian (sm_dashboard_ringkasan, migrasi 009) TIDAK
-- terpengaruh: dihitung dengan count(DISTINCT sales_user_id), bukan
-- count(*), jadi "sudah lapor hari ini" tetap berarti "minimal satu
-- laporan", bukan "tepat satu".
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_daily_report_satu_per_hari;
