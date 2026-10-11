// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
// Menyusun supabase/SETUP_LENGKAP.sql: SELURUH migrasi + akun Admin pertama
// dalam SATU berkas untuk project Supabase baru. Jalankan ulang setiap kali
// ada migrasi baru:  npm run sql:setup
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = 'supabase/migrations';
const berkas = readdirSync(folder).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const terakhir = berkas.at(-1)?.slice(0, 3);

const kepala = `-- ════════════════════════════════════════════════════════════════════════════
-- Sales Management Platform — SETUP LENGKAP (migrasi 001–${terakhir} + Admin pertama)
-- Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
-- atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
--
-- Untuk project Supabase BARU yang masih kosong. Cara pakai:
--   1. Ubah 3 isian akun Admin di bawah (username, nama, kata sandi sementara).
--   2. Supabase → SQL Editor → New query → tempel SELURUH isi berkas → Run.
--   3. Hasil akhir menampilkan akun Admin. Saat login pertama Admin wajib ganti sandi.
--   4. (Opsional) DATA DEMO di akhir berkas: ubah isian "true/false" di bagian
--      ▼▼▼ DATA DEMO ▼▼▼ untuk mengisi contoh skenario (akun demo.*).
--
-- Project yang SUDAH terpasang: JANGAN jalankan seluruh berkas (migrasi lama
-- akan bentrok). Salin dari baris "-- ▼▼▼ NNN_..." migrasi pertama yang belum
-- dijalankan SAMPAI AKHIR berkas, lalu Run. Potongan itu aman diulang: Admin
-- dan data demo yang sudah ada dilewati.
--
-- Seluruh isi berjalan dalam SATU transaksi: bila ada yang gagal, tidak ada
-- yang tersimpan — perbaiki penyebabnya lalu jalankan ulang.
-- Berkas ini DIHASILKAN oleh scripts/gabung-migrasi.mjs — jangan diedit manual
-- selain 3 isian Admin; sumber aslinya supabase/migrations/.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ▼▼▼ UBAH DI SINI — akun Admin pertama ▼▼▼
CREATE TEMP TABLE _admin_awal (username text, nama text, sandi text) ON COMMIT DROP;
INSERT INTO _admin_awal VALUES (
  'admin',                -- username: huruf kecil/angka/titik/strip, 3–40 karakter
  'Administrator',        -- nama lengkap
  'GantiSandiIni!2026'    -- kata sandi SEMENTARA (min. 8 karakter)
);
-- ▲▲▲ selesai — tidak perlu mengubah apa pun di bawah ini ▲▲▲
`;

const isi = berkas.map((f) => `\n\n-- ▼▼▼ ${f} ▼▼▼\n${readFileSync(join(folder, f), 'utf8').trimEnd()}\n`).join('');

const ekor = `

-- ════════════════════════════════════════════════════════════════════════════
-- Akun Admin pertama (dilewati bila sudah ada Admin)
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL search_path = public, extensions;

DO $admin$
DECLARE
  a  record;
  v_id uuid;
BEGIN
  -- Isian Admin tidak ikut tersalin (pembaruan project yang sudah terpasang) → lewati.
  IF to_regclass('pg_temp._admin_awal') IS NULL THEN
    RAISE NOTICE 'Isian Admin tidak ada — pembuatan Admin dilewati.';
    RETURN;
  END IF;
  SELECT * INTO a FROM _admin_awal LIMIT 1;
  IF a.username IS NULL OR a.username !~ '^[a-z0-9._-]{3,40}$' THEN
    RAISE EXCEPTION 'Username Admin tidak sah: huruf kecil, angka, titik, garis bawah, strip (3–40 karakter).';
  END IF;
  IF coalesce(length(a.sandi), 0) < 8 THEN
    RAISE EXCEPTION 'Kata sandi Admin minimal 8 karakter.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE role = 'ADMIN') THEN
    RAISE NOTICE 'Sudah ada akun Admin — pembuatan Admin dilewati.';
    RETURN;
  END IF;

  INSERT INTO public.users (username, full_name, role, active, approval_status)
  VALUES (a.username, coalesce(nullif(trim(a.nama), ''), 'Administrator'), 'ADMIN', true, 'DISETUJUI')
  RETURNING id INTO v_id;
  INSERT INTO public.user_credentials (user_id, password_hash, must_change)
  VALUES (v_id, crypt(a.sandi, gen_salt('bf', 10)), true);
END
$admin$;

COMMIT;

SELECT username, full_name, role, approval_status, 'Login lalu ganti kata sandi' AS langkah_berikutnya
FROM public.users WHERE role = 'ADMIN';
`;

// Data demo: bagian mandiri di akhir berkas, dengan saklarnya sendiri.
// DEMO=1 npm run sql:setup → saklar bawaan "true" (untuk server demo).
const demoAktif = process.env.DEMO === '1';
const demo = `

-- ════════════════════════════════════════════════════════════════════════════
-- ▼▼▼ DATA DEMO — UBAH DI SINI ▼▼▼
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
CREATE TEMP TABLE _opsi_demo (isi boolean, sandi text) ON COMMIT DROP;
INSERT INTO _opsi_demo VALUES (
  ${demoAktif ? 'true ' : 'false'},           -- true = isi data contoh skenario; false = lewati (pelanggan sungguhan)
  'DemoSales2026'   -- kata sandi semua akun demo.* (min. 8 karakter)
);
-- ▲▲▲ selesai ▲▲▲
SET LOCAL search_path = public, extensions;

${readFileSync('supabase/data-demo.sql', 'utf8').trimEnd()}

COMMIT;

SELECT username, full_name, role, position FROM public.users WHERE username LIKE 'demo.%' ORDER BY role, username;
`;

const keluaran = process.env.KELUAR || 'supabase/SETUP_LENGKAP.sql';
writeFileSync(keluaran, kepala + isi + ekor + demo);
console.log(`${keluaran} — ${berkas.length} migrasi (001–${terakhir}) + Admin pertama + data demo (${demoAktif ? 'AKTIF' : 'nonaktif'})`);
