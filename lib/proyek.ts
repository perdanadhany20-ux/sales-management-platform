import type { GayaStatus } from './constants';

/**
 * lib/proyek.ts — tipe dan label Proyek.
 *
 * Seperti di modul lain, TIDAK ada perhitungan di sini: seluruh angka
 * ringkasan (nilai pipeline, profit GP, jumlah meeting selesai) dihitung view
 * `sm_proyek_ringkasan` di database. Yang dihitung ulang di browser adalah
 * angka kedua, dan angka kedua pada akhirnya selalu berbeda dari yang pertama.
 */

export type StatusProyek = 'AKTIF' | 'SELESAI' | 'BATAL';

export const STATUS_PROYEK: Record<StatusProyek, GayaStatus> = {
  AKTIF:   { label: 'Aktif',    color: '#2a78d6', bg: '#e3edfb' },
  SELESAI: { label: 'Selesai',  color: '#008300', bg: '#e0f2e0' },
  BATAL:   { label: 'Batal',    color: '#94a3b8', bg: '#f1f5f9' },
};

export interface Proyek {
  id: string;
  kode: string;
  name: string;
  customer_id: string | null;
  customer_name: string;
  owner_user_id: string;
  status: string;
  description: string | null;
  target_value: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

/** Baris view sm_proyek_ringkasan: proyek + hitungan seluruh modul yang tertaut. */
export interface ProyekRingkasan extends Proyek {
  jumlah_pipeline: number;
  nilai_pipeline: number;
  gp_pipeline: number;

  jumlah_jadwal: number;
  jadwal_selesai: number;
  jumlah_meeting: number;
  meeting_selesai: number;

  jumlah_laporan: number;
  laporan_terakhir: string | null;

  jumlah_gp: number;
  nilai_gp: number;
  profit_gp: number;
  gp_disetujui: number;
  gp_menunggu: number;
}

/**
 * Seberapa jauh proyek ini berjalan, dari jejak yang benar-benar ada.
 *
 * Bukan persentase yang diisi tangan. Tahapan diturunkan dari keberadaan
 * catatan: ada pipeline → ada jadwal → meeting terbukti hadir → GP disusun →
 * GP disetujui. Progres yang diketik sendiri selalu berakhir optimistis;
 * progres yang dibaca dari jejak tidak bisa.
 */
export function tahapProyek(p: ProyekRingkasan): { tahap: number; total: number; label: string } {
  const tahapan = [
    { lolos: p.jumlah_pipeline > 0,  label: 'Pipeline dicatat' },
    { lolos: p.jumlah_jadwal > 0,    label: 'Jadwal dibuat' },
    { lolos: p.meeting_selesai > 0 || (p.jumlah_meeting === 0 && p.jadwal_selesai > 0),
      label: 'Kunjungan terbukti' },
    { lolos: p.jumlah_gp > 0,        label: 'GP disusun' },
    { lolos: p.gp_disetujui > 0,     label: 'GP disetujui' },
  ];

  // Dihitung sebagai tahapan BERURUTAN yang sudah lolos, bukan jumlah centang.
  // Proyek yang punya GP tapi belum punya satu pun jadwal bukan proyek yang
  // "80% jalan" — ia proyek yang catatannya bolong, dan menampilkannya sebagai
  // hampir selesai justru menyembunyikan hal yang perlu dilihat.
  let tahap = 0;
  for (const t of tahapan) {
    if (!t.lolos) break;
    tahap += 1;
  }

  return {
    tahap,
    total: tahapan.length,
    label: tahap === 0 ? 'Belum ada catatan' : tahapan[tahap - 1].label,
  };
}
