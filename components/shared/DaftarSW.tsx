// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect } from 'react';

/** Pasang service worker (public/sw.js) — hanya di produksi, supaya `next dev` tidak tersangkut cache. */
export function DaftarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA opsional; aplikasi tetap jalan */ });
  }, []);
  return null;
}
