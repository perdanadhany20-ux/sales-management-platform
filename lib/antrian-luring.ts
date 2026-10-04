// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { supabase } from './supabase';
import { pastikanCustomer } from '@/components/shared/PilihCustomer';

/**
 * lib/antrian-luring.ts — Daily Report yang dibuat tanpa sinyal.
 *
 * Laporan BARU yang gagal terkirim karena jaringan disimpan di perangkat ini
 * (per pengguna) lalu dikirim otomatis saat online kembali. Setiap laporan
 * membawa id yang dibuat di perangkat, jadi pengiriman ulang setelah
 * terputus di tengah jalan tidak pernah menggandakan laporan (duplikat id
 * dianggap sudah terkirim).
 *
 * Yang sengaja TIDAK diantrikan: check-in meeting & foto bukti. Verifikasi
 * lokasinya menuntut waktu server yang nyata; laporan lokasi yang dikirim
 * berjam-jam kemudian memang harus ditolak.
 */

export interface IsiLaporan {
  report_date: string;
  customer_id: string | null;
  customer_name: string;
  contact_person: string | null;
  position: string | null;
  phone_whatsapp: string | null;
  activity: string;
  lead_project: string | null;
  project_id: string | null;
  result: string;
  next_action: string;
}

interface Antre { id: string; dibuat: string; isi: IsiLaporan }

export const PERISTIWA_ANTRIAN = 'smp:antrian-luring';
const kunci = (userId: string) => `smp_antrian_laporan:${userId}`;

function baca(userId: string): Antre[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(kunci(userId)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function tulis(userId: string, daftar: Antre[]): boolean {
  try {
    if (daftar.length) window.localStorage.setItem(kunci(userId), JSON.stringify(daftar));
    else window.localStorage.removeItem(kunci(userId));
    window.dispatchEvent(new Event(PERISTIWA_ANTRIAN));
    return true;
  } catch {
    return false;
  }
}

export function jumlahAntrian(userId: string | undefined): number {
  return userId && typeof window !== 'undefined' ? baca(userId).length : 0;
}

/** Galat yang berarti "tidak ada jaringan", bukan ditolak server. */
export function galatJaringan(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const pesan = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? String(e ?? '');
  return /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed/i.test(pesan);
}

/** Simpan ke antrian. false = penyimpanan perangkat diblokir/penuh. */
export function antrikanLaporan(userId: string, isi: IsiLaporan): boolean {
  const daftar = baca(userId);
  if (daftar.length >= 50) return false;
  daftar.push({ id: crypto.randomUUID(), dibuat: new Date().toISOString(), isi });
  return tulis(userId, daftar);
}

let berjalan = false;

/**
 * Kirim semua antrian milik pengguna ini. Berhenti di galat jaringan pertama
 * (sisa tetap tersimpan). Laporan yang DITOLAK server (mis. lisensi/hak)
 * dikembalikan di `ditolak` dan dihapus dari antrian agar tidak berulang.
 */
export async function kirimAntrian(userId: string): Promise<{ terkirim: number; ditolak: string[]; sisa: number }> {
  if (berjalan) return { terkirim: 0, ditolak: [], sisa: jumlahAntrian(userId) };
  berjalan = true;
  let terkirim = 0;
  const ditolak: string[] = [];
  try {
    for (const a of baca(userId)) {
      try {
        const customerId = await pastikanCustomer(a.isi.customer_name, a.isi.customer_id);
        const { error } = await supabase.from('sm_daily_reports')
          .insert({ ...a.isi, customer_id: customerId, id: a.id, sales_user_id: userId });
        if (error && galatJaringan(error)) break;
        if (error && error.code !== '23505') ditolak.push(`${a.isi.report_date} · ${a.isi.customer_name}: ${error.message}`);
        else terkirim++;
      } catch (e) {
        if (galatJaringan(e)) break;
        ditolak.push(`${a.isi.report_date} · ${a.isi.customer_name}`);
      }
      tulis(userId, baca(userId).filter((x) => x.id !== a.id));
    }
  } finally {
    berjalan = false;
  }
  return { terkirim, ditolak, sisa: jumlahAntrian(userId) };
}
