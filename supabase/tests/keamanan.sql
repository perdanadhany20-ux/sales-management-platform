-- ════════════════════════════════════════════════════════════════════════════
-- Uji keamanan alur Meeting — §98, §99, §100, §101
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip TIDAK diakhiri COMMIT: begitu koneksinya tutup, seluruh data uji
-- hilang dengan sendirinya. Jangan menambahkan COMMIT di bawah.
--
-- Cara membaca: kolom `nyata` harus sama persis dengan `harapan` di kesembilan
-- baris. Satu saja meleset berarti ada penjaga yang jebol.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111','salesa','Sales A','SALES'),
  ('22222222-2222-2222-2222-222222222222','salesb','Sales B','SALES'),
  ('33333333-3333-3333-3333-333333333333','mgr','Manager','MANAGER');

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

RESET ROLE;

SELECT * FROM hasil ORDER BY no;

ROLLBACK;
