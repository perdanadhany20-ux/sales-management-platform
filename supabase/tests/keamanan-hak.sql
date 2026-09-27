-- ════════════════════════════════════════════════════════════════════════════
-- Uji hak edit/hapus, isolasi antar-Sales, dan Target Sales — migrasi 022, 027, 031
--
-- Jalankan seluruh berkas sebagai pemilik basis data (SQL Editor Supabase).
-- Skrip diakhiri ROLLBACK: data uji tidak pernah tersimpan.
--
-- Aturan yang dijaga di sini adalah aturan bisnis yang ditetapkan pemilik
-- platform, bukan sekadar pilihan teknis:
--   • Sales boleh MENYUNTING data miliknya, tapi TIDAK BOLEH MENGHAPUS.
--   • Sales tidak boleh melihat laporan/pipeline Sales lain.
--   • Hanya Admin yang boleh menyunting atau menghapus data orang lain —
--     Manager boleh MELIHAT seluruh tim, tapi tidak mengubah isinya.
--   • Target ditetapkan pengawas; Sales hanya melihat targetnya sendiri.
--
-- Cara membaca: kolom `nyata` harus sama persis dengan `harapan` di setiap baris.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE hasil(no int, uji text, harapan text, nyata text) ON COMMIT DROP;
GRANT ALL ON hasil TO authenticated;

INSERT INTO public.users (id, username, full_name, role) VALUES
  ('c1111111-1111-4111-8111-111111111111','hksalesa','Hak Sales A','SALES'),
  ('c2222222-2222-4222-8222-222222222222','hksalesb','Hak Sales B','SALES'),
  ('c3333333-3333-4333-8333-333333333333','hkmgr','Hak Manager','MANAGER'),
  ('c4444444-4444-4444-8444-444444444444','hkadmin','Hak Admin','ADMIN');

INSERT INTO public.sm_daily_reports (id, sales_user_id, report_date, customer_name, activity, result, next_action)
VALUES ('d0000000-0000-4000-8000-000000000001','c1111111-1111-4111-8111-111111111111', current_date,
        'Customer Uji Hak','Kunjungan uji','Hasil uji','Tindak lanjut uji');

INSERT INTO public.sm_pipeline (id, sales_user_id, customer_name, project_detail,
                                project_value, estimated_closing, next_action)
VALUES ('e0000000-0000-4000-8000-000000000001','c1111111-1111-4111-8111-111111111111',
        'Customer Uji Hak','Proyek uji', 100000000, current_date + 30, 'Tindak lanjut');

INSERT INTO public.sm_sales_targets (sales_user_id, periode, target_nilai) VALUES
  ('c1111111-1111-4111-8111-111111111111', date_trunc('month', current_date)::date, 500000000),
  ('c2222222-2222-4222-8222-222222222222', date_trunc('month', current_date)::date, 300000000);

SET LOCAL ROLE authenticated;

-- ══ Sales A — pemilik data ══════════════════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","user_role":"SALES"}',true);

WITH u AS (UPDATE public.sm_daily_reports SET result = 'Disunting pemilik'
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 1,'Sales menyunting laporannya sendiri','1 baris',
  count(*)::text||' baris' FROM u;

WITH d AS (DELETE FROM public.sm_daily_reports
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 2,'Sales menghapus laporannya sendiri','0 baris',
  count(*)::text||' baris' FROM d;

WITH d AS (DELETE FROM public.sm_pipeline
            WHERE id = 'e0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 3,'Sales menghapus pipeline-nya sendiri','0 baris',
  count(*)::text||' baris' FROM d;

-- Memindahkan laporan ke nama orang lain = membuang jejak kerja sendiri
-- atau memalsukan kerja orang lain. WITH CHECK harus menolaknya.
DO $x$ BEGIN
  BEGIN
    UPDATE public.sm_daily_reports SET sales_user_id = 'c2222222-2222-4222-8222-222222222222'
     WHERE id = 'd0000000-0000-4000-8000-000000000001';
    INSERT INTO hasil VALUES (4,'Sales memindahkan laporannya ke Sales lain','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (4,'Sales memindahkan laporannya ke Sales lain','ditolak','ditolak');
  END;
END $x$;

DO $x$ BEGIN
  BEGIN
    INSERT INTO public.sm_daily_reports (sales_user_id, report_date, customer_name, activity, result, next_action)
    VALUES ('c2222222-2222-4222-8222-222222222222', current_date, 'Palsu','Laporan atas nama orang lain','-','-');
    INSERT INTO hasil VALUES (5,'Sales membuat laporan atas nama Sales lain','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (5,'Sales membuat laporan atas nama Sales lain','ditolak','ditolak');
  END;
END $x$;

INSERT INTO hasil SELECT 6,'Sales hanya melihat targetnya sendiri','1 baris',
  count(*)::text||' baris' FROM public.sm_sales_targets
  WHERE sales_user_id IN ('c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222');

DO $x$ BEGIN
  BEGIN
    INSERT INTO public.sm_sales_targets (sales_user_id, periode, target_nilai)
    VALUES ('c1111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) + interval '1 month')::date, 1);
    INSERT INTO hasil VALUES (7,'Sales menetapkan targetnya sendiri','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (7,'Sales menetapkan targetnya sendiri','ditolak','ditolak');
  END;
END $x$;

WITH u AS (UPDATE public.sm_sales_targets SET target_nilai = 1
            WHERE sales_user_id = 'c1111111-1111-4111-8111-111111111111' RETURNING 1)
INSERT INTO hasil SELECT 8,'Sales menurunkan targetnya sendiri','0 baris',
  count(*)::text||' baris' FROM u;

INSERT INTO hasil SELECT 9,'Pencapaian target: Sales hanya melihat dirinya','hanya diri sendiri',
  CASE WHEN count(*) = 1 AND bool_and(sales_user_id = 'c1111111-1111-4111-8111-111111111111')
       THEN 'hanya diri sendiri' ELSE count(*)::text||' baris' END
  FROM public.sm_pencapaian_target(date_trunc('month', current_date)::date, current_date);

-- Kolom pribadi users (email, telepon, alamat) tidak boleh terbaca dari browser.
DO $x$ DECLARE v text; BEGIN
  BEGIN
    SELECT email INTO v FROM public.users LIMIT 1;
    INSERT INTO hasil VALUES (10,'Sales membaca email pengguna lain','ditolak','DITERIMA');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO hasil VALUES (10,'Sales membaca email pengguna lain','ditolak','ditolak');
  END;
END $x$;

-- ══ Sales B — bukan pemilik ═════════════════════════════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","user_role":"SALES"}',true);

INSERT INTO hasil SELECT 11,'Sales B melihat laporan Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_daily_reports
  WHERE id = 'd0000000-0000-4000-8000-000000000001';

INSERT INTO hasil SELECT 12,'Sales B melihat pipeline Sales A','0 baris',
  count(*)::text||' baris' FROM public.sm_pipeline
  WHERE id = 'e0000000-0000-4000-8000-000000000001';

WITH u AS (UPDATE public.sm_pipeline SET stage = 'WON'
            WHERE id = 'e0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 13,'Sales B mengubah pipeline Sales A','0 baris',
  count(*)::text||' baris' FROM u;

-- ══ Manager — melihat seluruh tim, tidak mengubah isinya ════════════════════
SELECT set_config('request.jwt.claims','{"sub":"c3333333-3333-4333-8333-333333333333","user_role":"MANAGER"}',true);

INSERT INTO hasil SELECT 14,'Manager melihat laporan Sales A','1 baris',
  count(*)::text||' baris' FROM public.sm_daily_reports
  WHERE id = 'd0000000-0000-4000-8000-000000000001';

WITH u AS (UPDATE public.sm_daily_reports SET result = 'Diubah Manager'
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 15,'Manager menyunting laporan Sales A','0 baris',
  count(*)::text||' baris' FROM u;

WITH d AS (DELETE FROM public.sm_daily_reports
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 16,'Manager menghapus laporan Sales A','0 baris',
  count(*)::text||' baris' FROM d;

INSERT INTO hasil SELECT 17,'Pencapaian target: Manager melihat seluruh tim','A dan B',
  CASE WHEN count(*) FILTER (WHERE sales_user_id IN ('c1111111-1111-4111-8111-111111111111',
                                                     'c2222222-2222-4222-8222-222222222222')) = 2
       THEN 'A dan B' ELSE count(*)::text||' baris' END
  FROM public.sm_pencapaian_target(date_trunc('month', current_date)::date, current_date);

-- ══ Admin — boleh menyunting dan menghapus apa pun ══════════════════════════
SELECT set_config('request.jwt.claims','{"sub":"c4444444-4444-4444-8444-444444444444","user_role":"ADMIN"}',true);

WITH u AS (UPDATE public.sm_daily_reports SET result = 'Diubah Admin'
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 18,'Admin menyunting laporan Sales A','1 baris',
  count(*)::text||' baris' FROM u;

WITH d AS (DELETE FROM public.sm_pipeline
            WHERE id = 'e0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 19,'Admin menghapus pipeline Sales A','1 baris',
  count(*)::text||' baris' FROM d;

WITH d AS (DELETE FROM public.sm_daily_reports
            WHERE id = 'd0000000-0000-4000-8000-000000000001' RETURNING 1)
INSERT INTO hasil SELECT 20,'Admin menghapus laporan Sales A','1 baris',
  count(*)::text||' baris' FROM d;

RESET ROLE;

SELECT no, uji, harapan, nyata, (harapan = nyata) AS lulus FROM hasil ORDER BY no;

ROLLBACK;
