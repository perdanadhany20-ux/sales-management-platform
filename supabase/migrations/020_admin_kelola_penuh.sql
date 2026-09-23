-- ════════════════════════════════════════════════════════════════════════════
-- 020 — Admin bisa menyunting dan menghapus di seluruh modul
--
-- Sebelum ini Admin bisa MENGHAPUS laporan dan pipeline milik orang lain tapi
-- tidak bisa MENYUNTINGNYA. Akibatnya satu-satunya cara memperbaiki salah
-- ketik pada laporan seorang Sales adalah menghapusnya — kehilangan seluruh
-- barisnya hanya karena satu angka keliru, lalu meminta orangnya mengetik
-- ulang. Kombinasi yang paling buruk dari keduanya.
--
-- ── Yang TIDAK ikut dibuka, dan alasannya ──────────────────────────────────
--
-- Tiga hal sengaja tetap tertutup bahkan bagi Admin. Ini bukan kelalaian
-- melainkan justru yang membuat sisanya bisa dipercaya:
--
--   1. audit_trail — tidak ada policy UPDATE maupun DELETE untuk siapa pun.
--      Jejak yang bisa disunting oleh orang yang tindakannya dicatat di
--      dalamnya bukan jejak audit, melainkan catatan biasa.
--
--   2. Berkas foto bukti di Storage tidak bisa DITIMPA. Admin boleh
--      MENGHAPUSNYA — dan penghapusan itu terlihat, karena barisnya hilang.
--      Menimpa foto lama dengan foto baru pada jalur yang sama mengubah isi
--      bukti tanpa meninggalkan tanda apa pun.
--
--   3. Kolom GENERATED (project_gp, gp_percentage, selling_total, dan
--      kawan-kawan) tidak bisa ditulis siapa pun, termasuk Admin. Itulah yang
--      membuat angka di layar Sales mustahil berbeda dari angka di layar
--      Director.
--
-- Suntingan Admin pada dokumen yang SUDAH DITANDATANGANI dicatat otomatis ke
-- audit_trail oleh trigger di bawah. Kewenangannya diberikan; jejaknya tetap
-- ada.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Laporan harian ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS dr_ubah ON public.sm_daily_reports;
CREATE POLICY dr_ubah ON public.sm_daily_reports
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  -- WITH CHECK tetap mengunci kepemilikan bagi non-Admin: tanpa itu, seorang
  -- Sales bisa "mengoper" laporannya ke orang lain lewat satu UPDATE dan
  -- merusak angka kepatuhan dua orang sekaligus.
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Pipeline ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS pl_ubah ON public.sm_pipeline;
CREATE POLICY pl_ubah ON public.sm_pipeline
  FOR UPDATE TO authenticated
  USING (sales_user_id = public.sm_uid() OR public.sm_is_admin())
  WITH CHECK (sales_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── GP Calculation ──────────────────────────────────────────────────────────
--
-- Pemiliknya tetap hanya bisa menyunting selagi DRAFT — dokumen yang masih
-- bisa diubah pembuatnya sesudah ditandatangani bukan dokumen yang
-- ditandatangani. Admin bisa menyunting pada status apa pun, dan trigger di
-- bawah mencatatnya.

DROP POLICY IF EXISTS gp_sunting ON public.sm_gp_calculations;
CREATE POLICY gp_sunting ON public.sm_gp_calculations
  FOR UPDATE TO authenticated
  USING ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin())
  WITH CHECK ((sales_user_id = public.sm_uid() AND status = 'DRAFT') OR public.sm_is_admin());

DROP POLICY IF EXISTS gp_item_tulis ON public.sm_gp_items;
CREATE POLICY gp_item_tulis ON public.sm_gp_items
  FOR INSERT TO authenticated
  WITH CHECK (public.sm_is_admin() OR EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id
       AND c.sales_user_id = public.sm_uid()
       AND c.status = 'DRAFT'
  ));

DROP POLICY IF EXISTS gp_item_ubah ON public.sm_gp_items;
CREATE POLICY gp_item_ubah ON public.sm_gp_items
  FOR UPDATE TO authenticated
  USING (public.sm_is_admin() OR EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ))
  WITH CHECK (public.sm_is_admin() OR EXISTS (
    SELECT 1 FROM public.sm_gp_calculations c
     WHERE c.id = calculation_id AND c.sales_user_id = public.sm_uid() AND c.status = 'DRAFT'
  ));

-- Hak UPDATE pada sm_gp_calculations dibatasi PER KOLOM sejak migrasi 016
-- (status dan kolom tanda tangan tidak ada dalam daftar). Pembatasan itu
-- berlaku untuk semua peran termasuk Admin — dan memang harus begitu:
-- memindahkan status lewat UPDATE langsung akan melewati seluruh pemeriksaan
-- di sm_gp_setujui(). Admin yang perlu menggerakkan status tetap memakai RPC
-- itu, tempat ia sudah diizinkan di setiap langkah.

-- ── Proyek ──────────────────────────────────────────────────────────────────
--
-- Sudah terbuka untuk pengawas sejak migrasi 018; yang ditambahkan di sini
-- hanya penghapusan oleh Admin atas proyek siapa pun.

DROP POLICY IF EXISTS proyek_hapus ON public.sm_projects;
CREATE POLICY proyek_hapus ON public.sm_projects
  FOR DELETE TO authenticated
  USING (owner_user_id = public.sm_uid() OR public.sm_is_admin());

-- ── Kontak ──────────────────────────────────────────────────────────────────
--
-- Sebelumnya tidak ada policy DELETE sama sekali, sehingga kontak yang salah
-- ketik tidak bisa dibuang siapa pun.

DROP POLICY IF EXISTS contacts_hapus ON public.sm_contacts;
CREATE POLICY contacts_hapus ON public.sm_contacts
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- ── Jejak GPS ───────────────────────────────────────────────────────────────
--
-- Tetap tidak bisa disunting siapa pun — jejak percobaan check-in adalah bukti,
-- dan bukti yang bisa diedit tidak ada gunanya. Tapi Admin kini bisa MENGHAPUS
-- baris uji atau data contoh; yang hilang terlihat sebagai baris yang hilang,
-- bukan sebagai angka yang diam-diam berubah.

DROP POLICY IF EXISTS gps_hapus ON public.sm_gps_events;
CREATE POLICY gps_hapus ON public.sm_gps_events
  FOR DELETE TO authenticated USING (public.sm_is_admin());

DROP POLICY IF EXISTS att_hapus ON public.sm_attendance;
CREATE POLICY att_hapus ON public.sm_attendance
  FOR DELETE TO authenticated USING (public.sm_is_admin());

DROP POLICY IF EXISTS exc_hapus ON public.sm_exceptions;
CREATE POLICY exc_hapus ON public.sm_exceptions
  FOR DELETE TO authenticated USING (public.sm_is_admin());

-- ── Jejak untuk suntingan Admin atas dokumen yang sudah ditandatangani ──────
--
-- Kewenangan besar tanpa jejak adalah kewenangan yang tidak bisa
-- dipertanggungjawabkan. Trigger ini tidak menghalangi apa pun; ia hanya
-- memastikan setiap suntingan pada GP yang sudah lewat DRAFT meninggalkan
-- catatan siapa, kapan, dan apa yang berubah.

CREATE OR REPLACE FUNCTION public.sm_gp_catat_suntingan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_berubah jsonb;
BEGIN
  -- Dokumen yang masih DRAFT disunting pemiliknya setiap saat; mencatat
  -- semuanya hanya akan menenggelamkan audit log dalam kebisingan.
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  -- Hanya kolom yang benar-benar berubah yang dicatat. UPDATE yang menulis
  -- nilai sama persis (lazim terjadi saat formulir disimpan ulang tanpa
  -- perubahan) tidak menghasilkan baris audit sama sekali.
  SELECT jsonb_object_agg(b.key, jsonb_build_object('dari', a.value, 'jadi', b.value))
    INTO v_berubah
  FROM jsonb_each(to_jsonb(OLD)) a
  JOIN jsonb_each(to_jsonb(NEW)) b ON a.key = b.key
  WHERE a.value IS DISTINCT FROM b.value
    AND b.key NOT IN ('updated_at');

  IF v_berubah IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_trail (actor_id, action, entity, entity_id, detail)
  VALUES (public.sm_uid(), 'GP_DISUNTING_SESUDAH_DIAJUKAN',
          'sm_gp_calculations', NEW.id::text,
          jsonb_build_object('nomor', NEW.nomor, 'status', OLD.status,
                             'perubahan', v_berubah));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gp_catat_suntingan ON public.sm_gp_calculations;
CREATE TRIGGER trg_gp_catat_suntingan AFTER UPDATE ON public.sm_gp_calculations
  FOR EACH ROW EXECUTE FUNCTION public.sm_gp_catat_suntingan();
