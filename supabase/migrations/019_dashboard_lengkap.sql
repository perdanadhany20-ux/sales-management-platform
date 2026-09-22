-- ════════════════════════════════════════════════════════════════════════════
-- 019 — Angka dashboard yang belum tercakup
--
-- sm_dashboard() (migrasi 009) dibuat sebelum modul GP Calculation dan Proyek
-- ada, jadi dua hal paling ditunggu atasan justru tidak terwakili di sana:
-- berapa nilai yang sudah masuk tahap GP, dan proyek mana yang jalan.
--
-- Fungsi ini BARU, bukan menimpa yang lama. Menulis ulang sm_dashboard()
-- berarti menyentuh angka yang sudah dipakai dan sudah diuji hanya untuk
-- menambah bagian baru di ujungnya — risiko yang tidak dibayar apa pun.
-- Halaman dashboard memanggil keduanya berdampingan.
--
-- SECURITY INVOKER, sama seperti pendahulunya: seluruh hitungan di bawah
-- tunduk RLS, sehingga Sales melihat angkanya sendiri dan pengawas melihat
-- angka tim. Menjadikannya DEFINER akan membocorkan nilai proyek dan margin
-- seluruh tim ke setiap Sales — dalam bentuk angka, yang justru paling mudah
-- lolos dari perhatian.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_dashboard_plus(
  p_dari   date DEFAULT (current_date - 29),
  p_sampai date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hasil jsonb;
BEGIN
  SELECT jsonb_build_object(

    -- ── GP Calculation ──
    'gp', (
      SELECT jsonb_build_object(
        'jumlah',      count(*),
        'nilai',       COALESCE(sum(total_selling), 0),
        'dpp',         COALESCE(sum(dpp), 0),
        'profit',      COALESCE(sum(net_profit), 0),
        -- Margin rata-rata DITIMBANG DPP, bukan avg(net_margin). Rata-rata
        -- polos memperlakukan dokumen Rp 5 juta setara dokumen Rp 5 miliar,
        -- dan satu dokumen kecil bermargin tinggi bisa menutupi kerugian
        -- besar di dokumen sebelahnya.
        'margin',      CASE WHEN COALESCE(sum(dpp), 0) = 0 THEN 0
                            ELSE round(sum(net_profit) / sum(dpp), 6) END,
        'draft',       count(*) FILTER (WHERE status = 'DRAFT'),
        'menunggu',    count(*) FILTER (WHERE status IN ('DIAJUKAN','DIPERIKSA','DISETUJUI')),
        'selesai',     count(*) FILTER (WHERE status = 'DIVERIFIKASI'),
        'ditolak',     count(*) FILTER (WHERE status = 'DITOLAK'),
        'di_bawah_target', count(*) FILTER (WHERE mutu_margin = 'DIRECTOR APPROVAL')
      )
      FROM public.sm_gp_ringkasan
      WHERE calc_date BETWEEN p_dari AND p_sampai
    ),

    -- Sebaran mutu margin — inilah yang membuat atasan tahu apakah nilai besar
    -- itu datang dengan margin sehat atau tidak.
    'gp_mutu', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'mutu', mutu, 'jumlah', jml, 'nilai', nilai) ORDER BY urut), '[]'::jsonb)
      FROM (
        SELECT mutu_margin AS mutu, count(*) AS jml, sum(total_selling) AS nilai,
               CASE mutu_margin
                 WHEN 'EXCEPTIONAL' THEN 1 WHEN 'EXCELLENT' THEN 2
                 WHEN 'GOOD' THEN 3 WHEN 'REVIEW' THEN 4
                 WHEN 'DIRECTOR APPROVAL' THEN 5 ELSE 6 END AS urut
          FROM public.sm_gp_ringkasan
         WHERE calc_date BETWEEN p_dari AND p_sampai AND jumlah_item > 0
         GROUP BY mutu_margin
      ) x
    ),

    -- ── Proyek ──
    'proyek', (
      SELECT jsonb_build_object(
        'jumlah',         count(*),
        'aktif',          count(*) FILTER (WHERE status = 'AKTIF'),
        'selesai',        count(*) FILTER (WHERE status = 'SELESAI'),
        'nilai_pipeline', COALESCE(sum(nilai_pipeline), 0),
        'profit_gp',      COALESCE(sum(profit_gp), 0),
        -- Proyek yang belum punya satu pun catatan tertaut. Angka ini sengaja
        -- ditampilkan: proyek kosong bukan proyek yang berjalan, dan
        -- menyembunyikannya membuat rekap terlihat lebih ramai dari kenyataan.
        'tanpa_catatan',  count(*) FILTER (
                            WHERE jumlah_pipeline = 0 AND jumlah_jadwal = 0
                              AND jumlah_laporan = 0 AND jumlah_gp = 0)
      )
      FROM public.sm_proyek_ringkasan
    ),

    -- ── Pipeline per tahapan ──
    'stage', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'stage', stage, 'jumlah', jml, 'nilai', nilai) ORDER BY urut), '[]'::jsonb)
      FROM (
        SELECT stage, count(*) AS jml, COALESCE(sum(project_value), 0) AS nilai,
               CASE stage WHEN 'OPEN' THEN 1 WHEN 'QUOTATION' THEN 2
                          WHEN 'WON' THEN 3 ELSE 4 END AS urut
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai
         GROUP BY stage
      ) x
    ),

    -- ── Corong: berapa yang lolos tiap tahap ──
    --
    -- Dihitung dari dokumen yang ADA, bukan dari persentase yang diketik.
    -- Angkanya boleh terlihat kecil; yang penting ia benar.
    'corong', (
      SELECT jsonb_build_object(
        'laporan',  (SELECT count(*) FROM public.sm_daily_reports
                      WHERE report_date BETWEEN p_dari AND p_sampai),
        'peluang',  (SELECT count(*) FROM public.sm_pipeline
                      WHERE pipeline_date BETWEEN p_dari AND p_sampai),
        'meeting',  (SELECT count(*) FROM public.sm_schedules
                      WHERE requires_attendance AND status = 'COMPLETED'
                        AND schedule_date BETWEEN p_dari AND p_sampai),
        'gp',       (SELECT count(*) FROM public.sm_gp_calculations
                      WHERE calc_date BETWEEN p_dari AND p_sampai),
        'gp_gol',   (SELECT count(*) FROM public.sm_gp_calculations
                      WHERE status IN ('DISETUJUI','DIVERIFIKASI')
                        AND calc_date BETWEEN p_dari AND p_sampai)
      )
    ),

    -- ── Per Sales ──
    --
    -- Bagi Sales, RLS membuat hasilnya berisi satu baris: dirinya sendiri.
    -- Itu bukan cacat melainkan justru yang diinginkan — ia melihat angkanya
    -- sendiri tanpa perlu halaman terpisah, dan tetap tidak melihat angka
    -- rekannya.
    'per_sales', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'user_id',  u.id,
               'nama',     u.full_name,
               'laporan',  COALESCE(d.jml, 0),
               'peluang',  COALESCE(p.jml, 0),
               'nilai',    COALESCE(p.nilai, 0),
               'gp',       COALESCE(g.jml, 0),
               'profit',   COALESCE(g.profit, 0),
               'meeting',  COALESCE(s.jml, 0)
             ) ORDER BY COALESCE(p.nilai, 0) DESC), '[]'::jsonb)
      FROM public.users u
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml FROM public.sm_daily_reports
         WHERE report_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) d ON d.sales_user_id = u.id
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml, sum(project_value) AS nilai
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) p ON p.sales_user_id = u.id
      LEFT JOIN (
        SELECT sales_user_id, count(*) AS jml, sum(net_profit) AS profit
          FROM public.sm_gp_ringkasan
         WHERE calc_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) g ON g.sales_user_id = u.id
      LEFT JOIN (
        SELECT assigned_to, count(*) AS jml FROM public.sm_schedules
         WHERE requires_attendance AND status = 'COMPLETED'
           AND schedule_date BETWEEN p_dari AND p_sampai GROUP BY 1
      ) s ON s.assigned_to = u.id
      WHERE u.active AND u.role = 'SALES'
        AND (COALESCE(d.jml,0) + COALESCE(p.jml,0) + COALESCE(g.jml,0) + COALESCE(s.jml,0)) > 0
    ),

    -- ── Customer teratas ──
    'customer_teratas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'nama', nama, 'jumlah', jml, 'nilai', nilai) ORDER BY nilai DESC), '[]'::jsonb)
      FROM (
        SELECT customer_name AS nama, count(*) AS jml,
               COALESCE(sum(project_value), 0) AS nilai
          FROM public.sm_pipeline
         WHERE pipeline_date BETWEEN p_dari AND p_sampai
         GROUP BY customer_name
         ORDER BY sum(project_value) DESC NULLS LAST
         LIMIT 6
      ) x
    )

  ) INTO v_hasil;

  RETURN v_hasil;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_dashboard_plus(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sm_dashboard_plus(date, date) TO authenticated;
