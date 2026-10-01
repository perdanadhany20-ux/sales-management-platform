// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import type { MetadataRoute } from 'next';

/**
 * Manifest PWA — dasar aplikasi Android (TWA, lihat android/README.md) dan
 * "Tambahkan ke layar utama" di iOS/Android. Aplikasi Android hanyalah
 * jendela penuh ke situs ini, jadi setiap pembaruan web (termasuk perubahan
 * lisensi dan fitur) langsung berlaku di APK tanpa rilis ulang.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Sales Management Platform',
    short_name: 'Sales MP',
    description: 'Daily Report, Pipeline, Schedule, dan Meeting dengan verifikasi GPS.',
    start_url: '/?sumber=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1d4ed8',
    lang: 'id',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
