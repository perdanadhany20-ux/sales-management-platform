-- ════════════════════════════════════════════════════════════════════════════
-- 036 — jenjang posisi dan penjaga pohon organisasi.
--
-- Jenjang tetap, dari bawah ke atas:
--   Staff → Supervisor → Manager → General Manager → Direktur
--
-- Setiap akun wajib punya posisi (dipaksa di formulir pendaftaran dan di
-- Admin → Pengguna); pohonnya — siapa membawahi siapa, lewat
-- users.manager_id — dipetakan Admin di Admin → Struktur Organisasi.
--
-- Aturan pohon ditegakkan DI SINI, bukan hanya di tampilan, supaya tidak bisa
-- dilewati lewat pemanggilan API langsung:
--   • tidak ada yang menjadi atasan dirinya sendiri;
--   • atasan harus aktif dan berposisi LEBIH TINGGI dari bawahannya
--     (boleh melompati jenjang: Staff langsung di bawah Manager itu sah);
--   • tidak boleh ada lingkaran (A di bawah B, B di bawah A);
--   • menurunkan posisi seseorang ditolak bila ia masih membawahi orang yang
--     posisinya setara atau lebih tinggi dari posisi barunya.
--
-- Padanan di kode: lib/posisi.ts. Ketiganya (constraint, fungsi peringkat,
-- dan daftar di kode) harus selalu sama.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Rapikan nilai lama ke jenjang baku ─────────────────────────────────
-- Posisi sebelumnya teks bebas dari daftar yang bisa disunting. Yang jelas
-- padanannya dipetakan; sisanya dikosongkan supaya Admin mengisinya.
UPDATE public.users SET position = CASE lower(btrim(position))
    WHEN 'staff'           THEN 'Staff'
    WHEN 'senior staff'    THEN 'Staff'
    WHEN 'sales'           THEN 'Staff'
    WHEN 'supervisor'      THEN 'Supervisor'
    WHEN 'manager'         THEN 'Manager'
    WHEN 'senior manager'  THEN 'Manager'
    WHEN 'general manager' THEN 'General Manager'
    WHEN 'gm'              THEN 'General Manager'
    WHEN 'director'        THEN 'Direktur'
    WHEN 'direktur'        THEN 'Direktur'
    ELSE NULL
  END
 WHERE position IS NOT NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_position_jenjang;
ALTER TABLE public.users ADD CONSTRAINT users_position_jenjang
  CHECK (position IS NULL
         OR position IN ('Staff', 'Supervisor', 'Manager', 'General Manager', 'Direktur'));

-- Pilihan di formulir pendaftaran mengikuti jenjang baku.
UPDATE public.sm_settings
   SET value = '["Staff","Supervisor","Manager","General Manager","Direktur"]'::jsonb,
       updated_at = now()
 WHERE key = 'positions';

-- ── 2. Peringkat ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_peringkat_posisi(p text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p
    WHEN 'Staff'           THEN 1
    WHEN 'Supervisor'      THEN 2
    WHEN 'Manager'         THEN 3
    WHEN 'General Manager' THEN 4
    WHEN 'Direktur'        THEN 5
    ELSE 0
  END;
$$;

-- ── 3. Penjaga pohon ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_jaga_struktur()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_atasan  record;
  v_bawahan record;
  v_lingkar boolean;
BEGIN
  IF NEW.manager_id IS NOT NULL THEN
    IF NEW.manager_id = NEW.id THEN
      RAISE EXCEPTION 'Seseorang tidak bisa menjadi atasannya sendiri.';
    END IF;

    SELECT id, full_name, position, active INTO v_atasan
      FROM public.users WHERE id = NEW.manager_id;

    IF NOT FOUND OR NOT v_atasan.active THEN
      RAISE EXCEPTION 'Atasan yang dipilih tidak ditemukan atau sudah nonaktif.';
    END IF;

    IF NEW.position IS NULL OR v_atasan.position IS NULL THEN
      RAISE EXCEPTION 'Isi posisi % dan % lebih dulu sebelum memetakan atasan.',
        NEW.full_name, v_atasan.full_name;
    END IF;

    IF sm_peringkat_posisi(v_atasan.position) <= sm_peringkat_posisi(NEW.position) THEN
      RAISE EXCEPTION 'Atasan harus berposisi lebih tinggi: % (%) tidak bisa membawahi % (%).',
        v_atasan.full_name, v_atasan.position, NEW.full_name, NEW.position;
    END IF;

    -- Lingkaran: telusuri garis atasan dari atasan baru; bila bertemu orang
    -- ini sendiri, pemetaannya membentuk lingkaran.
    WITH RECURSIVE garis AS (
      SELECT id, manager_id, 1 AS tingkat FROM public.users WHERE id = NEW.manager_id
      UNION ALL
      SELECT u.id, u.manager_id, g.tingkat + 1
        FROM garis g JOIN public.users u ON u.id = g.manager_id
       WHERE g.tingkat < 20
    )
    SELECT EXISTS (SELECT 1 FROM garis WHERE id = NEW.id) INTO v_lingkar;

    IF v_lingkar THEN
      RAISE EXCEPTION 'Pemetaan ini membuat lingkaran: % sudah berada di bawah %.',
        v_atasan.full_name, NEW.full_name;
    END IF;
  END IF;

  -- Menurunkan posisi tidak boleh meninggalkan bawahan yang setara/lebih tinggi.
  IF TG_OP = 'UPDATE' AND NEW.position IS DISTINCT FROM OLD.position THEN
    SELECT full_name, position INTO v_bawahan
      FROM public.users
     WHERE manager_id = NEW.id
       AND sm_peringkat_posisi(position) >= sm_peringkat_posisi(NEW.position)
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Posisi % terlalu rendah: % masih membawahi % (%). Pindahkan bawahannya dulu.',
        coalesce(NEW.position, '(kosong)'), NEW.full_name, v_bawahan.full_name, v_bawahan.position;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jaga_struktur ON public.users;
CREATE TRIGGER trg_jaga_struktur
  BEFORE INSERT OR UPDATE OF manager_id, position ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sm_jaga_struktur();

REVOKE ALL ON FUNCTION public.sm_jaga_struktur() FROM public, anon, authenticated;
