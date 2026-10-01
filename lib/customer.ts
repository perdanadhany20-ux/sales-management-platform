// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/**
 * lib/customer.ts — tipe & aturan kecil modul Customer (migrasi 042).
 */

export interface CustomerRingkasan {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  contact_person: string | null;
  contact_position: string | null;
  email: string | null;
  segment: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  jumlah_pipeline: number;
  nilai_terbuka: number;
  jumlah_won: number;
  nilai_won: number;
  jumlah_laporan: number;
  laporan_terakhir: string | null;
  kontak_terakhir: string | null;
  jabatan_terakhir: string | null;
  telepon_terakhir: string | null;
  jumlah_jadwal: number;
  jadwal_selesai: number;
  jadwal_berikutnya: string | null;
  jumlah_proyek: number;
  aktivitas_terakhir: string | null;
}

export type Kehangatan = 'AKTIF' | 'SAPA' | 'DINGIN' | 'BARU';

/** Seberapa lama customer ini tidak disentuh — penanda siapa yang perlu
 *  dikunjungi atau dihubungi lagi. Batasnya sengaja sederhana dan mudah
 *  dijelaskan: dua minggu dan enam minggu. */
export const KEHANGATAN: Record<Kehangatan, { label: string; color: string; bg: string; keterangan: string }> = {
  AKTIF:  { label: 'Aktif',          color: '#008300', bg: '#e0f2e0', keterangan: 'Ada aktivitas dalam 14 hari terakhir.' },
  SAPA:   { label: 'Perlu disapa',   color: '#b45309', bg: '#fef3d9', keterangan: 'Tidak ada aktivitas 15–45 hari.' },
  DINGIN: { label: 'Lama tak disentuh', color: '#e34948', bg: '#fce3e3', keterangan: 'Lebih dari 45 hari tanpa aktivitas.' },
  BARU:   { label: 'Belum ada aktivitas', color: '#64748b', bg: '#f1f5f9', keterangan: 'Belum ada laporan, pipeline, atau meeting.' },
};

export function kehangatan(c: Pick<CustomerRingkasan, 'aktivitas_terakhir'>, hariIni = new Date()): Kehangatan {
  if (!c.aktivitas_terakhir) return 'BARU';
  const selisih = Math.floor((hariIni.getTime() - new Date(c.aktivitas_terakhir + 'T00:00:00').getTime()) / 86_400_000);
  if (selisih <= 14) return 'AKTIF';
  if (selisih <= 45) return 'SAPA';
  return 'DINGIN';
}

/** Nomor lokal Indonesia → format wa.me (08xx → 628xx). null bila tidak terbaca. */
export function nomorWhatsApp(telepon: string | null | undefined): string | null {
  if (!telepon) return null;
  let d = telepon.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^62\d{8,13}$/.test(d) ? d : null;
}
