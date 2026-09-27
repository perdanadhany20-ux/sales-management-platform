-- ════════════════════════════════════════════════════════════════════════════
-- 039 — check-in lewat aplikasi Android: laporan lokasi native bertanda tangan.
--
-- Versi web hanya bisa MENEBAK lokasi palsu dari ciri-cirinya (migrasi 032),
-- karena browser tidak pernah menerima penanda "lokasi tiruan" dari Android.
-- Aplikasi Android (android/) membaca lokasi langsung dari sistem dan
-- menerima penanda itu (Location.isMock). Laporannya ditandatangani
-- HMAC-SHA256 dengan kunci yang hanya dimiliki APK deployment ini dan
-- tabel sm_kunci_aplikasi di bawah.
--
-- sm_check_in kini:
--   • laporan aplikasi SAH dan tidak tiruan  → dipercaya (skor tebakan = 0);
--   • laporan aplikasi bertanda tiruan       → SUSPECTED_MOCK;
--   • laporan aplikasi dengan tanda tangan tidak sah / basi / dipakai ulang
--                                            → SUSPECTED_MOCK;
--   • tanpa laporan aplikasi                 → jalur tebakan lama, KECUALI
--     pengaturan checkin_wajib_aplikasi = true → APP_REQUIRED.
--
-- Kunci TIDAK ditulis di berkas ini. Ia dibuat per deployment saat APK
-- dibangun (android/README.md) dan dimasukkan langsung ke tabel.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sm_kunci_aplikasi (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  kunci       text NOT NULL CHECK (length(kunci) >= 32),
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sm_kunci_aplikasi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sm_kunci_aplikasi FROM PUBLIC, anon, authenticated;

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('checkin_wajib_aplikasi', 'false'::jsonb,
   'Bila true, check-in Meeting hanya diterima dari aplikasi Android (pencegahan fake GPS).'),
  ('apk_versi_minimum', '"1.0.0"'::jsonb,
   'Versi aplikasi Android terendah yang masih diizinkan; di bawahnya pengguna diminta memperbarui.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.sm_gps_events DROP CONSTRAINT IF EXISTS sm_gps_events_validation_status_check;
ALTER TABLE public.sm_gps_events ADD CONSTRAINT sm_gps_events_validation_status_check
  CHECK (validation_status IN ('VALID', 'SCHEDULE_MISMATCH', 'ASSIGNMENT_MISMATCH',
                               'LOW_ACCURACY', 'OUTSIDE_RADIUS', 'NO_LOCATION',
                               'ALREADY_CLOSED', 'SUSPECTED_MOCK', 'APP_REQUIRED'));

-- ── Verifikasi laporan aplikasi ────────────────────────────────────────────
-- Muatan: v1|<id_jadwal>|<lat>|<lng>|<akurasi>|<tiruan 0/1>|<waktu_ms>|<versi>|<nonce>
CREATE OR REPLACE FUNCTION public.sm_verifikasi_aplikasi(
  p_schedule_id uuid, p_lat numeric, p_lng numeric, p_signals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_native  jsonb := p_signals -> 'native';
  v_muatan  text;
  v_tanda   text;
  v_kunci   text;
  v_bagian  text[];
  v_waktu   bigint;
BEGIN
  IF v_native IS NULL OR jsonb_typeof(v_native) <> 'object' THEN
    RETURN jsonb_build_object('ada', false);
  END IF;

  v_muatan := v_native ->> 'payload';
  v_tanda  := lower(coalesce(v_native ->> 'tanda', ''));
  IF v_muatan IS NULL OR length(v_muatan) > 300 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
  END IF;

  SELECT kunci INTO v_kunci FROM public.sm_kunci_aplikasi WHERE id;
  IF v_kunci IS NULL THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_BELUM_DIPASANGKAN');
  END IF;

  IF v_tanda <> encode(hmac(convert_to(v_muatan, 'UTF8'), convert_to(v_kunci, 'UTF8'), 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_TANDA_TANGAN_TIDAK_SAH');
  END IF;

  v_bagian := string_to_array(v_muatan, '|');
  IF array_length(v_bagian, 1) <> 9 OR v_bagian[1] <> 'v1' THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
  END IF;

  IF v_bagian[2] <> p_schedule_id::text
     OR abs(v_bagian[3]::numeric - p_lat) > 0.000001
     OR abs(v_bagian[4]::numeric - p_lng) > 0.000001 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_TIDAK_COCOK');
  END IF;

  -- Umur laporan: jam HP boleh sedikit meleset, tapi laporan lama tidak boleh
  -- dipakai lagi di kemudian hari.
  v_waktu := v_bagian[7]::bigint;
  IF abs(extract(epoch FROM now()) * 1000 - v_waktu) > 5 * 60 * 1000 THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_LAPORAN_BASI');
  END IF;

  -- Satu laporan hanya sah sekali.
  IF EXISTS (SELECT 1 FROM public.sm_gps_events
              WHERE client_signals -> 'native' ->> 'tanda' = v_tanda) THEN
    RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_LAPORAN_DIPAKAI_ULANG');
  END IF;

  RETURN jsonb_build_object('ada', true, 'sah', true, 'mock', v_bagian[6] = '1',
                            'versi', v_bagian[8]);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ada', true, 'sah', false, 'alasan', 'APLIKASI_MUATAN_RUSAK');
END;
$$;

REVOKE ALL ON FUNCTION public.sm_verifikasi_aplikasi(uuid, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_gps_tanda_aplikasi
  ON public.sm_gps_events ((client_signals -> 'native' ->> 'tanda'))
  WHERE client_signals ? 'native';

-- ── sm_check_in ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid, p_lat numeric, p_lng numeric,
  p_accuracy numeric DEFAULT NULL, p_altitude numeric DEFAULT NULL, p_alt_acc numeric DEFAULT NULL,
  p_speed numeric DEFAULT NULL, p_heading numeric DEFAULT NULL,
  p_client_time timestamptz DEFAULT NULL, p_samples jsonb DEFAULT NULL, p_signals jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_app       jsonb;
  v_wajib_app boolean;
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

  -- Laporan aplikasi Android menggantikan tebakan: bila sah dan tidak tiruan,
  -- ciri-ciri "mencurigakan" versi web (titik beku, akurasi bulat) tidak lagi
  -- relevan — Android sendiri yang menyatakan lokasinya bukan tiruan.
  v_app := public.sm_verifikasi_aplikasi(p_schedule_id, p_lat, p_lng, p_signals);
  IF (v_app->>'ada')::boolean THEN
    IF NOT (v_app->>'sah')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || (v_app->>'alasan');
    ELSIF (v_app->>'mock')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || 'APLIKASI_MENDETEKSI_LOKASI_TIRUAN'::text;
    ELSE
      v_skor  := 0;
      v_tanda := ARRAY['DIVERIFIKASI_APLIKASI']::text[] || v_tanda;
    END IF;
  END IF;

  v_wajib_app := COALESCE((SELECT (value #>> '{}')::boolean FROM public.sm_settings
                            WHERE key = 'checkin_wajib_aplikasi'), false);

  v_ip := split_part(
            COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1);
  IF v_ip = '' THEN v_ip := NULL; END IF;

  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF v_wajib_app AND NOT (v_app->>'ada')::boolean THEN
    v_status := 'APP_REQUIRED';
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
                             'skor_palsu', v_skor, 'tanda', v_tanda,
                             'lewat_aplikasi', (v_app->>'ada')::boolean));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'spoof_score', v_skor,
    'spoof_signals', v_tanda,
    'attendance_id', v_att_id
  );
END;
$function$;
