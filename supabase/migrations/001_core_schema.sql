-- ════════════════════════════════════════════════════════════════════════════
-- 001 — Skema inti: identitas, sesi, audit, pengaturan
--
-- Pola auth diadaptasi dari kedua baseline: BUKAN Supabase Auth, melainkan
-- tabel users + bcrypt + tabel sesi + cookie httpOnly. Konsekuensinya
-- auth.uid() selalu NULL di dalam policy, jadi identitas dibawa lewat klaim
-- JWT yang diterbitkan server (lihat lib/db-token.ts dan migrasi 004).
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Identitas ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  email         text,
  phone         text,
  -- Tiga peran sesuai §48. Sengaja tidak memakai enum: menambah peran baru
  -- lewat ALTER TYPE mengunci tabel, sedangkan CHECK bisa diubah tanpa itu.
  role          text NOT NULL DEFAULT 'SALES'
                CHECK (role IN ('SALES', 'MANAGER', 'ADMIN')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role   ON public.users (role) WHERE active;
CREATE INDEX IF NOT EXISTS idx_users_active ON public.users (active);

-- Kredensial dipisah dari tabel users supaya hash tidak pernah ikut terbawa
-- oleh SELECT * yang ceroboh pada profil user.
CREATE TABLE IF NOT EXISTS public.user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Yang disimpan hash-nya, bukan tokennya. Bocornya isi tabel ini tidak
-- memberi penyerang sesi yang bisa dipakai.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id          bigserial PRIMARY KEY,
  username    text NOT NULL,
  ip          text,
  success     boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup
  ON public.login_attempts (username, attempted_at DESC);

-- ── Audit ───────────────────────────────────────────────────────────────────

-- Append-only: tidak ada policy UPDATE/DELETE untuk siapa pun (migrasi 005),
-- mengikuti pola audit immutable FieldServices. Jejak yang bisa disunting
-- bukan jejak audit.
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name  text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON public.audit_trail (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_trail (created_at DESC);

-- ── Pengaturan yang bisa diubah admin ───────────────────────────────────────

-- §21/§47: nilai bisnis yang mungkin berubah (kategori jadwal, opsi
-- probability, radius default, satuan) tinggal di sini, bukan di-hardcode di
-- kode. Bentuk key/value jsonb dipilih supaya menambah satu pengaturan baru
-- tidak perlu migrasi kolom.
CREATE TABLE IF NOT EXISTS public.sm_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Pemicu updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_touch ON public.users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sm_touch_updated_at();
