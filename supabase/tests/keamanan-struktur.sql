-- ════════════════════════════════════════════════════════════════════════════
-- Uji jenjang posisi dan pohon organisasi — migrasi 036
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip diakhiri ROLLBACK: data uji tidak pernah tersimpan.
--
-- Penjaganya berupa trigger, jadi berlaku sama untuk Admin Panel, route
-- handler (service role), maupun SQL langsung.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;

INSERT INTO public.users (id, username, full_name, role, position) VALUES
  ('c8000000-0000-4000-8000-000000000001','stdir','Uji Direktur','DIRECTOR','Direktur'),
  ('c8000000-0000-4000-8000-000000000002','stgm', 'Uji GM',      'MANAGER', 'General Manager'),
  ('c8000000-0000-4000-8000-000000000003','stmgr','Uji Manager', 'MANAGER', 'Manager'),
  ('c8000000-0000-4000-8000-000000000004','stspv','Uji Spv',     'SALES',   'Supervisor'),
  ('c8000000-0000-4000-8000-000000000005','ststf','Uji Staff',   'SALES',   'Staff'),
  ('c8000000-0000-4000-8000-000000000006','stnon','Uji Tanpa Posisi','SALES', NULL);

-- Fungsi bantu: jalankan satu perintah, catat "diterima" atau pesan penolakannya.
CREATE FUNCTION pg_temp.coba(p_no int, p_uji text, p_harapan text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO hasil VALUES (p_no, p_uji, p_harapan, 'diterima');
  EXCEPTION WHEN others THEN
    INSERT INTO hasil VALUES (p_no, p_uji, p_harapan, 'ditolak');
  END;
END $f$;

-- Pohon sah: Direktur ← GM ← Manager ← Supervisor ← Staff
SELECT pg_temp.coba(1, 'GM di bawah Direktur', 'diterima',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000001' WHERE id='c8000000-0000-4000-8000-000000000002'$$);
SELECT pg_temp.coba(2, 'Manager di bawah GM', 'diterima',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000002' WHERE id='c8000000-0000-4000-8000-000000000003'$$);
SELECT pg_temp.coba(3, 'Supervisor di bawah Manager', 'diterima',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000003' WHERE id='c8000000-0000-4000-8000-000000000004'$$);
SELECT pg_temp.coba(4, 'Staff langsung di bawah Manager (melompati jenjang)', 'diterima',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000003' WHERE id='c8000000-0000-4000-8000-000000000005'$$);

-- Pelanggaran
SELECT pg_temp.coba(5, 'Atasan diri sendiri', 'ditolak',
  $$UPDATE public.users SET manager_id=id WHERE id='c8000000-0000-4000-8000-000000000003'$$);
SELECT pg_temp.coba(6, 'Staff membawahi Supervisor', 'ditolak',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000005' WHERE id='c8000000-0000-4000-8000-000000000004'$$);
SELECT pg_temp.coba(7, 'Manager membawahi Manager (setara)', 'ditolak',
  $$INSERT INTO public.users (username, full_name, role, position, manager_id)
    VALUES ('stmgr2','Uji Manager 2','MANAGER','Manager','c8000000-0000-4000-8000-000000000003')$$);
SELECT pg_temp.coba(8, 'Memetakan akun tanpa posisi', 'ditolak',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000003' WHERE id='c8000000-0000-4000-8000-000000000006'$$);
SELECT pg_temp.coba(9, 'Posisi di luar jenjang baku', 'ditolak',
  $$UPDATE public.users SET position='Senior Manager' WHERE id='c8000000-0000-4000-8000-000000000006'$$);
SELECT pg_temp.coba(10, 'Menurunkan Manager ke Staff selagi membawahi Supervisor', 'ditolak',
  $$UPDATE public.users SET position='Staff' WHERE id='c8000000-0000-4000-8000-000000000003'$$);

-- Karena atasan wajib berjenjang LEBIH TINGGI di setiap tingkat, lingkaran
-- tidak mungkin terbentuk lewat jenjang yang sah — pemeriksaan lingkaran di
-- trigger adalah pengaman ganda. Yang diuji di sini: membalik hubungan
-- (Direktur dijadikan bawahan GM yang ia bawahi) tetap ditolak.
SELECT pg_temp.coba(11, 'Membalik hubungan: Direktur di bawah GM bawahannya', 'ditolak',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000002'
     WHERE id='c8000000-0000-4000-8000-000000000001'$$);

UPDATE public.users SET active = false WHERE id = 'c8000000-0000-4000-8000-000000000001';
SELECT pg_temp.coba(12, 'Memetakan ke atasan yang nonaktif', 'ditolak',
  $$UPDATE public.users SET manager_id='c8000000-0000-4000-8000-000000000001' WHERE id='c8000000-0000-4000-8000-000000000004'$$);

SELECT pg_temp.coba(13, 'Akun baru langsung dipetakan dengan benar', 'diterima',
  $$INSERT INTO public.users (username, full_name, role, position, manager_id)
    VALUES ('ststf2','Uji Staff 2','SALES','Staff','c8000000-0000-4000-8000-000000000004')$$);

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
