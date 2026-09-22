-- ════════════════════════════════════════════════════════════════════════════
-- 006 — Supabase Storage untuk foto bukti meeting (§57)
--
-- Bucket PRIVAT. Foto kehadiran memuat wajah orang dan jejak lokasinya;
-- bucket publik berarti siapa pun yang menebak URL bisa mengunduhnya tanpa
-- login. Aplikasi menyajikannya lewat signed URL berumur pendek.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence', 'evidence', false,
  5242880,                                   -- 5 MB; foto sudah dikompres klien
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Kesepakatan jalur berkas ────────────────────────────────────────────────
--
--   evidence/{user_id}/{schedule_id}/{namaberkas}.jpg
--
-- user_id ditaruh sebagai folder PERTAMA dengan sengaja: dengan begitu
-- kepemilikan bisa dibaca dari jalurnya sendiri, dan policy di bawah cukup
-- membandingkan satu segmen — tanpa perlu menjoin tabel lain di setiap
-- pemeriksaan unggahan.

DROP POLICY IF EXISTS evidence_unggah ON storage.objects;
CREATE POLICY evidence_unggah ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = public.sm_uid()::text
  );

DROP POLICY IF EXISTS evidence_baca ON storage.objects;
CREATE POLICY evidence_baca ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (
      (storage.foldername(name))[1] = public.sm_uid()::text
      OR public.sm_is_pengawas()
    )
  );

-- Tidak ada policy UPDATE: berkas bukti tidak boleh ditimpa. Menimpa foto
-- lama dengan foto baru pada jalur yang sama akan mengubah isi bukti tanpa
-- meninggalkan jejak apa pun — persis bentuk manipulasi yang hendak dicegah
-- §35 dan §81.

DROP POLICY IF EXISTS evidence_hapus ON storage.objects;
CREATE POLICY evidence_hapus ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND public.sm_is_admin());
