-- ════════════════════════════════════════════════════════════════════════════
-- 022 — Admin bisa edit/hapus data siapa pun; Sales hanya bisa edit miliknya
--        sendiri dan TIDAK BISA menghapusnya
--
-- Sebelum migrasi ini, dua hal terbalik dari yang seharusnya:
--   1. Sales bisa menghapus Daily Report, Pipeline, dan GP Calculation
--      draft miliknya sendiri — padahal begitu tercatat, riwayatnya milik
--      perusahaan, bukan sesuatu yang boleh dihapus orang yang membuatnya.
--   2. Admin justru TIDAK BISA mengedit Daily Report atau Pipeline sama
--      sekali — kebijakan UPDATE-nya hanya mengizinkan sales_user_id = diri
--      sendiri, sehingga "Admin bisa sunting apa pun" belum benar-benar ada
--      di database, baru di kepala.
--
-- Aturan barunya, seragam di tiga tabel ini:
--   - EDIT  : pemilik ATAU sm_is_admin() — Manager TIDAK diikutkan sengaja,
--             supaya "siapa yang boleh mengubah data siapa pun" tetap satu
--             peran saja, bukan dua peran dengan cakupan yang mudah bergeser.
--   - HAPUS : sm_is_admin() saja — pemilik tidak lagi bisa menghapus.
--
-- SELECT tidak disentuh: dr_baca/pl_baca/gp_baca sudah membatasi Sales hanya
-- melihat miliknya sendiri (sales_user_id = sm_uid()), Manager/Admin melihat
-- semua lewat sm_is_pengawas() — itu sudah benar dan tetap seperti itu.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Daily Report ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS dr_ubah ON public.sm_daily_reports;
CREATE POLICY dr_ubah ON public.sm_daily_reports
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

DROP POLICY IF EXISTS dr_hapus ON public.sm_daily_reports;
CREATE POLICY dr_hapus ON public.sm_daily_reports
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Pipeline ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pl_ubah ON public.sm_pipeline;
CREATE POLICY pl_ubah ON public.sm_pipeline
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

DROP POLICY IF EXISTS pl_hapus ON public.sm_pipeline;
CREATE POLICY pl_hapus ON public.sm_pipeline
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── GP Calculation ───────────────────────────────────────────────────────────
-- Sunting tetap terkunci ke status DRAFT untuk Sales (dokumen yang sudah
-- diajukan beku — lihat migrasi 016); Admin dikecualikan dari batas itu
-- karena "bisa edit apa pun" berarti apa pun statusnya, bukan cuma draft.
DROP POLICY IF EXISTS gp_sunting ON public.sm_gp_calculations;
CREATE POLICY gp_sunting ON public.sm_gp_calculations
  FOR UPDATE TO authenticated
  USING ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin())
  WITH CHECK ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin());

DROP POLICY IF EXISTS gp_hapus ON public.sm_gp_calculations;
CREATE POLICY gp_hapus ON public.sm_gp_calculations
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Proyek ───────────────────────────────────────────────────────────────────
-- proyek_ubah TIDAK disentuh (owner ATAU pengawas — sudah termasuk Admin).
-- Hanya HAPUS yang dipersempit: pemilik proyek tidak lagi bisa menghapus
-- wadah yang mungkin sudah ditautkan pipeline/jadwal/GP milik orang lain.
DROP POLICY IF EXISTS proyek_hapus ON public.sm_projects;
CREATE POLICY proyek_hapus ON public.sm_projects
  FOR DELETE TO authenticated
  USING (public.sm_is_admin());

-- ── Schedule (Request Schedule) ──────────────────────────────────────────────
-- Sebelumnya HANYA Manager/Admin yang bisa UPDATE baris sm_schedules sama
-- sekali — bahkan Sales tidak bisa memperbaiki pengajuannya sendiri yang
-- salah ketik. Sekarang Sales boleh menyunting pengajuannya SENDIRI selama
-- masih UPCOMING dan belum ditugaskan (assigned_to IS NULL) — persis syarat
-- yang sudah dipakai sch_ajukan untuk INSERT, supaya "boleh dibuat" dan
-- "boleh disunting sebelum ditugaskan" konsisten. Begitu ditugaskan atau
-- statusnya berubah, kembali terkunci ke Manager/Admin — perubahan sesudah
-- itu menyentuh proses check-in GPS yang tidak boleh diutak-atik klien.
DROP POLICY IF EXISTS sch_kelola ON public.sm_schedules;
CREATE POLICY sch_kelola ON public.sm_schedules
  FOR UPDATE TO authenticated
  USING (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid() AND assigned_to IS NULL AND status = 'UPCOMING')
  )
  WITH CHECK (
    public.sm_is_pengawas()
    OR (created_by = public.sm_uid() AND assigned_to IS NULL AND status = 'UPCOMING')
  );
