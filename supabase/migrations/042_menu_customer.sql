-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Menu Customer
--
-- Modul lisensi "customer" (Data customer dan kontaknya) sudah ada sejak awal,
-- tetapi belum punya halaman: baris customer hanya lahir diam-diam dari isian
-- PilihCustomer di formulir lain, dan tidak ada tempat untuk melihat satu
-- pelanggan beserta seluruh riwayatnya. Migrasi ini menyiapkan datanya:
--
--   1. Kolom kontak di sm_customers (kontak utama, jabatan, email, segmen,
--      catatan) — semuanya opsional, baris lama tetap sah.
--   2. View sm_customer_ringkasan: satu baris per customer dengan hitungan
--      pipeline, nilai terbuka & menang, laporan, jadwal, proyek, kontak
--      terakhir dari laporan harian, dan tanggal aktivitas terakhir.
--      security_invoker → setiap subquery tunduk pada RLS tabel sumbernya,
--      jadi Sales hanya menghitung catatannya sendiri dan atasan melihat
--      timnya, persis seperti modul lain.
--   3. Menu 'customer' bawaan untuk semua peran.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_customers
  ADD COLUMN IF NOT EXISTS contact_person   text,
  ADD COLUMN IF NOT EXISTS contact_position text,
  ADD COLUMN IF NOT EXISTS email            text,
  ADD COLUMN IF NOT EXISTS segment          text,
  ADD COLUMN IF NOT EXISTS notes            text;

DROP VIEW IF EXISTS public.sm_customer_ringkasan;
CREATE VIEW public.sm_customer_ringkasan
WITH (security_invoker = true) AS
SELECT
  c.id, c.name, c.address, c.city, c.phone, c.contact_person, c.contact_position,
  c.email, c.segment, c.notes, c.created_by, c.created_at, c.updated_at,
  COALESCE(pl.jumlah, 0)        AS jumlah_pipeline,
  COALESCE(pl.nilai_terbuka, 0) AS nilai_terbuka,
  COALESCE(pl.jumlah_won, 0)    AS jumlah_won,
  COALESCE(pl.nilai_won, 0)     AS nilai_won,
  COALESCE(dr.jumlah, 0)        AS jumlah_laporan,
  dr.terakhir                   AS laporan_terakhir,
  dr.kontak                     AS kontak_terakhir,
  dr.jabatan                    AS jabatan_terakhir,
  dr.telepon                    AS telepon_terakhir,
  COALESCE(sc.jumlah, 0)        AS jumlah_jadwal,
  COALESCE(sc.selesai, 0)       AS jadwal_selesai,
  sc.berikutnya                 AS jadwal_berikutnya,
  COALESCE(pr.jumlah, 0)        AS jumlah_proyek,
  GREATEST(dr.terakhir, pl.terakhir, sc.terakhir) AS aktivitas_terakhir
FROM public.sm_customers c
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         sum(p.project_value) FILTER (WHERE p.stage NOT IN ('WON', 'LOST')) AS nilai_terbuka,
         count(*) FILTER (WHERE p.stage = 'WON') AS jumlah_won,
         sum(p.project_value) FILTER (WHERE p.stage = 'WON') AS nilai_won,
         max(p.pipeline_date) AS terakhir
  FROM public.sm_pipeline p WHERE p.customer_id = c.id
) pl ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         max(d.report_date) AS terakhir,
         (array_agg(d.contact_person ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.contact_person), '') IS NOT NULL))[1] AS kontak,
         (array_agg(d.position ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.position), '') IS NOT NULL))[1] AS jabatan,
         (array_agg(d.phone_whatsapp ORDER BY d.report_date DESC, d.created_at DESC)
            FILTER (WHERE NULLIF(btrim(d.phone_whatsapp), '') IS NOT NULL))[1] AS telepon
  FROM public.sm_daily_reports d WHERE d.customer_id = c.id
) dr ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah,
         count(*) FILTER (WHERE s.status = 'COMPLETED') AS selesai,
         min(s.schedule_date) FILTER (WHERE s.status IN ('UPCOMING', 'IN_PROGRESS')
                                        AND s.schedule_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date) AS berikutnya,
         max(s.schedule_date) FILTER (WHERE s.status = 'COMPLETED') AS terakhir
  FROM public.sm_schedules s WHERE s.customer_id = c.id
) sc ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS jumlah FROM public.sm_projects j WHERE j.customer_id = c.id
) pr ON true;

GRANT SELECT ON public.sm_customer_ringkasan TO authenticated;

-- Indeks penghubung yang dipakai view di atas.
CREATE INDEX IF NOT EXISTS idx_pipeline_customer ON public.sm_pipeline (customer_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_customer ON public.sm_daily_reports (customer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_customer ON public.sm_schedules (customer_id);

-- Menu bawaan: semua peran boleh membuka Customer (isinya tetap dibatasi RLS).
INSERT INTO public.sm_role_menu (role, menu_key)
SELECT r, 'customer' FROM unnest(ARRAY['SALES', 'MANAGER', 'DIRECTOR', 'FINANCE', 'ADMIN']) AS r
ON CONFLICT DO NOTHING;
