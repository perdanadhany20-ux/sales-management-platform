-- ════════════════════════════════════════════════════════════════════════════
-- Uji penolakan lokasi palsu — migrasi 032
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip TIDAK diakhiri COMMIT: begitu koneksinya tutup, data uji hilang
-- sendiri. Jangan menambahkan COMMIT di bawah.
--
-- Yang diuji di sini bukan hanya "apakah yang palsu tertolak". Setengah dari
-- berkas ini justru menguji hal sebaliknya: APAKAH YANG JUJUR TETAP LOLOS.
-- Penjaga yang terlalu galak jauh lebih merusak daripada tidak ada penjaga —
-- Sales yang check-in dari dalam gedung, di mana ponselnya hanya dapat fix
-- wifi tanpa ketinggian dan tanpa goyangan, TIDAK BOLEH dituduh menipu. Uji 2
-- dan 6 adalah pagar untuk itu, dan keduanya harus tetap hijau kalau suatu
-- saat ambangnya diutak-atik.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated, anon;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('9a111111-1111-4111-8111-111111111111','gpsa','GPS Sales A','SALES'),
  ('9a222222-2222-4222-8222-222222222222','gpsb','GPS Sales B','SALES');

INSERT INTO public.sm_locations (id, name, latitude, longitude, gps_radius_m)
VALUES ('9b000000-0000-4000-8000-000000000001','Kantor Uji',-6.2000000,106.8000000,100);

INSERT INTO public.sm_schedules
  (id, schedule_date, customer_name, category, requires_attendance, assigned_to, location_id)
SELECT ('9c000000-0000-4000-8000-00000000000'||g)::uuid, current_date,'Cust Uji '||g,'MEETING',true,
       '9a111111-1111-4111-8111-111111111111','9b000000-0000-4000-8000-000000000001'
FROM generate_series(1,7) g;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"9a111111-1111-4111-8111-111111111111","user_role":"SALES"}',true);

-- ══ 1. Sinyal GPS sungguhan — harus DITERIMA ════════════════════════════════
--
-- Ciri khasnya lengkap: lima sampel yang bergeser beberapa meter, ketinggian
-- ada, akurasi berupa pecahan yang berubah-ubah tiap sampel.
INSERT INTO hasil SELECT 1,'Fix GNSS sungguhan','VALID',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000001', -6.2000100, 106.8000200, 8.7,
    32.5, 6.0, 0.4, 187.0, now(),
    '[{"lat":-6.2000100,"lng":106.8000200,"accuracy":8.7,"t":1},
      {"lat":-6.2000140,"lng":106.8000260,"accuracy":9.2,"t":2},
      {"lat":-6.2000080,"lng":106.8000180,"accuracy":7.4,"t":3},
      {"lat":-6.2000190,"lng":106.8000310,"accuracy":11.1,"t":4},
      {"lat":-6.2000120,"lng":106.8000230,"accuracy":8.1,"t":5}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":120,"jumlah_sampel":5,"durasi_ms":6100}'::jsonb
  )->>'validation_status';

-- ══ 2. Fix wifi yang jujur — harus TETAP DITERIMA ═══════════════════════════
--
-- Di dalam gedung, ponsel sering hanya dapat fix wifi: titiknya beku, tidak
-- ada ketinggian. Semua itu juga ciri lokasi palsu — yang membedakan adalah
-- ia TIDAK mengaku presisi. Akurasi 42 m adalah pengakuan jujur, dan karena
-- itu tidak boleh diperlakukan sebagai penipuan.
INSERT INTO hasil SELECT 2,'Fix wifi jujur di dalam gedung','VALID',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000002', -6.2000000, 106.8000000, 42,
    NULL, NULL, NULL, NULL, now(),
    '[{"lat":-6.2000000,"lng":106.8000000,"accuracy":42,"t":1},
      {"lat":-6.2000000,"lng":106.8000000,"accuracy":42,"t":2},
      {"lat":-6.2000000,"lng":106.8000000,"accuracy":42,"t":3}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":3,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

-- ══ 3. Aplikasi fake GPS — harus DITOLAK ════════════════════════════════════
--
-- Titiknya PERSIS di tengah lokasi, jadi radius tidak akan menolaknya. Yang
-- menolak adalah pertentangan cirinya: mengaku akurasi 5 m (kelas satelit)
-- sambil sama sekali tidak bergoyang dan tanpa ketinggian.
INSERT INTO hasil SELECT 3,'Aplikasi fake GPS tepat di titik lokasi','SUSPECTED_MOCK',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000003', -6.2000000, 106.8000000, 5,
    NULL, NULL, NULL, NULL, now(),
    '[{"lat":-6.2000000,"lng":106.8000000,"accuracy":5,"t":1},
      {"lat":-6.2000000,"lng":106.8000000,"accuracy":5,"t":2},
      {"lat":-6.2000000,"lng":106.8000000,"accuracy":5,"t":3},
      {"lat":-6.2000000,"lng":106.8000000,"accuracy":5,"t":4}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":4,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

-- ══ 4. Geolocation API ditimpa ekstensi — harus DITOLAK ═════════════════════
INSERT INTO hasil SELECT 4,'Geolocation API sudah ditimpa','SUSPECTED_MOCK',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000004', -6.2000100, 106.8000200, 8.7,
    32.5, 6.0, NULL, NULL, now(),
    '[{"lat":-6.2000100,"lng":106.8000200,"accuracy":8.7,"t":1},
      {"lat":-6.2000140,"lng":106.8000260,"accuracy":9.2,"t":2},
      {"lat":-6.2000080,"lng":106.8000180,"accuracy":7.4,"t":3}]'::jsonb,
    '{"api_asli":false,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":3,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

-- ══ 5. Panggilan tanpa laporan sama sekali — harus DITOLAK ══════════════════
--
-- Inilah jalan pintas yang paling mungkin dicoba: memanggil RPC-nya langsung
-- dengan empat parameter lama, melewati seluruh pengumpulan sampel. Ketiadaan
-- laporan diperlakukan sebagai kecurigaan, bukan sebagai kelulusan.
INSERT INTO hasil SELECT 5,'Panggilan RPC tanpa laporan sinyal','SUSPECTED_MOCK',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000005', -6.2000000, 106.8000000, 10
  )->>'validation_status';

-- ══ 6. Check-in dari komputer — dicatat, tapi TIDAK diblokir sendirian ══════
--
-- Perangkat tanpa layar sentuh mencurigakan, tapi bukan bukti. Sales dengan
-- laptop berlayar sentuh, atau ponsel yang pelaporannya aneh, tidak boleh
-- kehilangan kehadirannya hanya karena satu sinyal ini.
INSERT INTO hasil SELECT 6,'Perangkat bukan layar sentuh','VALID',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000006', -6.2000100, 106.8000200, 8.7,
    32.5, 6.0, NULL, NULL, now(),
    '[{"lat":-6.2000100,"lng":106.8000200,"accuracy":8.7,"t":1},
      {"lat":-6.2000140,"lng":106.8000260,"accuracy":9.2,"t":2},
      {"lat":-6.2000080,"lng":106.8000180,"accuracy":7.4,"t":3}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":false,"selisih_jam_ms":0,"jumlah_sampel":3,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

-- ══ 7. Percobaan yang ditolak tetap meninggalkan jejak ══════════════════════
INSERT INTO hasil SELECT 7,'Jejak percobaan palsu tersimpan','1 baris',
  count(*)::text||' baris' FROM public.sm_gps_events
  WHERE schedule_id='9c000000-0000-4000-8000-000000000003'
    AND validation_status='SUSPECTED_MOCK';

INSERT INTO hasil SELECT 8,'Alasannya ikut tercatat','ada',
  CASE WHEN 'TITIK_BEKU_TAPI_MENGAKU_PRESISI' = ANY(spoof_signals)
        AND 'TANPA_KETINGGIAN_TAPI_MENGAKU_PRESISI' = ANY(spoof_signals)
       THEN 'ada' ELSE coalesce(array_to_string(spoof_signals,','),'(kosong)') END
  FROM public.sm_gps_events WHERE schedule_id='9c000000-0000-4000-8000-000000000003';

-- ══ 9. Kehadiran TIDAK terbentuk dari check-in yang ditolak ═════════════════
--
-- Yang paling penting dari seluruh berkas ini: status boleh apa saja, tapi
-- kalau baris kehadirannya tetap terbentuk, seluruh penjaga ini tidak ada
-- artinya — meeting akan terhitung hadir.
INSERT INTO hasil SELECT 9,'Kehadiran dari check-in palsu','0 baris',
  count(*)::text||' baris' FROM public.sm_attendance
  WHERE schedule_id='9c000000-0000-4000-8000-000000000003';

-- ══ 10. Teleportasi tercatat ════════════════════════════════════════════════
--
-- Sinyal satu-satunya yang tidak bisa dikarang klien: dihitung dari jejak yang
-- sudah tersimpan. Sesudah check-in sah di Jakarta beberapa detik lalu, titik
-- di Surabaya mustahil. Ia tidak memblokir sendirian — yang diuji di sini
-- adalah bahwa tandanya benar-benar terbit.
SELECT public.sm_check_in(
  '9c000000-0000-4000-8000-000000000007', -7.2500000, 112.7500000, 8.7,
  32.5, 6.0, NULL, NULL, now(),
  '[{"lat":-7.2500000,"lng":112.7500000,"accuracy":8.7,"t":1},
    {"lat":-7.2500040,"lng":112.7500060,"accuracy":9.2,"t":2},
    {"lat":-7.2499980,"lng":112.7499980,"accuracy":7.4,"t":3}]'::jsonb,
  '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":3,"durasi_ms":6000}'::jsonb
);

INSERT INTO hasil SELECT 10,'Pindah kota dalam hitungan detik','ada',
  CASE WHEN 'PINDAH_TERLALU_CEPAT' = ANY(spoof_signals) THEN 'ada'
       ELSE coalesce(array_to_string(spoof_signals,','),'(kosong)') END
  FROM public.sm_gps_events WHERE schedule_id='9c000000-0000-4000-8000-000000000007';

-- ══ 11. Regresi: penjaga lama tetap berdiri ═════════════════════════════════
--
-- Sales B tidak boleh check-in pada meeting Sales A, sebaik apa pun sinyalnya.
-- Penugasan diperiksa LEBIH DULU daripada dugaan palsu, jadi jawabannya harus
-- tetap ASSIGNMENT_MISMATCH — bukan tertutup oleh status baru.
SELECT set_config('request.jwt.claims','{"sub":"9a222222-2222-4222-8222-222222222222","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 11,'Sales B check-in di meeting Sales A','ASSIGNMENT_MISMATCH',
  public.sm_check_in(
    '9c000000-0000-4000-8000-000000000001', -6.2000100, 106.8000200, 8.7,
    32.5, 6.0, NULL, NULL, now(),
    '[{"lat":-6.2000100,"lng":106.8000200,"accuracy":8.7,"t":1},
      {"lat":-6.2000140,"lng":106.8000260,"accuracy":9.2,"t":2},
      {"lat":-6.2000080,"lng":106.8000180,"accuracy":7.4,"t":3}]'::jsonb,
    '{"api_asli":true,"objek_asli":true,"sentuh":true,"selisih_jam_ms":0,"jumlah_sampel":3,"durasi_ms":6000}'::jsonb
  )->>'validation_status';

-- ══ 12. anon tidak boleh memanggil sm_check_in ══════════════════════════════
RESET ROLE;
DO $x$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.sm_check_in('9c000000-0000-4000-8000-000000000001', -6.2, 106.8, 9);
    INSERT INTO hasil VALUES (12,'anon memanggil sm_check_in','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (12,'anon memanggil sm_check_in','ditolak','ditolak');
  END;
  RESET ROLE;
END $x$;

-- ══ 13. Fungsi penilainya sendiri tidak boleh dipanggil klien ═══════════════
--
-- Kalau Sales bisa memanggilnya langsung, ia bisa mencoba-coba kombinasi
-- laporan sampai menemukan yang berskor rendah — tanpa meninggalkan jejak.
DO $x$ BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.sm_gps_skor_palsu(NULL, -6.2, 106.8, 5, NULL, NULL, '{}'::jsonb);
    INSERT INTO hasil VALUES (13,'Sales memanggil fungsi penilai','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (13,'Sales memanggil fungsi penilai','ditolak','ditolak');
  END;
  RESET ROLE;
END $x$;

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
