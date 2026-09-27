-- ════════════════════════════════════════════════════════════════════════════
-- 037 — Lisensi & hak fitur deployment ini (LICENSE_ARCHITECTURE.md)
--
-- Model komersialnya: SATU pelanggan = SATU deployment (Vercel + Supabase
-- sendiri) = SATU lisensi. Sumber kebenaran lisensi ada di License Authority
-- pusat (license-authority/), BUKAN di database ini.
--
-- Yang tinggal di sini hanya SALINAN TERVERIFIKASI (sm_lisensi, satu baris):
-- token bertanda tangan Ed25519 dari Authority beserta isinya yang sudah
-- diurai. Baris itu hanya ditulis server (service role) SETELAH tanda
-- tangannya lolos pemeriksaan; peran `authenticated`/`anon` tidak punya hak
-- apa pun atasnya — Admin pelanggan tidak bisa menambah fitur, memperpanjang
-- masa berlaku, atau mengubah status.
--
-- Penegakan di database, bukan sekadar menu yang disembunyikan (§12):
--   • sm_fitur_berlisensi(fitur) — cermin evaluasiLisensi() di
--     lib/lisensi/kontrak.ts. Gagal TERTUTUP: tanpa baris, kedaluwarsa,
--     ditangguhkan, dicabut, atau melewati masa tenggang 7 hari ⇒ hanya
--     fitur keadaan-terbatas (admin_settings, notifications) yang hidup.
--   • Policy RESTRICTIVE per tabel bisnis. Policy restrictive di-AND-kan
--     dengan policy permisif yang sudah ada, jadi RLS lama TIDAK dilonggarkan
--     sedikit pun — hanya ditambah satu syarat.
--   • Trigger per pernyataan untuk penulisan. Fungsi SECURITY DEFINER
--     (sm_check_in, sm_gp_setujui, …) melewati RLS; trigger tetap menyala
--     di dalamnya, sehingga jalur RPC juga terkunci.
--
-- TIDAK ADA DATA YANG DIHAPUS. Fitur yang tidak berlisensi hanya ditutup
-- aksesnya; begitu lisensi dipulihkan atau ditingkatkan, datanya kembali
-- terlihat utuh (§45, §46, §80).
--
-- URUTAN PENERAPAN: migrasi ini mengunci modul bisnis sampai lisensi pertama
-- terverifikasi. Siapkan License Authority dan variabel LICENSE_* dulu
-- (lihat LICENSE_ARCHITECTURE.md → Checklist produksi), baru terapkan.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Salinan lisensi terverifikasi ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_lisensi (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode              text NOT NULL DEFAULT 'production' CHECK (mode IN ('production', 'development')),
  deployment_id     text,
  license_id        text,
  -- Token SMPL1 apa adanya; diperiksa ulang tanda tangannya setiap dibaca server.
  token             text,
  company_name      text,
  -- Status dasar dari Authority (PENDING/ACTIVE/SUSPENDED/REVOKED), atau
  -- INVALID bila token gagal pemeriksaan keaslian.
  status            text,
  package           text,
  license_type      text,
  features          jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at         timestamptz,
  starts_at         timestamptz,
  expires_at        timestamptz,
  grace_period_days integer NOT NULL DEFAULT 7 CHECK (grace_period_days BETWEEN 0 AND 60),
  warning_days      integer NOT NULL DEFAULT 30,
  requests          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Observabilitas (§60)
  last_verified_at  timestamptz,
  last_attempt_at   timestamptz,
  last_failed_at    timestamptz,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sm_lisensi ENABLE ROW LEVEL SECURITY;
-- Sengaja TANPA policy: hanya service role (server) yang membaca/menulis.
REVOKE ALL ON public.sm_lisensi FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.sm_lisensi FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.sm_lisensi FROM authenticated';
  END IF;
END $$;

-- ── Keputusan fitur ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_fitur_berlisensi(p_fitur text)
RETURNS boolean
LANGUAGE sql
STABLE
-- DEFINER supaya bisa membaca sm_lisensi yang tertutup bagi pemanggil.
-- Yang keluar hanya satu boolean, tidak pernah isi barisnya.
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH l AS (SELECT * FROM public.sm_lisensi WHERE id)
  SELECT CASE
    -- Harus sama dengan FITUR_SAAT_TERBATAS di lib/lisensi/kontrak.ts.
    WHEN NOT EXISTS (SELECT 1 FROM l) THEN p_fitur IN ('admin_settings', 'notifications')
    ELSE (
      SELECT CASE
        WHEN l.mode = 'development' THEN true
        WHEN l.status = 'ACTIVE'
         AND l.expires_at IS NOT NULL AND l.expires_at > now()
         AND l.last_verified_at IS NOT NULL
         AND l.last_verified_at + make_interval(days => l.grace_period_days) > now()
          THEN COALESCE(l.features ->> p_fitur, 'false') = 'true'
        ELSE p_fitur IN ('admin_settings', 'notifications')
      END
      FROM l
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sm_fitur_berlisensi(text) TO anon';
  END IF;
END $$;

-- ── Penjaga penulisan (termasuk dari dalam fungsi SECURITY DEFINER) ─────────

CREATE OR REPLACE FUNCTION public.sm_lisensi_jaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  -- Klaim JWT tetap terbaca di dalam fungsi DEFINER, sedangkan current_user
  -- berubah menjadi pemilik fungsi. Karena itu klaim didahulukan.
  v_peran text := COALESCE(NULLIF(public.sm_jwt('role'), ''), current_user::text);
  v_fitur text;
BEGIN
  -- Server (service_role) dan pemilik basis data (migrasi, SQL Editor) tidak
  -- dijaga di sini: route handler memeriksa lisensinya sendiri (lib/lisensi/server.ts).
  IF v_peran NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  FOREACH v_fitur IN ARRAY TG_ARGV LOOP
    IF public.sm_fitur_berlisensi(v_fitur) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'FEATURE_NOT_LICENSED'
    USING ERRCODE = '42501',
          DETAIL  = TG_TABLE_NAME,
          HINT    = 'Fitur ini tidak termasuk dalam lisensi platform saat ini.';
END;
$$;

-- ── Pemasangan per tabel ────────────────────────────────────────────────────
--
-- Pemetaan fitur → tabel (LICENSE_ARCHITECTURE.md §Pemetaan modul):
--   customer        sm_customers, sm_contacts
--   daily_report    sm_daily_reports
--   pipeline        sm_pipeline
--   schedule|meeting sm_schedules (meeting adalah jadwal ber-check-in)
--   meeting         sm_attendance, sm_evidence, sm_gps_events, sm_exceptions
--   meeting|project sm_locations (dipakai check-in dan pin lokasi proyek)
--   project         sm_projects
--   gp_calculation  sm_gp_calculations, sm_gp_items
--   pipeline        sm_sales_targets (realisasi target = pipeline WON)

DO $$
DECLARE
  r record;
  v_syarat text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sm_customers',       ARRAY['customer']),
      ('sm_contacts',        ARRAY['customer']),
      ('sm_daily_reports',   ARRAY['daily_report']),
      ('sm_pipeline',        ARRAY['pipeline']),
      ('sm_schedules',       ARRAY['schedule', 'meeting']),
      ('sm_attendance',      ARRAY['meeting']),
      ('sm_evidence',        ARRAY['meeting']),
      ('sm_gps_events',      ARRAY['meeting']),
      ('sm_exceptions',      ARRAY['meeting']),
      ('sm_locations',       ARRAY['meeting', 'project']),
      ('sm_projects',        ARRAY['project']),
      ('sm_gp_calculations', ARRAY['gp_calculation']),
      ('sm_gp_items',        ARRAY['gp_calculation']),
      ('sm_sales_targets',   ARRAY['pipeline'])
    ) AS t(tabel, fitur)
  LOOP
    IF to_regclass('public.' || r.tabel) IS NULL THEN
      CONTINUE;
    END IF;

    -- (SELECT …) membuat fungsinya dievaluasi sekali per query (initPlan),
    -- bukan sekali per baris.
    SELECT string_agg(format('(SELECT public.sm_fitur_berlisensi(%L))', f), ' OR ')
      INTO v_syarat FROM unnest(r.fitur) AS f;

    EXECUTE format('DROP POLICY IF EXISTS lisensi_fitur ON public.%I', r.tabel);
    EXECUTE format(
      'CREATE POLICY lisensi_fitur ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      r.tabel, v_syarat, v_syarat);

    EXECUTE format('DROP TRIGGER IF EXISTS lisensi_jaga ON public.%I', r.tabel);
    EXECUTE format(
      'CREATE TRIGGER lisensi_jaga BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.sm_lisensi_jaga(%s)',
      r.tabel, (SELECT string_agg(quote_literal(f), ', ') FROM unnest(r.fitur) AS f));
  END LOOP;
END $$;

-- Foto bukti meeting ikut modul Meeting. Dibungkus pemeriksaan skema supaya
-- migrasi tetap jalan di Postgres tanpa Supabase Storage (uji lokal).
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS lisensi_evidence ON storage.objects';
    EXECUTE $p$
      CREATE POLICY lisensi_evidence ON storage.objects AS RESTRICTIVE
        FOR ALL TO authenticated
        USING (bucket_id <> 'evidence' OR (SELECT public.sm_fitur_berlisensi('meeting')))
        WITH CHECK (bucket_id <> 'evidence' OR (SELECT public.sm_fitur_berlisensi('meeting')))
    $p$;
  END IF;
END $$;
