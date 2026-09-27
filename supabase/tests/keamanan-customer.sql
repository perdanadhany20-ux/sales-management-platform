-- ════════════════════════════════════════════════════════════════════════════
-- Uji isolasi daftar customer — migrasi 035
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip diakhiri ROLLBACK: data uji tidak pernah tersimpan.
--
-- Aturan pemilik platform: customer hanya terlihat oleh Sales yang
-- menanganinya dan oleh garis atasannya sendiri (plus Admin). Sales lain,
-- dan Manager yang BUKAN atasannya, tidak boleh melihatnya.
--
-- Susunan organisasi uji:
--   Director D
--     └─ Manager A ── Sales A
--   Manager B ── Sales B
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role, manager_id) VALUES
  ('b7000000-0000-4000-8000-00000000000d','cudir','Cust Director','DIRECTOR', NULL),
  ('b7000000-0000-4000-8000-0000000000a1','cumgra','Cust Manager A','MANAGER','b7000000-0000-4000-8000-00000000000d'),
  ('b7000000-0000-4000-8000-0000000000b1','cumgrb','Cust Manager B','MANAGER', NULL),
  ('b7000000-0000-4000-8000-0000000000ad','cuadmin','Cust Admin','ADMIN', NULL);
INSERT INTO public.users (id, username, full_name, role, manager_id) VALUES
  ('b7000000-0000-4000-8000-0000000000a2','cusalesa','Cust Sales A','SALES','b7000000-0000-4000-8000-0000000000a1'),
  ('b7000000-0000-4000-8000-0000000000b2','cusalesb','Cust Sales B','SALES','b7000000-0000-4000-8000-0000000000b1');

SET LOCAL ROLE authenticated;

-- ══ Sales A mencatat customernya ════════════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-0000000000a2","user_role":"SALES"}',true);

INSERT INTO public.sm_customers (name) VALUES ('PT Uji Rahasia A');

INSERT INTO hasil SELECT 1,'Sales A melihat customernya sendiri','1 baris',
  count(*)::text||' baris' FROM public.sm_customers WHERE name = 'PT Uji Rahasia A';

INSERT INTO hasil SELECT 2,'Pemilik tercatat otomatis','Sales A',
  CASE WHEN created_by = 'b7000000-0000-4000-8000-0000000000a2' THEN 'Sales A' ELSE coalesce(created_by::text,'kosong') END
  FROM public.sm_customers WHERE name = 'PT Uji Rahasia A';

DO $x$ BEGIN BEGIN
    INSERT INTO public.sm_customers (name) VALUES ('pt uji rahasia a ');
    INSERT INTO hasil VALUES (3,'Sales A mencatat nama yang sama dua kali','ditolak','DITERIMA');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO hasil VALUES (3,'Sales A mencatat nama yang sama dua kali','ditolak','ditolak');
  END; END $x$;

-- ══ Sales B — Sales lain ═══════════════════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-0000000000b2","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 4,'Sales B melihat customer Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_customers WHERE name ILIKE '%Uji Rahasia A%';

-- Nama unik per pemilik: B boleh punya customer bernama sama.
WITH i AS (INSERT INTO public.sm_customers (name) VALUES ('PT Uji Rahasia A') RETURNING 1)
INSERT INTO hasil SELECT 5,'Sales B mencatat customer bernama sama','1 baris',
  count(*)::text||' baris' FROM i;

DO $x$ BEGIN BEGIN
    INSERT INTO public.sm_customers (name, created_by)
    VALUES ('PT Titipan', 'b7000000-0000-4000-8000-0000000000a2');
    INSERT INTO hasil VALUES (6,'Sales B mencatat customer atas nama Sales A','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (6,'Sales B mencatat customer atas nama Sales A','ditolak','ditolak');
  END; END $x$;

WITH u AS (UPDATE public.sm_customers SET phone = '000'
            WHERE created_by = 'b7000000-0000-4000-8000-0000000000a2' RETURNING 1)
INSERT INTO hasil SELECT 7,'Sales B mengubah customer Sales A','0 baris',
  count(*)::text||' baris' FROM u;

-- ══ Manager A — atasan langsung Sales A ════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-0000000000a1","user_role":"MANAGER"}',true);

INSERT INTO hasil SELECT 8,'Atasan langsung melihat customer bawahannya','1 baris',
  count(*)::text||' baris' FROM public.sm_customers
  WHERE created_by = 'b7000000-0000-4000-8000-0000000000a2';

INSERT INTO hasil SELECT 9,'Manager A melihat customer Sales B (bukan bawahannya)','0 baris',
  count(*)::text||' baris' FROM public.sm_customers
  WHERE created_by = 'b7000000-0000-4000-8000-0000000000b2';

WITH u AS (UPDATE public.sm_customers SET phone = '000'
            WHERE created_by = 'b7000000-0000-4000-8000-0000000000a2' RETURNING 1)
INSERT INTO hasil SELECT 10,'Atasan mengubah customer bawahannya','0 baris',
  count(*)::text||' baris' FROM u;

-- ══ Manager B — bukan atasan Sales A ═══════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-0000000000b1","user_role":"MANAGER"}',true);

INSERT INTO hasil SELECT 11,'Manager lain melihat customer Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_customers
  WHERE created_by = 'b7000000-0000-4000-8000-0000000000a2';

-- ══ Director — atasan dari Manager A ═══════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-00000000000d","user_role":"DIRECTOR"}',true);

INSERT INTO hasil SELECT 12,'Atasan di atas atasan melihat customer Sales A','1 baris',
  count(*)::text||' baris' FROM public.sm_customers
  WHERE created_by = 'b7000000-0000-4000-8000-0000000000a2';

INSERT INTO hasil SELECT 13,'Director melihat customer Sales B (di luar garisnya)','0 baris',
  count(*)::text||' baris' FROM public.sm_customers
  WHERE created_by = 'b7000000-0000-4000-8000-0000000000b2';

-- ══ Admin ══════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"b7000000-0000-4000-8000-0000000000ad","user_role":"ADMIN"}',true);

INSERT INTO hasil SELECT 14,'Admin melihat customer seluruh Sales','2 baris',
  count(*)::text||' baris' FROM public.sm_customers WHERE name = 'PT Uji Rahasia A';

-- ══ anon ═══════════════════════════════════════════════════════════════════
RESET ROLE;
GRANT ALL ON hasil TO anon;
SET LOCAL ROLE anon;
DO $x$ DECLARE n int; BEGIN BEGIN
    SELECT count(*) INTO n FROM public.sm_customers;
    INSERT INTO hasil VALUES (15,'anon membaca daftar customer','ditolak',
      CASE WHEN n = 0 THEN 'ditolak' ELSE 'DITERIMA' END);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (15,'anon membaca daftar customer','ditolak','ditolak');
  END; END $x$;

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
