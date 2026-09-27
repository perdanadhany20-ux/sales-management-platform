-- ════════════════════════════════════════════════════════════════════════════
-- License Authority — skema pusat (proyek Supabase TERSENDIRI milik developer)
--
-- Database ini HANYA berisi catatan kendali lisensi: identitas deployment,
-- lisensi, hak fitur, permintaan, dan jejak audit. TIDAK ADA data bisnis
-- pelanggan (customer, pipeline, aktivitas, GP, foto, sandi) di sini —
-- setiap pelanggan tetap punya Supabase-nya sendiri (LICENSE_ARCHITECTURE.md).
--
-- Seluruh perubahan status lewat fungsi la_* di bawah, dalam satu transaksi,
-- dengan penguncian baris dan kunci idempotensi. Telegram dan dashboard web
-- memanggil fungsi yang SAMA (§48) — tidak ada dua sumber kebenaran.
--
-- Hanya service role yang boleh menyentuhnya: RLS aktif tanpa policy, dan hak
-- eksekusi fungsi dicabut dari anon/authenticated.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS public.la_deployment_seq;

CREATE TABLE IF NOT EXISTS public.deployments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_code     text NOT NULL UNIQUE CHECK (deployment_code ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'),
  company_name        text NOT NULL CHECK (length(trim(company_name)) BETWEEN 2 AND 160),
  environment         text NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'staging', 'development')),
  application_version text,
  -- SHA-256 kunci deployment. Kunci aslinya hanya ditampilkan sekali saat registrasi.
  key_hash            text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at        timestamptz,
  rl_window           timestamptz,
  rl_count            integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.licenses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_code        text NOT NULL UNIQUE CHECK (license_code ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'),
  deployment_id       uuid NOT NULL UNIQUE REFERENCES public.deployments(id) ON DELETE RESTRICT,
  package             text NOT NULL CHECK (package IN ('STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE', 'CUSTOM')),
  -- Disiapkan untuk uji coba kelak (§63); TRIAL hanyalah lisensi berkedaluwarsa.
  license_type        text NOT NULL DEFAULT 'STANDARD' CHECK (license_type IN ('STANDARD', 'TRIAL')),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  issued_at           timestamptz,
  starts_at           timestamptz,
  expires_at          timestamptz,
  grace_period_days   integer NOT NULL DEFAULT 7 CHECK (grace_period_days BETWEEN 0 AND 60),
  warning_days        integer NOT NULL DEFAULT 30 CHECK (warning_days BETWEEN 0 AND 120),
  min_version         text,
  max_version         text,
  last_verified_at    timestamptz,
  -- Tahap pemberitahuan kedaluwarsa yang sudah dikirim ke Telegram (anti-spam).
  expiry_notice_stage text NOT NULL DEFAULT 'NONE' CHECK (expiry_notice_stage IN ('NONE', 'D30', 'D7', 'EXPIRED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_features (
  license_id  uuid NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key ~ '^[a-z_]{2,40}$'),
  enabled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (license_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.license_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id        uuid NOT NULL REFERENCES public.deployments(id) ON DELETE RESTRICT,
  license_id           uuid NOT NULL REFERENCES public.licenses(id) ON DELETE RESTRICT,
  kind                 text NOT NULL CHECK (kind IN ('NEW', 'EXTENSION', 'CHANGE_PACKAGE')),
  requested_package    text NOT NULL CHECK (requested_package IN ('STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE', 'CUSTOM')),
  requested_features   jsonb,
  duration_days        integer CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 3660),
  requested_starts_at  timestamptz,
  requested_expires_at timestamptz,
  status               text NOT NULL DEFAULT 'PENDING_APPROVAL'
                       CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')),
  notes                text CHECK (notes IS NULL OR length(notes) <= 500),
  requested_by         text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz,
  processed_by         text,
  reason               text CHECK (reason IS NULL OR length(reason) <= 500),
  telegram_message_id  bigint
);

-- §67: satu permintaan menunggu per deployment — duplikat ditolak database.
CREATE UNIQUE INDEX IF NOT EXISTS license_requests_satu_menunggu
  ON public.license_requests (deployment_id) WHERE status = 'PENDING_APPROVAL';
CREATE INDEX IF NOT EXISTS license_requests_deployment ON public.license_requests (deployment_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.license_audit_logs (
  id             bigserial PRIMARY KEY,
  license_id     uuid REFERENCES public.licenses(id) ON DELETE SET NULL,
  deployment_id  uuid REFERENCES public.deployments(id) ON DELETE SET NULL,
  action         text NOT NULL,
  previous_state jsonb,
  new_state      jsonb,
  performed_by   text NOT NULL,
  performed_via  text NOT NULL CHECK (performed_via IN ('telegram', 'web', 'api', 'system')),
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS license_audit_logs_license ON public.license_audit_logs (license_id, created_at DESC);

-- Kunci idempotensi: update Telegram yang terkirim ulang, tombol yang diketuk
-- dua kali, atau formulir web yang dikirim ganda tidak diterapkan dua kali (§49).
CREATE TABLE IF NOT EXISTS public.processed_actions (
  action_key text PRIMARY KEY CHECK (length(action_key) <= 200),
  result     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit hanya-tambah: tidak ada UPDATE/DELETE, bahkan lewat service role.
CREATE OR REPLACE FUNCTION public.la_audit_tolak_ubah() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'license_audit_logs bersifat hanya-tambah.';
END $$;

DROP TRIGGER IF EXISTS license_audit_logs_hanya_tambah ON public.license_audit_logs;
CREATE TRIGGER license_audit_logs_hanya_tambah
  BEFORE UPDATE OR DELETE ON public.license_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.la_audit_tolak_ubah();

-- ── Kunci akses ─────────────────────────────────────────────────────────────

ALTER TABLE public.deployments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_features   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_actions  ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fungsi bantu
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.la_features(p_license uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(feature_key, enabled), '{}'::jsonb)
    FROM public.license_features WHERE license_id = p_license;
$$;

CREATE OR REPLACE FUNCTION public.la_snapshot(p_license uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'status', l.status, 'package', l.package, 'starts_at', l.starts_at,
    'expires_at', l.expires_at, 'features', public.la_features(l.id))
  FROM public.licenses l WHERE l.id = p_license;
$$;

CREATE OR REPLACE FUNCTION public.la_set_features(p_license uuid, p_features jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k text; v jsonb;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(p_features, '{}'::jsonb)) LOOP
    IF k !~ '^[a-z_]{2,40}$' THEN CONTINUE; END IF;
    INSERT INTO public.license_features (license_id, feature_key, enabled)
    VALUES (p_license, k, v = 'true'::jsonb)
    ON CONFLICT (license_id, feature_key)
      DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.la_audit(
  p_license uuid, p_action text, p_prev jsonb, p_new jsonb, p_actor text, p_via text, p_reason text
) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO public.license_audit_logs
    (license_id, deployment_id, action, previous_state, new_state, performed_by, performed_via, reason)
  SELECT p_license, l.deployment_id, p_action, p_prev, p_new, COALESCE(p_actor, 'system'), p_via, p_reason
    FROM public.licenses l WHERE l.id = p_license;
$$;

/** Klaim kunci idempotensi. NULL = belum pernah; selain itu = hasil tersimpan. */
CREATE OR REPLACE FUNCTION public.la_claim(p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF p_key IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.processed_actions (action_key) VALUES (p_key) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT result INTO v FROM public.processed_actions WHERE action_key = p_key;
  RETURN COALESCE(v, '{"ok":false,"code":"IN_PROGRESS"}'::jsonb) || '{"duplicate":true}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION public.la_finish(p_key text, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_key IS NOT NULL THEN
    UPDATE public.processed_actions SET result = p_result WHERE action_key = p_key;
  END IF;
  RETURN p_result;
END $$;

/** Hanya untuk update Telegram yang dikirim ulang: true = baru, false = sudah diproses. */
CREATE OR REPLACE FUNCTION public.la_claim_once(p_key text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.processed_actions (action_key, result) VALUES (p_key, '{"ok":true}') ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;

/** Ringkasan lisensi untuk pesan Telegram & dashboard. */
CREATE OR REPLACE FUNCTION public.la_license_info(p_license uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'license_code', l.license_code, 'deployment_code', d.deployment_code, 'company_name', d.company_name,
    'package', l.package, 'status', l.status, 'license_type', l.license_type,
    'issued_at', l.issued_at, 'starts_at', l.starts_at, 'expires_at', l.expires_at,
    'grace_period_days', l.grace_period_days, 'warning_days', l.warning_days,
    'min_version', l.min_version, 'max_version', l.max_version,
    'last_verified_at', l.last_verified_at, 'application_version', d.application_version,
    'features', public.la_features(l.id))
  FROM public.licenses l JOIN public.deployments d ON d.id = l.deployment_id
  WHERE l.id = p_license;
$$;

/** Autentikasi deployment: kode + lisensi + hash kunci harus cocok bersama. */
CREATE OR REPLACE FUNCTION public.la_auth(p_deployment text, p_license text, p_key_hash text)
RETURNS TABLE (deployment_id uuid, license_id uuid)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT d.id, l.id
    FROM public.deployments d JOIN public.licenses l ON l.deployment_id = d.id
   WHERE d.deployment_code = p_deployment AND l.license_code = p_license AND d.key_hash = p_key_hash;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Jalur deployment (dipanggil API /api/v1/*)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.la_verify(
  p_deployment text, p_license text, p_key_hash text, p_app_version text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
  d public.deployments;
BEGIN
  SELECT * INTO a FROM public.la_auth(p_deployment, p_license, p_key_hash);
  -- Satu jawaban untuk semua ketidakcocokan: tidak bisa dipakai menebak kode yang ada (§29).
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED'); END IF;

  SELECT * INTO d FROM public.deployments WHERE id = a.deployment_id FOR UPDATE;
  IF d.rl_window IS NULL OR d.rl_window < now() - interval '1 minute' THEN
    UPDATE public.deployments SET rl_window = now(), rl_count = 1 WHERE id = d.id;
  ELSIF d.rl_count >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  ELSE
    UPDATE public.deployments SET rl_count = rl_count + 1 WHERE id = d.id;
  END IF;

  UPDATE public.deployments
     SET last_seen_at = now(), application_version = left(p_app_version, 40), updated_at = now()
   WHERE id = d.id;
  UPDATE public.licenses SET last_verified_at = now() WHERE id = a.license_id;

  RETURN jsonb_build_object('ok', true, 'license', public.la_license_info(a.license_id), 'requests', (
    SELECT COALESCE(jsonb_agg(x ORDER BY x.requested_at DESC), '[]'::jsonb) FROM (
      SELECT id, kind, requested_package, duration_days, status, reason, notes, requested_at, processed_at
        FROM public.license_requests WHERE deployment_id = a.deployment_id
       ORDER BY requested_at DESC LIMIT 5) x));
END $$;

CREATE OR REPLACE FUNCTION public.la_create_request(
  p_deployment text, p_license text, p_key_hash text,
  p_kind text, p_package text, p_features jsonb, p_duration integer, p_notes text, p_requested_by text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.la_auth(p_deployment, p_license, p_key_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED'); END IF;

  IF (SELECT status FROM public.licenses WHERE id = a.license_id) = 'REVOKED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LICENSE_REVOKED');
  END IF;

  IF (SELECT count(*) FROM public.license_requests
       WHERE deployment_id = a.deployment_id AND requested_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;

  BEGIN
    INSERT INTO public.license_requests
      (deployment_id, license_id, kind, requested_package, requested_features, duration_days,
       requested_starts_at, requested_expires_at, notes, requested_by)
    VALUES
      (a.deployment_id, a.license_id, p_kind, p_package,
       CASE WHEN p_package = 'CUSTOM' THEN p_features END, p_duration,
       CASE WHEN p_kind = 'NEW' THEN now() END,
       CASE WHEN p_duration IS NOT NULL THEN now() + make_interval(days => p_duration) END,
       left(p_notes, 500), left(p_requested_by, 120))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_ALREADY_PENDING');
  END;

  PERFORM public.la_audit(a.license_id, 'REQUESTED', NULL,
    jsonb_build_object('request_id', v_id, 'kind', p_kind, 'package', p_package, 'duration_days', p_duration),
    COALESCE(p_requested_by, 'customer-admin'), 'api', p_notes);

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'license', public.la_license_info(a.license_id));
END $$;

CREATE OR REPLACE FUNCTION public.la_cancel_request(
  p_deployment text, p_license text, p_key_hash text, p_request uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.la_auth(p_deployment, p_license, p_key_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED'); END IF;

  UPDATE public.license_requests SET status = 'CANCELLED', processed_at = now(), processed_by = 'customer-admin'
   WHERE id = p_request AND deployment_id = a.deployment_id AND status = 'PENDING_APPROVAL';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_PENDING'); END IF;

  PERFORM public.la_audit(a.license_id, 'REQUEST_CANCELLED', NULL, jsonb_build_object('request_id', p_request),
    'customer-admin', 'api', NULL);
  RETURN jsonb_build_object('ok', true, 'request_id', p_request);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Tindakan developer (Telegram & dashboard web memanggil yang SAMA)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.la_approve_request(
  p_request uuid, p_features jsonb, p_actor text, p_via text, p_action_key text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_dup jsonb := public.la_claim(p_action_key);
  r public.license_requests;
  l public.licenses;
  v_prev jsonb;
  v_action text;
  v_old int; v_new int;
BEGIN
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;

  SELECT * INTO r FROM public.license_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND'));
  END IF;
  -- Ketukan kedua pada tombol APPROVE jatuh di sini: tidak mengubah apa pun.
  IF r.status <> 'PENDING_APPROVAL' THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_PENDING', 'status', r.status));
  END IF;

  SELECT * INTO l FROM public.licenses WHERE id = r.license_id FOR UPDATE;
  IF l.status = 'REVOKED' THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_REVOKED'));
  END IF;
  v_prev := public.la_snapshot(l.id);

  IF r.kind = 'NEW' THEN
    UPDATE public.licenses SET
      package = r.requested_package,
      status = CASE WHEN status = 'SUSPENDED' THEN status ELSE 'ACTIVE' END,
      issued_at = COALESCE(issued_at, now()),
      starts_at = now(),
      expires_at = now() + make_interval(days => COALESCE(r.duration_days, 365)),
      expiry_notice_stage = 'NONE', updated_at = now()
    WHERE id = l.id;
    PERFORM public.la_set_features(l.id, p_features);
    v_action := 'APPROVED';
  ELSIF r.kind = 'EXTENSION' THEN
    UPDATE public.licenses SET
      status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END,
      issued_at = COALESCE(issued_at, now()),
      starts_at = COALESCE(starts_at, now()),
      expires_at = GREATEST(COALESCE(expires_at, now()), now()) + make_interval(days => COALESCE(r.duration_days, 365)),
      expiry_notice_stage = 'NONE', updated_at = now()
    WHERE id = l.id;
    v_action := 'EXTENDED';
  ELSE
    SELECT count(*) FILTER (WHERE enabled) INTO v_old FROM public.license_features WHERE license_id = l.id;
    UPDATE public.licenses SET package = r.requested_package, updated_at = now() WHERE id = l.id;
    PERFORM public.la_set_features(l.id, p_features);
    SELECT count(*) FILTER (WHERE enabled) INTO v_new FROM public.license_features WHERE license_id = l.id;
    v_action := CASE WHEN v_new > v_old THEN 'UPGRADED' WHEN v_new < v_old THEN 'DOWNGRADED' ELSE 'CHANGED' END;
  END IF;

  UPDATE public.license_requests SET status = 'APPROVED', processed_at = now(), processed_by = p_actor
   WHERE id = r.id;

  PERFORM public.la_audit(l.id, v_action, v_prev, public.la_snapshot(l.id), p_actor, p_via,
    format('Permintaan %s disetujui', r.id));

  RETURN public.la_finish(p_action_key, jsonb_build_object(
    'ok', true, 'action', v_action, 'request_id', r.id, 'kind', r.kind,
    'license', public.la_license_info(l.id)));
END $$;

CREATE OR REPLACE FUNCTION public.la_reject_request(
  p_request uuid, p_reason text, p_actor text, p_via text, p_action_key text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_dup jsonb := public.la_claim(p_action_key);
  r public.license_requests;
BEGIN
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;

  SELECT * INTO r FROM public.license_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND'));
  END IF;
  IF r.status <> 'PENDING_APPROVAL' THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_PENDING', 'status', r.status));
  END IF;

  UPDATE public.license_requests
     SET status = 'REJECTED', processed_at = now(), processed_by = p_actor, reason = NULLIF(trim(left(p_reason, 500)), '')
   WHERE id = r.id;

  PERFORM public.la_audit(r.license_id, 'REJECTED', NULL,
    jsonb_build_object('request_id', r.id, 'kind', r.kind, 'package', r.requested_package), p_actor, p_via, p_reason);

  RETURN public.la_finish(p_action_key, jsonb_build_object(
    'ok', true, 'action', 'REJECTED', 'request_id', r.id, 'kind', r.kind,
    'requested_package', r.requested_package, 'license', public.la_license_info(r.license_id)));
END $$;

CREATE OR REPLACE FUNCTION public.la_extend(
  p_license_code text, p_days integer, p_actor text, p_via text, p_action_key text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_dup jsonb := public.la_claim(p_action_key);
  l public.licenses;
  v_prev jsonb;
BEGIN
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3660 THEN
    RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'INVALID_DURATION'));
  END IF;

  SELECT * INTO l FROM public.licenses WHERE license_code = p_license_code FOR UPDATE;
  IF NOT FOUND THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_NOT_FOUND')); END IF;
  IF l.status = 'REVOKED' THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_REVOKED')); END IF;

  v_prev := public.la_snapshot(l.id);
  UPDATE public.licenses SET
    expires_at = GREATEST(COALESCE(expires_at, now()), now()) + make_interval(days => p_days),
    starts_at = COALESCE(starts_at, now()),
    issued_at = COALESCE(issued_at, now()),
    expiry_notice_stage = 'NONE', updated_at = now()
  WHERE id = l.id;

  PERFORM public.la_audit(l.id, 'EXTENDED', v_prev, public.la_snapshot(l.id), p_actor, p_via,
    COALESCE(p_reason, format('+%s hari', p_days)));
  RETURN public.la_finish(p_action_key, jsonb_build_object('ok', true, 'action', 'EXTENDED', 'days', p_days,
    'license', public.la_license_info(l.id)));
END $$;

CREATE OR REPLACE FUNCTION public.la_set_status(
  p_license_code text, p_action text, p_actor text, p_via text, p_action_key text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_dup jsonb := public.la_claim(p_action_key);
  l public.licenses;
  v_prev jsonb;
  v_baru text;
  v_audit text;
BEGIN
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;

  SELECT * INTO l FROM public.licenses WHERE license_code = p_license_code FOR UPDATE;
  IF NOT FOUND THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_NOT_FOUND')); END IF;
  IF l.status = 'REVOKED' THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_REVOKED')); END IF;

  CASE p_action
    WHEN 'SUSPEND' THEN
      IF l.status = 'SUSPENDED' THEN
        RETURN public.la_finish(p_action_key, jsonb_build_object('ok', true, 'action', 'SUSPENDED', 'unchanged', true, 'license', public.la_license_info(l.id)));
      END IF;
      v_baru := 'SUSPENDED'; v_audit := 'SUSPENDED';
    WHEN 'REACTIVATE' THEN
      IF l.status <> 'SUSPENDED' THEN
        RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'NOT_SUSPENDED', 'status', l.status));
      END IF;
      v_baru := 'ACTIVE'; v_audit := 'REACTIVATED';
    WHEN 'REVOKE' THEN
      v_baru := 'REVOKED'; v_audit := 'REVOKED';
    ELSE
      RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'INVALID_ACTION'));
  END CASE;

  v_prev := public.la_snapshot(l.id);
  UPDATE public.licenses SET status = v_baru, updated_at = now() WHERE id = l.id;
  IF v_baru = 'REVOKED' THEN
    UPDATE public.license_requests SET status = 'CANCELLED', processed_at = now(), processed_by = p_actor,
           reason = 'Lisensi dicabut'
     WHERE license_id = l.id AND status = 'PENDING_APPROVAL';
  END IF;

  PERFORM public.la_audit(l.id, v_audit, v_prev, public.la_snapshot(l.id), p_actor, p_via, p_reason);
  RETURN public.la_finish(p_action_key, jsonb_build_object('ok', true, 'action', v_audit, 'license', public.la_license_info(l.id)));
END $$;

CREATE OR REPLACE FUNCTION public.la_set_package(
  p_license_code text, p_package text, p_features jsonb, p_actor text, p_via text, p_action_key text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_dup jsonb := public.la_claim(p_action_key);
  l public.licenses;
  v_prev jsonb;
  v_old int; v_new int;
  v_action text;
BEGIN
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;

  SELECT * INTO l FROM public.licenses WHERE license_code = p_license_code FOR UPDATE;
  IF NOT FOUND THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_NOT_FOUND')); END IF;
  IF l.status = 'REVOKED' THEN RETURN public.la_finish(p_action_key, jsonb_build_object('ok', false, 'code', 'LICENSE_REVOKED')); END IF;

  v_prev := public.la_snapshot(l.id);
  SELECT count(*) FILTER (WHERE enabled) INTO v_old FROM public.license_features WHERE license_id = l.id;
  UPDATE public.licenses SET package = p_package, updated_at = now() WHERE id = l.id;
  PERFORM public.la_set_features(l.id, p_features);
  SELECT count(*) FILTER (WHERE enabled) INTO v_new FROM public.license_features WHERE license_id = l.id;
  v_action := CASE WHEN v_new > v_old THEN 'UPGRADED' WHEN v_new < v_old THEN 'DOWNGRADED' ELSE 'CHANGED' END;

  PERFORM public.la_audit(l.id, v_action, v_prev, public.la_snapshot(l.id), p_actor, p_via, p_reason);
  RETURN public.la_finish(p_action_key, jsonb_build_object('ok', true, 'action', v_action, 'license', public.la_license_info(l.id)));
END $$;

/** Registrasi deployment baru (§41). Kode dibuat di sini supaya unik dan berurutan. */
CREATE OR REPLACE FUNCTION public.la_register_deployment(
  p_company text, p_environment text, p_key_hash text, p_package text, p_features jsonb,
  p_duration_days integer, p_activate boolean, p_actor text, p_via text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_seq bigint := nextval('public.la_deployment_seq');
  v_tahun text := to_char(now(), 'YYYY');
  v_singkat text;
  v_dep uuid;
  v_lic uuid;
  v_dep_code text;
  v_lic_code text;
BEGIN
  v_singkat := left(regexp_replace(upper(regexp_replace(p_company, '^\s*(PT|CV|UD|TBK)\.?\s+', '', 'i')), '[^A-Z0-9]', '', 'g'), 3);
  IF length(v_singkat) < 2 THEN v_singkat := 'CUS'; END IF;
  v_dep_code := format('SMA-%s-%s-%s', v_singkat, v_tahun, lpad(v_seq::text, 3, '0'));
  v_lic_code := format('LIC-SMA-%s-%s', v_tahun, lpad(v_seq::text, 4, '0'));

  INSERT INTO public.deployments (deployment_code, company_name, environment, key_hash)
  VALUES (v_dep_code, trim(p_company), COALESCE(p_environment, 'production'), p_key_hash)
  RETURNING id INTO v_dep;

  INSERT INTO public.licenses (license_code, deployment_id, package, status, issued_at, starts_at, expires_at)
  VALUES (v_lic_code, v_dep, p_package,
    CASE WHEN p_activate THEN 'ACTIVE' ELSE 'PENDING' END,
    CASE WHEN p_activate THEN now() END,
    CASE WHEN p_activate THEN now() END,
    CASE WHEN p_activate THEN now() + make_interval(days => COALESCE(p_duration_days, 365)) END)
  RETURNING id INTO v_lic;

  PERFORM public.la_set_features(v_lic, p_features);
  PERFORM public.la_audit(v_lic, 'CREATED', NULL, public.la_snapshot(v_lic), p_actor, p_via, NULL);

  RETURN jsonb_build_object('ok', true, 'deployment_code', v_dep_code, 'license_code', v_lic_code,
    'license', public.la_license_info(v_lic));
END $$;

/** Tahap peringatan kedaluwarsa yang BARU dicapai (dipanggil cron harian; tiap tahap sekali). */
CREATE OR REPLACE FUNCTION public.la_expiry_notices() RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  r record;
  v_tahap text;
BEGIN
  FOR r IN
    SELECT l.id, l.expires_at, l.expiry_notice_stage FROM public.licenses l
     WHERE l.status = 'ACTIVE' AND l.expires_at IS NOT NULL AND l.expires_at < now() + interval '30 days'
     FOR UPDATE
  LOOP
    v_tahap := CASE
      WHEN r.expires_at <= now() THEN 'EXPIRED'
      WHEN r.expires_at <= now() + interval '7 days' THEN 'D7'
      ELSE 'D30' END;
    IF array_position(ARRAY['NONE','D30','D7','EXPIRED'], v_tahap)
       > array_position(ARRAY['NONE','D30','D7','EXPIRED'], r.expiry_notice_stage) THEN
      UPDATE public.licenses SET expiry_notice_stage = v_tahap WHERE id = r.id;
      IF v_tahap = 'EXPIRED' THEN
        PERFORM public.la_audit(r.id, 'EXPIRED', NULL, public.la_snapshot(r.id), 'system', 'system', NULL);
      END IF;
      v := v || jsonb_build_array(public.la_license_info(r.id) || jsonb_build_object('stage', v_tahap));
    END IF;
  END LOOP;
  RETURN v;
END $$;

-- Hak eksekusi hanya untuk service role.
DO $$ DECLARE f record; r text; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'la\_%' LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', f.sig, r);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;
