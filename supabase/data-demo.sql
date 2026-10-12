-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- DATA DEMO — beberapa skenario siap tunjuk untuk presentasi ke calon pelanggan
--
-- Untuk menghapusnya lagi: supabase/HAPUS_DATA_DEMO.sql.
-- Disisipkan ke SETUP_LENGKAP*.sql oleh scripts/gabung-migrasi.mjs (bagian ini
-- bukan migrasi). Hanya berjalan bila _opsi_demo.isi = true, dan DILEWATI bila
-- akun demo.direktur sudah ada — aman dijalankan ulang, tidak menggandakan.
-- Semua tanggal relatif terhadap hari ini (WIB), jadi demo selalu tampak baru.
--
-- Skenario yang langsung terlihat di aplikasi:
--   1. Tim & struktur: Direktur → Manager → 3 Sales, plus Finance.
--   2. Dashboard: satu Sales BELUM mengisi laporan hari ini (kepatuhan < 100%).
--   3. Meeting hari ini wajib check-in GPS + foto (siap didemokan dari HP).
--   4. Pengajuan jadwal yang BELUM DITUGASKAN, satu jadwal TERLEWAT, satu batal.
--   5. Lokasi meeting usulan Sales yang MENUNGGU persetujuan Admin.
--   6. Pipeline lengkap: Open, Quotation, Won (bulan ini & lalu), Lost.
--   7. Customer: aktif, perlu disapa, dan lama tak disentuh (penanda kehangatan).
--   8. Target bulan ini: satu Sales sudah tembus target, dua masih kurang.
--   9. GP Calculation: Draft, menunggu Manager, sudah disetujui, dan satu
--      bermargin di bawah target.
--  10. Proyek yang menyatukan pipeline, jadwal, laporan, dan GP.
-- ════════════════════════════════════════════════════════════════════════════

DO $demo$
DECLARE
  v_isi    boolean;
  v_sandi  text;
  h        date := (now() AT TIME ZONE 'Asia/Jakarta')::date;      -- hari ini (WIB)
  b0       date := date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta'))::date;  -- awal bulan ini
  u_dir uuid; u_mgr uuid; u_fin uuid; u_s1 uuid; u_s2 uuid; u_s3 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid;
  l1 uuid; l2 uuid; l3 uuid;
  pr1 uuid; pr2 uuid;
  pl_won1 uuid; pl_q1 uuid;
  g1 uuid; g2 uuid; g3 uuid; g4 uuid;
BEGIN
  SELECT isi, sandi INTO v_isi, v_sandi FROM _opsi_demo LIMIT 1;
  IF NOT coalesce(v_isi, false) THEN
    RAISE NOTICE 'Data demo tidak diisi (_opsi_demo.isi = false).';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE username = 'demo.direktur') THEN
    RAISE NOTICE 'Data demo sudah ada — dilewati.';
    RETURN;
  END IF;
  IF coalesce(length(v_sandi), 0) < 8 THEN
    RAISE EXCEPTION 'Kata sandi akun demo minimal 8 karakter.';
  END IF;

  -- ── 1. Tim & struktur ──────────────────────────────────────────────────
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, position, joined_at)
  VALUES ('demo.direktur', 'Hendra Wijaya', 'hendra@demo-nusantara.co.id', '081100000001', 'DIRECTOR', true, 'DISETUJUI', 'Manajemen', 'Direktur', h - 900)
  RETURNING id INTO u_dir;
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, position, joined_at, manager_id)
  VALUES ('demo.manager', 'Rudi Santoso', 'rudi@demo-nusantara.co.id', '081100000002', 'MANAGER', true, 'DISETUJUI', 'Sales', 'Manager', h - 700, u_dir)
  RETURNING id INTO u_mgr;
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, position, joined_at, manager_id)
  VALUES ('demo.finance', 'Maya Kusuma', 'maya@demo-nusantara.co.id', '081100000003', 'FINANCE', true, 'DISETUJUI', 'Finance', 'Manager', h - 650, u_dir)
  RETURNING id INTO u_fin;
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, sales_division, position, joined_at, manager_id)
  VALUES ('demo.sari', 'Sari Puspita', 'sari@demo-nusantara.co.id', '081100000011', 'SALES', true, 'DISETUJUI', 'Sales', 'Corporate', 'Staff', h - 400, u_mgr)
  RETURNING id INTO u_s1;
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, sales_division, position, joined_at, manager_id)
  VALUES ('demo.dimas', 'Dimas Pratama', 'dimas@demo-nusantara.co.id', '081100000012', 'SALES', true, 'DISETUJUI', 'Sales', 'Government', 'Staff', h - 300, u_mgr)
  RETURNING id INTO u_s2;
  INSERT INTO public.users (username, full_name, email, phone, role, active, approval_status, division, sales_division, position, joined_at, manager_id)
  VALUES ('demo.ayu', 'Ayu Lestari', 'ayu@demo-nusantara.co.id', '081100000013', 'SALES', true, 'DISETUJUI', 'Sales', 'Retail', 'Staff', h - 120, u_mgr)
  RETURNING id INTO u_s3;

  INSERT INTO public.user_credentials (user_id, password_hash, must_change)
  SELECT id, crypt(v_sandi, gen_salt('bf', 10)), false
  FROM public.users WHERE id IN (u_dir, u_mgr, u_fin, u_s1, u_s2, u_s3);

  -- ── 7. Customer (milik tiap Sales) ─────────────────────────────────────
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, email, address, city, notes, created_by)
  VALUES ('PT Bank Sejahtera Abadi', 'Perbankan', 'Bpk. Arif Setiawan', 'Head of IT', '081210010001', 'arif@banksejahtera.co.id', 'Jl. Jend. Sudirman Kav. 21', 'Jakarta Selatan', 'Sedang ekspansi 12 cabang tahun ini.', u_s1) RETURNING id INTO c1;
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, email, address, city, created_by)
  VALUES ('Hotel Grand Mutiara', 'Perhotelan', 'Ibu Karina', 'Purchasing Manager', '081210010002', 'karina@grandmutiara.com', 'Jl. MH Thamrin No. 8', 'Jakarta Pusat', u_s1) RETURNING id INTO c2;
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, address, city, created_by)
  VALUES ('RS Medika Utama', 'Kesehatan', 'dr. Bambang', 'Direktur Operasional', '081210010003', 'Jl. Pemuda No. 45', 'Bekasi', u_s1) RETURNING id INTO c3;
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, address, city, created_by)
  VALUES ('Pemkot Cendana — Command Center', 'Pemerintah', 'Bpk. Joko Susilo', 'Kabid Infrastruktur TI', '081210010004', 'Jl. Ir. H. Juanda No. 10', 'Bogor', u_s2) RETURNING id INTO c4;
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, address, city, created_by)
  VALUES ('Universitas Bina Cendekia', 'Pendidikan', 'Ibu Ratna Dewi', 'Kepala Biro Umum', '081210010005', 'Jl. Raya Kampus No. 1', 'Depok', u_s2) RETURNING id INTO c5;
  INSERT INTO public.sm_customers (name, segment, contact_person, phone, city, created_by)
  VALUES ('Dinas Perhubungan Provinsi', 'Pemerintah', 'Bpk. Hasan', '081210010006', 'Bandung', u_s2) RETURNING id INTO c6;
  INSERT INTO public.sm_customers (name, segment, contact_person, contact_position, phone, address, city, created_by)
  VALUES ('Mall Galaxy Raya', 'Ritel', 'Bpk. Fikri', 'Building Manager', '081210010007', 'Jl. Boulevard Raya Blok A', 'Bekasi', u_s3) RETURNING id INTO c7;
  INSERT INTO public.sm_customers (name, segment, contact_person, phone, city, created_by)
  VALUES ('CV Maju Bersama', 'Ritel', 'Ibu Lina', '081210010008', 'Tangerang', u_s3) RETURNING id INTO c8;

  -- ── 3 & 5. Lokasi meeting ──────────────────────────────────────────────
  INSERT INTO public.sm_locations (name, address, latitude, longitude, gps_radius_m, active, created_by, approval_status, approved_by, approved_at)
  VALUES ('PT Bank Sejahtera Abadi — Kantor Pusat', 'Jl. Jend. Sudirman Kav. 21, Jakarta Selatan', -6.2146, 106.8227, 100, true, u_mgr, 'DISETUJUI', u_mgr, now() - interval '30 days')
  RETURNING id INTO l1;
  INSERT INTO public.sm_locations (name, address, latitude, longitude, gps_radius_m, active, created_by, approval_status, approved_by, approved_at)
  VALUES ('Pemkot Cendana — Command Center', 'Jl. Ir. H. Juanda No. 10, Bogor', -6.5950, 106.7970, 100, true, u_mgr, 'DISETUJUI', u_mgr, now() - interval '25 days')
  RETURNING id INTO l2;
  INSERT INTO public.sm_locations (name, address, latitude, longitude, gps_radius_m, active, created_by, approval_status, approved_by, approved_at)
  VALUES ('Mall Galaxy Raya — Atrium', 'Jl. Boulevard Raya Blok A, Bekasi', -6.2600, 106.9750, 120, true, u_mgr, 'DISETUJUI', u_mgr, now() - interval '20 days')
  RETURNING id INTO l3;
  -- Usulan Sales yang menunggu persetujuan Admin.
  INSERT INTO public.sm_locations (name, address, latitude, longitude, gps_radius_m, active, created_by, approval_status)
  VALUES ('Hotel Grand Mutiara — Ballroom', 'Jl. MH Thamrin No. 8, Jakarta Pusat', -6.1937, 106.8230, 80, true, u_s1, 'MENUNGGU');

  -- ── 10. Proyek ─────────────────────────────────────────────────────────
  INSERT INTO public.sm_projects (name, customer_id, customer_name, owner_user_id, status, description, target_value, start_date, end_date, location_id)
  VALUES ('Digital Signage 12 Cabang', c1, 'PT Bank Sejahtera Abadi', u_s1, 'AKTIF',
          'Signage antrean & promosi untuk 12 kantor cabang, termasuk CMS terpusat.', 1200000000, h - 40, h + 60, l1)
  RETURNING id INTO pr1;
  INSERT INTO public.sm_projects (name, customer_id, customer_name, owner_user_id, status, description, target_value, start_date, end_date, location_id)
  VALUES ('Videowall Command Center', c4, 'Pemkot Cendana — Command Center', u_s2, 'AKTIF',
          'Videowall 4x3 + video processor untuk ruang command center kota.', 850000000, h - 55, h + 30, l2)
  RETURNING id INTO pr2;

  -- ── 6. Pipeline ────────────────────────────────────────────────────────
  INSERT INTO public.sm_pipeline (sales_user_id, pipeline_date, customer_id, customer_name, contact_person, project_detail, quantity, unit, project_value, project_hpp, probability, stage, estimated_closing, won_at, next_action, project_id)
  VALUES (u_s1, h - 38, c1, 'PT Bank Sejahtera Abadi', 'Bpk. Arif Setiawan', 'Signage cabang tahap 1 (4 cabang) + CMS', 4, 'set', 420000000, 300000000, 100, 'WON', h - 6, h - 6, 'Koordinasi jadwal instalasi tahap 1', pr1)
  RETURNING id INTO pl_won1;
  INSERT INTO public.sm_pipeline (sales_user_id, pipeline_date, customer_id, customer_name, contact_person, project_detail, quantity, unit, project_value, project_hpp, probability, stage, estimated_closing, next_action, project_id)
  VALUES (u_s1, h - 20, c1, 'PT Bank Sejahtera Abadi', 'Bpk. Arif Setiawan', 'Signage cabang tahap 2 (8 cabang)', 8, 'set', 780000000, 560000000, 75, 'QUOTATION', h + 25, 'Revisi penawaran tahap 2 setelah survei', pr1)
  RETURNING id INTO pl_q1;
  INSERT INTO public.sm_pipeline (sales_user_id, pipeline_date, customer_id, customer_name, contact_person, project_detail, quantity, unit, project_value, project_hpp, probability, stage, estimated_closing, next_action)
  VALUES
    (u_s1, h - 12, c2, 'Hotel Grand Mutiara', 'Ibu Karina', 'LED indoor ballroom P2.5 6x3 m', 1, 'unit', 365000000, 255000000, 50, 'QUOTATION', h + 20, 'Presentasi ke GM hotel'),
    (u_s1, h - 70, c3, 'RS Medika Utama', 'dr. Bambang', 'Display antrean pasien 3 lantai', 6, 'unit', 96000000, 70000000, 0, 'LOST', h - 45, 'Kalah harga — tawarkan maintenance'),
    (u_s2, h - 30, c5, 'Universitas Bina Cendekia', 'Ibu Ratna Dewi', 'Interactive panel 30 kelas', 30, 'unit', 540000000, 405000000, 90, 'QUOTATION', h + 10, 'Tunggu SPK rektorat'),
    (u_s2, h - 8,  c6, 'Dinas Perhubungan Provinsi', 'Bpk. Hasan', 'Papan informasi lalu lintas 5 titik', 5, 'titik', 650000000, 470000000, 25, 'OPEN', h + 60, 'Survei titik bersama dinas'),
    (u_s3, h - 26, c7, 'Mall Galaxy Raya', 'Bpk. Fikri', 'Kiosk direktori interaktif 6 unit', 6, 'unit', 132000000, 97000000, 100, 'WON', h - 3, 'Jadwalkan instalasi malam hari'),
    (u_s3, h - 10, c8, 'CV Maju Bersama', 'Ibu Lina', 'Running text LED 3 toko', 3, 'unit', 58000000, 44000000, 10, 'OPEN', h + 45, 'Kirim brosur & harga');
  -- WON bulan lalu → muncul di tren & target periode sebelumnya.
  INSERT INTO public.sm_pipeline (sales_user_id, pipeline_date, customer_id, customer_name, contact_person, project_detail, quantity, unit, project_value, project_hpp, probability, stage, estimated_closing, won_at, next_action, project_id)
  VALUES (u_s2, h - 60, c4, 'Pemkot Cendana — Command Center', 'Bpk. Joko Susilo', 'Videowall 4x3 + video processor', 1, 'paket', 640000000, 455000000, 100, 'WON', b0 - 10, b0 - 10, 'Serah terima & pelatihan operator', pr2);

  -- ── 8. Target bulan ini & bulan lalu ───────────────────────────────────
  INSERT INTO public.sm_sales_targets (sales_user_id, periode, target_nilai, target_gp, updated_by)
  VALUES
    (u_s1, b0, 400000000, 100000000, u_mgr),                                   -- Sari: sudah tembus (WON 420 jt)
    (u_s2, b0, 600000000, 150000000, u_mgr),                                   -- Dimas: belum
    (u_s3, b0, 250000000, 60000000,  u_mgr),                                   -- Ayu: setengah jalan
    (u_s1, (b0 - interval '1 month')::date, 350000000, 90000000, u_mgr),
    (u_s2, (b0 - interval '1 month')::date, 600000000, 150000000, u_mgr),
    (u_s3, (b0 - interval '1 month')::date, 200000000, 50000000, u_mgr);

  -- ── 3 & 4. Jadwal ──────────────────────────────────────────────────────
  -- Riwayat kunjungan selesai (tanpa kewajiban bukti).
  INSERT INTO public.sm_schedules (schedule_date, schedule_time, customer_id, customer_name, project, category, detail, requires_attendance, assigned_to, status, created_by, completed_at, project_id)
  VALUES
    (h - 21, '10:00', c1, 'PT Bank Sejahtera Abadi', 'Digital Signage 12 Cabang', 'Other Sales Activity', 'Presentasi solusi signage ke tim IT', false, u_s1, 'COMPLETED', u_mgr, (((h - 21) + time '11:30') AT TIME ZONE 'Asia/Jakarta'), pr1),
    (h - 14, '13:00', c4, 'Pemkot Cendana — Command Center', 'Videowall Command Center', 'Other Sales Activity', 'Survei ruang command center', false, u_s2, 'COMPLETED', u_mgr, (((h - 14) + time '15:00') AT TIME ZONE 'Asia/Jakarta'), pr2),
    (h - 9,  '09:30', c7, 'Mall Galaxy Raya', NULL, 'Other Sales Activity', 'Demo kiosk direktori di atrium', false, u_s3, 'COMPLETED', u_mgr, (((h - 9) + time '11:00') AT TIME ZONE 'Asia/Jakarta'), NULL),
    (h - 4,  '14:00', c5, 'Universitas Bina Cendekia', NULL, 'Other Sales Activity', 'Uji coba interactive panel di 2 kelas', false, u_s2, 'COMPLETED', u_mgr, (((h - 4) + time '16:00') AT TIME ZONE 'Asia/Jakarta'), NULL);
  -- Terlewat & dibatalkan.
  INSERT INTO public.sm_schedules (schedule_date, schedule_time, customer_id, customer_name, category, detail, requires_attendance, assigned_to, status, created_by, notes)
  VALUES
    (h - 2, '10:00', c8, 'CV Maju Bersama', 'Other Sales Activity', 'Kunjungan perkenalan', false, u_s3, 'MISSED', u_mgr, NULL),
    (h - 5, '15:00', c3, 'RS Medika Utama', 'Other Sales Activity', 'Diskusi maintenance', false, u_s1, 'CANCELLED', u_mgr, 'Dibatalkan customer, dijadwalkan ulang bulan depan');
  -- HARI INI: meeting wajib check-in GPS + foto (demo dari HP Sales).
  INSERT INTO public.sm_schedules (schedule_date, schedule_time, customer_id, customer_name, project, category, detail, requires_attendance, location_id, assigned_to, status, created_by, project_id)
  VALUES
    (h, '10:00', c1, 'PT Bank Sejahtera Abadi', 'Digital Signage 12 Cabang', 'Meeting', 'Kick-off instalasi tahap 1 & survei tahap 2', true, l1, u_s1, 'UPCOMING', u_mgr, pr1),
    (h, '14:00', c7, 'Mall Galaxy Raya', NULL, 'Meeting', 'Serah terima kiosk direktori', true, l3, u_s3, 'UPCOMING', u_mgr, NULL),
    (h + 3, '09:00', c4, 'Pemkot Cendana — Command Center', 'Videowall Command Center', 'Meeting', 'Pelatihan operator videowall', true, l2, u_s2, 'UPCOMING', u_mgr, pr2),
    (h + 7, '13:30', c2, 'Hotel Grand Mutiara', NULL, 'Other Sales Activity', 'Presentasi LED ballroom ke GM', false, NULL, u_s1, 'UPCOMING', u_mgr, NULL);
  -- Pengajuan yang BELUM DITUGASKAN (muncul di "Perlu Ditindaklanjuti").
  INSERT INTO public.sm_schedules (schedule_date, schedule_time, customer_id, customer_name, category, detail, requires_attendance, assigned_to, status, created_by)
  VALUES (h + 5, '10:00', c6, 'Dinas Perhubungan Provinsi', 'Other Sales Activity', 'Survei 5 titik papan informasi — perlu Sales pendamping', false, NULL, 'UPCOMING', u_s2);

  -- ── 2. Laporan harian (14 hari kerja terakhir) ─────────────────────────
  -- Sari & Dimas rutin; Ayu jarang — dan Ayu BELUM mengisi hari ini.
  INSERT INTO public.sm_daily_reports (sales_user_id, report_date, customer_id, customer_name, contact_person, position, phone_whatsapp, lead_project, activity, result, next_action, project_id, created_at)
  SELECT s.uid, d::date, s.cid, s.cnama, s.kontak, s.jabatan, s.telp, s.lead,
         s.aktivitas[1 + (extract(doy FROM d)::int % array_length(s.aktivitas, 1))],
         s.hasil[1 + (extract(doy FROM d)::int % array_length(s.hasil, 1))],
         s.lanjut, s.proyek, (d::date + time '17:05') AT TIME ZONE 'Asia/Jakarta'
  FROM generate_series(h - 18, h, interval '1 day') AS d
  CROSS JOIN (VALUES
    (u_s1, c1, 'PT Bank Sejahtera Abadi', 'Bpk. Arif Setiawan', 'Head of IT', '081210010001', 'Signage 12 cabang', pr1,
      ARRAY['Follow up penawaran tahap 2 via telepon', 'Meeting teknis dengan tim IT cabang', 'Kirim revisi gambar kerja signage'],
      ARRAY['Tim IT setuju spesifikasi, menunggu anggaran', 'Diminta tambahan opsi layar 55 inci', 'Gambar kerja disetujui untuk 4 cabang'],
      'Kirim revisi penawaran tahap 2', true),
    (u_s2, c5, 'Universitas Bina Cendekia', 'Ibu Ratna Dewi', 'Kepala Biro Umum', '081210010005', 'Interactive panel 30 kelas', NULL::uuid,
      ARRAY['Presentasi ke rektorat', 'Follow up SPK', 'Koordinasi uji coba di kelas'],
      ARRAY['Rektorat minta perbandingan 2 merek', 'SPK dijadwalkan ditandatangani minggu depan', 'Uji coba diterima baik oleh dosen'],
      'Siapkan dokumen SPK', true),
    (u_s3, c7, 'Mall Galaxy Raya', 'Bpk. Fikri', 'Building Manager', '081210010007', 'Kiosk direktori', NULL::uuid,
      ARRAY['Koordinasi jadwal instalasi malam', 'Cek kesiapan listrik atrium'],
      ARRAY['Instalasi disetujui mulai pukul 22.00', 'Titik listrik perlu tambahan 2 stop kontak'],
      'Konfirmasi tim instalasi', false)
  ) AS s(uid, cid, cnama, kontak, jabatan, telp, lead, proyek, aktivitas, hasil, lanjut, rutin)
  WHERE extract(isodow FROM d) < 6                                   -- hari kerja
    AND (s.rutin OR extract(day FROM d)::int % 3 = 0)               -- Ayu jarang
    AND NOT (s.uid = u_s3 AND d::date = h);                         -- Ayu belum mengisi hari ini
  -- Laporan lama → customer "lama tak disentuh" & "perlu disapa".
  INSERT INTO public.sm_daily_reports (sales_user_id, report_date, customer_id, customer_name, contact_person, activity, result, next_action, created_at)
  VALUES
    (u_s1, h - 50, c3, 'RS Medika Utama', 'dr. Bambang', 'Negosiasi harga display antrean', 'Customer memilih vendor lain', 'Tawarkan kontrak maintenance', (((h - 50) + time '16:00') AT TIME ZONE 'Asia/Jakarta')),
    (u_s3, h - 28, c8, 'CV Maju Bersama', 'Ibu Lina', 'Perkenalan produk running text', 'Tertarik untuk 3 toko', 'Kirim brosur', (((h - 28) + time '15:30') AT TIME ZONE 'Asia/Jakarta')),
    (u_s2, h - 20, c6, 'Dinas Perhubungan Provinsi', 'Bpk. Hasan', 'Audiensi program papan informasi', 'Diminta proposal awal', 'Survei titik bersama dinas', (((h - 20) + time '16:30') AT TIME ZONE 'Asia/Jakarta'));

  -- ── 9. GP Calculation ──────────────────────────────────────────────────
  -- (a) Disetujui lengkap — proyek bank tahap 1.
  INSERT INTO public.sm_gp_calculations (sales_user_id, pipeline_id, customer_id, customer_name, project_name, po_spk_no, calc_date, payment_term, lead_time,
    gp_target, installation_cost, shipping_cost, status, submitted_at, checked_by, checked_at, approved_by, approved_at, verified_by, verified_at, project_id)
  VALUES (u_s1, pl_won1, c1, 'PT Bank Sejahtera Abadi', 'Signage cabang tahap 1', 'PO/BSA/2026/118', h - 10, '30 hari setelah BAST', '4 minggu',
    0.20, 12000000, 4000000, 'DIVERIFIKASI', now() - interval '9 days', u_mgr, now() - interval '9 days', u_dir, now() - interval '8 days', u_fin, now() - interval '7 days', pr1)
  RETURNING id INTO g1;
  INSERT INTO public.sm_gp_items (calculation_id, urutan, description, qty, vendor, unit_price, unit_cost) VALUES
    (g1, 1, 'Display signage 55 inci + bracket', 8, 'PT Optima Display', 32000000, 19800000),
    (g1, 2, 'Media player & lisensi CMS 1 tahun', 8, 'PT Optima Display', 9000000, 5500000),
    (g1, 3, 'Instalasi & pelatihan', 4, 'Tim internal', 9500000, 4800000);
  -- (b) Menunggu Manager — universitas.
  INSERT INTO public.sm_gp_calculations (sales_user_id, customer_id, customer_name, project_name, calc_date, payment_term, lead_time, gp_target, installation_cost, status, submitted_at)
  VALUES (u_s2, c5, 'Universitas Bina Cendekia', 'Interactive panel 30 kelas', h - 2, '50% DP, 50% setelah BAST', '6 minggu', 0.20, 15000000, 'DIAJUKAN', now() - interval '1 day')
  RETURNING id INTO g2;
  INSERT INTO public.sm_gp_items (calculation_id, urutan, description, qty, vendor, unit_price, unit_cost) VALUES
    (g2, 1, 'Interactive flat panel 75 inci', 30, 'PT Edukasi Visual', 16500000, 11100000),
    (g2, 2, 'Mobile stand', 30, 'PT Edukasi Visual', 1500000, 900000);
  -- (c) Margin DI BAWAH target, menunggu Director — hotel.
  INSERT INTO public.sm_gp_calculations (sales_user_id, customer_id, customer_name, project_name, calc_date, payment_term, lead_time, gp_target, installation_cost, shipping_cost, status, submitted_at, checked_by, checked_at)
  VALUES (u_s1, c2, 'Hotel Grand Mutiara', 'LED ballroom P2.5', h - 3, '30 hari', '5 minggu', 0.20, 25000000, 8000000, 'DIPERIKSA', now() - interval '3 days', u_mgr, now() - interval '2 days')
  RETURNING id INTO g3;
  INSERT INTO public.sm_gp_items (calculation_id, urutan, description, qty, vendor, unit_price, unit_cost) VALUES
    (g3, 1, 'Modul LED P2.5 indoor (18 m²)', 18, 'PT Cahaya LED', 15500000, 10300000),
    (g3, 2, 'Video processor & kontroler', 1, 'PT Cahaya LED', 45000000, 30400000);
  -- (d) Draft — masih disusun Sales.
  INSERT INTO public.sm_gp_calculations (sales_user_id, customer_id, customer_name, project_name, calc_date, gp_target, status)
  VALUES (u_s3, c8, 'CV Maju Bersama', 'Running text LED 3 toko', h, 0.20, 'DRAFT')
  RETURNING id INTO g4;
  INSERT INTO public.sm_gp_items (calculation_id, urutan, description, qty, vendor, unit_price, unit_cost) VALUES
    (g4, 1, 'Running text LED outdoor 3 m', 3, 'CV Sinar Teknik', 16000000, 10400000);

  RAISE NOTICE 'Data demo terpasang: 6 akun (demo.direktur, demo.manager, demo.finance, demo.sari, demo.dimas, demo.ayu), 8 customer, 4 lokasi, 2 proyek, 9 pipeline, 11 jadwal, laporan 3 minggu, 4 GP.';
END
$demo$;
