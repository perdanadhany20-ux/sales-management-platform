-- ════════════════════════════════════════════════════════════════════════════
-- 034 — buang objek basis data yang tidak dipakai siapa pun.
--
-- Diperiksa sebelum dibuang: tidak dirujuk kode aplikasi, fungsi lain, policy,
-- view, maupun foreign key.
--
-- 1. sm_contacts — dibuat di 002, tidak pernah diisi (0 baris) dan tidak pernah
--    dibaca. Kontak customer disimpan langsung di laporan harian
--    (contact_person, phone_whatsapp) dan pipeline.
-- 2. sm_dashboard_plus() — dari 019. Hook pemanggilnya (useDashboardPlus)
--    tidak pernah dipasang di halaman mana pun, jadi fungsinya berjalan
--    kosong. Angka yang benar-benar tampil di dashboard berasal dari
--    sm_dashboard() dan sm_pencapaian_target().
-- 3. idx_gps_events_user_waktu — kembar persis dengan idx_gps_user dari 003
--    (user_id, created_at DESC). Dua indeks identik hanya memperlambat tulis.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.sm_contacts;

DROP FUNCTION IF EXISTS public.sm_dashboard_plus(date, date);

DROP INDEX IF EXISTS public.idx_gps_events_user_waktu;
