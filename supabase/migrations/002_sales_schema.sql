-- ════════════════════════════════════════════════════════════════════════════
-- 002 — Daily Report & Pipeline
--
-- Customer dibuat relasional sejak awal (§45) supaya jalur
-- Customer → Lead → Pipeline → Quotation → Won → Project (§46) bisa tumbuh
-- tanpa migrasi besar — tapi berhenti di situ: tidak ada modul Project
-- Management yang dibangun sekarang.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Customer & kontak ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  address    text,
  city       text,
  phone      text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nama customer dinormalkan saat dicocokkan supaya "PT Maju" dan "pt maju"
-- tidak jadi dua baris berbeda yang memecah riwayat satu pelanggan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name_unik
  ON public.sm_customers (lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.sm_customers (name);

CREATE TABLE IF NOT EXISTS public.sm_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES public.sm_customers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  position       text,
  phone_whatsapp text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON public.sm_contacts (customer_id);

-- ── Daily Sales Report (§12–§16) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_daily_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_date    date NOT NULL,
  customer_id    uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  -- Nama customer ikut disalin sebagai teks: laporan harian adalah catatan
  -- historis, jadi ia harus tetap terbaca apa adanya walau baris customer-nya
  -- kelak dirapikan atau digabung.
  customer_name  text NOT NULL,
  contact_person text,
  position       text,
  phone_whatsapp text,
  activity       text NOT NULL,
  lead_project   text,
  result         text NOT NULL,
  next_action    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- §14: satu laporan per Sales per hari, ditegakkan database — bukan hanya
-- validasi frontend, yang bisa dilewati dengan memanggil API langsung.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_satu_per_hari
  ON public.sm_daily_reports (sales_user_id, report_date);

CREATE INDEX IF NOT EXISTS idx_daily_report_tanggal
  ON public.sm_daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_report_sales
  ON public.sm_daily_reports (sales_user_id, report_date DESC);

DROP TRIGGER IF EXISTS trg_daily_report_touch ON public.sm_daily_reports;
CREATE TRIGGER trg_daily_report_touch BEFORE UPDATE ON public.sm_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Sales Pipeline (§17–§22) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_pipeline (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pipeline_date    date NOT NULL DEFAULT current_date,
  customer_id      uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,
  customer_name    text NOT NULL,
  contact_person   text,
  project_detail   text NOT NULL,
  quantity         numeric(14,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit             text NOT NULL DEFAULT 'unit',

  -- numeric, bukan float: perhitungan uang tidak boleh kena galat biner
  -- (§73). numeric(18,2) cukup untuk nilai proyek sampai ribuan triliun.
  project_value    numeric(18,2) NOT NULL DEFAULT 0 CHECK (project_value >= 0),
  project_hpp      numeric(18,2) NOT NULL DEFAULT 0 CHECK (project_hpp    >= 0),

  -- §19: GP dihitung database, bukan diketik manual. GENERATED STORED membuat
  -- nilainya mustahil berbeda dari rumusnya — termasuk lewat pemanggilan API
  -- langsung yang melewati frontend.
  project_gp       numeric(18,2)
                   GENERATED ALWAYS AS (project_value - project_hpp) STORED,

  -- §20: pembagian nol ditutup di sini. Inilah alasan NaN/Infinity tidak
  -- pernah bisa sampai ke layar — bukan karena frontend rajin memeriksanya,
  -- tapi karena nilainya memang tidak pernah ada di database.
  gp_percentage    numeric(6,2)
                   GENERATED ALWAYS AS (
                     CASE WHEN project_value > 0
                          THEN round((project_value - project_hpp) / project_value * 100, 2)
                          ELSE 0 END
                   ) STORED,

  -- Opsi yang boleh dipakai tinggal di sm_settings (§21); di sini hanya
  -- dijaga rentang wajarnya supaya data tetap masuk akal kalau daftar
  -- opsinya kelak diubah admin.
  probability      smallint NOT NULL DEFAULT 50
                   CHECK (probability BETWEEN 0 AND 100),
  estimated_closing date NOT NULL,
  next_action      text NOT NULL,
  stage            text NOT NULL DEFAULT 'OPEN'
                   CHECK (stage IN ('OPEN', 'QUOTATION', 'WON', 'LOST')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_sales
  ON public.sm_pipeline (sales_user_id, pipeline_date DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_closing
  ON public.sm_pipeline (estimated_closing);
CREATE INDEX IF NOT EXISTS idx_pipeline_probability
  ON public.sm_pipeline (probability);
CREATE INDEX IF NOT EXISTS idx_pipeline_customer
  ON public.sm_pipeline (customer_id);

DROP TRIGGER IF EXISTS trg_pipeline_touch ON public.sm_pipeline;
CREATE TRIGGER trg_pipeline_touch BEFORE UPDATE ON public.sm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();
