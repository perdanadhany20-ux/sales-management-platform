'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

/**
 * lib/navigasi-muat.ts — "sedang memuat" saat pindah menu.
 *
 * Halaman-halaman di sini adalah komponen klien yang baru mengambil datanya
 * setelah tampil. Tanpa penanda, pindah menu terasa tidak merespons, lalu
 * kartu KPI sempat menunjukkan angka nol sebelum data tiba. Penandanya
 * bertahan sampai (1) URL sudah berganti dan (2) seluruh permintaan jaringan
 * halaman baru selesai — bukan sekadar sampai URL berganti.
 */

let berjalan = 0;
let navigasi: { mulai: number; tungguRute: string | null } | null = null;
const pendengar = new Set<() => void>();
const kabari = () => pendengar.forEach((f) => f());

let terpasang = false;
/** Menghitung setiap fetch yang sedang berjalan (data Supabase, /api, RSC). */
export function pasangPenghitungFetch() {
  if (terpasang || typeof window === 'undefined') return;
  terpasang = true;
  const asli = window.fetch.bind(window);
  window.fetch = async (...args) => {
    berjalan++; kabari();
    try {
      return await asli(...args);
    } finally {
      berjalan = Math.max(0, berjalan - 1); kabari();
    }
  };
}

/** Dipanggil saat menu diklik. `ruteTujuan` null untuk pindah tab tanpa ganti URL. */
export function mulaiNavigasi(ruteTujuan: string | null) {
  navigasi = { mulai: Date.now(), tungguRute: ruteTujuan };
  kabari();
}

function selesaiNavigasi() {
  navigasi = null;
  kabari();
}

const langganan = (f: () => void) => { pendengar.add(f); return () => { pendengar.delete(f); }; };
const potret = () => `${navigasi ? navigasi.mulai : 0}|${navigasi?.tungguRute ?? ''}|${berjalan}`;

/** true selama pindah menu belum tuntas termasuk pemuatan datanya. */
export function useSedangNavigasi(): boolean {
  const kondisi = useSyncExternalStore(langganan, potret, () => '0||0');
  const pathname = usePathname();
  const [menunggu, setMenunggu] = useState(false);

  useEffect(() => {
    if (!navigasi) { setMenunggu(false); return; }
    setMenunggu(true);

    const ruteSudah = !navigasi.tungguRute || pathname === navigasi.tungguRute;
    // Jeda singkat setelah permintaan terakhir: halaman baru biasanya memulai
    // query-nya satu render sesudah tampil, dan tanpa jeda ini penanda sempat
    // padam di celah itu lalu data masih kosong.
    const t = setTimeout(() => {
      if (ruteSudah && berjalan === 0) selesaiNavigasi();
    }, 300);
    // Jaring pengaman: jangan pernah mengunci layar lebih dari 15 detik.
    const batas = setTimeout(selesaiNavigasi, Math.max(0, 15_000 - (Date.now() - navigasi.mulai)));
    return () => { clearTimeout(t); clearTimeout(batas); };
  }, [kondisi, pathname]);

  return menunggu;
}

/** Klik tautan internal mana pun (sidebar, bilah bawah, kartu) memulai penanda. */
export function usePantauKlikTautan() {
  const pathname = usePathname();
  useEffect(() => {
    const onKlik = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === pathname) return;
      mulaiNavigasi(url.pathname);
    };
    // Fase capture: <Link> Next.js memanggil preventDefault() di handler
    // React-nya, jadi pada fase bubble klik tautan selalu tampak "dibatalkan".
    document.addEventListener('click', onKlik, true);
    return () => document.removeEventListener('click', onKlik, true);
  }, [pathname]);
}
