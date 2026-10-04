-- ════════════════════════════════════════════════════════════════════════════
-- Uji keamanan akun — 2FA (user_mfa) & sesi (migrasi 045), push (046)
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip TIDAK diakhiri COMMIT: data uji hilang sendiri saat koneksi ditutup.
-- Kolom `nyata` harus sama persis dengan `harapan` di setiap baris.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated, anon;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('d1000000-0000-4000-8000-000000000001','mfa.a','MFA A','SALES'),
  ('d1000000-0000-4000-8000-000000000002','mfa.adm','MFA Admin','ADMIN');
INSERT INTO public.user_mfa (user_id, rahasia_enc, aktif, kode_cadangan)
VALUES ('d1000000-0000-4000-8000-000000000001','v1.x.y.z',true,'{abc}');
INSERT INTO public.user_sessions (user_id, token_hash, expires_at)
VALUES ('d1000000-0000-4000-8000-000000000002','uji-hash-sesi', now() + interval '1 hour');

-- 1–2: tabel terlindung RLS & tanpa hak untuk peran API
INSERT INTO hasil SELECT 1,'RLS user_mfa aktif','true',relrowsecurity::text FROM pg_class WHERE oid='public.user_mfa'::regclass;
INSERT INTO hasil SELECT 2,'authenticated punya hak SELECT user_mfa','false',
  has_table_privilege('authenticated','public.user_mfa','SELECT')::text;
INSERT INTO hasil SELECT 3,'anon punya hak SELECT user_mfa','false',
  has_table_privilege('anon','public.user_mfa','SELECT')::text;

-- 4: pemilik baris sendiri tetap tidak bisa membaca rahasianya
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","user_role":"SALES"}',true);
DO $x$ BEGIN
  BEGIN
    PERFORM 1 FROM public.user_mfa;
    INSERT INTO hasil VALUES (4,'Pengguna membaca user_mfa sendiri','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (4,'Pengguna membaca user_mfa sendiri','ditolak','ditolak');
  END;
END $x$;

-- 5: Admin pun tidak (hanya service role lewat server)
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","user_role":"ADMIN"}',true);
DO $x$ BEGIN
  BEGIN
    DELETE FROM public.user_mfa;
    INSERT INTO hasil VALUES (5,'Admin menghapus user_mfa langsung','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (5,'Admin menghapus user_mfa langsung','ditolak','ditolak');
  END;
END $x$;

-- 6: sesi milik orang lain tidak terbaca
DO $x$ DECLARE n int; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.user_sessions;
    INSERT INTO hasil VALUES (6,'Membaca user_sessions langsung','ditolak/0', CASE WHEN n = 0 THEN 'ditolak/0' ELSE n::text END);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (6,'Membaca user_sessions langsung','ditolak/0','ditolak/0');
  END;
END $x$;
RESET ROLE;

-- 7: menghapus pengguna ikut menghapus 2FA-nya
DELETE FROM public.users WHERE id='d1000000-0000-4000-8000-000000000001';
INSERT INTO hasil SELECT 7,'2FA ikut terhapus bersama pengguna','0', count(*)::text
  FROM public.user_mfa WHERE user_id='d1000000-0000-4000-8000-000000000001';

-- 8–10: langganan push & lonceng orang lain hanya untuk server
INSERT INTO hasil SELECT 8,'authenticated punya hak SELECT sm_push_langganan','false',
  has_table_privilege('authenticated','public.sm_push_langganan','SELECT')::text;
INSERT INTO hasil SELECT 9,'authenticated boleh memanggil sm_lonceng_untuk','false',
  has_function_privilege('authenticated','public.sm_lonceng_untuk(uuid)','EXECUTE')::text;
INSERT INTO hasil SELECT 10,'anon boleh memanggil sm_lonceng_untuk','false',
  has_function_privilege('anon','public.sm_lonceng_untuk(uuid)','EXECUTE')::text;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;
ROLLBACK;
