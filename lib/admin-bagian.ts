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

export type KunciBagian =
  | 'pengguna' | 'persetujuan' | 'hak_akses' | 'lokasi' | 'tampilan' | 'konfigurasi' | 'audit';

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
}

export const BAGIAN_ADMIN: Bagian[] = [
  {
    kunci: 'pengguna', label: 'Pengguna', kelompok: 'ORGANISASI', ikon: '👥', adminSaja: true,
    judul: 'Manajemen Pengguna',
    keterangan: 'Akun, peran, status aktif, dan pengaturan ulang kata sandi.',
  },
  {
    kunci: 'persetujuan', label: 'Persetujuan Akun', kelompok: 'ORGANISASI', ikon: '✅', adminSaja: true,
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
    judul: 'Lokasi Meeting',
    keterangan: 'Titik meeting beserta radius GPS yang diterima saat check-in.',
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
    kunci: 'audit', label: 'Audit Log', kelompok: 'SISTEM', ikon: '🧾',
    judul: 'Audit Log',
    keterangan: 'Jejak tindakan penting: check-in, penyelesaian, override, dan perubahan akun.',
  },
];

export const URUTAN_KELOMPOK: KelompokBagian[] = ['ORGANISASI', 'TAMPILAN', 'SISTEM'];

/** Bagian yang boleh dibuka peran ini. Penyaringan di sini kosmetik — yang
 *  menolak sungguhan tetap RLS dan pemeriksaan peran di route handler. */
export function bagianUntuk(peran: string | null | undefined): Bagian[] {
  const admin = (peran ?? '').toUpperCase() === 'ADMIN';
  return BAGIAN_ADMIN.filter((b) => admin || !b.adminSaja);
}
