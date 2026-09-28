-- ════════════════════════════════════════════════════════════════════════════
-- Uji check-in lewat aplikasi Android — migrasi 039
--
-- Jalankan sebagai pemilik basis data SETELAH kunci aplikasi terpasang di
-- sm_kunci_aplikasi. Laporan uji ditandatangani DI SINI memakai kunci itu,
-- persis seperti yang dilakukan APK. Skrip diakhiri ROLLBACK.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('d9000000-0000-4000-8000-000000000001','apsales','Aplikasi Sales','SALES');
INSERT INTO public.sm_locations (id, name, latitude, longitude, gps_radius_m)
VALUES ('d9000000-0000-4000-8000-0000000000a1','Kantor Uji Aplikasi',-6.2000000,106.8000000,100);
INSERT INTO public.sm_schedules (id, schedule_date, customer_name, category, requires_attendance, assigned_to, location_id)
SELECT ('d9000000-0000-4000-8000-00000000001'||g)::uuid, current_date, 'Cust '||g, 'MEETING', true,
       'd9000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-0000000000a1'
FROM generate_series(0,7) g;

-- Pembuat laporan bertanda tangan, meniru PembacaLokasi.java.
CREATE FUNCTION pg_temp.laporan(p_jadwal uuid, p_lat numeric, p_lng numeric, p_mock int,
                                p_waktu_ms bigint, p_nonce text, p_rusak boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $f$
  WITH m AS (SELECT format('v1|%s|%s|%s|8.5|%s|%s|1.0.0|%s', p_jadwal,
                           to_char(p_lat, 'FM990.0000000'), to_char(p_lng, 'FM990.0000000'),
                           p_mock, p_waktu_ms, p_nonce) AS muatan)
  SELECT jsonb_build_object('native', jsonb_build_object(
    'payload', m.muatan,
    'tanda', CASE WHEN p_rusak THEN repeat('0', 64)
                  ELSE encode(extensions.hmac(convert_to(m.muatan,'UTF8'),
                        convert_to((SELECT kunci FROM public.sm_kunci_aplikasi WHERE id),'UTF8'),'sha256'),'hex') END,
    'versi', '1.0.0'))
  FROM m
$f$;
CREATE FUNCTION pg_temp.skrg() RETURNS bigint LANGUAGE sql AS $f$ SELECT (extract(epoch FROM now())*1000)::bigint $f$;

-- Laporan dibuat sebagai pemilik (butuh kunci), lalu dipakai sebagai Sales.
CREATE TEMP TABLE lap(no int, sinyal jsonb) ON COMMIT DROP;
GRANT ALL ON lap TO authenticated;
INSERT INTO lap VALUES
  (1, pg_temp.laporan('d9000000-0000-4000-8000-000000000010', -6.2000100, 106.8000200, 0, pg_temp.skrg(), 'aa01')),
  (2, pg_temp.laporan('d9000000-0000-4000-8000-000000000011', -6.2000100, 106.8000200, 1, pg_temp.skrg(), 'aa02')),
  (3, pg_temp.laporan('d9000000-0000-4000-8000-000000000012', -6.2000100, 106.8000200, 0, pg_temp.skrg(), 'aa03', true)),
  (5, pg_temp.laporan('d9000000-0000-4000-8000-000000000014', -6.2000100, 106.8000200, 0, pg_temp.skrg() - 3600000, 'aa05')),
  (6, pg_temp.laporan('d9000000-0000-4000-8000-000000000015', -6.2000100, 106.8000200, 0, pg_temp.skrg(), 'aa06')),
  (7, pg_temp.laporan('d9000000-0000-4000-8000-000000000016', -6.2000100, 106.8000200, 0, pg_temp.skrg(), 'aa07')),
  -- 040: bertanda tangan sah (kunci bisa dibongkar dari APK) dan tepat di kantor,
  -- padahal jejak terakhir pengguna ini di Surabaya sedetik sebelumnya.
  (10, pg_temp.laporan('d9000000-0000-4000-8000-000000000016', -6.2000100, 106.8000200, 0, pg_temp.skrg(), 'aa10'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 1,'Laporan aplikasi sah, lokasi asli','VALID',
  public.sm_check_in('d9000000-0000-4000-8000-000000000010', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=1))->>'validation_status';

INSERT INTO hasil SELECT 2,'Aplikasi mendeteksi fake GPS','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000011', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=2))->>'validation_status';

INSERT INTO hasil SELECT 3,'Tanda tangan dikarang (dikirim langsung ke API)','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000012', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=3))->>'validation_status';

-- Laporan no. 1 dipakai lagi untuk jadwal yang sama (dibuka ulang).
INSERT INTO hasil SELECT 4,'Laporan sah dipakai ulang (replay)','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000010', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=1))->>'validation_status';

INSERT INTO hasil SELECT 5,'Laporan basi (1 jam lalu)','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000014', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=5))->>'validation_status';

INSERT INTO hasil SELECT 6,'Titik check-in diganti dari laporan aslinya','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000015', -6.2100000, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=6))->>'validation_status';

INSERT INTO hasil SELECT 7,'Laporan jadwal lain dipakai untuk jadwal ini','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000017', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=7))->>'validation_status';

-- Mode wajib aplikasi
RESET ROLE;
INSERT INTO public.sm_gps_events (schedule_id, user_id, event_type, latitude, longitude, validation_status, created_at)
VALUES ('d9000000-0000-4000-8000-000000000017', 'd9000000-0000-4000-8000-000000000001', 'CHECK_IN',
        -7.2500000, 112.7500000, 'VALID', now() + interval '1 second');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 10,'Laporan aplikasi sah tetap dinilai server (Surabaya → kantor Jakarta)','SUSPECTED_MOCK',
  public.sm_check_in('d9000000-0000-4000-8000-000000000016', -6.2000100, 106.8000200, 8.5,
    NULL,NULL,NULL,NULL,now(),NULL,(SELECT sinyal FROM lap WHERE no=10))->>'validation_status';

RESET ROLE;
UPDATE public.sm_settings SET value = 'true'::jsonb WHERE key = 'checkin_wajib_aplikasi';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 8,'Wajib aplikasi: check-in dari browser','APP_REQUIRED',
  public.sm_check_in('d9000000-0000-4000-8000-000000000013', -6.2000100, 106.8000200, 8.7,
    32.5, 6.0, NULL, NULL, now(),
    '[{"lat":-6.20001,"lng":106.80002,"accuracy":8.7,"t":1},{"lat":-6.200014,"lng":106.800026,"accuracy":9.2,"t":2}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":2,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

INSERT INTO hasil SELECT 9,'Kunci aplikasi tidak bisa dibaca Sales','ditolak',
  CASE WHEN has_table_privilege('authenticated', 'public.sm_kunci_aplikasi', 'SELECT') THEN 'DITERIMA' ELSE 'ditolak' END;

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
