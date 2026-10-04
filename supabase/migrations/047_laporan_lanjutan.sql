-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- 047 — Laporan lanjutan (fitur lisensi advanced_reporting)
--
-- sm_laporan_bulanan(dari, sampai): satu baris per BULAN × SALES —
-- jumlah laporan harian, meeting selesai, peluang baru, closing (WON),
-- dan targetnya. Dipakai menu Laporan (tren, target vs realisasi,
-- peringkat) dan ekspor Excel-nya.
--
-- Keamanan: SECURITY INVOKER — setiap tabel tetap disaring RLS pemanggil
-- (Sales hanya dirinya, pengawas seluruh tim), dan fungsi menolak bila
-- lisensi platform tidak memuat advanced_reporting (gagal tertutup).
-- Definisi realisasi = sm_pencapaian_target (WON berdasarkan won_at).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_laporan_bulanan(p_dari date, p_sampai date)
RETURNS TABLE (
  bulan           date,
  sales_user_id   uuid,
  full_name       text,
  laporan         integer,
  meeting_selesai integer,
  peluang_baru    integer,
  nilai_peluang   numeric,
  won             integer,
  nilai_won       numeric,
  gp_won          numeric,
  target_nilai    numeric,
  target_gp       numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'Asia/Jakarta'
AS $$
BEGIN
  IF NOT public.sm_fitur_berlisensi('advanced_reporting') THEN
    RAISE EXCEPTION 'FEATURE_NOT_LICENSED' USING DETAIL = 'advanced_reporting',
      HINT = 'Fitur ini tidak termasuk dalam lisensi platform saat ini.';
  END IF;
  IF p_dari IS NULL OR p_sampai IS NULL OR p_sampai < p_dari OR p_sampai - p_dari > 800 THEN
    RAISE EXCEPTION 'Rentang tanggal tidak sah (maksimal ±2 tahun).';
  END IF;

  RETURN QUERY
  WITH sales AS (
    SELECT u.id, u.full_name FROM public.users u
     WHERE u.active AND u.role = 'SALES'
       AND (public.sm_is_pengawas() OR u.id = public.sm_uid())
  ),
  bln AS (
    SELECT generate_series(date_trunc('month', p_dari), date_trunc('month', p_sampai), interval '1 month')::date AS b
  ),
  lap AS (
    SELECT d.sales_user_id AS u, date_trunc('month', d.report_date)::date AS b, count(*)::int AS n
      FROM public.sm_daily_reports d WHERE d.report_date BETWEEN p_dari AND p_sampai GROUP BY 1, 2
  ),
  mtg AS (
    SELECT s.assigned_to AS u, date_trunc('month', s.schedule_date)::date AS b, count(*)::int AS n
      FROM public.sm_schedules s
     WHERE s.status = 'COMPLETED' AND s.schedule_date BETWEEN p_dari AND p_sampai GROUP BY 1, 2
  ),
  pip AS (
    SELECT p.sales_user_id AS u, date_trunc('month', p.pipeline_date)::date AS b,
           count(*)::int AS n, sum(p.project_value) AS v
      FROM public.sm_pipeline p WHERE p.pipeline_date BETWEEN p_dari AND p_sampai GROUP BY 1, 2
  ),
  wn AS (
    SELECT p.sales_user_id AS u, date_trunc('month', p.won_at)::date AS b,
           count(*)::int AS n, sum(p.project_value) AS v, sum(p.project_gp) AS g
      FROM public.sm_pipeline p
     WHERE p.stage = 'WON' AND p.won_at BETWEEN p_dari AND p_sampai GROUP BY 1, 2
  ),
  tgt AS (
    SELECT t.sales_user_id AS u, t.periode AS b, t.target_nilai AS v, t.target_gp AS g
      FROM public.sm_sales_targets t
     WHERE t.periode BETWEEN date_trunc('month', p_dari)::date AND p_sampai
  )
  SELECT bln.b, s.id, s.full_name,
         COALESCE(lap.n, 0), COALESCE(mtg.n, 0),
         COALESCE(pip.n, 0), COALESCE(pip.v, 0),
         COALESCE(wn.n, 0), COALESCE(wn.v, 0), COALESCE(wn.g, 0),
         COALESCE(tgt.v, 0), tgt.g
    FROM bln CROSS JOIN sales s
    LEFT JOIN lap ON lap.u = s.id AND lap.b = bln.b
    LEFT JOIN mtg ON mtg.u = s.id AND mtg.b = bln.b
    LEFT JOIN pip ON pip.u = s.id AND pip.b = bln.b
    LEFT JOIN wn  ON wn.u  = s.id AND wn.b  = bln.b
    LEFT JOIN tgt ON tgt.u = s.id AND tgt.b = bln.b
   ORDER BY bln.b, s.full_name;
END $$;

REVOKE EXECUTE ON FUNCTION public.sm_laporan_bulanan(date, date) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.sm_laporan_bulanan(date, date) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.sm_laporan_bulanan(date, date) TO authenticated;
  END IF;
END $$;

-- Menu bawaan: semua peran (isi tetap disaring RLS). Akun dengan daftar menu
-- khusus (sm_user_menu) tidak diubah — Admin menambahkannya sendiri.
INSERT INTO public.sm_role_menu (role, menu_key)
SELECT r, 'laporan' FROM unnest(ARRAY['SALES', 'MANAGER', 'DIRECTOR', 'FINANCE', 'ADMIN']) AS r
ON CONFLICT DO NOTHING;
