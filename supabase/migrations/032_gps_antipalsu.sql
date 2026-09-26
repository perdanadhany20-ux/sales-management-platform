-- ════════════════════════════════════════════════════════════════════════════
-- 032 — Menolak check-in dari lokasi palsu (fake GPS)
--
-- YANG PERLU DIPAHAMI LEBIH DULU, SUPAYA TIDAK ADA YANG MENGIRA INI MUTLAK:
--
-- Aplikasi web TIDAK BISA membedakan koordinat asli dari koordinat buatan
-- dengan pasti. Di Android, penyedia lokasi tiruan ("mock location provider")
-- menyuntik posisinya di tingkat sistem operasi, sehingga peramban menerima
-- angka itu sebagai lokasi yang sah dan meneruskannya lewat Geolocation API
-- seperti biasa. Bendera `isFromMockProvider` yang dipakai aplikasi native
-- Android TIDAK pernah diteruskan ke peramban — tidak ada padanannya di web.
-- Siapa pun yang menjanjikan "web app anti fake GPS 100%" sedang menjual
-- sesuatu yang tidak ada.
--
-- Yang bisa dilakukan, dan itulah isi migrasi ini: MENGENALI JEJAKNYA.
-- Sinyal GPS sungguhan punya sidik jari fisik yang sulit ditiru aplikasi
-- pemalsu, dan yang dinilai di sini bukan satu-satu nilainya, melainkan
-- PERTENTANGAN di antara mereka:
--
--   * Fix GNSS sungguhan selalu bergoyang. Berdiri diam pun, koordinatnya
--     bergeser 1–5 meter antar sampel. Aplikasi pemalsu mengembalikan angka
--     yang sama persis sampai tujuh desimal, setiap kali.
--   * Fix GNSS sungguhan membawa ketinggian (altitude). Aplikasi pemalsu
--     hampir selalu meninggalkannya kosong.
--   * Fix GNSS sungguhan memberi akurasi pecahan (8,734 m), bukan bulat.
--     Aplikasi pemalsu menyetel angka bulat yang rapi: 1, 5, 10, 20.
--   * Akurasi di bawah 1 meter tidak ada pada perangkat konsumen.
--
-- Satu nilai kosong belum berarti bohong — fix dari wifi/menara seluler juga
-- tidak punya ketinggian dan juga tidak bergoyang. Karena itu yang diberi
-- nilai besar adalah PERTENTANGANNYA: mengaku presisi 5 meter (kelas GNSS)
-- sambil tidak punya satu pun ciri GNSS. Fix wifi yang jujur mengaku akurasi
-- 40 meter tidak akan pernah diblokir oleh aturan ini.
--
-- Keputusannya dibuat DI SINI, di database, bukan di peramban. Peramban hanya
-- melaporkan sampel mentah; ia tidak pernah menyimpulkan sah atau tidak.
--
-- Batas jujur yang tetap ada: pemalsu yang mau bersusah payah bisa menambal
-- sendiri isi laporannya (mengarang sampel yang bergoyang dan ketinggian yang
-- masuk akal). Itu jauh lebih sulit daripada memasang aplikasi dari Play
-- Store, dan seluruh laporannya tetap tersimpan di sm_gps_events sehingga
-- polanya bisa dilihat pengawas. Untuk kepastian mutlak dibutuhkan aplikasi
-- Android native yang membaca isFromMockProvider — itu di luar platform ini.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tempat menyimpan bukti mentahnya ─────────────────────────────────────
--
-- Semua ini disimpan apa adanya, termasuk pada percobaan yang ditolak. Tanpa
-- bahan mentahnya, tuduhan "ini fake GPS" tidak bisa dipertanggungjawabkan ke
-- orang yang dituduh.

ALTER TABLE public.sm_gps_events
  ADD COLUMN IF NOT EXISTS altitude_m          numeric(10,2),
  ADD COLUMN IF NOT EXISTS altitude_accuracy_m numeric(10,2),
  ADD COLUMN IF NOT EXISTS speed_mps           numeric(10,2),
  ADD COLUMN IF NOT EXISTS heading_deg         numeric(6,2),
  ADD COLUMN IF NOT EXISTS client_time         timestamptz,
  ADD COLUMN IF NOT EXISTS samples             jsonb,
  ADD COLUMN IF NOT EXISTS client_signals      jsonb,
  ADD COLUMN IF NOT EXISTS spoof_score         smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spoof_signals       text[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ip_hint             text;

-- Status baru. Dibedakan dari OUTSIDE_RADIUS supaya laporan bisa memisahkan
-- "salah tempat" (bisa jadi jujur) dari "lokasinya tidak masuk akal".
ALTER TABLE public.sm_gps_events DROP CONSTRAINT IF EXISTS sm_gps_events_validation_status_check;
ALTER TABLE public.sm_gps_events ADD CONSTRAINT sm_gps_events_validation_status_check
  CHECK (validation_status IN ('VALID', 'SCHEDULE_MISMATCH', 'ASSIGNMENT_MISMATCH',
                               'LOW_ACCURACY', 'OUTSIDE_RADIUS', 'NO_LOCATION',
                               'ALREADY_CLOSED', 'SUSPECTED_MOCK'));

-- Dipakai pemeriksaan "teleportasi": mencari jejak sah terakhir milik satu
-- orang. Tanpa indeks ini, setiap check-in memindai seluruh tabel jejak.
CREATE INDEX IF NOT EXISTS idx_gps_events_user_waktu
  ON public.sm_gps_events (user_id, created_at DESC);

-- ── 2. Ambang batas, bisa disetel admin tanpa mengubah kode ─────────────────

INSERT INTO public.sm_settings (key, value) VALUES
  ('gps_spoof_block_score', '60'::jsonb),
  ('gps_spoof_warn_score',  '30'::jsonb),
  ('gps_max_kmh',          '300'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sm_angka_setelan(p_key text, p_bawaan numeric)
RETURNS numeric LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM public.sm_settings WHERE key = p_key),
                  p_bawaan);
$$;

-- ── 3. Penilaiannya ─────────────────────────────────────────────────────────
--
-- Mengembalikan {skor, tanda[]}. Tidak memutuskan apa pun sendiri — yang
-- membandingkan skor dengan ambang adalah sm_check_in().

CREATE OR REPLACE FUNCTION public.sm_gps_skor_palsu(
  p_uid      uuid,
  p_lat      numeric,
  p_lng      numeric,
  p_accuracy numeric,
  p_altitude numeric,
  p_samples  jsonb,
  p_signals  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_skor   int := 0;
  v_tanda  text[] := '{}';
  v_n      int := 0;
  v_jitter numeric := NULL;
  v_akurasi_unik int := 0;
  -- Akurasi "kelas GNSS": di bawah nilai ini, perangkat sedang mengaku punya
  -- fix satelit sungguhan — dan karena itu wajib menunjukkan ciri-cirinya.
  v_presisi CONSTANT numeric := 15;
  v_prev   record;
  v_jarak  numeric;
  v_detik  numeric;
  v_kmh    numeric;
BEGIN
  -- ══ a. Laporan tidak ada sama sekali ══════════════════════════════════════
  -- Diperlakukan sebagai sangat mencurigakan, BUKAN sebagai lulus. Aplikasi
  -- ini selalu mengirimkannya; yang memanggil RPC tanpa laporan berarti skrip
  -- atau klien yang sudah diutak-atik. Ketiadaan bukti bukan bukti ketiadaan.
  IF p_signals IS NULL THEN
    RETURN jsonb_build_object('skor', 60, 'tanda', ARRAY['LAPORAN_KOSONG']);
  END IF;

  -- ══ b. Geolocation API sudah ditimpa ═════════════════════════════════════
  -- Menangkap pemalsu termurah dan paling umum di desktop: ekstensi peramban
  -- dan devtools, yang mengganti getCurrentPosition dengan fungsi JavaScript
  -- biasa. Fungsi aslinya selalu melaporkan dirinya sebagai [native code].
  IF COALESCE((p_signals->>'api_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'API_LOKASI_DITIMPA';
  END IF;

  IF COALESCE((p_signals->>'objek_asli')::boolean, false) = false THEN
    v_skor := v_skor + 60;
    v_tanda := v_tanda || 'OBJEK_POSISI_PALSU';
  END IF;

  -- ══ c. Goyangan sampel ═══════════════════════════════════════════════════
  IF p_samples IS NOT NULL AND jsonb_typeof(p_samples) = 'array' THEN
    SELECT count(*),
           public.sm_distance_meters(min(lat), min(lng), max(lat), max(lng)),
           count(DISTINCT acc)
      INTO v_n, v_jitter, v_akurasi_unik
    FROM (
      SELECT (e->>'lat')::numeric AS lat, (e->>'lng')::numeric AS lng,
             (e->>'accuracy')::numeric AS acc
      FROM jsonb_array_elements(p_samples) e
    ) s;
  END IF;

  IF v_n < 3 THEN
    v_skor := v_skor + 30;
    v_tanda := v_tanda || 'SAMPEL_TERLALU_SEDIKIT';
  ELSIF v_jitter = 0 THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      -- Inilah pertentangan yang paling menentukan: mengaku presisi beberapa
      -- meter, tapi tidak bergeser sepersejuta derajat pun selama beberapa
      -- detik. Sinyal satelit sungguhan tidak pernah sediam itu.
      v_skor := v_skor + 45;
      v_tanda := v_tanda || 'TITIK_BEKU_TAPI_MENGAKU_PRESISI';
    ELSE
      -- Fix wifi/menara seluler juga beku, dan itu wajar. Cukup dicatat.
      v_skor := v_skor + 10;
      v_tanda := v_tanda || 'TITIK_BEKU';
    END IF;
  END IF;

  IF v_n >= 3 AND v_akurasi_unik = 1 THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_TIDAK_BERUBAH';
  END IF;

  -- ══ d. Ciri fisik yang hilang ════════════════════════════════════════════
  IF p_altitude IS NULL THEN
    IF p_accuracy IS NOT NULL AND p_accuracy <= v_presisi THEN
      v_skor := v_skor + 25;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN_TAPI_MENGAKU_PRESISI';
    ELSE
      v_skor := v_skor + 5;
      v_tanda := v_tanda || 'TANPA_KETINGGIAN';
    END IF;
  END IF;

  IF p_accuracy IS NOT NULL AND p_accuracy < 1 THEN
    v_skor := v_skor + 30;
    v_tanda := v_tanda || 'AKURASI_MUSTAHIL';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy <= 20 AND p_accuracy = round(p_accuracy) THEN
    v_skor := v_skor + 10;
    v_tanda := v_tanda || 'AKURASI_BULAT_RAPI';
  END IF;

  -- ══ e. Perangkat ═════════════════════════════════════════════════════════
  -- Kehadiran di lapangan dilakukan dari ponsel. Check-in dari perangkat tanpa
  -- layar sentuh berarti dari komputer — tempat ekstensi pemalsu lokasi hidup.
  IF COALESCE((p_signals->>'sentuh')::boolean, true) = false THEN
    v_skor := v_skor + 25;
    v_tanda := v_tanda || 'BUKAN_PERANGKAT_SENTUH';
  END IF;

  -- Jam perangkat yang jauh menyimpang menandakan posisi yang disodorkan
  -- bukan hasil pembacaan saat itu.
  IF abs(COALESCE((p_signals->>'selisih_jam_ms')::numeric, 0)) > 120000 THEN
    v_skor := v_skor + 20;
    v_tanda := v_tanda || 'JAM_PERANGKAT_MENYIMPANG';
  END IF;

  -- ══ f. Teleportasi ═══════════════════════════════════════════════════════
  -- Satu-satunya sinyal di sini yang TIDAK bisa dikarang klien: ia dihitung
  -- dari jejak yang sudah tersimpan, bukan dari laporan yang baru masuk.
  SELECT latitude, longitude, created_at INTO v_prev
  FROM public.sm_gps_events
  WHERE user_id = p_uid AND validation_status = 'VALID'
  ORDER BY created_at DESC LIMIT 1;

  IF v_prev.created_at IS NOT NULL THEN
    v_jarak := public.sm_distance_meters(p_lat, p_lng, v_prev.latitude, v_prev.longitude);
    v_detik := GREATEST(EXTRACT(EPOCH FROM (now() - v_prev.created_at)), 1);
    v_kmh   := (v_jarak / v_detik) * 3.6;
    IF v_kmh > public.sm_angka_setelan('gps_max_kmh', 300) THEN
      v_skor := v_skor + 40;
      v_tanda := v_tanda || 'PINDAH_TERLALU_CEPAT';
    END IF;
  END IF;

  RETURN jsonb_build_object('skor', LEAST(v_skor, 100), 'tanda', v_tanda);
END;
$$;

-- ── 4. sm_check_in() dengan lapisan barunya ─────────────────────────────────
--
-- Parameter lama tetap di urutan yang sama supaya pemanggil lama tidak pecah;
-- yang baru ditambahkan di belakang dengan DEFAULT NULL. Tapi perhatikan:
-- pemanggil yang tidak mengirim p_signals mendapat skor 60 dari butir (a) dan
-- karena itu DITOLAK. Ini disengaja — bukan celah yang terlupa.

CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric DEFAULT NULL,
  p_altitude    numeric DEFAULT NULL,
  p_alt_acc     numeric DEFAULT NULL,
  p_speed       numeric DEFAULT NULL,
  p_heading     numeric DEFAULT NULL,
  p_client_time timestamptz DEFAULT NULL,
  p_samples     jsonb DEFAULT NULL,
  p_signals     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := public.sm_uid();
  v_sched     public.sm_schedules%ROWTYPE;
  v_lok       public.sm_locations%ROWTYPE;
  v_status    text;
  v_distance  numeric;
  v_att_id    uuid;
  v_gps_id    uuid;
  v_ambang    numeric := public.sm_ambang_akurasi();
  v_nilai     jsonb;
  v_skor      int;
  v_tanda     text[];
  v_batas     numeric := public.sm_angka_setelan('gps_spoof_block_score', 60);
  v_ip        text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_sched.requires_attendance THEN
    RAISE EXCEPTION 'Jadwal ini tidak memerlukan kehadiran ber-GPS.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lok FROM public.sm_locations WHERE id = v_sched.location_id;

  v_nilai := public.sm_gps_skor_palsu(v_uid, p_lat, p_lng, p_accuracy, p_altitude,
                                      p_samples, p_signals);
  v_skor  := (v_nilai->>'skor')::int;
  SELECT array_agg(t) INTO v_tanda FROM jsonb_array_elements_text(v_nilai->'tanda') t;
  v_tanda := COALESCE(v_tanda, '{}');

  -- Alamat IP dibaca dari header yang dipasang PostgREST. Tidak dipakai untuk
  -- memutuskan apa pun — hanya dicatat, supaya dua orang yang check-in di dua
  -- kota berbeda dari satu sambungan yang sama bisa terlihat kemudian.
  v_ip := split_part(
            COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1);
  IF v_ip = '' THEN v_ip := NULL; END IF;

  -- Rantai keputusan. Hanya SATU status yang keluar, dan itu yang dicatat.
  -- Dugaan lokasi palsu diperiksa SESUDAH penugasan dan tanggal (pelanggaran
  -- yang lebih pokok tetap dilaporkan apa adanya) tapi SEBELUM radius —
  -- koordinat yang tidak bisa dipercaya tidak layak dibandingkan dengan radius,
  -- dan mengembalikan OUTSIDE_RADIUS untuk lokasi palsu justru mengajari
  -- pemakainya untuk menggeser titik palsunya sampai masuk.
  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF v_skor >= v_batas THEN
    v_status := 'SUSPECTED_MOCK';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status, altitude_m, altitude_accuracy_m, speed_mps, heading_deg,
    client_time, samples, client_signals, spoof_score, spoof_signals, ip_hint
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status,
    p_altitude, p_alt_acc, p_speed, p_heading,
    p_client_time, p_samples, p_signals, v_skor, v_tanda, v_ip
  )
  RETURNING id INTO v_gps_id;

  IF v_status = 'SUSPECTED_MOCK' THEN
    -- Dicatat di audit_trail juga: ini bukan kegagalan teknis biasa, ini
    -- kejadian yang perlu dilihat pengawas tanpa harus membuka tabel jejak.
    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'MEETING_CHECK_IN_DIDUGA_PALSU', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('skor', v_skor, 'tanda', v_tanda,
                               'lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
  END IF;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'spoof_score', v_skor,
      'spoof_signals', v_tanda,
      'attendance_id', NULL
    );
  END IF;

  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy,
                             'skor_palsu', v_skor, 'tanda', v_tanda));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'spoof_score', v_skor,
    'spoof_signals', v_tanda,
    'attendance_id', v_att_id
  );
END;
$$;

-- ── 5. Hak eksekusi ─────────────────────────────────────────────────────────
--
-- Tanda tangan sm_check_in berubah, jadi fungsi versi 4-parameter yang lama
-- masih ada di database dengan hak lamanya. Ia dihapus supaya tidak menjadi
-- pintu belakang yang melewati seluruh penilaian di atas.

DROP FUNCTION IF EXISTS public.sm_check_in(uuid, numeric, numeric, numeric);

-- Supabase memberi EXECUTE ke anon secara eksplisit, jadi REVOKE FROM public
-- saja tidak cukup — anon harus disebut namanya (pelajaran migrasi 017).
REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sm_gps_skor_palsu(uuid, numeric, numeric, numeric,
  numeric, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sm_angka_setelan(text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_angka_setelan(text, numeric) TO authenticated;
