-- ════════════════════════════════════════════════════════════════════════════
-- 027 — Perketat hak baca data pribadi dan hak berlebih
--
-- 1. Policy users_baca = true (sengaja: daftar nama dibutuhkan di mana-mana),
--    tapi itu membuat SETIAP akun — termasuk Sales — bisa membaca email,
--    telepon, alamat, dan alasan penolakan seluruh pengguna langsung lewat
--    PostgREST. RLS menyaring baris, bukan kolom, jadi yang dibatasi di sini
--    adalah hak kolomnya. Kolom sensitif hanya terbaca lewat /api/profil dan
--    /api/admin/users (service role).
--
-- 2. Migrasi 016–023 membuat tabel/view baru tanpa mencabut hak bawaan
--    Supabase untuk anon. RLS/security_invoker sudah membuat anon tidak
--    mendapat satu baris pun, tapi hak itu tetap dicabut sebagai lapisan
--    kedua — termasuk TRUNCATE, satu-satunya hak yang tidak tunduk RLS.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE SELECT ON public.users FROM authenticated, anon;
GRANT SELECT (id, full_name, role, active, division, position, manager_id)
  ON public.users TO authenticated;

REVOKE ALL ON public.sm_gp_calculations, public.sm_gp_items, public.sm_projects,
              public.sm_role_menu, public.sm_user_menu,
              public.sm_activity_feed, public.sm_gp_ringkasan, public.sm_proyek_ringkasan
  FROM anon;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
