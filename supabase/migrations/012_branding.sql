-- ════════════════════════════════════════════════════════════════════════════
-- 012 — Identitas visual platform (Administrasi → Tampilan)
--
-- Nama platform, nama perusahaan, logo, dan warna merek disimpan di database,
-- bukan dipaku di kode. Alasannya sederhana: mengganti nama atau warna adalah
-- keputusan pemilik platform, dan menuntut satu siklus deploy untuk setiap
-- perubahan seperti itu membuat hal yang seharusnya sepele jadi mahal.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('branding',
   '{
      "nama_platform":  "Sales Management Platform",
      "nama_pendek":    "Sales MP",
      "nama_portal":    "",
      "nama_perusahaan":"",
      "kredit":         "",
      "kontak_bantuan": "",
      "warna_utama":    "#1d4ed8",
      "warna_utama_2":  "#1e40af",
      "warna_aksen":    "#eda100",
      "logo_url":       "",
      "latar_login_url":"",
      "latar_dashboard_url": ""
    }'::jsonb,
   'Identitas visual: nama, logo, warna, dan gambar latar. Diatur lewat Administrasi → Tampilan.')
ON CONFLICT (key) DO NOTHING;

-- ── Bucket aset merek ───────────────────────────────────────────────────────
--
-- PUBLIK, berbeda dari bucket 'evidence' yang privat — dan bedanya disengaja.
-- Logo serta latar halaman login harus tampil SEBELUM seseorang masuk, jadi
-- tidak ada sesi yang bisa dipakai menandatangani URL-nya. Isinya pun memang
-- untuk dilihat semua orang: tidak ada wajah, lokasi, atau data pribadi di
-- sini. Yang tetap dibatasi rapat adalah siapa yang boleh MENULIS.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding', 'branding', true,
  8388608,                                   -- 8 MB, cukup untuk foto latar
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS branding_unggah ON storage.objects;
CREATE POLICY branding_unggah ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.sm_is_admin());

-- Berbeda dari 'evidence' yang haram ditimpa: berkas merek memang diganti
-- berulang kali, dan menumpuk versi lama hanya menyisakan sampah yang tidak
-- pernah dibersihkan siapa pun.
DROP POLICY IF EXISTS branding_ganti ON storage.objects;
CREATE POLICY branding_ganti ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'branding' AND public.sm_is_admin())
  WITH CHECK (bucket_id = 'branding' AND public.sm_is_admin());

DROP POLICY IF EXISTS branding_hapus ON storage.objects;
CREATE POLICY branding_hapus ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.sm_is_admin());
