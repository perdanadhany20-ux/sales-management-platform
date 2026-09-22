-- ════════════════════════════════════════════════════════════════════════════
-- 004 — Fungsi identitas, jarak, dan penjaga alur Meeting
--
-- Berkas ini adalah SATU-SATUNYA tempat keabsahan check-in dan penyelesaian
-- Meeting diputuskan (§37, §38). Klien tidak pernah menghitung jarak, tidak
-- pernah menyatakan dirinya sah, dan tidak punya jalan lain menuju COMPLETED
-- untuk jadwal yang mewajibkan kehadiran.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Identitas dari klaim JWT ────────────────────────────────────────────────

-- Platform ini tidak memakai Supabase Auth, jadi auth.uid() selalu NULL.
-- Identitas dibawa lewat JWT yang diterbitkan server (lib/db-token.ts) dan
-- dibaca di sini. STABLE, bukan IMMUTABLE: nilainya tetap dalam satu
-- pernyataan tapi berbeda antar permintaan.
CREATE OR REPLACE FUNCTION public.sm_jwt(claim text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> claim,
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.sm_uid()
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v text := public.sm_jwt('sub');
BEGIN
  -- Token tanpa `sub`, atau `sub` yang bentuknya bukan UUID, harus berarti
  -- "tidak ada identitas" — bukan menggagalkan seluruh query dengan error
  -- konversi, yang akan membuat halaman kosong tanpa penjelasan.
  IF v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sm_role()
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT upper(public.sm_jwt('user_role')); $$;

CREATE OR REPLACE FUNCTION public.sm_is_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.sm_role() = 'ADMIN'; $$;

/** Manager DAN Admin — dipakai policy "boleh lihat semua / boleh assign". */
CREATE OR REPLACE FUNCTION public.sm_is_pengawas()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.sm_role() IN ('MANAGER', 'ADMIN'); $$;

-- ── Jarak Haversine ─────────────────────────────────────────────────────────

-- Diadaptasi dari fs_distance_meters (FieldServices migrasi 005). LEAST/
-- GREATEST mengurung argumen acos di [-1,1]: tanpa itu, dua titik yang
-- praktis identik bisa menghasilkan 1.0000000002 karena pembulatan floating
-- point dan acos() melempar error domain — yakni justru pada kasus paling
-- umum, orang yang berdiri tepat di lokasinya.
CREATE OR REPLACE FUNCTION public.sm_distance_meters(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT round((6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  ))::numeric, 2);
$$;

/** Ambang akurasi GPS (meter) dari sm_settings; 100 m bila belum disetel. */
CREATE OR REPLACE FUNCTION public.sm_ambang_akurasi()
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::numeric FROM public.sm_settings
      WHERE key = 'gps_accuracy_threshold_m'),
    100
  );
$$;

-- ── Check-in (§25, §26, §28–§32) ────────────────────────────────────────────

-- Urutan pemeriksaan disengaja dan mengikuti FieldServices: jadwal dulu, lalu
-- penugasan, baru GPS. Kalau orangnya memang bukan yang ditugaskan, seberapa
-- dekat ia berdiri tidak relevan sama sekali.
--
-- Idempotent: memanggilnya lagi pada jadwal yang sudah terverifikasi
-- mengembalikan kehadiran yang sama, bukan membuat baris baru.
CREATE OR REPLACE FUNCTION public.sm_check_in(
  p_schedule_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy    numeric DEFAULT NULL
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

  -- Rantai keputusan. Hanya SATU status yang keluar, dan itu yang dicatat.
  IF v_sched.assigned_to IS DISTINCT FROM v_uid THEN
    -- §98: ini uji lintas-user yang wajib. Sales B tidak boleh check-in pada
    -- Meeting milik Sales A, sedekat apa pun ia berdiri.
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF v_sched.schedule_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  ELSIF v_lok.id IS NULL THEN
    v_status := 'NO_LOCATION';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_ambang THEN
    -- §31: GPS yang buruk tidak boleh diam-diam dianggap sah.
    v_status := 'LOW_ACCURACY';
  ELSE
    v_distance := public.sm_distance_meters(p_lat, p_lng, v_lok.latitude, v_lok.longitude);
    IF v_distance > v_lok.gps_radius_m THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  -- Dicatat SEBELUM percabangan berhasil/gagal, supaya percobaan yang ditolak
  -- pun meninggalkan jejak (§79).
  INSERT INTO public.sm_gps_events (
    schedule_id, user_id, event_type, latitude, longitude, accuracy_m,
    expected_latitude, expected_longitude, allowed_radius_m, distance_m,
    validation_status
  ) VALUES (
    p_schedule_id, v_uid, 'CHECK_IN', p_lat, p_lng, p_accuracy,
    v_lok.latitude, v_lok.longitude, v_lok.gps_radius_m, v_distance, v_status
  )
  RETURNING id INTO v_gps_id;

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object(
      'validation_status', v_status,
      'distance_m', v_distance,
      'allowed_radius_m', v_lok.gps_radius_m,
      'attendance_id', NULL
    );
  END IF;

  -- ON CONFLICT pada schedule_id (UNIQUE di migrasi 003) — inilah yang
  -- membuat panggilan kedua aman.
  INSERT INTO public.sm_attendance (
    schedule_id, user_id, checkin_at, state, gps_verified, distance_m, accuracy_m
  ) VALUES (
    p_schedule_id, v_uid, now(), 'EVIDENCE_PENDING', true, v_distance, p_accuracy
  )
  -- Baris yang sudah ada dirujuk dengan nama tabel TANPA skema; bentuk
  -- `public.sm_attendance.state` di sini ditolak parser.
  ON CONFLICT (schedule_id) DO UPDATE SET
    gps_verified = true,
    distance_m   = EXCLUDED.distance_m,
    accuracy_m   = EXCLUDED.accuracy_m,
    checkin_at   = COALESCE(sm_attendance.checkin_at, EXCLUDED.checkin_at),
    -- Jangan mundurkan state kehadiran yang sudah lebih maju: check-in ulang
    -- karena sinyal putus tidak boleh menghapus foto yang sudah diunggah.
    state        = CASE
                     WHEN sm_attendance.state IN ('COMPLETED', 'READY_TO_COMPLETE')
                       THEN sm_attendance.state
                     ELSE 'EVIDENCE_PENDING'
                   END
  RETURNING id INTO v_att_id;

  -- HANYA baris jejak yang baru saja dibuat. Menambal semua baris jadwal ini
  -- yang attendance_id-nya masih kosong akan salah: percobaan gagal milik
  -- orang lain (ASSIGNMENT_MISMATCH) ikut tercatut ke kehadiran ini, dan
  -- jejak auditnya justru jadi menyesatkan.
  UPDATE public.sm_gps_events SET attendance_id = v_att_id WHERE id = v_gps_id;

  UPDATE public.sm_schedules
    SET status = 'IN_PROGRESS'
    WHERE id = p_schedule_id AND status = 'UPCOMING';

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_CHECK_IN', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('distance_m', v_distance, 'accuracy_m', p_accuracy));

  RETURN jsonb_build_object(
    'validation_status', 'VALID',
    'distance_m', v_distance,
    'allowed_radius_m', v_lok.gps_radius_m,
    'attendance_id', v_att_id
  );
END;
$$;

-- ── Evidence menggeser state ────────────────────────────────────────────────

-- Begitu foto pertama masuk, kehadiran naik ke READY_TO_COMPLETE. Ditaruh
-- sebagai trigger, bukan di kode aplikasi, supaya jalur mana pun yang
-- menyisipkan evidence menghasilkan state yang sama.
CREATE OR REPLACE FUNCTION public.sm_evidence_naikkan_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.sm_attendance
    SET state = 'READY_TO_COMPLETE'
    WHERE id = NEW.attendance_id
      AND gps_verified = true
      AND state IN ('CHECKED_IN', 'GPS_VERIFIED', 'EVIDENCE_PENDING');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_naikkan_state ON public.sm_evidence;
CREATE TRIGGER trg_evidence_naikkan_state AFTER INSERT ON public.sm_evidence
  FOR EACH ROW EXECUTE FUNCTION public.sm_evidence_naikkan_state();

-- ── Penyelesaian Meeting (§38, §82) ─────────────────────────────────────────

-- Syaratnya diperiksa ULANG dari database di sini. Apa pun yang dikirim
-- klien tidak dipercaya — klien hanya menyebut jadwal mana yang ingin
-- diselesaikan.
CREATE OR REPLACE FUNCTION public.sm_complete_schedule(p_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := public.sm_uid();
  v_sched      public.sm_schedules%ROWTYPE;
  v_att        public.sm_attendance%ROWTYPE;
  v_jml_bukti  integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_sched.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED', 'note', 'sudah selesai');
  END IF;

  IF v_sched.assigned_to IS DISTINCT FROM v_uid AND NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Anda tidak berhak menyelesaikan jadwal ini.'
      USING ERRCODE = '42501';
  END IF;

  -- §83: jadwal non-Meeting tidak dibebani syarat GPS/foto yang tidak
  -- relevan baginya.
  IF NOT v_sched.requires_attendance THEN
    UPDATE public.sm_schedules
      SET status = 'COMPLETED', completed_at = now()
      WHERE id = p_schedule_id;

    INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
    VALUES (v_uid, 'SCHEDULE_COMPLETED', 'sm_schedules', p_schedule_id::text,
            jsonb_build_object('requires_attendance', false));

    RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED');
  END IF;

  SELECT * INTO v_att FROM public.sm_attendance WHERE schedule_id = p_schedule_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ATTENDANCE',
      'message', 'Belum ada check-in untuk meeting ini.');
  END IF;

  IF NOT v_att.gps_verified THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'GPS_NOT_VERIFIED',
      'message', 'Lokasi Anda belum terverifikasi.');
  END IF;

  SELECT count(*) INTO v_jml_bukti FROM public.sm_evidence
    WHERE attendance_id = v_att.id;

  IF v_jml_bukti = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_EVIDENCE',
      'message', 'Foto bukti kehadiran belum diunggah.');
  END IF;

  UPDATE public.sm_attendance
    SET state = 'COMPLETED', checkout_at = COALESCE(checkout_at, now())
    WHERE id = v_att.id;

  UPDATE public.sm_schedules
    SET status = 'COMPLETED', completed_at = now()
    WHERE id = p_schedule_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_COMPLETED', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('attendance_id', v_att.id, 'evidence_count', v_jml_bukti,
                             'distance_m', v_att.distance_m));

  RETURN jsonb_build_object('ok', true, 'status', 'COMPLETED');
END;
$$;

-- ── Override admin (§39, §84) ───────────────────────────────────────────────

-- Jalan keluar yang SAH untuk meeting yang gagal diverifikasi — dan satu-
-- satunya. Bedanya dengan bypass: ia menuntut alasan tertulis, mencatat siapa
-- yang menyetujui, dan meninggalkan baris permanen di sm_exceptions.
CREATE OR REPLACE FUNCTION public.sm_override_completion(
  p_schedule_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := public.sm_uid();
  v_sched  public.sm_schedules%ROWTYPE;
  v_att    public.sm_attendance%ROWTYPE;
  v_gagal  text;
BEGIN
  IF NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Hanya Manager atau Admin yang boleh melakukan override.'
      USING ERRCODE = '42501';
  END IF;

  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Alasan override wajib diisi minimal 10 karakter.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sched FROM public.sm_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_att FROM public.sm_attendance WHERE schedule_id = p_schedule_id;

  v_gagal := CASE
    WHEN v_att.id IS NULL           THEN 'NO_ATTENDANCE'
    WHEN NOT v_att.gps_verified     THEN 'GPS_NOT_VERIFIED'
    WHEN NOT EXISTS (SELECT 1 FROM public.sm_evidence WHERE attendance_id = v_att.id)
                                    THEN 'NO_EVIDENCE'
    ELSE 'NONE'
  END;

  INSERT INTO public.sm_exceptions (
    schedule_id, original_failure, reason, approved_by, resulting_status
  ) VALUES (p_schedule_id, v_gagal, trim(p_reason), v_uid, 'COMPLETED');

  IF v_att.id IS NOT NULL THEN
    UPDATE public.sm_attendance SET state = 'EXCEPTION' WHERE id = v_att.id;
  END IF;

  UPDATE public.sm_schedules
    SET status = 'COMPLETED', completed_at = now()
    WHERE id = p_schedule_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'MEETING_OVERRIDE', 'sm_schedules', p_schedule_id::text,
          jsonb_build_object('original_failure', v_gagal, 'reason', trim(p_reason)));

  RETURN jsonb_build_object('ok', true, 'original_failure', v_gagal);
END;
$$;

-- Fungsi di atas SECURITY DEFINER: ia berjalan dengan hak pemiliknya, jadi
-- siapa yang boleh memanggilnya harus dibatasi rapat. Postgres memberi
-- EXECUTE ke role `public` secara bawaan pada setiap fungsi baru — itu
-- ditarik dulu di sini, baru diberikan ke satu peran yang memang butuh.
--
-- `anon` sengaja TIDAK ikut. Klien aplikasi selalu membawa JWT terbitan
-- server dengan role 'authenticated' (lihat lib/db-token.ts); permintaan yang
-- berjalan sebagai anon berarti tidak ada sesi, dan tidak ada alasan sah
-- baginya menyentuh alur check-in maupun penyelesaian meeting.
REVOKE EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           FROM public;

GRANT EXECUTE ON FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_complete_schedule(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_override_completion(uuid, text)           TO authenticated;

-- Fungsi trigger tidak pernah dipanggil langsung. Membiarkannya bisa
-- dieksekusi lewat /rest/v1/rpc/ hanya menambah permukaan serang tanpa
-- memberi manfaat apa pun — trigger tetap menyala tanpa hak EXECUTE ini.
REVOKE EXECUTE ON FUNCTION public.sm_evidence_naikkan_state()
  FROM public, anon, authenticated;
