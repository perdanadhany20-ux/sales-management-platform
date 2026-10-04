-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- 045 — Keamanan akun: verifikasi dua langkah (TOTP) & perangkat aktif
--
-- 1. user_mfa: rahasia TOTP (terenkripsi AES-256-GCM di server, bukan teks
--    polos), langkah waktu terakhir yang dipakai (tolak kode diputar ulang),
--    dan hash kode cadangan sekali pakai. Hanya service role yang menyentuh
--    tabel ini — sama seperti user_credentials.
-- 2. user_sessions: alamat IP & waktu terakhir aktif, untuk daftar
--    "Perangkat aktif" di Profil (pengguna bisa memutus sesi lain).
-- Tidak mengubah data lama. Aman dijalankan ulang.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_mfa (
  user_id         uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  rahasia_enc     text        NOT NULL,
  aktif           boolean     NOT NULL DEFAULT false,
  langkah_terakhir bigint     NOT NULL DEFAULT 0,
  kode_cadangan   text[]      NOT NULL DEFAULT '{}',
  dibuat_at       timestamptz NOT NULL DEFAULT now(),
  diaktifkan_at   timestamptz
);

ALTER TABLE public.user_mfa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_mfa FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.user_mfa FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.user_mfa FROM authenticated;
  END IF;
END $$;

ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
