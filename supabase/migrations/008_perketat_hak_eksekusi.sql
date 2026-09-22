-- ════════════════════════════════════════════════════════════════════════════
-- 008 — Perketat hak eksekusi fungsi SECURITY DEFINER
--
-- Ditemukan oleh database linter Supabase (0028/0029) setelah 004 diterapkan:
-- ketiga fungsi alur meeting bisa dipanggil peran `anon` lewat
-- /rest/v1/rpc/. Badan fungsinya memang sudah menolak pemanggil tanpa
-- identitas (sm_uid() NULL → error 28000), jadi ini bukan lubang yang bisa
-- ditembus — tapi tidak ada alasan membiarkan pintunya terbuka.
--
-- Migrasi ini dipertahankan terpisah, bukan dilebur ke 004, supaya riwayat
-- basis data yang sudah berjalan tetap jujur. 004 juga sudah diperbaiki agar
-- pemasangan baru langsung benar sejak awal; menjalankan keduanya berurutan
-- aman karena REVOKE/GRANT bersifat idempoten.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           FROM anon, public;

REVOKE EXECUTE ON FUNCTION public.sm_evidence_naikkan_state()
  FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           TO authenticated;
