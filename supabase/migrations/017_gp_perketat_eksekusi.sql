-- ════════════════════════════════════════════════════════════════════════════
-- 017 — Menutup dua lubang pada fungsi GP Calculation
--
-- Ditemukan advisor keamanan Supabase segera sesudah migrasi 016 diterapkan.
-- Keduanya nyata, dan keduanya jenis kesalahan yang paling mudah terlewat
-- karena tidak menghasilkan error apa pun saat aplikasi dipakai normal.
--
-- ── Lubang 1: `anon` bisa memanggil keempat fungsi GP ──────────────────────
--
-- Migrasi 016 menutupnya dengan REVOKE ... FROM public, dan itu TIDAK cukup.
-- Supabase memasang default privilege yang memberi EXECUTE kepada `anon` dan
-- `authenticated` secara EKSPLISIT pada setiap fungsi baru di schema public —
-- bukan lewat peran `public`. Mencabut dari `public` tidak menyentuh pemberian
-- eksplisit itu sama sekali.
--
-- Migrasi 008 sudah pernah menangani hal yang sama untuk sm_check_in dan
-- kawan-kawan; pelajaran itu terlewat saat menulis 016.
--
-- ── Lubang 2: sm_gp_buka_ulang() lolos untuk pemanggil tanpa sesi ──────────
--
-- Penjaganya berbunyi:
--
--     IF v_gp.sales_user_id <> v_uid AND NOT public.sm_is_admin() THEN
--
-- Ketika pemanggilnya tidak punya sesi, v_uid bernilai NULL. Di SQL,
-- `sesuatu <> NULL` menghasilkan NULL — bukan TRUE, bukan FALSE. `NULL AND
-- FALSE` menghasilkan FALSE, sehingga IF-nya TIDAK pernah jalan dan
-- pemeriksaan kepemilikannya terlewati begitu saja.
--
-- Akibatnya: siapa pun tanpa sesi yang menebak UUID sebuah dokumen GP yang
-- berstatus DITOLAK bisa mengembalikannya ke DRAFT. Tidak merusak angka, tapi
-- ia menggerakkan status dokumen yang seharusnya hanya bisa digerakkan
-- pemiliknya — persis hal yang dijaga seluruh rancangan ini.
--
-- Perbaikannya: tolak lebih dulu pemanggil tanpa sesi, seperti yang sudah
-- dilakukan tiga fungsi GP lainnya.
-- ════════════════════════════════════════════════════════════════════════════

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
  -- Penjaga yang sebelumnya tidak ada. Tanpa baris ini, seluruh pemeriksaan
  -- kepemilikan di bawah menghasilkan NULL bagi pemanggil tanpa sesi.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.' USING ERRCODE = '28000';
  END IF;

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

-- Pencabutan yang sebenarnya. `anon` disebut namanya, bukan diwakili `public`.
REVOKE EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    FROM anon;

-- sm_lonceng() tidak ikut dicabut dari authenticated karena memang untuk
-- mereka, tapi anon tetap tidak punya urusan dengannya: tanpa sesi, seluruh
-- hitungannya nol dan fungsinya sudah menolak lebih dulu.
REVOKE EXECUTE ON FUNCTION public.sm_lonceng() FROM anon;

GRANT EXECUTE ON FUNCTION public.sm_gp_ajukan(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_setujui(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_tolak(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_gp_buka_ulang(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_lonceng()              TO authenticated;
