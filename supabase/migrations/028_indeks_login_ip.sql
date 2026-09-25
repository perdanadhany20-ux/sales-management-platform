-- 028 — Indeks untuk batas percobaan login per-IP (app/api/auth/login).
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON public.login_attempts (ip, attempted_at DESC)
  WHERE success = false;
