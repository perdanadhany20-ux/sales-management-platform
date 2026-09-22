/**
 * lib/constants.ts — satu sumber kebenaran untuk label, warna status, dan
 * pesan kegagalan.
 *
 * Palet status diwarisi dari lib/fs-status.ts FieldServices, yang sudah lolos
 * pemeriksaan buta warna. Pasangan merah/hijau versi lama di sana (#b91c1c vs
 * #15803d) GAGAL uji CVD — ΔE 4,2 di bawah ambang 8 — dan itu justru pasangan
 * yang paling sering tidak terbedakan penderita deuteranopia/protanopia.
 * Nilai di bawah adalah hasil perbaikannya; jangan diganti dengan warna
 * Tailwind sembarangan tanpa mengulang pemeriksaan yang sama.
 */

export type StatusJadwal =
  | 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export interface GayaStatus { label: string; color: string; bg: string }

export const STATUS_JADWAL: Record<StatusJadwal, GayaStatus> = {
  UPCOMING:    { label: 'Akan Datang',    color: '#64748b', bg: '#f1f5f9' },
  IN_PROGRESS: { label: 'Sedang Berjalan', color: '#2a78d6', bg: '#e3edfb' },
  COMPLETED:   { label: 'Selesai',        color: '#008300', bg: '#e0f2e0' },
  MISSED:      { label: 'Terlewat',       color: '#e34948', bg: '#fce3e3' },
  CANCELLED:   { label: 'Dibatalkan',     color: '#94a3b8', bg: '#f1f5f9' },
};

export type StateKehadiran =
  | 'NOT_STARTED' | 'CHECKED_IN' | 'GPS_VERIFIED' | 'EVIDENCE_PENDING'
  | 'READY_TO_COMPLETE' | 'COMPLETED' | 'GPS_FAILED' | 'EXCEPTION';

export const STATE_KEHADIRAN: Record<StateKehadiran, GayaStatus> = {
  NOT_STARTED:       { label: 'Belum Mulai',        color: '#64748b', bg: '#f1f5f9' },
  CHECKED_IN:        { label: 'Sudah Check-in',     color: '#2a78d6', bg: '#e3edfb' },
  GPS_VERIFIED:      { label: 'Lokasi Terverifikasi', color: '#2a78d6', bg: '#e3edfb' },
  EVIDENCE_PENDING:  { label: 'Menunggu Foto',      color: '#eda100', bg: '#fef3d9' },
  READY_TO_COMPLETE: { label: 'Siap Diselesaikan',  color: '#2a78d6', bg: '#e3edfb' },
  COMPLETED:         { label: 'Selesai',            color: '#008300', bg: '#e0f2e0' },
  GPS_FAILED:        { label: 'Lokasi Gagal',       color: '#e34948', bg: '#fce3e3' },
  EXCEPTION:         { label: 'Exception Admin',    color: '#eda100', bg: '#fef3d9' },
};

/**
 * Pesan kegagalan GPS untuk Sales di lapangan (§32).
 *
 * Sengaja tidak menyebut nama status teknisnya, tidak menyebut fungsi
 * database, dan tidak menampilkan koordinat. Yang dibutuhkan orang yang
 * sedang berdiri di depan kantor klien hanyalah: apa yang salah, dan apa
 * yang harus ia lakukan sekarang.
 */
export const PESAN_GPS: Record<string, string> = {
  SCHEDULE_MISMATCH:
    'Jadwal ini bukan untuk hari ini, jadi belum bisa dimulai.',
  ASSIGNMENT_MISMATCH:
    'Meeting ini ditugaskan kepada orang lain.',
  LOW_ACCURACY:
    'Sinyal GPS belum cukup akurat. Coba pindah ke tempat terbuka, jauh dari atap atau gedung tinggi, lalu ulangi.',
  OUTSIDE_RADIUS:
    'Anda berada di luar area meeting yang diizinkan.',
  NO_LOCATION:
    'Lokasi meeting belum diatur. Hubungi admin untuk melengkapinya.',
};

export const PESAN_PENYELESAIAN: Record<string, string> = {
  NO_ATTENDANCE:   'Mulai meeting dan lakukan check-in terlebih dahulu.',
  GPS_NOT_VERIFIED: 'Lokasi Anda belum terverifikasi.',
  NO_EVIDENCE:     'Unggah foto bukti kehadiran terlebih dahulu.',
};

/**
 * Warna kategori untuk grafik. Biru memimpin sebagai warna merek; sisanya
 * dipilih berjarak cukup jauh di roda warna supaya tetap terbedakan saat
 * bersebelahan dalam satu donat.
 */
export const WARNA_CHART = [
  '#1d4ed8', // biru — aksen utama
  '#0891b2', // teal
  '#eda100', // amber
  '#008300', // hijau
  '#7c3aed', // ungu
  '#e34948', // merah
  '#64748b', // abu
] as const;

/** Warna per tingkat probability Pipeline: makin panas makin dekat closing. */
export const WARNA_PROBABILITY: Record<number, string> = {
  10: '#94a3b8',
  25: '#0891b2',
  50: '#1d4ed8',
  75: '#eda100',
  90: '#008300',
};

export type Peran = 'SALES' | 'MANAGER' | 'ADMIN' | 'DIRECTOR' | 'FINANCE';

export const LABEL_PERAN: Record<Peran, string> = {
  SALES:    'Sales',
  MANAGER:  'Manager',
  ADMIN:    'Admin',
  DIRECTOR: 'Director',
  FINANCE:  'Finance',
};

/**
 * Peran yang melihat data seluruh tim.
 *
 * Director dan Finance ikut karena keduanya menandatangani GP Calculation —
 * tanda tangan di atas angka yang tidak boleh ia baca adalah tanda tangan
 * kosong. Keduanya tetap BUKAN Admin: pengelolaan akun dan konfigurasi
 * platform tertutup bagi mereka, dan itu ditentukan isAdmin() di bawah,
 * bukan fungsi ini. Padanannya di database: sm_is_pengawas() (migrasi 015).
 */
export function isPengawas(role: string | null | undefined): boolean {
  return ['MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE'].includes((role ?? '').toUpperCase());
}

export function isAdmin(role: string | null | undefined): boolean {
  return (role ?? '').toUpperCase() === 'ADMIN';
}
