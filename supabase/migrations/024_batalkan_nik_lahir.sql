-- ════════════════════════════════════════════════════════════════════════════
-- 024 — Batalkan NIK dan tempat/tanggal lahir dari migrasi 023
--
-- Ditambahkan lalu langsung dibatalkan pada sesi yang sama sebelum dipakai
-- di mana pun — pemilik platform memutuskan dua field itu tidak diperlukan.
-- Alamat dan manager_id (atasan) TETAP, hanya dua kolom ini yang dibuang.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users
  DROP COLUMN IF EXISTS nik,
  DROP COLUMN IF EXISTS birth_place,
  DROP COLUMN IF EXISTS birth_date;
