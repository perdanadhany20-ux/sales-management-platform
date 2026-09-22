/**
 * lib/gp.ts — tipe, label, dan aturan tampilan GP Calculation.
 *
 * TIDAK ada satu pun perhitungan di berkas ini, dan itu disengaja. Seluruh
 * angka — DPP, PPN, Pph, net amount received, total costing, net profit, dan
 * net margin — dihitung view `sm_gp_ringkasan` di database (migrasi 016).
 *
 * Alasannya sama seperti GP pada Pipeline: angka yang dihitung ulang di
 * browser adalah angka kedua, dan angka kedua pada akhirnya selalu berbeda
 * dari yang pertama — entah karena pembulatan, entah karena salah satu sisi
 * lupa diperbarui. Yang boleh berbeda antara layar Sales dan layar Director
 * hanya tata letaknya, bukan angkanya.
 */

import type { GayaStatus } from './constants';

export type StatusGp =
  | 'DRAFT' | 'DIAJUKAN' | 'DIPERIKSA' | 'DISETUJUI' | 'DIVERIFIKASI' | 'DITOLAK';

export const STATUS_GP: Record<StatusGp, GayaStatus> = {
  DRAFT:        { label: 'Draft',            color: '#64748b', bg: '#f1f5f9' },
  DIAJUKAN:     { label: 'Menunggu Manager', color: '#eda100', bg: '#fef3d9' },
  DIPERIKSA:    { label: 'Menunggu Director', color: '#2a78d6', bg: '#e3edfb' },
  DISETUJUI:    { label: 'Menunggu Finance', color: '#0891b2', bg: '#e0f2fe' },
  DIVERIFIKASI: { label: 'Selesai',          color: '#008300', bg: '#e0f2e0' },
  DITOLAK:      { label: 'Ditolak',          color: '#e34948', bg: '#fce3e3' },
};

/**
 * Mutu margin — rumus IF bertingkat pada berkas GP asli.
 *
 * "DIRECTOR APPROVAL" di sini BUKAN status persetujuan, melainkan peringatan
 * mutu: marginnya lebih dari 5 poin di bawah target, jadi seharusnya tidak
 * lolos tanpa Director benar-benar melihatnya. Dibedakan warnanya supaya tidak
 * tertukar dengan status dokumen.
 */
export const MUTU_MARGIN: Record<string, GayaStatus> = {
  EXCEPTIONAL:         { label: 'Exceptional',       color: '#008300', bg: '#e0f2e0' },
  EXCELLENT:           { label: 'Excellent',         color: '#0891b2', bg: '#e0f2fe' },
  GOOD:                { label: 'Good',              color: '#2a78d6', bg: '#e3edfb' },
  REVIEW:              { label: 'Perlu Ditinjau',    color: '#eda100', bg: '#fef3d9' },
  'DIRECTOR APPROVAL': { label: 'Di Bawah Target',   color: '#e34948', bg: '#fce3e3' },
  'TANPA NILAI':       { label: 'Belum Ada Item',    color: '#94a3b8', bg: '#f1f5f9' },
};

/** Langkah rantai tanda tangan, mengikuti blok APPROVAL pada berkas asli. */
export const LANGKAH_GP = [
  { status: 'DIAJUKAN',     peran: 'Sales',         label: 'Prepared By' },
  { status: 'DIPERIKSA',    peran: 'Manager Sales', label: 'Checked By' },
  { status: 'DISETUJUI',    peran: 'Director',      label: 'Approved By' },
  { status: 'DIVERIFIKASI', peran: 'Finance',       label: 'Verified By' },
] as const;

export interface GpItem {
  id: string;
  calculation_id: string;
  urutan: number;
  description: string;
  qty: number;
  vendor: string | null;
  unit_price: number;
  unit_cost: number;
  /** Kolom GENERATED — dibaca saja, jangan pernah dikirim saat menyimpan. */
  selling_total: number;
  costing_total: number;
  gp_amount: number;
  gp_percentage: number;
}

export interface GpDokumen {
  id: string;
  nomor: string;
  sales_user_id: string;
  /** Tautan ke sm_projects (migrasi 018). Nullable dengan sengaja: dokumen GP
   *  proyek lama boleh berdiri tanpa baris proyek terdaftar. */
  project_id: string | null;
  pipeline_id: string | null;
  customer_id: string | null;
  customer_name: string;
  project_name: string;
  po_spk_no: string | null;
  calc_date: string;
  payment_term: string | null;
  lead_time: string | null;
  ppn_rate: number;
  pph_rate: number;
  gp_target: number;
  installation_cost: number;
  shipping_cost: number;
  operational_cost: number;
  other_cost: number;
  disbursement_cost: number;
  wapu: boolean;
  currency: string;
  notes: string | null;
  status: string;
  submitted_at: string | null;
  checked_by: string | null;
  checked_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

/** Baris view sm_gp_ringkasan: dokumen + seluruh angka turunannya. */
export interface GpRingkasan extends GpDokumen {
  total_qty: number;
  total_selling: number;
  total_material: number;
  gross_profit: number;
  dpp: number;
  ppn_amount: number;
  pph_amount: number;
  net_amount_received: number;
  total_costing: number;
  net_profit: number;
  net_margin: number;
  mutu_margin: string;
  jumlah_item: number;
}

/**
 * Siapa yang ditunggu dokumen ini sekarang.
 *
 * Dipakai untuk memberi tahu pemakainya apakah tombol setujui pantas muncul.
 * Yang MENOLAK sungguhan tetap sm_gp_setujui() di database — fungsi ini hanya
 * mencegah tombol yang pasti gagal ikut tampil.
 */
export function menungguPeran(status: string): string | null {
  if (status === 'DIAJUKAN') return 'MANAGER';
  if (status === 'DIPERIKSA') return 'DIRECTOR';
  if (status === 'DISETUJUI') return 'FINANCE';
  return null;
}

export function bolehMenyetujui(status: string, peran: string | null | undefined): boolean {
  const butuh = menungguPeran(status);
  if (!butuh) return false;
  const p = (peran ?? '').toUpperCase();
  // Admin diizinkan di setiap langkah bukan karena ia atasan semua orang,
  // melainkan supaya rantai tidak macet total saat Director atau Finance belum
  // punya akun. Tindakannya tetap tercatat atas namanya di audit_trail.
  return p === butuh || p === 'ADMIN';
}
