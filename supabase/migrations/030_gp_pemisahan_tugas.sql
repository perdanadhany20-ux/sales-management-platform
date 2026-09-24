-- ════════════════════════════════════════════════════════════════════════════
-- 030 — Pemisahan tugas pada persetujuan GP Calculation
--
-- Sebelumnya Admin boleh bertindak di ketiga tahap (Manager → Director →
-- Finance), jadi satu orang bisa membuat dokumen lalu meloloskannya sendirian
-- sampai DIVERIFIKASI. Kini:
--   1. pembuat dokumen tidak boleh menyetujuinya di tahap mana pun;
--   2. satu orang tidak boleh menyetujui dua tahap berturut-turut.
-- Aturan kedua sengaja bukan "tiga orang berbeda": dengan dua pemeriksa saja
-- (mis. dua Admin) alurnya tetap bisa tuntas, tapi tetap butuh dua pasang mata.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sm_gp_setujui(p_id uuid, p_catatan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF v_gp.sales_user_id = v_uid THEN
    RAISE EXCEPTION 'Anda tidak bisa menyetujui perhitungan buatan Anda sendiri.' USING ERRCODE = '42501';
  END IF;

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
    IF v_gp.checked_by = v_uid THEN
      RAISE EXCEPTION 'Anda sudah memeriksa dokumen ini; persetujuan harus oleh orang lain.' USING ERRCODE = '42501';
    END IF;
    v_baru := 'DISETUJUI';
    UPDATE public.sm_gp_calculations
       SET status = v_baru, approved_by = v_uid, approved_at = now() WHERE id = p_id;

  ELSIF v_gp.status = 'DISETUJUI' THEN
    IF v_peran NOT IN ('FINANCE', 'ADMIN') THEN
      RAISE EXCEPTION 'Langkah ini menunggu verifikasi Finance.' USING ERRCODE = '42501';
    END IF;
    IF v_gp.approved_by = v_uid THEN
      RAISE EXCEPTION 'Anda sudah menyetujui dokumen ini; verifikasi harus oleh orang lain.' USING ERRCODE = '42501';
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
$function$;
