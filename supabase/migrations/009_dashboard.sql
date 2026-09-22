-- ════════════════════════════════════════════════════════════════════════════
-- 009 — Agregat dashboard dalam satu panggilan
--
-- §62/§63 melarang menarik seluruh baris ke browser hanya untuk menghitung
-- sebuah donat. Fungsi ini menghitung SEMUA angka dashboard di dalam Postgres
-- dan mengembalikannya sebagai satu jsonb — satu perjalanan jaringan, bukan
-- delapan, dan nol baris mentah yang menyeberang.
--
-- SECURITY INVOKER, bukan DEFINER, dan itu keputusan penting: fungsinya
-- berjalan sebagai pemanggil, sehingga RLS tetap berlaku pada setiap tabel
-- yang ia baca. Akibatnya satu fungsi ini otomatis benar untuk semua peran —
-- Sales melihat angkanya sendiri, Manager melihat seluruh tim — tanpa satu
-- pun percabangan peran di dalam badannya. Kalau ia dibuat DEFINER, setiap
-- cabang itu harus ditulis tangan, dan satu saja yang terlewat berarti Sales
-- melihat angka milik orang lain.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_dashboard(
  p_dari   date DEFAULT (current_date - 29),
  p_sampai date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hasil        jsonb;
  v_hari_ini     date := current_date;
  v_jml_sales    integer;
  v_sudah_lapor  integer;
BEGIN
  -- Pembanding kepatuhan laporan harian. Untuk Sales, RLS membuat
  -- sm_daily_reports hanya berisi miliknya, jadi angkanya jadi 0 atau 1 —
  -- yang memang artinya "saya sudah lapor hari ini atau belum".
  SELECT count(*) INTO v_jml_sales
    FROM public.users WHERE active AND role = 'SALES';

  SELECT count(DISTINCT sales_user_id) INTO v_sudah_lapor
    FROM public.sm_daily_reports WHERE report_date = v_hari_ini;

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
        -- Rata-rata GP% ditimbang nilai proyek, bukan avg(gp_percentage).
        -- Rata-rata polos memperlakukan proyek Rp 5 juta setara proyek
        -- Rp 5 miliar, sehingga satu peluang kecil bermargin tinggi bisa
        -- menaikkan angka tim padahal uangnya tidak ke mana-mana.
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
        'upcoming',    count(*) FILTER (WHERE status = 'UPCOMING'),
        'berjalan',    count(*) FILTER (WHERE status = 'IN_PROGRESS'),
        'selesai',     count(*) FILTER (WHERE status = 'COMPLETED'),
        'terlewat',    count(*) FILTER (WHERE status = 'MISSED'),
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

    -- Percobaan check-in yang DITOLAK. Ini angka pengecualian yang jadi inti
    -- dashboard operasional: yang perlu ditindaklanjuti bukan meeting yang
    -- lancar, melainkan yang lokasinya tidak terverifikasi.
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

    -- Tren enam bulan terakhir. generate_series dipakai supaya bulan yang
    -- TIDAK punya data tetap muncul sebagai nol — tanpa itu, grafiknya
    -- melompati bulan kosong dan sumbu waktunya berbohong.
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
$$;

REVOKE EXECUTE ON FUNCTION public.sm_dashboard(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_dashboard(date, date) TO authenticated;
