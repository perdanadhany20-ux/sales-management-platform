// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import Link from 'next/link';
import { usePenggunaAktif } from '@/lib/auth';
import { isAdmin } from '@/lib/constants';
import type { JenisImpor } from '@/lib/impor-data';

/** Kunci sessionStorage: jenis data yang langsung dipilih saat Impor Data dibuka. */
export const KUNCI_JENIS_IMPOR = 'sm:impor-jenis';

/** Tombol "Impor Excel" di samping Ekspor — hanya untuk Admin, karena
 *  impor menulis data atas nama Sales lain. */
export function TombolImpor({ jenis }: { jenis: JenisImpor }) {
  const { pengguna } = usePenggunaAktif();
  if (!isAdmin(pengguna?.role)) return null;
  return (
    <Link
      href="/admin?bagian=impor"
      onClick={() => { try { sessionStorage.setItem(KUNCI_JENIS_IMPOR, jenis); } catch { /* mode privat */ } }}
      className="inline-flex items-center gap-1.5 rounded-kontrol border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 hover:bg-slate-50 transition-colors"
    >
      ⬆ Impor Excel
    </Link>
  );
}
