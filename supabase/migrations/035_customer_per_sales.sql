-- ════════════════════════════════════════════════════════════════════════════
-- 035 — daftar customer milik Sales yang menanganinya.
--
-- Aturan dari pemilik platform:
--   • Customer hanya terlihat oleh Sales yang menanganinya.
--   • Sales lain tidak boleh melihatnya — tidak lewat daftar, pencarian
--     header, maupun isian pilihan customer.
--   • Yang boleh ikut melihat hanya ATASAN Sales itu sendiri (garis atasan
--     lewat users.manager_id), plus Admin.
--
-- Sebelum migrasi ini:
--   • customers_baca = true — semua orang melihat semua customer.
--   • created_by tidak punya default dan kode tidak pernah mengisinya, jadi
--     tidak ada satu baris pun yang tercatat pemiliknya.
--   • Nama unik secara GLOBAL. Begitu daftar dipisah per Sales, Sales B tidak
--     akan bisa mencatat "PT X" bila Sales A sudah punya — dan tidak pula bisa
--     melihat milik A. Keunikan dipindah menjadi per pemilik.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Pemilik terisi otomatis ─────────────────────────────────────────────
ALTER TABLE public.sm_customers ALTER COLUMN created_by SET DEFAULT public.sm_uid();

-- Baris lama: pemiliknya ditebak dari catatan pertama yang merujuknya. Baris
-- yang tidak dirujuk apa pun tetap tanpa pemilik — hanya Admin yang melihatnya.
UPDATE public.sm_customers c
   SET created_by = x.pemilik
  FROM (
    SELECT DISTINCT ON (customer_id) customer_id, pemilik
      FROM (
        SELECT customer_id, sales_user_id AS pemilik, created_at FROM public.sm_daily_reports
        UNION ALL
        SELECT customer_id, sales_user_id, created_at FROM public.sm_pipeline
        UNION ALL
        SELECT customer_id, owner_user_id, created_at FROM public.sm_projects
        UNION ALL
        SELECT customer_id, sales_user_id, created_at FROM public.sm_gp_calculations
        UNION ALL
        SELECT customer_id, coalesce(assigned_to, created_by), created_at FROM public.sm_schedules
      ) r
     WHERE customer_id IS NOT NULL AND pemilik IS NOT NULL
     ORDER BY customer_id, created_at
  ) x
 WHERE c.id = x.customer_id AND c.created_by IS NULL;

-- ── 2. Nama unik per pemilik, bukan global ─────────────────────────────────
DROP INDEX IF EXISTS public.idx_customers_name_unik;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_pemilik_nama
  ON public.sm_customers (created_by, lower(btrim(name)));

-- ── 3. Siapa atasan siapa ──────────────────────────────────────────────────
-- Benar bila pemanggil berada di garis atasan p_user (atasan langsung, atau
-- atasan dari atasannya). SECURITY DEFINER supaya tidak bergantung pada hak
-- baca tabel users milik pemanggil; kedalaman dibatasi agar data manager_id
-- yang melingkar tidak membuat kueri berputar tanpa akhir.
CREATE OR REPLACE FUNCTION public.sm_adalah_atasan(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH RECURSIVE garis AS (
    SELECT manager_id, 1 AS tingkat FROM public.users WHERE id = p_user
    UNION ALL
    SELECT u.manager_id, g.tingkat + 1
      FROM garis g JOIN public.users u ON u.id = g.manager_id
     WHERE g.tingkat < 10
  )
  SELECT p_user IS NOT NULL AND public.sm_uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM garis WHERE manager_id = public.sm_uid());
$$;

REVOKE ALL ON FUNCTION public.sm_adalah_atasan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sm_adalah_atasan(uuid) TO authenticated;

-- ── 4. Policy ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS customers_baca  ON public.sm_customers;
DROP POLICY IF EXISTS customers_tulis ON public.sm_customers;
DROP POLICY IF EXISTS customers_ubah  ON public.sm_customers;

CREATE POLICY customers_baca ON public.sm_customers FOR SELECT TO authenticated
  USING (created_by = public.sm_uid()
         OR public.sm_is_admin()
         OR public.sm_adalah_atasan(created_by));

-- Customer selalu dicatat atas nama pembuatnya; hanya Admin yang boleh
-- mencatatkannya untuk orang lain.
CREATE POLICY customers_tulis ON public.sm_customers FOR INSERT TO authenticated
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_admin());

-- Menyunting: pemilik sendiri atau Admin — sama dengan aturan data lain.
CREATE POLICY customers_ubah ON public.sm_customers FOR UPDATE TO authenticated
  USING (created_by = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (created_by = public.sm_uid() OR public.sm_is_admin());

-- customers_hapus (hanya Admin) tidak berubah.
