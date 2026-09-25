-- ════════════════════════════════════════════════════════════════════════════
-- 020 — Lokasi dipin dari Proyek, dengan persetujuan admin
--
-- Sebelumnya lokasi meeting hanya bisa didaftarkan admin lewat menu terpisah
-- (Admin Panel → Lokasi Meeting), sehingga Sales yang ingin bertemu di
-- customer baru harus minta admin mendaftarkan titiknya dulu sebelum jadwal
-- bisa dibuat. Sekarang Sales bisa pin lokasi langsung saat membuat Proyek.
--
-- Radius GPS TETAP sepenuhnya ditentukan server (lihat app/api/lokasi),
-- bukan oleh kolom di sini — kalau Sales bisa melebarkan radiusnya sendiri,
-- verifikasi kehadiran kehilangan arti (lihat catatan di TabLokasi.tsx).
-- Kolom baru di bawah hanya mencatat SIAPA yang mengajukan dan bagaimana
-- keputusan admin atasnya; lokasi ajuan Sales lahir dengan active=false dan
-- baru bisa dipakai check-in setelah admin menyetujuinya.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sm_locations
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.sm_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DISETUJUI'
    CHECK (approval_status IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK')),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz;

COMMENT ON COLUMN public.sm_locations.approval_status IS
  'MENUNGGU = diajukan Sales lewat form Proyek, belum bisa dipilih di jadwal (active masih false) sampai admin menyetujui.';

ALTER TABLE public.sm_projects
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.sm_locations(id) ON DELETE SET NULL;
