-- ════════════════════════════════════════════════════════════════════════════
-- 026 — Zona waktu WIB, jadwal terlewat, dan kepatuhan laporan
--
-- 1. Database berjalan di UTC, sedangkan seluruh pengguna di WIB (UTC+7).
--    `current_date` di server tertinggal satu hari antara 00:00–06:59 WIB.
--    Akibatnya sm_check_in() menolak check-in meeting yang sah pada jam itu
--    dengan SCHEDULE_MISMATCH, dan lencana/dashboard menghitung "hari ini"
--    sebagai kemarin. Ketiga fungsi yang memakai current_date kini dipaksa
--    berjalan di Asia/Jakarta lewat klausa SET.
--
-- 2. Status MISSED tidak pernah diisi oleh apa pun, jadi "Terlewat" di
--    dashboard selalu 0 walau lonceng (yang menghitung dari tanggal) bilang
--    ada. Kini terlewat = MISSED ATAU belum selesai dan tanggalnya lewat.
--
-- 3. Kepatuhan laporan menghitung laporan dari akun non-Sales (mis. Admin)
--    sebagai "Sales sudah lapor". Kini hanya Sales aktif yang dihitung, dan
--    lencana "laporan belum diisi" hanya ditagihkan ke Sales.
-- ════════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.sm_check_in(uuid, numeric, numeric, numeric) SET "TimeZone" TO 'Asia/Jakarta';

ALTER TABLE public.sm_pipeline        ALTER COLUMN pipeline_date SET DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date;
ALTER TABLE public.sm_gp_calculations ALTER COLUMN calc_date     SET DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date;

CREATE OR REPLACE FUNCTION public.sm_lonceng()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  v_uid      uuid    := public.sm_uid();
  v_pengawas boolean := public.sm_is_pengawas();
  v_hari     date    := current_date;
  v_pekan    date    := current_date + 7;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.'
      USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'laporan_belum', public.sm_role() = 'SALES' AND NOT EXISTS (
      SELECT 1 FROM public.sm_daily_reports
       WHERE sales_user_id = v_uid AND report_date = v_hari
    ),
    'jadwal_hari_ini', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'meeting_perlu', (
      SELECT count(*) FROM public.sm_schedules
       WHERE requires_attendance
         AND schedule_date = v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'pipeline_dekat', (
      SELECT count(*) FROM public.sm_pipeline
       WHERE estimated_closing BETWEEN v_hari AND v_pekan
         AND stage IN ('OPEN', 'QUOTATION')
         AND (v_pengawas OR sales_user_id = v_uid)
    ),
    'terlewat', (
      SELECT count(*) FROM public.sm_schedules
       WHERE schedule_date < v_hari
         AND status IN ('UPCOMING', 'IN_PROGRESS')
         AND (v_pengawas OR assigned_to = v_uid)
    ),
    'belum_ditugaskan', CASE WHEN v_pengawas THEN (
      SELECT count(*) FROM public.sm_schedules
       WHERE assigned_to IS NULL AND status = 'UPCOMING'
    ) ELSE 0 END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_dashboard(p_dari date DEFAULT (CURRENT_DATE - 29), p_sampai date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  v_hasil        jsonb;
  v_hari_ini     date := current_date;
  v_jml_sales    integer;
  v_sudah_lapor  integer;
BEGIN
  SELECT count(*) INTO v_jml_sales
    FROM public.users WHERE active AND role = 'SALES';

  SELECT count(DISTINCT r.sales_user_id) INTO v_sudah_lapor
    FROM public.sm_daily_reports r
    JOIN public.users u ON u.id = r.sales_user_id
   WHERE r.report_date = v_hari_ini AND u.active AND u.role = 'SALES';

  SELECT jsonb_build_object(
    'periode', jsonb_build_object('dari', p_dari, 'sampai', p_sampai),
    'daily_report', jsonb_build_object(
      'total_sales',   v_jml_sales,
      'sudah_lapor',   v_sudah_lapor,
      'belum_lapor',   GREATEST(0, v_jml_sales - v_sudah_lapor),
      'dalam_periode', (SELECT count(*) FROM public.sm_daily_reports
                         WHERE report_date BETWEEN p_dari AND p_sampai)
    ),
    'pipeline', (
      SELECT jsonb_build_object(
        'jumlah',      count(*),
        'total_nilai', COALESCE(sum(project_value), 0),
        'total_hpp',   COALESCE(sum(project_hpp),   0),
        'total_gp',    COALESCE(sum(project_gp),    0),
        'gp_persen',   CASE WHEN COALESCE(sum(project_value), 0) > 0
                            THEN round(sum(project_gp) / sum(project_value) * 100, 2)
                            ELSE 0 END,
        'akan_closing', count(*) FILTER (
                          WHERE estimated_closing BETWEEN v_hari_ini AND v_hari_ini + 30
                            AND stage NOT IN ('WON', 'LOST'))
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),
    'probability', (
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'probability')::int), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'probability', probability,
                 'jumlah',      count(*),
                 'nilai',       COALESCE(sum(project_value), 0)
               ) AS x
        FROM public.sm_pipeline
        WHERE pipeline_date BETWEEN p_dari AND p_sampai
        GROUP BY probability
      ) t
    ),
    'gp_kondisi', (
      SELECT jsonb_build_object(
        'positif', count(*) FILTER (WHERE project_gp >  0),
        'nol',     count(*) FILTER (WHERE project_gp =  0),
        'negatif', count(*) FILTER (WHERE project_gp <  0)
      )
      FROM public.sm_pipeline
      WHERE pipeline_date BETWEEN p_dari AND p_sampai
    ),
    'jadwal', (
      SELECT jsonb_build_object(
        'upcoming',    count(*) FILTER (WHERE status = 'UPCOMING' AND schedule_date >= v_hari_ini),
        'berjalan',    count(*) FILTER (WHERE status = 'IN_PROGRESS' AND schedule_date >= v_hari_ini),
        'selesai',     count(*) FILTER (WHERE status = 'COMPLETED'),
        'terlewat',    count(*) FILTER (WHERE status = 'MISSED'
                                          OR (status IN ('UPCOMING', 'IN_PROGRESS') AND schedule_date < v_hari_ini)),
        'dibatalkan',  count(*) FILTER (WHERE status = 'CANCELLED'),
        'hari_ini',    count(*) FILTER (WHERE schedule_date = v_hari_ini
                                          AND status IN ('UPCOMING', 'IN_PROGRESS'))
      )
      FROM public.sm_schedules
      WHERE schedule_date BETWEEN p_dari AND p_sampai
    ),
    'meeting', (
      SELECT jsonb_build_object(
        'total',            count(*),
        'selesai',          count(*) FILTER (WHERE s.status = 'COMPLETED'),
        'belum_mulai',      count(*) FILTER (WHERE a.id IS NULL AND s.status <> 'COMPLETED'),
        'menunggu_foto',    count(*) FILTER (WHERE a.state = 'EVIDENCE_PENDING'),
        'siap_selesai',     count(*) FILTER (WHERE a.state = 'READY_TO_COMPLETE'),
        'exception',        count(*) FILTER (WHERE a.state = 'EXCEPTION')
      )
      FROM public.sm_schedules s
      LEFT JOIN public.sm_attendance a ON a.schedule_id = s.id
      WHERE s.requires_attendance
        AND s.schedule_date BETWEEN p_dari AND p_sampai
    ),
    'gps_gagal', (
      SELECT COALESCE(jsonb_object_agg(validation_status, jml), '{}'::jsonb)
      FROM (
        SELECT validation_status, count(*) AS jml
        FROM public.sm_gps_events
        WHERE validation_status <> 'VALID'
          AND created_at::date BETWEEN p_dari AND p_sampai
        GROUP BY validation_status
      ) g
    ),
    'tren_bulanan', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'bulan',    to_char(b.bulan, 'Mon'),
               'laporan',  COALESCE(d.jml, 0),
               'pipeline', COALESCE(p.jml, 0),
               'nilai',    COALESCE(p.nilai, 0)
             ) ORDER BY b.bulan), '[]'::jsonb)
      FROM generate_series(
             date_trunc('month', v_hari_ini) - interval '5 months',
             date_trunc('month', v_hari_ini),
             interval '1 month'
           ) AS b(bulan)
      LEFT JOIN (
        SELECT date_trunc('month', report_date) AS bulan, count(*) AS jml
        FROM public.sm_daily_reports GROUP BY 1
      ) d ON d.bulan = b.bulan
      LEFT JOIN (
        SELECT date_trunc('month', pipeline_date) AS bulan,
               count(*) AS jml, sum(project_value) AS nilai
        FROM public.sm_pipeline GROUP BY 1
      ) p ON p.bulan = b.bulan
    )
  ) INTO v_hasil;

  RETURN v_hasil;
END;
$function$;
