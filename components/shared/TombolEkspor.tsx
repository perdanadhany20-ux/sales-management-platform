'use client';

import { useState } from 'react';
import { eksporExcel, BATAS_BARIS_EKSPOR, type OpsiEkspor } from '@/lib/ekspor-excel';
import { useToast } from './Feedback';

/**
 * components/shared/TombolEkspor.tsx — satu tombol ekspor untuk semua modul.
 *
 * Yang diekspor adalah SELURUH baris yang cocok dengan penyaring saat ini,
 * bukan halaman yang sedang terlihat. Mengekspor 20 baris dari halaman 1
 * padahal penyaringnya mencakup 300 baris adalah jebakan diam: berkasnya
 * terbuka normal, angkanya salah, dan tidak ada yang menyadarinya sampai
 * rekapnya dipakai mengambil keputusan.
 *
 * Karena itu `ambil` di sini mengambil data sendiri ke database, terpisah dari
 * daftar yang sudah dimuat halaman.
 */
export function TombolEkspor<T>({ ambil, susun, label = 'Ekspor Excel', className = '' }: {
  /** Ambil seluruh baris sesuai penyaring aktif (tanpa paginasi). */
  ambil: () => Promise<T[]>;
  /** Susun baris itu menjadi berkas. */
  susun: (baris: T[]) => OpsiEkspor<T>;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [sibuk, setSibuk] = useState(false);

  async function jalankan() {
    setSibuk(true);
    try {
      const baris = await ambil();

      if (baris.length === 0) {
        toast('info', 'Tidak ada data untuk diekspor pada penyaring ini.');
        return;
      }

      const dipotong = baris.length > BATAS_BARIS_EKSPOR;
      const dipakai = dipotong ? baris.slice(0, BATAS_BARIS_EKSPOR) : baris;

      await eksporExcel(susun(dipakai));

      if (dipotong) {
        // Diberitahukan, bukan didiamkan: berkas yang diam-diam terpotong
        // adalah berkas yang salah tanpa ada yang tahu.
        toast('info',
          `Berkas dibatasi ${BATAS_BARIS_EKSPOR} baris pertama dari ${baris.length}. Persempit rentang tanggalnya untuk data selengkapnya.`);
      } else {
        toast('sukses', `${baris.length} baris diekspor.`);
      }
    } catch (e) {
      toast('galat', e instanceof Error ? e.message : 'Gagal membuat berkas Excel.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <button
      type="button"
      onClick={jalankan}
      disabled={sibuk}
      className={`inline-flex items-center gap-1.5 rounded-kontrol border border-slate-300 bg-white
                  px-3.5 py-2 text-[12px] font-semibold text-slate-700 transition-colors
                  hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <span aria-hidden="true">{sibuk ? '⏳' : '⬇'}</span>
      {sibuk ? 'Menyiapkan…' : label}
    </button>
  );
}
