-- ════════════════════════════════════════════════════════════════════════════
-- 040 — Check-in lewat aplikasi Android tidak lagi melewati penilaian server
--
-- Di 039, laporan lokasi bertanda tangan sah dari aplikasi membuat skor
-- kecurigaan langsung 0. Kunci tanda tangannya tertanam di APK (yang bisa
-- diunduh setiap pengguna yang masuk), sehingga orang yang membongkar APK bisa
-- memalsukan laporan "sah" dan lolos dari SEMUA pemeriksaan — termasuk
-- "pindah terlalu cepat" yang dihitung dari jejak tersimpan di server.
--
-- Kini untuk laporan aplikasi yang sah hanya sinyal khas peramban yang
-- diabaikan; sinyal yang tidak bisa dikarang klien tetap dinilai, dan
-- "pindah terlalu cepat" cukup untuk menolak. Tidak ada
-- perubahan lain pada sm_check_in (salinan 039 apa adanya selain blok itu).
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Laporan aplikasi Android: bila sah dan tidak tiruan, ciri-ciri versi web
  -- (titik beku, akurasi bulat) tidak relevan — tetapi lihat blok ELSE.
  v_app := public.sm_verifikasi_aplikasi(p_schedule_id, p_lat, p_lng, p_signals);
  IF (v_app->>'ada')::boolean THEN
    IF NOT (v_app->>'sah')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || (v_app->>'alasan');
    ELSIF (v_app->>'mock')::boolean THEN
      v_skor  := 100;
      v_tanda := v_tanda || 'APLIKASI_MENDETEKSI_LOKASI_TIRUAN'::text;
    ELSE
      -- Tanda tangan sah hanya membuktikan laporan dibuat dengan kunci yang
      -- ada di APK — dan kunci itu bisa dibongkar dari APK. Karena itu hanya
      -- sinyal khas peramban yang diabaikan; sinyal yang dihitung SERVER dari
      -- jejak tersimpan dan kemustahilan fisik tetap dinilai. Lompatan mustahil
      -- cukup untuk menolak sendiri (bobot 60 = ambang bawaan).
      SELECT COALESCE(array_agg(t), '{}') INTO v_tanda
        FROM unnest(v_tanda) t WHERE t IN ('PINDAH_TERLALU_CEPAT', 'AKURASI_MUSTAHIL');
      v_skor  := CASE WHEN 'PINDAH_TERLALU_CEPAT' = ANY (v_tanda) THEN 60 ELSE 0 END
               + CASE WHEN 'AKURASI_MUSTAHIL' = ANY (v_tanda) THEN 30 ELSE 0 END;
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

REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb) TO authenticated;
