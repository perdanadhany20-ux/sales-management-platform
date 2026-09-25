-- ════════════════════════════════════════════════════════════════════════════
-- 025 — Perbaiki celah §022: admin edit GP Calculation orang lain bisa
--        menghapus item tanpa bisa menggantinya
--
-- FormGp.tsx menyunting item dengan cara hapus-semua-lalu-sisipkan-ulang
-- (lihat komentar di sana). gp_item_hapus sudah diberi jalan admin sejak
-- migrasi 022, tapi gp_item_tulis (INSERT) dan gp_item_ubah (UPDATE) — yang
-- keduanya hanya mengizinkan sales_user_id pemilik dokumen berstatus DRAFT —
-- terlewat. Akibatnya: Admin yang menyunting dokumen ORANG LAIN yang sudah
-- bukan DRAFT berhasil menghapus seluruh baris item lama (DELETE lolos),
-- tapi gagal menyisipkan baris baru (INSERT ditolak) — dokumen tertinggal
-- tanpa satu pun item, bukan tersunting. Disamakan dengan pola gp_sunting
-- di sm_gp_calculations: pemilik ATAU admin, tanpa syarat status untuk admin.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS gp_item_tulis ON public.sm_gp_items;
CREATE POLICY gp_item_tulis ON public.sm_gp_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  );

DROP POLICY IF EXISTS gp_item_ubah ON public.sm_gp_items;
CREATE POLICY gp_item_ubah ON public.sm_gp_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sm_gp_calculations c
      WHERE c.id = sm_gp_items.calculation_id
        AND ((c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT') OR public.sm_is_admin())
    )
  );
