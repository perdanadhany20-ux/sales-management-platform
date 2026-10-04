-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- 046 — Notifikasi push (Web Push)
--
-- 1. sm_push_langganan: endpoint push per perangkat. Hanya service role
--    (server) yang menyentuhnya; pengguna mendaftar lewat /api/push.
-- 2. sm_lonceng_untuk(uuid): isi lonceng seorang pengguna, untuk dikirim
--    cron push saat aplikasinya tertutup. Memakai sm_lonceng() yang sama
--    dengan header aplikasi, sehingga isi push = isi lonceng. Hanya bisa
--    dipanggil service role.
-- Tidak mengubah data lama. Aman dijalankan ulang.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sm_push_langganan (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint       text        NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh         text        NOT NULL CHECK (length(p256dh) <= 200),
  auth           text        NOT NULL CHECK (length(auth) <= 100),
  user_agent     text,
  dibuat_at      timestamptz NOT NULL DEFAULT now(),
  terakhir_kirim timestamptz,
  slot_terakhir  text
);
CREATE INDEX IF NOT EXISTS idx_push_user ON public.sm_push_langganan (user_id);

ALTER TABLE public.sm_push_langganan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sm_push_langganan FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.sm_push_langganan FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.sm_push_langganan FROM authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sm_lonceng_untuk(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_user AND active;
  IF v_role IS NULL THEN RETURN NULL; END IF;
  -- Identitas pengguna itu hanya untuk sisa transaksi ini (is_local = true).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'user_role', v_role)::text, true);
  RETURN public.sm_lonceng();
END $$;

REVOKE EXECUTE ON FUNCTION public.sm_lonceng_untuk(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.sm_lonceng_untuk(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.sm_lonceng_untuk(uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.sm_lonceng_untuk(uuid) TO service_role;
  END IF;
END $$;
