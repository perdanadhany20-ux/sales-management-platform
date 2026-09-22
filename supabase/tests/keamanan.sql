-- ════════════════════════════════════════════════════════════════════════════
-- Uji keamanan alur Meeting — §98, §99, §100, §101
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip TIDAK diakhiri COMMIT: begitu koneksinya tutup, seluruh data uji
-- hilang dengan sendirinya. Jangan menambahkan COMMIT di bawah.
--
-- Cara membaca: kolom `nyata` harus sama persis dengan `harapan` di kesembilan
-- belas baris. Satu saja meleset berarti ada penjaga yang jebol.
--
-- Uji 10–14 ditambahkan bersama modul Activity dan Dashboard Setting: view
-- aktivitas, pengaturan branding, dan kepemilikan bukti adalah permukaan baru,
-- dan permukaan baru tanpa uji adalah tempat kebocoran berikutnya bersembunyi.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111','salesa','Sales A','SALES'),
  ('22222222-2222-2222-2222-222222222222','salesb','Sales B','SALES'),
  ('33333333-3333-3333-3333-333333333333','mgr','Manager','MANAGER'),
  ('44444444-4444-4444-4444-444444444445','dir','Director','DIRECTOR'),
  ('55555555-5555-5555-5555-555555555556','fin','Finance','FINANCE');

INSERT INTO public.sm_locations (id, name, latitude, longitude, gps_radius_m, created_by)
VALUES ('44444444-4444-4444-4444-444444444444','Kantor Monas',-6.1753924,106.8271528,50,
        '33333333-3333-3333-3333-333333333333');

INSERT INTO public.sm_schedules
  (id, schedule_date, customer_name, category, requires_attendance, assigned_to, location_id, created_by)
VALUES ('55555555-5555-5555-5555-555555555555', current_date, 'PT Uji Coba', 'Meeting', true,
        '11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333');

-- Sampai baris di atas skrip berjalan sebagai pemilik, yang MELEWATI RLS.
-- Mulai di sini peran diturunkan supaya policy benar-benar diuji — tanpa
-- baris ini seluruh uji di bawah akan "lulus" tanpa arti.
SET LOCAL ROLE authenticated;

-- ══ Sebagai Sales B — bukan yang ditugaskan ═════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 1,'§98 Sales B melihat jadwal Sales A','0 baris', count(*)::text||' baris'
  FROM public.sm_schedules WHERE id='55555555-5555-5555-5555-555555555555';

INSERT INTO hasil SELECT 2,'§98 Sales B check-in di meeting Sales A','ASSIGNMENT_MISMATCH',
  public.sm_check_in('55555555-5555-5555-5555-555555555555',-6.1754,106.8272,10)->>'validation_status';

-- ══ Sebagai Sales A — yang ditugaskan ═══════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","user_role":"SALES"}',true);

-- Inti §37: menembak status langsung lewat PostgREST. Tidak ada policy UPDATE
-- untuk Sales, jadi yang terjadi bukan error melainkan NOL baris tersentuh.
WITH u AS (UPDATE public.sm_schedules SET status='COMPLETED'
            WHERE id='55555555-5555-5555-5555-555555555555' RETURNING 1)
INSERT INTO hasil SELECT 3,'§99 Sales UPDATE status=COMPLETED langsung','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

INSERT INTO hasil SELECT 4,'§99 selesaikan tanpa check-in','NO_ATTENDANCE',
  public.sm_complete_schedule('55555555-5555-5555-5555-555555555555')->>'reason';

INSERT INTO hasil SELECT 5,'§100 check-in dari 3 km jauhnya','OUTSIDE_RADIUS',
  public.sm_check_in('55555555-5555-5555-5555-555555555555',-6.2000,106.8160,10)->>'validation_status';

INSERT INTO hasil SELECT 6,'§31 check-in dengan akurasi GPS 250 m','LOW_ACCURACY',
  public.sm_check_in('55555555-5555-5555-5555-555555555555',-6.1754,106.8272,250)->>'validation_status';

INSERT INTO hasil SELECT 7,'§29 check-in dari dalam radius','VALID',
  public.sm_check_in('55555555-5555-5555-5555-555555555555',-6.1754,106.8272,10)->>'validation_status';

INSERT INTO hasil SELECT 8,'§101 selesaikan tanpa foto bukti','NO_EVIDENCE',
  public.sm_complete_schedule('55555555-5555-5555-5555-555555555555')->>'reason';

-- Empat percobaan check-in terjadi, tapi yang TERLIHAT Sales A hanya tiga —
-- percobaan Sales B disembunyikan policy gps_baca. Angka 3 di sini justru
-- bukti RLS pada tabel jejak ikut bekerja; kalau muncul 4, policy-nya bocor.
INSERT INTO hasil SELECT 9,'§42 jejak GPS tersaring per pemilik','3 jejak',
  count(*)::text||' jejak' FROM public.sm_gps_events
  WHERE schedule_id='55555555-5555-5555-5555-555555555555';

-- ══ Uji permukaan baru ══════════════════════════════════════════════════════

-- §47: nilai bisnis dan identitas platform hanya boleh disentuh Admin. Sales
-- yang bisa mengubah branding juga bisa mengubah ambang akurasi GPS — baris
-- pengaturan yang sama, policy yang sama.
WITH u AS (UPDATE public.sm_settings SET value = '{"nama_platform":"Diretas"}'::jsonb
            WHERE key = 'branding' RETURNING 1)
INSERT INTO hasil SELECT 10,'Sales mengubah pengaturan branding','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

-- Eskalasi peran: menaikkan diri sendiri jadi ADMIN lewat satu UPDATE adalah
-- jalan pintas paling murah yang ada. Tidak ada policy UPDATE untuk non-Admin
-- pada tabel users, jadi yang terjadi bukan error melainkan nol baris.
WITH u AS (UPDATE public.users SET role = 'ADMIN'
            WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
INSERT INTO hasil SELECT 11,'Sales menaikkan perannya sendiri jadi ADMIN','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

-- Manager pengawas, bukan pengelola akun. Ia melihat data seluruh tim tapi
-- tidak boleh mengangkat siapa pun jadi Admin.
SELECT set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","user_role":"MANAGER"}',true);

WITH u AS (UPDATE public.users SET role = 'ADMIN'
            WHERE id = '22222222-2222-2222-2222-222222222222' RETURNING 1)
INSERT INTO hasil SELECT 12,'Manager mengangkat Sales jadi ADMIN','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

-- Uji 15 & 16 adalah uji REGRESI untuk migrasi 013, yang memecah policy
-- `FOR ALL` menjadi INSERT/UPDATE/DELETE demi menghapus evaluasi ganda pada
-- SELECT. Memecah policy adalah tempat paling mudah hak tanpa sengaja hilang
-- atau bocor, jadi kedua arahnya diuji: yang boleh harus tetap boleh, yang
-- tidak boleh harus tetap ditolak.
WITH i AS (INSERT INTO public.sm_locations (name, latitude, longitude, created_by)
           VALUES ('Uji Manager', -6.2, 106.8, '33333333-3333-3333-3333-333333333333')
           RETURNING 1)
INSERT INTO hasil SELECT 15,'Manager menambah lokasi (harus BOLEH)','1 baris ditambah',
  count(*)::text||' baris ditambah' FROM i;

-- View aktivitas dibuat dengan security_invoker. Tanpa opsi itu ia berjalan
-- sebagai pemiliknya dan MELEWATI seluruh RLS tabel sumber — satu SELECT
-- membuka aktivitas seluruh tim bagi siapa pun.
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 13,'Sales B membaca jejak Sales A lewat activity feed','0 jejak',
  count(*)::text||' jejak' FROM public.sm_activity_feed
  WHERE entitas_id = '55555555-5555-5555-5555-555555555555';

-- §101: foto bukti tidak boleh ditempelkan ke kehadiran orang lain. Yang diuji
-- di sini policy ev_tulis, yang menuntut tiga syarat sekaligus — pemilik,
-- kecocokan jadwal, dan GPS yang sudah terverifikasi.
DO $lok$
BEGIN
  BEGIN
    INSERT INTO public.sm_locations (name, latitude, longitude) VALUES ('Palsu', -6.2, 106.8);
    INSERT INTO hasil VALUES (16,'Sales menambah lokasi meeting','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (16,'Sales menambah lokasi meeting','ditolak','ditolak');
  END;
END
$lok$;

DO $uji$
DECLARE v_att uuid;
BEGIN
  SELECT id INTO v_att FROM public.sm_attendance
   WHERE schedule_id = '55555555-5555-5555-5555-555555555555';

  BEGIN
    INSERT INTO public.sm_evidence (attendance_id, schedule_id, user_id, storage_path)
    VALUES (v_att, '55555555-5555-5555-5555-555555555555',
            '22222222-2222-2222-2222-222222222222', 'palsu.jpg');
    INSERT INTO hasil VALUES (14,'§101 Sales B menempelkan foto ke kehadiran Sales A','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO hasil VALUES (14,'§101 Sales B menempelkan foto ke kehadiran Sales A','ditolak','ditolak');
  END;
END
$uji$;

-- ══ Peran DIRECTOR & FINANCE (migrasi 015) ══════════════════════════════════
--
-- Keduanya ditambahkan ke sm_is_pengawas() karena menandatangani GP
-- Calculation. Yang diuji di sini DUA arah sekaligus: mereka memang bisa
-- melihat data tim (kalau tidak, tanda tangannya kosong), TAPI tetap bukan
-- Admin — sm_is_admin() sengaja tidak disentuh, sehingga pengelolaan akun
-- tetap tertutup bagi mereka.

SELECT set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444445","user_role":"DIRECTOR"}',true);

INSERT INTO hasil SELECT 17,'Director melihat jadwal seluruh tim','1 baris',
  count(*)::text||' baris' FROM public.sm_schedules
  WHERE id='55555555-5555-5555-5555-555555555555';

WITH u AS (UPDATE public.users SET role = 'ADMIN'
            WHERE id = '22222222-2222-2222-2222-222222222222' RETURNING 1)
INSERT INTO hasil SELECT 18,'Director mengangkat orang jadi ADMIN','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

SELECT set_config('request.jwt.claims','{"sub":"55555555-5555-5555-5555-555555555556","user_role":"FINANCE"}',true);

INSERT INTO hasil SELECT 19,'Finance melihat jadwal seluruh tim','1 baris',
  count(*)::text||' baris' FROM public.sm_schedules
  WHERE id='55555555-5555-5555-5555-555555555555';

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
