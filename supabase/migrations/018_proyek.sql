-- ════════════════════════════════════════════════════════════════════════════
-- 018 — Proyek sebagai penyatu seluruh modul
--
-- Sampai migrasi ini, setiap modul berdiri sendiri: pipeline punya
-- project_detail, jadwal punya project, GP Calculation punya project_name —
-- ketiganya teks bebas yang kebetulan sering berisi hal yang sama. Akibatnya
-- tidak ada satu tempat pun yang bisa menjawab pertanyaan paling wajar dari
-- seorang atasan: "proyek Balaikota itu sudah sampai mana?"
--
-- Tabel ini menjadi tempat itu. Pipeline, jadwal, laporan harian, dan GP
-- Calculation kini boleh menunjuk ke satu baris proyek, dan view di bawah
-- menyatukan seluruhnya menjadi satu ringkasan.
--
-- ── Kenapa project_id BOLEH KOSONG ─────────────────────────────────────────
--
-- Ini keputusan terpenting di migrasi ini. Kolomnya sengaja nullable.
--
-- Sales bertemu peluang baru di lapangan setiap hari, dan memaksa mereka
-- membuat baris proyek lebih dulu sebelum boleh mencatat apa pun akan
-- berakhir seperti semua kewajiban pencatatan yang mendahului pekerjaannya:
-- laporannya tidak jadi diisi sama sekali. Yang hilang bukan kerapian data,
-- melainkan datanya itu sendiri.
--
-- Jadi menautkan ke proyek adalah TAWARAN, bukan syarat. Yang belum tertaut
-- tetap tercatat dan tetap terhitung; ia hanya belum muncul di ringkasan
-- proyek — dan bisa ditautkan belakangan kapan saja.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.sm_proyek_nomor_seq;

CREATE TABLE IF NOT EXISTS public.sm_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode          text UNIQUE NOT NULL,

  name          text NOT NULL,
  customer_id   uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,

  -- Pemilik proyek. Dipakai policy untuk menjaga proyek Sales lain tidak
  -- terlihat, sama seperti sales_user_id pada modul lainnya.
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  status        text NOT NULL DEFAULT 'AKTIF'
                CHECK (status IN ('AKTIF', 'SELESAI', 'BATAL')),

  description   text,
  -- Nilai perkiraan yang diisi tangan; angka sesungguhnya tetap dihitung dari
  -- pipeline dan GP yang tertaut, dan itulah yang tampil di ringkasan.
  target_value  numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_value >= 0),

  start_date    date,
  end_date      date,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proyek_pemilik  ON public.sm_projects (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proyek_status   ON public.sm_projects (status);
CREATE INDEX IF NOT EXISTS idx_proyek_customer ON public.sm_projects (customer_id);
CREATE INDEX IF NOT EXISTS idx_proyek_nama     ON public.sm_projects (name);

DROP TRIGGER IF EXISTS trg_proyek_touch ON public.sm_projects;
CREATE TRIGGER trg_proyek_touch BEFORE UPDATE ON public.sm_projects
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

CREATE OR REPLACE FUNCTION public.sm_proyek_kode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.kode IS NULL OR NEW.kode = '' THEN
    NEW.kode := 'PRJ/' || to_char(now(), 'YYYY/MM') || '/' ||
                lpad(nextval('public.sm_proyek_nomor_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proyek_kode ON public.sm_projects;
CREATE TRIGGER trg_proyek_kode BEFORE INSERT ON public.sm_projects
  FOR EACH ROW EXECUTE FUNCTION public.sm_proyek_kode();

-- ── Tautan dari modul yang sudah ada ────────────────────────────────────────
--
-- ON DELETE SET NULL, bukan CASCADE. Menghapus baris proyek tidak boleh ikut
-- menghapus laporan harian, jadwal yang sudah dieksekusi dengan bukti foto,
-- atau GP Calculation yang sudah ditandatangani empat pihak. Yang hilang
-- cukup tautannya.

ALTER TABLE public.sm_pipeline
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_schedules
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_daily_reports
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

ALTER TABLE public.sm_gp_calculations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_proyek ON public.sm_pipeline (project_id);
CREATE INDEX IF NOT EXISTS idx_jadwal_proyek   ON public.sm_schedules (project_id);
CREATE INDEX IF NOT EXISTS idx_laporan_proyek  ON public.sm_daily_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_gp_proyek       ON public.sm_gp_calculations (project_id);

-- Kolom project_id pada GP ikut dibuka untuk disunting pemiliknya. Daftar
-- kolom di migrasi 016 ditulis eksplisit, jadi kolom baru harus ditambahkan
-- ke sana — kalau tidak, menautkan GP ke proyek akan ditolak tanpa sebab yang
-- terlihat.
GRANT UPDATE (project_id) ON public.sm_gp_calculations TO authenticated;

-- ── sm_gp_ringkasan WAJIB dibuat ulang ─────────────────────────────────────
--
-- View yang ditulis `SELECT c.*` MEMBEKUKAN daftar kolomnya saat dibuat.
-- Menambahkan project_id ke sm_gp_calculations di atas tidak membuat kolom itu
-- muncul di view yang sudah ada — dan sm_proyek_ringkasan di bawah membacanya
-- lewat r.project_id, jadi tanpa pembuatan ulang ini migrasinya gagal dengan
-- pesan "column r.project_id does not exist".
--
-- Ini bukan kehati-hatian berlebihan: setiap kali kelak ada kolom baru
-- ditambahkan ke sm_gp_calculations, view ini harus ikut dibuat ulang.

DROP VIEW IF EXISTS public.sm_proyek_ringkasan;
DROP VIEW IF EXISTS public.sm_gp_ringkasan;

CREATE VIEW public.sm_gp_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.*,
  t.total_qty,
  t.total_selling,
  t.total_material,
  t.gross_profit,
  t.dpp,
  t.total_selling - t.dpp                    AS ppn_amount,
  round(t.dpp * c.pph_rate, 2)               AS pph_amount,
  round(t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost, 2) AS net_amount_received,
  t.total_material + c.installation_cost + c.shipping_cost
    + c.operational_cost + c.other_cost      AS total_costing,
  round(
    (t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
    - (t.total_material + c.installation_cost + c.shipping_cost
       + c.operational_cost + c.other_cost), 2) AS net_profit,
  CASE WHEN t.dpp = 0 THEN 0 ELSE round(
    ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
     - (t.total_material + c.installation_cost + c.shipping_cost
        + c.operational_cost + c.other_cost)) / t.dpp, 6)
  END                                        AS net_margin,
  CASE
    WHEN t.dpp = 0 THEN 'TANPA NILAI'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.15
      THEN 'EXCEPTIONAL'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target + 0.10
      THEN 'EXCELLENT'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target
      THEN 'GOOD'
    WHEN ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
          - (t.total_material + c.installation_cost + c.shipping_cost
             + c.operational_cost + c.other_cost)) / t.dpp >= c.gp_target - 0.05
      THEN 'REVIEW'
    ELSE 'DIRECTOR APPROVAL'
  END                                        AS mutu_margin,
  t.jumlah_item
FROM public.sm_gp_calculations c
CROSS JOIN LATERAL (
  SELECT
    COALESCE(sum(i.qty), 0)            AS total_qty,
    COALESCE(sum(i.selling_total), 0)  AS total_selling,
    COALESCE(sum(i.costing_total), 0)  AS total_material,
    COALESCE(sum(i.gp_amount), 0)      AS gross_profit,
    count(i.id)                        AS jumlah_item,
    round(COALESCE(sum(i.selling_total), 0) / (1 + c.ppn_rate), 2) AS dpp
  FROM public.sm_gp_items i
  WHERE i.calculation_id = c.id
) t;

GRANT SELECT ON public.sm_gp_ringkasan TO authenticated;

-- ── Ringkasan satu proyek ───────────────────────────────────────────────────
--
-- security_invoker: seluruh subquery di bawah tunduk pada RLS tabel sumbernya.
-- Tanpa itu, satu SELECT ke view ini akan membuka nilai pipeline dan margin GP
-- proyek Sales lain — kebocoran yang muncul sebagai angka, bukan sebagai
-- baris, dan karena itu jauh lebih mudah lolos dari perhatian.

CREATE VIEW public.sm_proyek_ringkasan
WITH (security_invoker = true) AS
SELECT
  p.*,

  COALESCE(pl.jml, 0)          AS jumlah_pipeline,
  COALESCE(pl.nilai, 0)        AS nilai_pipeline,
  COALESCE(pl.gp, 0)           AS gp_pipeline,

  COALESCE(sc.jml, 0)          AS jumlah_jadwal,
  COALESCE(sc.selesai, 0)      AS jadwal_selesai,
  COALESCE(sc.meeting, 0)      AS jumlah_meeting,
  COALESCE(sc.meeting_selesai, 0) AS meeting_selesai,

  COALESCE(dr.jml, 0)          AS jumlah_laporan,
  dr.terakhir                  AS laporan_terakhir,

  COALESCE(gp.jml, 0)          AS jumlah_gp,
  COALESCE(gp.nilai, 0)        AS nilai_gp,
  COALESCE(gp.profit, 0)       AS profit_gp,
  COALESCE(gp.disetujui, 0)    AS gp_disetujui,
  COALESCE(gp.menunggu, 0)     AS gp_menunggu

FROM public.sm_projects p

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         COALESCE(sum(project_value), 0) AS nilai,
         COALESCE(sum(project_gp), 0)    AS gp
    FROM public.sm_pipeline WHERE project_id = p.id
) pl ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         count(*) FILTER (WHERE status = 'COMPLETED')                        AS selesai,
         count(*) FILTER (WHERE requires_attendance)                         AS meeting,
         count(*) FILTER (WHERE requires_attendance AND status = 'COMPLETED') AS meeting_selesai
    FROM public.sm_schedules WHERE project_id = p.id
) sc ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml, max(report_date) AS terakhir
    FROM public.sm_daily_reports WHERE project_id = p.id
) dr ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS jml,
         COALESCE(sum(r.total_selling), 0) AS nilai,
         COALESCE(sum(r.net_profit), 0)    AS profit,
         count(*) FILTER (WHERE r.status IN ('DISETUJUI', 'DIVERIFIKASI')) AS disetujui,
         count(*) FILTER (WHERE r.status IN ('DIAJUKAN', 'DIPERIKSA'))     AS menunggu
    FROM public.sm_gp_ringkasan r WHERE r.project_id = p.id
) gp ON true;

GRANT SELECT ON public.sm_proyek_ringkasan TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.sm_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proyek_baca ON public.sm_projects;
CREATE POLICY proyek_baca ON public.sm_projects
  FOR SELECT TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS proyek_buat ON public.sm_projects;
CREATE POLICY proyek_buat ON public.sm_projects
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS proyek_ubah ON public.sm_projects;
CREATE POLICY proyek_ubah ON public.sm_projects
  FOR UPDATE TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_pengawas())
  WITH CHECK (owner_user_id = public.sm_uid() OR public.sm_is_pengawas());

-- Menghapus proyek memutus tautan pada empat tabel sekaligus. Dibatasi ke
-- pemiliknya sendiri dan Admin; Manager yang salah klik pada proyek orang lain
-- akan merusak ringkasan yang bukan miliknya.
DROP POLICY IF EXISTS proyek_hapus ON public.sm_projects;
CREATE POLICY proyek_hapus ON public.sm_projects
  FOR DELETE TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_admin());
