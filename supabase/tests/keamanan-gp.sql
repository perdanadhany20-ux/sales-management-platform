-- ════════════════════════════════════════════════════════════════════════════
-- Uji GP Calculation — ketepatan angka, isolasi antar-Sales, rantai persetujuan
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip TIDAK diakhiri COMMIT: begitu koneksinya tutup, seluruh data uji
-- hilang dengan sendirinya. Jangan menambahkan COMMIT di bawah.
--
-- Dua hal yang diuji di sini dan tidak bisa diuji di tempat lain:
--
-- 1. ANGKANYA. Uji 1–12 membandingkan hasil hitungan database dengan angka
--    berkas asli tim (GP_BALAIKOTA.xlsx). Kalau kelak rumus di view diubah
--    "supaya lebih rapi", uji ini yang akan memberi tahu bahwa hasilnya
--    tidak lagi sama dengan berkas yang selama ini dipakai.
--
-- 2. KERAHASIAAN ANTAR-SALES. Uji 13–16 adalah syarat yang ditegaskan
--    pemilik platform: data GP satu Sales tidak boleh terlihat Sales lain.
--    Angka margin adalah informasi paling sensitif di seluruh platform ini.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('a1111111-1111-4111-8111-111111111111','gpsalesa','GP Sales A','SALES'),
  ('a2222222-2222-4222-8222-222222222222','gpsalesb','GP Sales B','SALES'),
  ('a3333333-3333-4333-8333-333333333333','gpmgr','GP Manager','MANAGER'),
  ('a4444444-4444-4444-8444-444444444444','gpdir','GP Director','DIRECTOR'),
  ('a5555555-5555-4555-8555-555555555555','gpfin','GP Finance','FINANCE');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","user_role":"SALES"}',true);

-- Angka di bawah disalin apa adanya dari GP_BALAIKOTA.xlsx.
INSERT INTO public.sm_gp_calculations
  (id, sales_user_id, customer_name, project_name, operational_cost, disbursement_cost)
VALUES ('b0000000-0000-4000-8000-000000000001','a1111111-1111-4111-8111-111111111111',
        'Balaikota DKI','Camera', 1000000, 8000);

INSERT INTO public.sm_gp_items (calculation_id, urutan, description, qty, unit_price, unit_cost)
VALUES ('b0000000-0000-4000-8000-000000000001',1,'Kamera Sony A7S III Body Only',
        1, 56550000, 47633370);

-- ══ Ketepatan angka terhadap berkas asli ════════════════════════════════════

INSERT INTO hasil SELECT 1,'Nomor dokumen terbit otomatis','GP/',
  left(nomor,3) FROM public.sm_gp_calculations WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 2,'Total Selling (bruto)','56550000',
  round(total_selling)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 3,'DPP = bruto / 1.11','50945946',
  round(dpp)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 4,'PPN 11%','5604054',
  round(ppn_amount)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 5,'Pph 2,5% dari DPP','1273649',
  round(pph_amount)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 6,'NET AMOUNT RECEIVED','49664297',
  round(net_amount_received)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 7,'TOTAL COSTING','48633370',
  round(total_costing)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 8,'NET PROFIT','1030927',
  round(net_profit)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 9,'Net margin','0.0202',
  round(net_margin,4)::text FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

-- Rumus IF bertingkat pada berkas asli. Margin 2% terhadap target 20% jatuh
-- ke kategori paling bawah — dan memang begitulah berkas aslinya berbunyi.
INSERT INTO hasil SELECT 10,'Mutu margin','DIRECTOR APPROVAL',
  mutu_margin FROM public.sm_gp_ringkasan WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 11,'GP item (Rp)','8916630',
  round(gp_amount)::text FROM public.sm_gp_items WHERE calculation_id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 12,'GP item (%)','15.7677',
  round(gp_percentage,4)::text FROM public.sm_gp_items WHERE calculation_id='b0000000-0000-4000-8000-000000000001';

-- ══ Isolasi antar-Sales ═════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims','{"sub":"a2222222-2222-4222-8222-222222222222","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 13,'Sales B melihat dokumen GP Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_gp_calculations
  WHERE id='b0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 14,'Sales B melihat ITEM GP Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_gp_items
  WHERE calculation_id='b0000000-0000-4000-8000-000000000001';

-- View ringkasan diuji terpisah dari tabelnya: security_invoker bisa saja
-- terlupa saat view-nya kelak dibuat ulang, dan kebocorannya justru lewat
-- sini — lengkap dengan seluruh angka marginnya.
INSERT INTO hasil SELECT 15,'Sales B melihat RINGKASAN GP Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_gp_ringkasan
  WHERE id='b0000000-0000-4000-8000-000000000001';

DO $x$ BEGIN
  BEGIN
    PERFORM public.sm_gp_tolak('b0000000-0000-4000-8000-000000000001','alasan yang cukup panjang');
    INSERT INTO hasil VALUES (16,'Sales B menolak dokumen Sales A','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (16,'Sales B menolak dokumen Sales A','ditolak','ditolak');
  END;
END $x$;

-- ══ Status tidak bisa ditembak langsung ═════════════════════════════════════
--
-- RLS membatasi BARIS, bukan kolom. Tanpa pencabutan hak UPDATE per kolom di
-- migrasi 016, pemilik dokumen bisa melompati seluruh rantai tanda tangan
-- dengan satu UPDATE pada barisnya sendiri.

SELECT set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","user_role":"SALES"}',true);

DO $y$ BEGIN
  BEGIN
    UPDATE public.sm_gp_calculations SET status='DIVERIFIKASI'
     WHERE id='b0000000-0000-4000-8000-000000000001';
    INSERT INTO hasil VALUES (17,'Pemilik menembak status=DIVERIFIKASI','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (17,'Pemilik menembak status=DIVERIFIKASI','ditolak','ditolak');
  END;
END $y$;

-- ══ Rantai persetujuan, termasuk urutannya ══════════════════════════════════

INSERT INTO hasil SELECT 18,'Sales A mengajukan','DIAJUKAN',
  public.sm_gp_ajukan('b0000000-0000-4000-8000-000000000001')->>'status';

SELECT set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","user_role":"DIRECTOR"}',true);
DO $z$ BEGIN
  BEGIN
    PERFORM public.sm_gp_setujui('b0000000-0000-4000-8000-000000000001', NULL);
    INSERT INTO hasil VALUES (19,'Director melompati pemeriksaan Manager','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (19,'Director melompati pemeriksaan Manager','ditolak','ditolak');
  END;
END $z$;

SELECT set_config('request.jwt.claims','{"sub":"a3333333-3333-4333-8333-333333333333","user_role":"MANAGER"}',true);
INSERT INTO hasil SELECT 20,'Manager memeriksa','DIPERIKSA',
  public.sm_gp_setujui('b0000000-0000-4000-8000-000000000001','oke')->>'status';

DO $w$ BEGIN
  BEGIN
    PERFORM public.sm_gp_setujui('b0000000-0000-4000-8000-000000000001', NULL);
    INSERT INTO hasil VALUES (21,'Manager mengambil langkah Director','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (21,'Manager mengambil langkah Director','ditolak','ditolak');
  END;
END $w$;

SELECT set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","user_role":"DIRECTOR"}',true);
INSERT INTO hasil SELECT 22,'Director menyetujui','DISETUJUI',
  public.sm_gp_setujui('b0000000-0000-4000-8000-000000000001', NULL)->>'status';

SELECT set_config('request.jwt.claims','{"sub":"a5555555-5555-4555-8555-555555555555","user_role":"FINANCE"}',true);
INSERT INTO hasil SELECT 23,'Finance memverifikasi','DIVERIFIKASI',
  public.sm_gp_setujui('b0000000-0000-4000-8000-000000000001', NULL)->>'status';

-- ══ Dokumen beku sesudah diajukan ═══════════════════════════════════════════

SELECT set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","user_role":"SALES"}',true);

WITH u AS (UPDATE public.sm_gp_calculations SET project_name='Diubah diam-diam'
            WHERE id='b0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 24,'Pemilik menyunting dokumen yang sudah diverifikasi','0 baris diubah',
  count(*)::text||' baris diubah' FROM u;

DO $v$ BEGIN
  BEGIN
    INSERT INTO public.sm_gp_items (calculation_id, description, qty, unit_price, unit_cost)
    VALUES ('b0000000-0000-4000-8000-000000000001','Item selundupan',1,1,1);
    INSERT INTO hasil VALUES (25,'Menambah item sesudah diverifikasi','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (25,'Menambah item sesudah diverifikasi','ditolak','ditolak');
  END;
END $v$;

-- Sisi sebaliknya: pengawas memang HARUS bisa melihat, kalau tidak seluruh
-- rantai tanda tangannya tidak mungkin berjalan.
SELECT set_config('request.jwt.claims','{"sub":"a3333333-3333-4333-8333-333333333333","user_role":"MANAGER"}',true);
INSERT INTO hasil SELECT 26,'Manager melihat GP seluruh tim','1 baris',
  count(*)::text||' baris' FROM public.sm_gp_ringkasan
  WHERE id='b0000000-0000-4000-8000-000000000001';

-- ══ Tanpa sesi sama sekali (migrasi 017) ════════════════════════════════════
--
-- Uji regresi untuk lubang yang ditemukan advisor keamanan tepat sesudah
-- migrasi 016: keempat fungsi GP ternyata masih bisa dipanggil peran `anon`.
-- REVOKE ... FROM public tidak cukup, karena Supabase memberi EXECUTE kepada
-- `anon` secara EKSPLISIT pada setiap fungsi baru — bukan lewat peran
-- `public`. Kalau uji di bawah kelak gagal, artinya pencabutan itu terlewat
-- lagi pada fungsi yang baru ditambahkan.

RESET ROLE;
GRANT ALL ON hasil TO anon;
SET LOCAL ROLE anon;

DO $a$ BEGIN
  BEGIN
    PERFORM public.sm_gp_buka_ulang('00000000-0000-4000-8000-000000000000');
    INSERT INTO hasil VALUES (27,'anon memanggil sm_gp_buka_ulang','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (27,'anon memanggil sm_gp_buka_ulang','ditolak','ditolak');
  END;

  BEGIN
    PERFORM public.sm_gp_setujui('00000000-0000-4000-8000-000000000000', NULL);
    INSERT INTO hasil VALUES (28,'anon memanggil sm_gp_setujui','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (28,'anon memanggil sm_gp_setujui','ditolak','ditolak');
  END;

  BEGIN
    PERFORM public.sm_lonceng();
    INSERT INTO hasil VALUES (29,'anon memanggil sm_lonceng','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (29,'anon memanggil sm_lonceng','ditolak','ditolak');
  END;
END $a$;

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
