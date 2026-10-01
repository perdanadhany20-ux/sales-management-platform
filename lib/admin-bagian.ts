// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/**
 * lib/admin-bagian.ts — daftar bagian Admin Panel.
 *
 * Tinggal di lib, bukan di dalam halaman /admin, karena dua tempat
 * membutuhkannya: halaman itu sendiri untuk menampilkan isinya, dan sidebar
 * navigasi untuk menampilkan sub-menunya. Menyalin daftarnya ke dua berkas
 * berarti menambah bagian baru harus diingat dua kali — dan yang terlupa
 * hampir selalu sisi navigasinya, sehingga bagiannya ada tapi tidak bisa
 * dituju siapa pun.
 */

import type { KunciFitur } from './lisensi/kontrak';

export type KunciBagian =
  | 'pengguna' | 'struktur' | 'persetujuan' | 'hak_akses' | 'lokasi' | 'target' | 'tampilan' | 'konfigurasi'
  | 'impor' | 'lisensi' | 'audit';

export type KelompokBagian = 'ORGANISASI' | 'TAMPILAN' | 'SISTEM';

export interface Bagian {
  kunci: KunciBagian;
  label: string;
  judul: string;
  keterangan: string;
  ikon: string;
  kelompok: KelompokBagian;
  /** Bagian yang hanya untuk Admin; Manager tidak melihatnya. */
  adminSaja?: boolean;
  /** Fitur lisensi yang dibutuhkan (salah satu cukup). Tanpa ini: selalu ada. */
  fitur?: KunciFitur[];
}

export const BAGIAN_ADMIN: Bagian[] = [
  {
    kunci: 'pengguna', label: 'Pengguna', kelompok: 'ORGANISASI', ikon: '👥', adminSaja: true,
    judul: 'Manajemen Pengguna',
    keterangan: 'Akun, peran, status aktif, dan pengaturan ulang kata sandi.',
  },
  {
    kunci: 'struktur', label: 'Struktur Organisasi', kelompok: 'ORGANISASI', ikon: '🌳', adminSaja: true,
    judul: 'Struktur Organisasi',
    keterangan: 'Pohon atasan–bawahan: Staff, Supervisor, Manager, General Manager, Direktur. Menentukan siapa melihat data siapa.',
  },
  {
    kunci: 'persetujuan', label: 'Persetujuan Akun', kelompok: 'ORGANISASI', ikon: '✅', adminSaja: true,
    fitur: ['approval'],
    judul: 'Persetujuan Pendaftaran Akun',
    keterangan: 'Akun yang mendaftar sendiri dan menunggu diverifikasi sebelum bisa dipakai masuk.',
  },
  {
    kunci: 'hak_akses', label: 'Hak Akses Menu', kelompok: 'ORGANISASI', ikon: '🔐', adminSaja: true,
    judul: 'Hak Akses Menu',
    keterangan: 'Menu mana yang tersedia untuk tiap peran, dan pengecualian per akun bila perlu.',
  },
  {
    kunci: 'lokasi', label: 'Lokasi Meeting', kelompok: 'ORGANISASI', ikon: '📍',
    fitur: ['meeting', 'project'],
    judul: 'Lokasi Meeting',
    keterangan: 'Titik meeting beserta radius GPS yang diterima saat check-in.',
  },
  {
    kunci: 'target', label: 'Target Sales', kelompok: 'ORGANISASI', ikon: '🎯',
    // Realisasi target dihitung dari pipeline WON — tanpa Pipeline, target tak bermakna.
    fitur: ['pipeline'],
    judul: 'Target Sales',
    keterangan: 'Target bulanan nilai penjualan dan GP tiap Sales. Realisasi dihitung dari pipeline WON.',
  },
  {
    kunci: 'tampilan', label: 'Dashboard Setting', kelompok: 'TAMPILAN', ikon: '🎨', adminSaja: true,
    judul: 'Dashboard Setting',
    keterangan: 'Logo, nama, warna merek, tampilan halaman masuk, dan kartu dashboard.',
  },
  {
    kunci: 'konfigurasi', label: 'Nilai Bisnis', kelompok: 'SISTEM', ikon: '⚙️', adminSaja: true,
    judul: 'Konfigurasi Nilai Bisnis',
    keterangan: 'Kategori jadwal, opsi probability, satuan, dan ambang verifikasi lokasi.',
  },
  {
    kunci: 'impor', label: 'Impor Data', kelompok: 'SISTEM', ikon: '📥', adminSaja: true,
    judul: 'Impor Data dari Excel',
    keterangan: 'Masukkan data lama — customer, laporan harian, pipeline, dan riwayat jadwal — dari spreadsheet.',
  },
  {
    kunci: 'lisensi', label: 'Lisensi', kelompok: 'SISTEM', ikon: '🔑', adminSaja: true,
    judul: 'Lisensi Platform',
    keterangan: 'Status lisensi, masa berlaku, fitur yang tersedia, dan permintaan ke penyedia platform.',
  },
  {
    kunci: 'audit', label: 'Audit Log', kelompok: 'SISTEM', ikon: '🧾',
    judul: 'Audit Log',
    keterangan: 'Jejak tindakan penting: check-in, penyelesaian, override, dan perubahan akun.',
  },
];

export const URUTAN_KELOMPOK: KelompokBagian[] = ['ORGANISASI', 'TAMPILAN', 'SISTEM'];

/** Bagian yang boleh dibuka peran ini DAN tercakup lisensinya. Penyaringan
 *  di sini kosmetik — yang menolak sungguhan tetap RLS dan pemeriksaan peran
 *  serta lisensi di route handler. `fitur` null = lisensi belum dimuat. */
export function bagianUntuk(peran: string | null | undefined, fitur: readonly KunciFitur[] | null = null): Bagian[] {
  const admin = (peran ?? '').toUpperCase() === 'ADMIN';
  return BAGIAN_ADMIN.filter((b) =>
    (admin || !b.adminSaja)
    && (!b.fitur || (fitur !== null && b.fitur.some((f) => fitur.includes(f)))));
}
