-- ════════════════════════════════════════════════════════════════════════════
-- 007 — Nilai bisnis awal (§21, §24, §30, §47)
--
-- Semua yang ada di sini BISA diubah admin lewat menu Konfigurasi. Yang
-- ditanam di sini hanya titik awalnya, supaya aplikasi bisa jalan sejak
-- pasang pertama tanpa layar setup wajib.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES

  -- `requires_attendance` di sinilah yang menentukan kategori mana yang
  -- menyeret alur GPS + foto. Nilainya disalin ke kolom sm_schedules saat
  -- jadwal dibuat — lihat catatan di migrasi 003 soal kenapa disalin, bukan
  -- dicocokkan ulang lewat nama.
  ('schedule_categories',
   '[{"name":"Meeting","requires_attendance":true},
     {"name":"Other Sales Activity","requires_attendance":false}]'::jsonb,
   'Kategori Request Schedule. requires_attendance=true mewajibkan check-in GPS + foto bukti.'),

  ('probability_options',
   '[10, 25, 50, 75, 90]'::jsonb,
   'Pilihan probability Pipeline (persen).'),

  ('default_gps_radius_m',
   '50'::jsonb,
   'Radius bawaan lokasi meeting baru, dalam meter. Bisa ditimpa per lokasi.'),

  ('gps_accuracy_threshold_m',
   '100'::jsonb,
   'Akurasi GPS terburuk yang masih diterima saat check-in, dalam meter. Dibaca sm_ambang_akurasi().'),

  ('pipeline_units',
   '["unit","set","titik","paket","lot","meter"]'::jsonb,
   'Pilihan satuan pada Pipeline.'),

  ('activity_categories',
   '["Meeting","Follow Up","Quotation","Customer Visit","Survey","Other"]'::jsonb,
   'Kategori aktivitas untuk analitik halaman Activity.')

ON CONFLICT (key) DO NOTHING;
