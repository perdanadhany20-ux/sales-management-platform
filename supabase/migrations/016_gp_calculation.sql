-- ════════════════════════════════════════════════════════════════════════════
-- 016 — GP Calculation Form
--
-- Dibuat mengikuti berkas asli yang dipakai tim (GP_BALAIKOTA.xlsx) — setiap
-- pos biaya, setiap rumus, dan rantai tanda tangannya. Yang berubah hanya
-- tempat rumusnya tinggal: di spreadsheet rumus itu ada di dalam sel yang bisa
-- ditimpa siapa saja; di sini ia ada di kolom GENERATED dan view, tempat yang
-- tidak bisa ditimpa siapa pun.
--
-- Itu bukan kerapian belaka. Pada berkas aslinya, satu sel rumus yang tidak
-- sengaja tertimpa angka ketikan akan menghasilkan GP yang salah tanpa satu
-- pun tanda di layar — dan angka itulah yang dibawa ke rapat.
--
-- ── Catatan penting soal harga ─────────────────────────────────────────────
-- Unit Price pada DETAIL ITEM adalah harga jual BRUTO (sudah termasuk PPN),
-- persis seperti berkas aslinya: di sana Total Selling (DPP) dihitung sebagai
-- H31/1.11, yaitu total item DIBAGI (1 + PPN). Kalau kelak ada yang mengira
-- kolom itu DPP dan mengisinya tanpa PPN, seluruh angka di bawahnya akan
-- meleset ~11% — karena itu diletakkan sebagai catatan, bukan asumsi diam.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.sm_gp_nomor_seq;

CREATE TABLE IF NOT EXISTS public.sm_gp_calculations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor         text UNIQUE NOT NULL,

  -- Pemiliknya. Inilah kolom yang menjaga data antar-Sales tidak saling
  -- terlihat; seluruh policy di bawah bersandar padanya.
  sales_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Asal-usulnya bila dibuat dari peluang yang sudah deal. SET NULL, bukan
  -- CASCADE: menghapus baris pipeline tidak boleh ikut menghapus perhitungan
  -- GP yang sudah ditandatangani empat pihak.
  pipeline_id   uuid REFERENCES public.sm_pipeline(id) ON DELETE SET NULL,
  customer_id   uuid REFERENCES public.sm_customers(id) ON DELETE SET NULL,

  customer_name text NOT NULL,
  project_name  text NOT NULL,
  po_spk_no     text,
  calc_date     date NOT NULL DEFAULT current_date,
  payment_term  text,
  lead_time     text,

  -- Tarif disimpan PER DOKUMEN, bukan diambil dari pengaturan saat dibaca.
  -- Kalau tarif PPN nasional berubah tahun depan, perhitungan yang sudah
  -- disetujui tahun ini harus tetap menunjukkan angka yang dulu disetujui.
  ppn_rate      numeric(6,4) NOT NULL DEFAULT 0.11  CHECK (ppn_rate BETWEEN 0 AND 1),
  pph_rate      numeric(6,4) NOT NULL DEFAULT 0.025 CHECK (pph_rate BETWEEN 0 AND 1),
  gp_target     numeric(6,4) NOT NULL DEFAULT 0.20  CHECK (gp_target BETWEEN 0 AND 1),

  -- COST BREAKDOWN di luar material (material dihitung dari item).
  installation_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (installation_cost >= 0),
  shipping_cost     numeric(18,2) NOT NULL DEFAULT 0 CHECK (shipping_cost     >= 0),
  operational_cost  numeric(18,2) NOT NULL DEFAULT 0 CHECK (operational_cost  >= 0),
  other_cost        numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_cost        >= 0),

  -- Potongan dari sisi penerimaan, bukan biaya proyek. Letaknya di SELLING
  -- SUMMARY pada berkas asli, dan ia mengurangi NET AMOUNT RECEIVED.
  disbursement_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (disbursement_cost >= 0),

  wapu          boolean NOT NULL DEFAULT false,
  currency      text NOT NULL DEFAULT 'IDR',
  notes         text,

  -- ── Rantai persetujuan (empat tanda tangan pada berkas asli) ──
  status text NOT NULL DEFAULT 'DRAFT'
         CHECK (status IN ('DRAFT', 'DIAJUKAN', 'DIPERIKSA',
                           'DISETUJUI', 'DIVERIFIKASI', 'DITOLAK')),

  submitted_at timestamptz,
  checked_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  checked_at   timestamptz,
  approved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  verified_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at  timestamptz,
  rejected_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at  timestamptz,
  rejection_reason text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gp_sales     ON public.sm_gp_calculations (sales_user_id, calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_gp_status    ON public.sm_gp_calculations (status);
CREATE INDEX IF NOT EXISTS idx_gp_tanggal   ON public.sm_gp_calculations (calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_gp_pipeline  ON public.sm_gp_calculations (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_gp_customer  ON public.sm_gp_calculations (customer_id);
CREATE INDEX IF NOT EXISTS idx_gp_pemeriksa ON public.sm_gp_calculations (checked_by);
CREATE INDEX IF NOT EXISTS idx_gp_penyetuju ON public.sm_gp_calculations (approved_by);
CREATE INDEX IF NOT EXISTS idx_gp_verifikator ON public.sm_gp_calculations (verified_by);
CREATE INDEX IF NOT EXISTS idx_gp_penolak   ON public.sm_gp_calculations (rejected_by);

-- Indeks penutup FK dipasang sejak awal, bukan menunggu advisor menegur —
-- pelajaran dari migrasi 013.

DROP TRIGGER IF EXISTS trg_gp_touch ON public.sm_gp_calculations;
CREATE TRIGGER trg_gp_touch BEFORE UPDATE ON public.sm_gp_calculations
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();

-- ── Nomor dokumen ───────────────────────────────────────────────────────────
--
-- Memakai sequence, bukan "hitung baris bulan ini lalu tambah satu". Cara
-- kedua terlihat lebih rapi (nomornya mulai dari 1 tiap bulan) tapi dua Sales
-- yang menekan Simpan pada detik yang sama akan memperoleh nomor yang sama,
-- dan yang kalah mendapat error tepat setelah mengetik satu formulir penuh.

CREATE OR REPLACE FUNCTION public.sm_gp_nomor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.nomor IS NULL OR NEW.nomor = '' THEN
    NEW.nomor := 'GP/' || to_char(now(), 'YYYY/MM') || '/' ||
                 lpad(nextval('public.sm_gp_nomor_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gp_nomor ON public.sm_gp_calculations;
CREATE TRIGGER trg_gp_nomor BEFORE INSERT ON public.sm_gp_calculations
  FOR EACH ROW EXECUTE FUNCTION public.sm_gp_nomor();

-- ── DETAIL ITEM ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sm_gp_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid NOT NULL REFERENCES public.sm_gp_calculations(id) ON DELETE CASCADE,
  urutan         integer NOT NULL DEFAULT 1,

  description    text NOT NULL,
  qty            numeric(14,2) NOT NULL DEFAULT 1 CHECK (qty >= 0),
  vendor         text,
  unit_price     numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_cost      numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost  >= 0),

  -- Kolom GENERATED, sama seperti project_gp di sm_pipeline: JANGAN dikirim
  -- saat insert maupun update. Inilah yang membuat angka di layar Sales
  -- mustahil berbeda dari angka di layar Director.
  selling_total  numeric(18,2) GENERATED ALWAYS AS (unit_price * qty) STORED,
  costing_total  numeric(18,2) GENERATED ALWAYS AS (unit_cost  * qty) STORED,
  gp_amount      numeric(18,2) GENERATED ALWAYS AS ((unit_price - unit_cost) * qty) STORED,

  -- Pembagian nol dijaga di sini, bukan diserahkan ke pembacanya. Pada berkas
  -- aslinya baris kosong menghasilkan #DIV/0! yang lalu ikut tercetak.
  gp_percentage  numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN unit_price * qty = 0 THEN 0
         ELSE ((unit_price - unit_cost) * qty) / (unit_price * qty) * 100
    END
  ) STORED,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gp_items_induk
  ON public.sm_gp_items (calculation_id, urutan);

-- ── Ringkasan: seluruh rumus berkas asli, dalam satu view ──────────────────
--
-- security_invoker: view tunduk pada RLS tabel sumbernya, sehingga Sales hanya
-- melihat ringkasan miliknya sendiri. Tanpa opsi ini, satu SELECT ke view ini
-- membuka seluruh angka GP tim — termasuk margin proyek Sales lain.

DROP VIEW IF EXISTS public.sm_gp_ringkasan;

CREATE VIEW public.sm_gp_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.*,

  t.total_qty,
  t.total_selling,                                   -- bruto, termasuk PPN
  t.total_material,
  t.gross_profit,                                    -- Σ GP item

  -- SELLING SUMMARY
  t.dpp,
  t.total_selling - t.dpp                    AS ppn_amount,
  round(t.dpp * c.pph_rate, 2)               AS pph_amount,
  round(t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost, 2)
                                             AS net_amount_received,

  -- COST BREAKDOWN
  t.total_material + c.installation_cost + c.shipping_cost
    + c.operational_cost + c.other_cost      AS total_costing,

  -- PROFIT ANALYSIS
  round(
    (t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
    - (t.total_material + c.installation_cost + c.shipping_cost
       + c.operational_cost + c.other_cost), 2)
                                             AS net_profit,

  CASE WHEN t.dpp = 0 THEN 0 ELSE round(
    ((t.dpp - (t.dpp * c.pph_rate) - c.disbursement_cost)
     - (t.total_material + c.installation_cost + c.shipping_cost
        + c.operational_cost + c.other_cost)) / t.dpp, 6)
  END                                        AS net_margin,

  -- Status mutu margin — rumus IF bertingkat pada berkas asli, apa adanya.
  -- Ambangnya poin persentase absolut terhadap target, bukan kelipatan.
  -- Ditulis berulang alih-alih lewat CTE karena CASE di dalam daftar SELECT
  -- tidak boleh memuat WITH. Panjang, tapi jujur: yang dibandingkan persis
  -- rumus IF bertingkat pada berkas asli.
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
    -- DPP = total bruto dibagi (1 + PPN), persis H31/1.11 pada berkas asli.
    round(COALESCE(sum(i.selling_total), 0) / (1 + c.ppn_rate), 2) AS dpp
  FROM public.sm_gp_items i
  WHERE i.calculation_id = c.id
) t;

GRANT SELECT ON public.sm_gp_ringkasan TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_gp_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_gp_items        ENABLE ROW LEVEL SECURITY;

-- Inti permintaan: antar Sales tidak boleh saling melihat. Pengawas
-- (Manager, Admin, Director, Finance) melihat semua karena merekalah yang
-- memeriksa dan menandatangani.
DROP POLICY IF EXISTS gp_baca ON public.sm_gp_calculations;
CREATE POLICY gp_baca ON public.sm_gp_calculations
  FOR SELECT TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_pengawas());

DROP POLICY IF EXISTS gp_buat ON public.sm_gp_calculations;
CREATE POLICY gp_buat ON public.sm_gp_calculations
  FOR INSERT TO authenticated
  -- Tidak bisa dibuat atas nama orang lain, dan tidak bisa lahir langsung
  -- dalam keadaan sudah disetujui.
  WITH CHECK (sales_user_id = public.sm_uid() AND status = 'DRAFT');

-- Hanya selama DRAFT. Begitu diajukan, isinya beku — dokumen yang masih bisa
-- disunting sesudah ditandatangani bukan dokumen yang ditandatangani.
DROP POLICY IF EXISTS gp_sunting ON public.sm_gp_calculations;
CREATE POLICY gp_sunting ON public.sm_gp_calculations
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() AND status = 'DRAFT')
  WITH CHECK (sales_user_id = public.sm_uid() AND status = 'DRAFT');

DROP POLICY IF EXISTS gp_hapus ON public.sm_gp_calculations;
CREATE POLICY gp_hapus ON public.sm_gp_calculations
  FOR DELETE TO authenticated
  USING ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin());

-- Policy di atas membatasi BARIS mana yang boleh disunting, tapi RLS tidak
-- mengenal kolom. Tanpa pembatasan berikut, pemilik dokumen bisa menembakkan
-- UPDATE status='DISETUJUI' pada barisnya sendiri selagi DRAFT dan melompati
-- seluruh rantai tanda tangan dalam satu permintaan.
--
-- Karena itu hak UPDATE dicabut lalu diberikan ulang HANYA pada kolom isian.
-- status, seluruh kolom tanda tangan, dan nomor dokumen tidak ada di daftar.
REVOKE UPDATE ON public.sm_gp_calculations FROM authenticated;
GRANT UPDATE (
  customer_id, customer_name, project_name, po_spk_no, calc_date,
  payment_term, lead_time, ppn_rate, pph_rate, gp_target,
  installation_cost, shipping_cost, operational_cost, other_cost,
  disbursement_cost, wapu, currency, notes, pipeline_id, updated_at
) ON public.sm_gp_calculations TO authenticated;

-- ── Item mengikuti induknya ────────────────────────────────────────────────

DROP POLICY IF EXISTS gp_item_baca ON public.sm_gp_items;
CREATE POLICY gp_item_baca ON public.sm_gp_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND (c.sales_user_id = public.sm_uid() OR public.sm_is_pengawas())
  ));

DROP POLICY IF EXISTS gp_item_tulis ON public.sm_gp_items;
CREATE POLICY gp_item_tulis ON public.sm_gp_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND c.sales_user_id = public.sm_uid()
       AND c.status = 'DRAFT'
  ));

DROP POLICY IF EXISTS gp_item_ubah ON public.sm_gp_items;
CREATE POLICY gp_item_ubah ON public.sm_gp_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ));

DROP POLICY IF EXISTS gp_item_hapus ON public.sm_gp_items;
CREATE POLICY gp_item_hapus ON public.sm_gp_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- Rantai persetujuan — satu-satunya jalan status berpindah
-- ════════════════════════════════════════════════════════════════════════════

-- DRAFT → DIAJUKAN. Milik pemiliknya sendiri.
CREATE OR REPLACE FUNCTION public.sm_gp_ajukan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid  uuid := public.sm_uid();
  v_gp   public.sm_gp_calculations%ROWTYPE;
  v_item integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id <> v_uid THEN
    RAISE EXCEPTION 'Hanya pembuatnya yang boleh mengajukan perhitungan ini.'
      USING ERRCODE = '42501';
  END IF;

  IF v_gp.status <> 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DRAFT',
      'message', 'Perhitungan ini sudah diajukan sebelumnya.');
  END IF;

  SELECT count(*) INTO v_item FROM public.sm_gp_items WHERE calculation_id = p_id;
  IF v_item = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TANPA_ITEM',
      'message', 'Tambahkan minimal satu item sebelum mengajukan.');
  END IF;

  UPDATE public.sm_gp_calculations
     SET status = 'DIAJUKAN', submitted_at = now(),
         rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
   WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DIAJUKAN', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'jumlah_item', v_item));

  RETURN jsonb_build_object('ok', true, 'status', 'DIAJUKAN');
END;
$$;

-- Satu fungsi untuk tiga langkah berikutnya. Yang menentukan langkah mana yang
-- terjadi adalah STATUS SAAT INI, bukan apa yang dikirim klien — klien hanya
-- menyebut dokumen mana yang hendak disetujui.
CREATE OR REPLACE FUNCTION public.sm_gp_setujui(p_id uuid, p_catatan text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := public.sm_uid();
  v_peran text := public.sm_role();
  v_gp    public.sm_gp_calculations%ROWTYPE;
  v_baru  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  -- Pemeriksaan wewenang per langkah. Admin boleh di setiap langkah bukan
  -- karena ia atasan semua orang, melainkan supaya rantai tidak macet total
  -- ketika Director atau Finance belum punya akun — dan setiap langkahnya
  -- tetap tercatat atas namanya di audit_trail.
  IF v_gp.status = 'DIAJUKAN' THEN
    IF v_peran NOT IN ('MANAGER', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu pemeriksaan Manager Sales.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIPERIKSA';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, checked_by = v_uid, checked_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DIPERIKSA' THEN
    IF v_peran NOT IN ('DIRECTOR', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu persetujuan Director.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DISETUJUI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, approved_by = v_uid, approved_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DISETUJUI' THEN
    IF v_peran NOT IN ('FINANCE', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu verifikasi Finance.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DIVERIFIKASI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, verified_by = v_uid, verified_at = now() WHERE id = p_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'STATUS_TIDAK_SESUAI',
      'message', 'Perhitungan ini tidak sedang menunggu persetujuan siapa pun.');
  END IF;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_' || v_baru, 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'catatan', p_catatan));

  RETURN jsonb_build_object('ok', true, 'status', v_baru);
END;
$$;

-- Penolakan mengembalikan dokumen ke pembuatnya untuk diperbaiki. Alasannya
-- wajib dan tersimpan permanen — penolakan tanpa alasan hanya memindahkan
-- kebingungan, bukan menyelesaikannya.
CREATE OR REPLACE FUNCTION public.sm_gp_tolak(p_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.sm_uid();
  v_gp  public.sm_gp_calculations%ROWTYPE;
BEGIN
  IF NOT public.sm_is_pengawas() THEN
    RAISE EXCEPTION 'Hanya pemeriksa yang boleh menolak perhitungan.' USING ERRCODE = '42501';
  END IF;

  IF length(trim(COALESCE(p_alasan, ''))) < 10 THEN
    RAISE EXCEPTION 'Alasan penolakan wajib diisi minimal 10 karakter.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.status IN ('DRAFT', 'DITOLAK') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'STATUS_TIDAK_SESUAI',
      'message', 'Perhitungan ini belum diajukan.');
  END IF;

  UPDATE public.sm_gp_calculations
     SET status = 'DITOLAK', rejected_by = v_uid, rejected_at = now(),
         rejection_reason = trim(p_alasan)
   WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DITOLAK', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor, 'dari_status', v_gp.status,
                             'alasan', trim(p_alasan)));

  RETURN jsonb_build_object('ok', true, 'status', 'DITOLAK');
END;
$$;

-- Dokumen yang ditolak kembali bisa disunting pembuatnya.
CREATE OR REPLACE FUNCTION public.sm_gp_buka_ulang(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.sm_uid();
  v_gp  public.sm_gp_calculations%ROWTYPE;
BEGIN
  SELECT * INTO v_gp FROM public.sm_gp_calculations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perhitungan tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  IF v_gp.sales_user_id <> v_uid AND NOT public.sm_is_admin() THEN
    RAISE EXCEPTION 'Hanya pembuatnya yang boleh membuka ulang perhitungan ini.'
      USING ERRCODE = '42501';
  END IF;

  IF v_gp.status <> 'DITOLAK' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DITOLAK',
      'message', 'Hanya perhitungan yang ditolak yang bisa dibuka ulang.');
  END IF;

  UPDATE public.sm_gp_calculations SET status = 'DRAFT' WHERE id = p_id;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (v_uid, 'GP_DIBUKA_ULANG', 'sm_gp_calculations', p_id::text,
          jsonb_build_object('nomor', v_gp.nomor));

  RETURN jsonb_build_object('ok', true, 'status', 'DRAFT');
END;
$$;

-- SECURITY DEFINER berarti hak eksekusinya harus dibatasi rapat. `anon`
-- sengaja tidak ikut: tanpa sesi tidak ada dokumen yang sah untuk disetujui.
REVOKE EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)          FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text)   FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)     FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)      FROM public;

GRANT EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    TO authenticated;
