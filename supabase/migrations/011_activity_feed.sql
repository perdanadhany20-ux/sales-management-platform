-- ════════════════════════════════════════════════════════════════════════════
-- 011 — Riwayat aktivitas Sales (halaman /activity)
--
-- Feed ini TIDAK menyimpan apa pun. Ia menyatukan jejak yang sudah ditulis
-- modul lain — laporan harian, pipeline, jadwal, check-in, foto bukti, dan
-- override — menjadi satu urutan waktu.
--
-- Kenapa view, bukan tabel `sm_activities` yang diisi trigger: tabel seperti
-- itu adalah salinan kedua dari kebenaran yang sama, dan salinan kedua selalu
-- berakhir berbeda dari aslinya — baris yang gagal ditulis karena trigger-nya
-- error, baris lama yang tidak ikut terhapus, atau catatan yang tidak sesuai
-- lagi setelah datanya disunting. View tidak bisa melenceng: ia MEMBACA
-- sumbernya setiap kali dibuka.
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.sm_activity_feed;

-- security_invoker = true adalah inti keamanannya. Tanpa itu, view berjalan
-- dengan hak PEMILIKNYA (postgres), sehingga RLS di tabel-tabel sumber
-- dilewati begitu saja dan setiap Sales bisa membaca aktivitas seluruh tim
-- lewat satu SELECT. Dengan opsi ini, tiap cabang UNION di bawah tetap
-- tunduk pada policy yang sama seperti kalau tabelnya dibuka langsung.
CREATE VIEW public.sm_activity_feed
WITH (security_invoker = true) AS

-- ── Laporan harian ──────────────────────────────────────────────────────────
SELECT
  'DAILY_REPORT:' || r.id::text          AS id,
  'DAILY_REPORT'::text                   AS jenis,
  r.created_at                           AS terjadi_pada,
  r.report_date                          AS tanggal_acuan,
  r.sales_user_id                        AS user_id,
  r.customer_name                        AS judul,
  r.activity                             AS keterangan,
  r.result                               AS tambahan,
  'sm_daily_reports'::text               AS entitas,
  r.id                                   AS entitas_id,
  NULL::numeric                          AS nilai,
  NULL::text                             AS status
FROM public.sm_daily_reports r

UNION ALL

-- ── Pipeline ────────────────────────────────────────────────────────────────
SELECT
  'PIPELINE:' || p.id::text,
  'PIPELINE',
  p.created_at,
  p.pipeline_date,
  p.sales_user_id,
  p.customer_name,
  p.project_detail,
  p.next_action,
  'sm_pipeline',
  p.id,
  p.project_value,
  p.probability::text
FROM public.sm_pipeline p

UNION ALL

-- ── Jadwal dibuat / diajukan ────────────────────────────────────────────────
SELECT
  'SCHEDULE:' || s.id::text,
  'SCHEDULE',
  s.created_at,
  s.schedule_date,
  COALESCE(s.assigned_to, s.created_by),
  s.customer_name,
  s.category,
  s.detail,
  'sm_schedules',
  s.id,
  NULL::numeric,
  s.status
FROM public.sm_schedules s

UNION ALL

-- ── Jadwal diselesaikan ─────────────────────────────────────────────────────
--
-- Baris terpisah dari cabang di atas dengan sengaja: pembuatan dan
-- penyelesaian terjadi pada waktu yang berbeda, dan feed yang hanya memuat
-- salah satunya menyembunyikan separuh pekerjaan hari itu.
SELECT
  'COMPLETED:' || s.id::text,
  CASE WHEN s.requires_attendance THEN 'MEETING_SELESAI' ELSE 'SCHEDULE_SELESAI' END,
  s.completed_at,
  s.schedule_date,
  COALESCE(s.assigned_to, s.created_by),
  s.customer_name,
  s.category,
  NULL::text,
  'sm_schedules',
  s.id,
  NULL::numeric,
  'COMPLETED'
FROM public.sm_schedules s
WHERE s.completed_at IS NOT NULL

UNION ALL

-- ── Percobaan check-in, termasuk yang ditolak (§79) ─────────────────────────
SELECT
  'GPS:' || g.id::text,
  'CHECK_IN',
  g.created_at,
  g.created_at::date,
  g.user_id,
  COALESCE(s.customer_name, 'Meeting'),
  COALESCE(l.name, 'Lokasi tidak diketahui'),
  NULL::text,
  'sm_gps_events',
  g.id,
  g.distance_m,
  g.validation_status
FROM public.sm_gps_events g
LEFT JOIN public.sm_schedules s ON s.id = g.schedule_id
LEFT JOIN public.sm_locations l ON l.id = s.location_id

UNION ALL

-- ── Foto bukti ──────────────────────────────────────────────────────────────
SELECT
  'EVIDENCE:' || e.id::text,
  'BUKTI',
  e.captured_at,
  e.captured_at::date,
  e.user_id,
  COALESCE(s.customer_name, 'Meeting'),
  'Foto bukti kehadiran',
  NULL::text,
  'sm_evidence',
  e.id,
  NULL::numeric,
  NULL::text
FROM public.sm_evidence e
LEFT JOIN public.sm_schedules s ON s.id = e.schedule_id

UNION ALL

-- ── Override pengawas (§39) ─────────────────────────────────────────────────
SELECT
  'EXCEPTION:' || x.id::text,
  'OVERRIDE',
  x.approved_at,
  x.approved_at::date,
  x.approved_by,
  COALESCE(s.customer_name, 'Meeting'),
  x.reason,
  x.original_failure,
  'sm_exceptions',
  x.id,
  NULL::numeric,
  x.resulting_status
FROM public.sm_exceptions x
LEFT JOIN public.sm_schedules s ON s.id = x.schedule_id;

-- anon tidak ikut: tanpa sesi tidak ada aktivitas yang sah untuk dibaca.
GRANT SELECT ON public.sm_activity_feed TO authenticated;

COMMENT ON VIEW public.sm_activity_feed IS
  'Riwayat aktivitas gabungan untuk /activity. Hanya membaca; RLS tabel '
  'sumber tetap berlaku lewat security_invoker.';
