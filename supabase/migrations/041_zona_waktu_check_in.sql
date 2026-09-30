-- ════════════════════════════════════════════════════════════════════════════
-- 041 — Check-in kembali memakai tanggal WIB
--
-- Migrasi 026 memasang `SET "TimeZone" TO 'Asia/Jakarta'` pada sm_check_in()
-- karena database berjalan di UTC: tanpa itu `current_date` tertinggal satu
-- hari antara 00:00–06:59 WIB, dan check-in meeting yang sah pada jam itu
-- ditolak dengan SCHEDULE_MISMATCH ("Jadwal ini bukan untuk hari ini").
--
-- Klausa itu melekat pada tanda tangan fungsi lama (4 parameter). Ketika
-- sm_check_in() ditulis ulang dengan 11 parameter (032, 039, 040), fungsi
-- barunya lahir tanpa klausa tersebut — regresi yang baru terlihat saat
-- check-in dicoba sebelum pukul 07.00 WIB.
-- ════════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb)
  SET "TimeZone" TO 'Asia/Jakarta';

-- Penyelesaian dan override tidak membandingkan tanggal hari ini, tetapi
-- ikut disetel supaya setiap fungsi alur meeting membaca waktu yang sama.
ALTER FUNCTION public.sm_complete_schedule(uuid) SET "TimeZone" TO 'Asia/Jakarta';
ALTER FUNCTION public.sm_override_completion(uuid, text) SET "TimeZone" TO 'Asia/Jakarta';
