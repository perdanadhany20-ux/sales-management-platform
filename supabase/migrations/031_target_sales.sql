-- ════════════════════════════════════════════════════════════════════════════
-- 031 — Target penjualan per Sales
--
-- Target ditetapkan per Sales per BULAN (periode = tanggal 1 bulan itu), dalam
-- dua ukuran: nilai penjualan dan Gross Profit (opsional). Kuartal dan tahun
-- dihitung dengan menjumlahkan target bulanannya, jadi tidak perlu disimpan
-- terpisah dan tidak bisa saling bertentangan.
--
-- Realisasi = pipeline berstatus WON. Supaya WON bulan lalu tidak dihitung
-- ke bulan ini, sm_pipeline diberi won_at: diisi otomatis saat tahapan
-- berubah menjadi WON dan dikosongkan bila berubah lagi.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tanggal WON ─────────────────────────────────────────────────────────
ALTER TABLE public.sm_pipeline ADD COLUMN IF NOT EXISTS won_at date;

UPDATE public.sm_pipeline
   SET won_at = COALESCE(estimated_closing, (updated_at AT TIME ZONE 'Asia/Jakarta')::date)
 WHERE stage = 'WON' AND won_at IS NULL;

CREATE OR REPLACE FUNCTION public.sm_pipeline_isi_won_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.stage = 'WON' THEN
    IF TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'WON' OR NEW.won_at IS NULL THEN
      NEW.won_at := COALESCE(NEW.won_at, (now() AT TIME ZONE 'Asia/Jakarta')::date);
    END IF;
  ELSE
    NEW.won_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_pipeline_isi_won_at() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pipeline_won_at ON public.sm_pipeline;
CREATE TRIGGER trg_pipeline_won_at
  BEFORE INSERT OR UPDATE OF stage, won_at ON public.sm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.sm_pipeline_isi_won_at();

CREATE INDEX IF NOT EXISTS idx_pipeline_won ON public.sm_pipeline (sales_user_id, won_at) WHERE stage = 'WON';

-- ── 2. Tabel target ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sm_sales_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  periode       date NOT NULL,
  target_nilai  numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_nilai >= 0),
  target_gp     numeric(18,2) CHECK (target_gp IS NULL OR target_gp >= 0),
  updated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sm_sales_targets_awal_bulan CHECK (periode = date_trunc('month', periode)::date),
  CONSTRAINT sm_sales_targets_unik UNIQUE (sales_user_id, periode)
);

CREATE INDEX IF NOT EXISTS idx_targets_periode ON public.sm_sales_targets (periode);
CREATE INDEX IF NOT EXISTS idx_targets_updated_by ON public.sm_sales_targets (updated_by);

ALTER TABLE public.sm_sales_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sm_sales_targets FROM anon;
REVOKE TRUNCATE ON public.sm_sales_targets FROM authenticated;

-- Sales melihat targetnya sendiri; hanya pengawas yang menetapkan.
DROP POLICY IF EXISTS tgt_baca ON public.sm_sales_targets;
CREATE POLICY tgt_baca ON public.sm_sales_targets FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_tulis ON public.sm_sales_targets;
CREATE POLICY tgt_tulis ON public.sm_sales_targets FOR INSERT TO authenticated
  WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_ubah ON public.sm_sales_targets;
CREATE POLICY tgt_ubah ON public.sm_sales_targets FOR UPDATE TO authenticated
  USING (public.sm_is_pengawas()) WITH CHECK (public.sm_is_pengawas());

DROP POLICY IF EXISTS tgt_hapus ON public.sm_sales_targets;
CREATE POLICY tgt_hapus ON public.sm_sales_targets FOR DELETE TO authenticated
  USING (public.sm_is_pengawas());

DROP TRIGGER IF EXISTS trg_targets_touch ON public.sm_sales_targets;
CREATE TRIGGER trg_targets_touch BEFORE UPDATE ON public.sm_sales_targets
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── 3. Pencapaian ──────────────────────────────────────────────────────────
-- SECURITY INVOKER: RLS tabel asal yang menentukan barisnya, jadi Sales
-- hanya mendapat dirinya sendiri dan pengawas mendapat seluruh Sales aktif.
CREATE OR REPLACE FUNCTION public.sm_pencapaian_target(p_dari date, p_sampai date)
 RETURNS TABLE (
   sales_user_id     uuid,
   full_name         text,
   target_nilai      numeric,
   target_gp         numeric,
   realisasi_nilai   numeric,
   realisasi_gp      numeric,
   jumlah_won        integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sales AS (
    SELECT u.id, u.full_name FROM public.users u
     WHERE u.active AND u.role = 'SALES'
       AND (public.sm_is_pengawas() OR u.id = public.sm_uid())
  ),
  tgt AS (
    SELECT t.sales_user_id,
           sum(t.target_nilai) AS nilai,
           CASE WHEN count(t.target_gp) > 0 THEN sum(COALESCE(t.target_gp, 0)) END AS gp
      FROM public.sm_sales_targets t
     WHERE t.periode BETWEEN date_trunc('month', p_dari)::date AND p_sampai
     GROUP BY 1
  ),
  won AS (
    SELECT p.sales_user_id, sum(p.project_value) AS nilai, sum(p.project_gp) AS gp, count(*)::int AS jml
      FROM public.sm_pipeline p
     WHERE p.stage = 'WON' AND p.won_at BETWEEN p_dari AND p_sampai
     GROUP BY 1
  )
  SELECT s.id, s.full_name,
         COALESCE(tgt.nilai, 0), tgt.gp,
         COALESCE(won.nilai, 0), COALESCE(won.gp, 0), COALESCE(won.jml, 0)
    FROM sales s
    LEFT JOIN tgt ON tgt.sales_user_id = s.id
    LEFT JOIN won ON won.sales_user_id = s.id
   ORDER BY s.full_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_pencapaian_target(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sm_pencapaian_target(date, date) TO authenticated;

-- ── 4. Kartu dashboard baru bisa diatur dari Dashboard Setting ────────────
UPDATE public.sm_settings
   SET value = value || '[{"key":"target","label":"Pencapaian Target Sales","aktif":true}]'::jsonb
 WHERE key = 'dashboard_widgets'
   AND NOT (value @> '[{"key":"target"}]'::jsonb);
