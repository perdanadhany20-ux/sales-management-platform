-- ════════════════════════════════════════════════════════════════════════════
-- Uji lisensi & hak fitur — migrasi 037
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip diakhiri ROLLBACK: data uji tidak pernah tersimpan, dan baris
-- sm_lisensi yang sebenarnya dikembalikan seperti semula.
--
-- Yang dijaga:
--   • Pengguna aplikasi (termasuk Admin) tidak bisa membaca/mengubah salinan
--     lisensi — tidak bisa menambah fitur, memperpanjang, atau mengubah status.
--   • Fitur tak berlisensi tertutup di database, bukan hanya di menu —
--     termasuk lewat fungsi SECURITY DEFINER.
--   • Kedaluwarsa, penangguhan, dan tenggang 7 hari ditegakkan oleh waktu
--     database sendiri, tanpa menunggu server memeriksa ulang.
--   • Downgrade tidak menghapus data; upgrade memunculkannya kembali.
--   • RLS lama tetap berlaku (lisensi tidak pernah melampaui peran).
--
-- Cara membaca: kolom `nyata` harus sama persis dengan `harapan` di setiap baris.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

-- Lisensi asli (kalau ada) disingkirkan dulu; ROLLBACK mengembalikannya.
DELETE FROM public.sm_lisensi;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('f1111111-1111-4111-8111-111111111111','lssalesa','Lisensi Sales A','SALES'),
  ('f2222222-2222-4222-8222-222222222222','lssalesb','Lisensi Sales B','SALES'),
  ('f4444444-4444-4444-8444-444444444444','lsadmin','Lisensi Admin','ADMIN');

INSERT INTO public.sm_daily_reports (id, sales_user_id, report_date, customer_name, activity, result, next_action)
VALUES ('fd000000-0000-4000-8000-000000000001','f1111111-1111-4111-8111-111111111111', current_date,
        'Customer Uji Lisensi','Kunjungan','Hasil','Tindak lanjut');

INSERT INTO public.sm_pipeline (id, sales_user_id, customer_name, project_detail,
                                project_value, estimated_closing, next_action)
VALUES ('fe000000-0000-4000-8000-000000000001','f1111111-1111-4111-8111-111111111111',
        'Customer Uji Lisensi','Proyek uji', 100000000, current_date + 30, 'Tindak lanjut');

-- Fungsi DEFINER uji: meniru RPC seperti sm_gp_ajukan yang melewati RLS.
CREATE FUNCTION pg_temp.uji_definer_pipeline() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.sm_pipeline SET next_action = 'lewat definer'
   WHERE id = 'fe000000-0000-4000-8000-000000000001';
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.uji_definer_pipeline() TO authenticated;

-- ══ 1. Belum ada lisensi sama sekali ═══════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 1,'Tanpa lisensi: Sales melihat laporannya','0 baris',
  count(*)::text||' baris' FROM public.sm_daily_reports WHERE id = 'fd000000-0000-4000-8000-000000000001';

DO $x$ BEGIN
  BEGIN
    INSERT INTO public.sm_daily_reports (sales_user_id, report_date, customer_name, activity, result, next_action)
    VALUES ('f1111111-1111-4111-8111-111111111111', current_date, 'X','X','X','X');
    INSERT INTO hasil VALUES (2,'Tanpa lisensi: Sales membuat laporan','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (2,'Tanpa lisensi: Sales membuat laporan','ditolak',
      CASE WHEN SQLERRM = 'FEATURE_NOT_LICENSED' THEN 'ditolak' ELSE 'pesan lain: '||SQLERRM END);
  END;
END $x$;

INSERT INTO hasil SELECT 3,'Tanpa lisensi: fitur keadaan-terbatas tetap hidup','admin_settings',
  CASE WHEN public.sm_fitur_berlisensi('admin_settings') AND NOT public.sm_fitur_berlisensi('pipeline')
       THEN 'admin_settings' ELSE 'salah' END;

-- ══ 2. Admin pelanggan tidak bisa menyentuh salinan lisensi ════════════════
SELECT set_config('request.jwt.claims','{"sub":"f4444444-4444-4444-8444-444444444444","role":"authenticated","user_role":"ADMIN"}',true);

DO $x$ BEGIN
  BEGIN
    PERFORM 1 FROM public.sm_lisensi;
    INSERT INTO hasil VALUES (4,'Admin membaca sm_lisensi','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (4,'Admin membaca sm_lisensi','ditolak','ditolak');
  END;
END $x$;

DO $x$ BEGIN
  BEGIN
    INSERT INTO public.sm_lisensi (status, package, features, expires_at, last_verified_at)
    VALUES ('ACTIVE','ENTERPRISE','{"pipeline":true}', now() + interval '10 years', now());
    INSERT INTO hasil VALUES (5,'Admin memberi dirinya lisensi','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (5,'Admin memberi dirinya lisensi','ditolak','ditolak');
  END;
END $x$;

RESET ROLE;

-- ══ 3. STARTER aktif (ditulis server/pemilik) ══════════════════════════════
INSERT INTO public.sm_lisensi (deployment_id, license_id, status, package, features,
                               starts_at, expires_at, last_verified_at)
VALUES ('SMA-UJI-2026-001','LIC-SMA-2026-9999','ACTIVE','STARTER',
  '{"dashboard":true,"customer":true,"sales_activity":true,"daily_report":true,"admin_settings":true,"notifications":true,"pipeline":false}',
  now() - interval '1 day', now() + interval '200 days', now());

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"sub":"f4444444-4444-4444-8444-444444444444","role":"authenticated","user_role":"ADMIN"}',true);
DO $x$ BEGIN
  BEGIN
    UPDATE public.sm_lisensi SET expires_at = now() + interval '10 years';
    INSERT INTO hasil VALUES (6,'Admin memperpanjang lisensi sendiri','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (6,'Admin memperpanjang lisensi sendiri','ditolak','ditolak');
  END;
END $x$;

SELECT set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 7,'STARTER: Sales melihat laporannya','1 baris',
  count(*)::text||' baris' FROM public.sm_daily_reports WHERE id = 'fd000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 8,'STARTER: pipeline tidak tersedia','0 baris',
  count(*)::text||' baris' FROM public.sm_pipeline WHERE id = 'fe000000-0000-4000-8000-000000000001';

DO $x$ BEGIN
  BEGIN
    PERFORM pg_temp.uji_definer_pipeline();
    INSERT INTO hasil VALUES (9,'STARTER: pipeline lewat fungsi DEFINER','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (9,'STARTER: pipeline lewat fungsi DEFINER','ditolak',
      CASE WHEN SQLERRM = 'FEATURE_NOT_LICENSED' THEN 'ditolak' ELSE 'pesan lain: '||SQLERRM END);
  END;
END $x$;

-- Peran tetap berlaku: Sales B tidak melihat laporan Sales A walau fiturnya berlisensi.
SELECT set_config('request.jwt.claims','{"sub":"f2222222-2222-4222-8222-222222222222","role":"authenticated","user_role":"SALES"}',true);
INSERT INTO hasil SELECT 10,'Lisensi tidak melampaui peran (Sales B)','0 baris',
  count(*)::text||' baris' FROM public.sm_daily_reports WHERE id = 'fd000000-0000-4000-8000-000000000001';

RESET ROLE;

-- ══ 4. Upgrade STARTER → PROFESSIONAL tanpa redeploy ═══════════════════════
UPDATE public.sm_lisensi SET package = 'PROFESSIONAL',
  features = features || '{"pipeline":true,"meeting":true,"schedule":true}'::jsonb;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","user_role":"SALES"}',true);
INSERT INTO hasil SELECT 11,'PROFESSIONAL: pipeline lama muncul kembali','1 baris',
  count(*)::text||' baris' FROM public.sm_pipeline WHERE id = 'fe000000-0000-4000-8000-000000000001';
RESET ROLE;

-- ══ 5. Downgrade tidak menghapus data ══════════════════════════════════════
UPDATE public.sm_lisensi SET package = 'STARTER', features = features || '{"pipeline":false}'::jsonb;
INSERT INTO hasil SELECT 12,'Downgrade: baris pipeline tetap ada di database','1 baris',
  count(*)::text||' baris' FROM public.sm_pipeline WHERE id = 'fe000000-0000-4000-8000-000000000001';

-- ══ 6. Status & tanggal ════════════════════════════════════════════════════
UPDATE public.sm_lisensi SET expires_at = now() - interval '1 minute';
INSERT INTO hasil SELECT 13,'Kedaluwarsa: daily report tertutup','false',
  public.sm_fitur_berlisensi('daily_report')::text;

UPDATE public.sm_lisensi SET expires_at = now() + interval '200 days', status = 'SUSPENDED';
INSERT INTO hasil SELECT 14,'Ditangguhkan: daily report tertutup','false',
  public.sm_fitur_berlisensi('daily_report')::text;

UPDATE public.sm_lisensi SET status = 'REVOKED';
INSERT INTO hasil SELECT 15,'Dicabut: daily report tertutup','false',
  public.sm_fitur_berlisensi('daily_report')::text;

UPDATE public.sm_lisensi SET status = 'ACTIVE', last_verified_at = now() - interval '3 days';
INSERT INTO hasil SELECT 16,'Authority mati 3 hari (dalam tenggang)','true',
  public.sm_fitur_berlisensi('daily_report')::text;

UPDATE public.sm_lisensi SET last_verified_at = now() - interval '8 days';
INSERT INTO hasil SELECT 17,'Authority mati 8 hari (lewat tenggang)','false',
  public.sm_fitur_berlisensi('daily_report')::text;
INSERT INTO hasil SELECT 18,'Lewat tenggang tidak membuka semua fitur','false',
  public.sm_fitur_berlisensi('pipeline')::text;

UPDATE public.sm_lisensi SET last_verified_at = now(), status = 'INVALID';
INSERT INTO hasil SELECT 19,'Token dirusak (INVALID): tertutup','false',
  public.sm_fitur_berlisensi('daily_report')::text;

-- ══ 7. Lisensi CUSTOM mengikuti fitur persis ═══════════════════════════════
UPDATE public.sm_lisensi SET status = 'ACTIVE', package = 'CUSTOM',
  features = '{"dashboard":true,"customer":true,"sales_activity":true,"daily_report":true,"pipeline":true,"meeting":false,"schedule":true,"project":false,"gp_calculation":true,"advanced_reporting":false,"approval":false,"notifications":true}';
INSERT INTO hasil SELECT 20,'CUSTOM: pipeline/schedule/gp ya, meeting/project tidak','t t t f f',
  concat_ws(' ',
    left(public.sm_fitur_berlisensi('pipeline')::text,1),
    left(public.sm_fitur_berlisensi('schedule')::text,1),
    left(public.sm_fitur_berlisensi('gp_calculation')::text,1),
    left(public.sm_fitur_berlisensi('meeting')::text,1),
    left(public.sm_fitur_berlisensi('project')::text,1));

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
