-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- HAPUS DATA DEMO — membersihkan seluruh data contoh skenario (akun demo.*)
--
-- Cara pakai: Supabase → SQL Editor → tempel SELURUH isi berkas → Run.
-- Tidak ada yang perlu diubah. Aman dijalankan berulang kali.
--
-- Yang dihapus HANYA milik 6 akun demo (demo.direktur, demo.manager,
-- demo.finance, demo.sari, demo.dimas, demo.ayu): akunnya, customer, lokasi,
-- proyek, pipeline, target, jadwal (beserta check-in & foto bukti di
-- database), laporan harian, GP Calculation, sesi, dan jejak audit mereka.
-- Data asli TIDAK disentuh:
--   - lokasi buatan akun demo yang sudah dipakai jadwal/proyek asli tetap ada;
--   - tanda "disetujui oleh" akun demo pada data asli dikosongkan saja,
--     status persetujuannya tetap.
-- Seluruh langkah dalam SATU transaksi: gagal sebagian = tidak ada yang terhapus.
--
-- Catatan: berkas foto bukti di Supabase Storage (bucket "evidence") tidak bisa
-- dihapus lewat SQL. Bila akun demo pernah mengunggah foto, hasil akhir berkas
-- ini menampilkan nama foldernya untuk dihapus dari Storage.
-- Untuk mengisi ulang data demo: jalankan lagi SQL FULL dengan DATA DEMO = true.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _demo ON COMMIT DROP AS
SELECT id, username FROM public.users
WHERE username IN ('demo.direktur', 'demo.manager', 'demo.finance', 'demo.sari', 'demo.dimas', 'demo.ayu');

-- Folder foto bukti di Storage (untuk dihapus manual bila ada).
CREATE TEMP TABLE _folder_foto ON COMMIT DROP AS
SELECT DISTINCT d.username, d.id::text || '/' AS folder_storage
FROM _demo d
WHERE EXISTS (SELECT 1 FROM public.sm_evidence e WHERE e.user_id = d.id);

DO $hapus$
DECLARE
  n_akun int;
  n_jadwal int; n_cust int; n_lok int; n_audit int;
BEGIN
  SELECT count(*) INTO n_akun FROM _demo;
  IF n_akun = 0 THEN
    RAISE NOTICE 'Tidak ada data demo — tidak ada yang dihapus.';
    RETURN;
  END IF;

  -- 1. Jejak akun demo pada data ASLI: kosongkan saja, jangan hapus datanya.
  UPDATE public.sm_locations  SET approved_by = NULL WHERE approved_by IN (SELECT id FROM _demo)
     AND (created_by IS NULL OR created_by NOT IN (SELECT id FROM _demo));
  UPDATE public.sm_exceptions SET approved_by = NULL WHERE approved_by IN (SELECT id FROM _demo);

  -- 2. Jadwal yang melibatkan akun demo (check-in, foto, GPS, pengecualian ikut terhapus).
  DELETE FROM public.sm_schedules
   WHERE assigned_to IN (SELECT id FROM _demo) OR created_by IN (SELECT id FROM _demo);
  GET DIAGNOSTICS n_jadwal = ROW_COUNT;

  -- 3. Customer milik akun demo (tautan di data lain menjadi kosong, datanya tetap).
  DELETE FROM public.sm_customers WHERE created_by IN (SELECT id FROM _demo);
  GET DIAGNOSTICS n_cust = ROW_COUNT;

  -- 4. Proyek, pipeline, laporan, target, GP milik akun demo — lewat akunnya
  --    (CASCADE), tetapi lokasi proyek demo dilepas dulu supaya bisa dihapus.
  DELETE FROM public.sm_projects WHERE owner_user_id IN (SELECT id FROM _demo);

  -- 5. Lokasi buatan akun demo yang TIDAK dipakai jadwal/proyek asli.
  DELETE FROM public.sm_locations l
   WHERE l.created_by IN (SELECT id FROM _demo)
     AND NOT EXISTS (SELECT 1 FROM public.sm_schedules s WHERE s.location_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM public.sm_projects  p WHERE p.location_id = l.id);
  GET DIAGNOSTICS n_lok = ROW_COUNT;
  UPDATE public.sm_locations SET approved_by = NULL WHERE approved_by IN (SELECT id FROM _demo);

  -- 6. Jejak audit & percobaan login akun demo.
  DELETE FROM public.audit_trail WHERE actor_id IN (SELECT id FROM _demo);
  GET DIAGNOSTICS n_audit = ROW_COUNT;
  DELETE FROM public.login_attempts WHERE username IN (SELECT username FROM _demo);

  -- 7. Akunnya. Sisa milik akun (kredensial, sesi, 2FA, menu khusus, pipeline,
  --    laporan, target, GP, check-in) terhapus lewat CASCADE; atasan pengguna
  --    asli yang menunjuk akun demo menjadi kosong (SET NULL).
  UPDATE public.users SET manager_id = NULL WHERE id IN (SELECT id FROM _demo);
  DELETE FROM public.users WHERE id IN (SELECT id FROM _demo);

  RAISE NOTICE 'Data demo dihapus: % akun, % jadwal, % customer, % lokasi, % jejak audit (beserta proyek, pipeline, laporan, target, GP milik akun demo).',
    n_akun, n_jadwal, n_cust, n_lok, n_audit;
END
$hapus$;

SELECT 'Folder foto demo di Storage (bucket evidence) — hapus dari Dashboard Storage' AS catatan,
       username, folder_storage
FROM _folder_foto;

COMMIT;

SELECT (SELECT count(*) FROM public.users WHERE username LIKE 'demo.%') AS sisa_akun_demo;
