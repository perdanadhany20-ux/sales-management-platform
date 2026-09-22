-- ════════════════════════════════════════════════════════════════════════════
-- 014 — Satu panggilan untuk seluruh lencana header (§108, temuan performa)
--
-- Sebelum ini, header menembakkan ENAM permintaan HTTP terpisah hanya untuk
-- mengisi angka lencananya, dan mengulanginya tiap tiga menit selama tab
-- terbuka. Di meja kantor itu tidak terasa. Di lapangan, tempat Sales membuka
-- aplikasi ini dengan satu bar sinyal, enam perjalanan bolak-balik berarti
-- header yang angkanya baru lengkap beberapa detik kemudian — kalau semuanya
-- berhasil.
--
-- Fungsi ini menghitung keenamnya dalam satu perjalanan.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_lonceng()
RETURNS jsonb
LANGUAGE plpgsql
-- SECURITY INVOKER (bawaan, ditulis eksplisit supaya niatnya tidak
-- disalahpahami pembaca berikutnya). Fungsi ini berjalan dengan hak
-- PEMANGGIL, sehingga seluruh policy RLS tetap berlaku pada setiap hitungan di
-- bawah. Menjadikannya SECURITY DEFINER akan membuat angka lencana Sales
-- diam-diam menghitung baris milik seluruh tim — kebocoran yang tampil sebagai
-- angka, bukan sebagai data, dan karena itu mudah lolos dari perhatian.
SECURITY INVOKER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
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
    'laporan_belum', NOT EXISTS (
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

    -- Hanya bermakna bagi pengawas; bagi Sales selalu nol, karena menugaskan
    -- jadwal memang bukan wewenangnya dan angka yang tidak bisa
    -- ditindaklanjuti hanya menambah kebisingan.
    'belum_ditugaskan', CASE WHEN v_pengawas THEN (
      SELECT count(*) FROM public.sm_schedules
       WHERE assigned_to IS NULL AND status = 'UPCOMING'
    ) ELSE 0 END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sm_lonceng() FROM public;
GRANT EXECUTE ON FUNCTION public.sm_lonceng() TO authenticated;
