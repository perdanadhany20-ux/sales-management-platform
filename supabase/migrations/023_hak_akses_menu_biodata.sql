-- ════════════════════════════════════════════════════════════════════════════
-- 023 — Hak akses menu per peran/akun (tier lisensi) + biodata & atasan
--
-- BAGIAN 1: Hak Akses Menu
--
-- Dulu satu-satunya penyaringan menu adalah "Admin Panel hanya untuk
-- Manager/Admin", ditulis langsung di kode (Shell.tsx, `untuk: isPengawas`).
-- Itu cukup untuk satu aturan, tapi platform ini dijual ke banyak pelanggan
-- dengan paket berbeda — pelanggan A mungkin hanya beli Daily Report,
-- pelanggan B sampai GP Calculation. Aturan sebanyak itu tidak pantas
-- ditulis ulang di kode setiap kali ada pelanggan baru.
--
-- sm_role_menu   : default per PERAN — baris ada berarti peran itu boleh
--                  membuka menu itu.
-- sm_user_menu   : pengecualian per AKUN — begitu satu akun punya baris di
--                  sini, daftar inilah yang berlaku untuknya, MENGGANTIKAN
--                  default perannya (bukan digabung). Akun tanpa baris di
--                  sini mengikuti default perannya seperti biasa.
--
-- Baris di kedua tabel HANYA berisi kunci menu (teks pendek seperti
-- 'daily-report') — tidak ada data sensitif, jadi SELECT dibuka untuk semua
-- yang sudah masuk (dibutuhkan untuk merender sidebar & memblokir halaman
-- sendiri). Menulis tetap dikunci ke Admin, sejalan dengan §022.
--
-- Data awal disamakan PERSIS dengan perilaku sebelum migrasi ini: semua
-- peran melihat semua menu, kecuali Admin Panel yang tetap Manager+Admin —
-- supaya menerapkan migrasi ini tidak mengunci siapa pun secara tiba-tiba.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sm_role_menu (
  role     text NOT NULL,
  menu_key text NOT NULL,
  PRIMARY KEY (role, menu_key)
);

CREATE TABLE IF NOT EXISTS public.sm_user_menu (
  user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  menu_key text NOT NULL,
  PRIMARY KEY (user_id, menu_key)
);

ALTER TABLE public.sm_role_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_user_menu ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rm_baca ON public.sm_role_menu;
CREATE POLICY rm_baca  ON public.sm_role_menu FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rm_tulis ON public.sm_role_menu;
CREATE POLICY rm_tulis ON public.sm_role_menu FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());
DROP POLICY IF EXISTS rm_ubah ON public.sm_role_menu;
CREATE POLICY rm_ubah  ON public.sm_role_menu FOR UPDATE TO authenticated USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());
DROP POLICY IF EXISTS rm_hapus ON public.sm_role_menu;
CREATE POLICY rm_hapus ON public.sm_role_menu FOR DELETE TO authenticated USING (public.sm_is_admin());

DROP POLICY IF EXISTS um_baca ON public.sm_user_menu;
CREATE POLICY um_baca  ON public.sm_user_menu FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS um_tulis ON public.sm_user_menu;
CREATE POLICY um_tulis ON public.sm_user_menu FOR INSERT TO authenticated WITH CHECK (public.sm_is_admin());
DROP POLICY IF EXISTS um_ubah ON public.sm_user_menu;
CREATE POLICY um_ubah  ON public.sm_user_menu FOR UPDATE TO authenticated USING (public.sm_is_admin()) WITH CHECK (public.sm_is_admin());
DROP POLICY IF EXISTS um_hapus ON public.sm_user_menu;
CREATE POLICY um_hapus ON public.sm_user_menu FOR DELETE TO authenticated USING (public.sm_is_admin());

-- Menu bawaan dipasang SEKALI seumur server (penanda di sm_settings
-- 'menu_bawaan_terpasang'). Menjalankan ulang berkas SQL tidak mengembalikan
-- menu yang sudah dicabut Admin lewat Hak Akses Menu.
DO $menu$
DECLARE v_tanda jsonb;
BEGIN
  SELECT value INTO v_tanda FROM public.sm_settings WHERE key = 'menu_bawaan_terpasang';
  v_tanda := coalesce(v_tanda, '[]'::jsonb);
  IF NOT (v_tanda ? 'dasar') THEN
    IF NOT EXISTS (SELECT 1 FROM public.sm_role_menu) THEN
      INSERT INTO public.sm_role_menu (role, menu_key)
      SELECT r, k
      FROM unnest(ARRAY['SALES','MANAGER','ADMIN','DIRECTOR','FINANCE']) AS r
      CROSS JOIN unnest(ARRAY['dashboard','daily-report','proyek','pipeline','schedule','meeting','gp','activity']) AS k
      ON CONFLICT DO NOTHING;
      INSERT INTO public.sm_role_menu (role, menu_key) VALUES ('MANAGER', 'admin'), ('ADMIN', 'admin')
      ON CONFLICT DO NOTHING;
    END IF;
    INSERT INTO public.sm_settings (key, value, description)
    VALUES ('menu_bawaan_terpasang', v_tanda || '["dasar"]'::jsonb,
            'Penanda internal migrasi: menu bawaan yang sudah pernah dipasang.')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END
$menu$;

-- ── BAGIAN 2: Biodata & atasan ───────────────────────────────────────────────
--
-- NIK, tempat/tanggal lahir, dan alamat adalah biodata milik pegawai sendiri
-- — boleh diisi lewat /api/profil, sama seperti email/telepon sekarang.
-- manager_id ("Atasan") beda sifatnya: itu keputusan struktur organisasi,
-- jadi hanya Admin yang boleh mengisinya (lewat /api/admin/users), bukan
-- kolom yang bisa diisi sendiri.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nik         text,
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS address     text,
  ADD COLUMN IF NOT EXISTS manager_id  uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_manager_not_self;
ALTER TABLE public.users
  ADD CONSTRAINT users_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);
