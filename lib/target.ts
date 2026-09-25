import { supabase } from './supabase';
import { tanggalISO } from './format';

/**
 * lib/target.ts — target penjualan per Sales (migrasi 031).
 *
 * Target disimpan per bulan; kuartal dan tahun adalah jumlah target
 * bulanannya. Realisasi = pipeline WON berdasarkan tanggal WON-nya.
 */

export type JenisPeriode = 'bulan' | 'kuartal' | 'tahun';
export type Ukuran = 'nilai' | 'gp';

export interface Pencapaian {
  sales_user_id: string;
  full_name: string;
  target_nilai: number;
  target_gp: number | null;
  realisasi_nilai: number;
  realisasi_gp: number;
  jumlah_won: number;
}

export const LABEL_PERIODE: Record<JenisPeriode, string> = {
  bulan: 'Bulan Ini', kuartal: 'Kuartal Ini', tahun: 'Tahun Ini',
};

/** Rentang tanggal periode yang memuat `acuan`. */
export function rentangPeriode(jenis: JenisPeriode, acuan = new Date()): { dari: string; sampai: string; label: string } {
  const th = acuan.getFullYear();
  const bl = acuan.getMonth();
  const awalBulan = jenis === 'bulan' ? bl : jenis === 'kuartal' ? Math.floor(bl / 3) * 3 : 0;
  const jumlahBulan = jenis === 'bulan' ? 1 : jenis === 'kuartal' ? 3 : 12;
  const dari = new Date(th, awalBulan, 1);
  const sampai = new Date(th, awalBulan + jumlahBulan, 0);
  const namaBulan = (d: Date) => d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const label = jenis === 'bulan' ? namaBulan(dari)
    : jenis === 'kuartal' ? `Kuartal ${Math.floor(bl / 3) + 1} ${th}`
    : `Tahun ${th}`;
  return { dari: tanggalISO(dari), sampai: tanggalISO(sampai), label };
}

export async function ambilPencapaian(dari: string, sampai: string): Promise<Pencapaian[]> {
  const { data, error } = await supabase.rpc('sm_pencapaian_target', { p_dari: dari, p_sampai: sampai });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Pencapaian[]).map((r) => ({
    ...r,
    target_nilai: Number(r.target_nilai) || 0,
    target_gp: r.target_gp === null ? null : Number(r.target_gp),
    realisasi_nilai: Number(r.realisasi_nilai) || 0,
    realisasi_gp: Number(r.realisasi_gp) || 0,
  }));
}

export function ambilUkuran(p: Pencapaian, ukuran: Ukuran): { target: number; realisasi: number } {
  return ukuran === 'nilai'
    ? { target: p.target_nilai, realisasi: p.realisasi_nilai }
    : { target: p.target_gp ?? 0, realisasi: p.realisasi_gp };
}
