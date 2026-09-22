-- ════════════════════════════════════════════════════════════════════════════
-- 010 — Kartu dashboard yang bisa dinyalakan/dimatikan admin
--
-- Disimpan sebagai satu baris sm_settings, bukan tabel sendiri. Isinya daftar
-- tetap yang pendek dan hanya dibaca satu halaman; membuatkan tabel beserta
-- RLS-nya sendiri untuk enam baris konfigurasi adalah kerumitan yang tidak
-- dibayar apa pun.
--
-- `key` di bawah HARUS cocok dengan konstanta di app/(app)/dashboard/page.tsx.
-- Kartu yang key-nya tidak dikenal akan diabaikan begitu saja — itu disengaja,
-- supaya menghapus sebuah kartu dari kode tidak membuat halamannya rusak bagi
-- pemasangan yang pengaturannya masih menyebut kartu lama.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.sm_settings (key, value, description) VALUES
  ('dashboard_widgets',
   '[
      {"key":"kepatuhan",   "label":"Kepatuhan Laporan Hari Ini", "aktif":true},
      {"key":"nilai_pipeline","label":"Nilai Pipeline",           "aktif":true},
      {"key":"gross_profit", "label":"Gross Profit",              "aktif":true},
      {"key":"probability",  "label":"Sebaran Probability",       "aktif":true},
      {"key":"status_jadwal","label":"Status Jadwal",             "aktif":true},
      {"key":"tren",         "label":"Aktivitas 6 Bulan Terakhir","aktif":true},
      {"key":"meeting",      "label":"Meeting",                   "aktif":true},
      {"key":"pengecualian", "label":"Perlu Ditindaklanjuti",     "aktif":true}
    ]'::jsonb,
   'Kartu mana yang tampil di Dashboard. Diatur lewat Administrasi → Tampilan.')
ON CONFLICT (key) DO NOTHING;
