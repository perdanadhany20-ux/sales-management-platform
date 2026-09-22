'use client';

/**
 * lib/gps.ts — pembacaan lokasi di browser.
 *
 * Berkas ini HANYA membaca dan melaporkan. Ia tidak menghitung jarak, tidak
 * membandingkan dengan radius, dan tidak pernah menyimpulkan sah/tidak sah —
 * semua itu diputuskan sm_check_in() di database (§29). Kalau suatu saat ada
 * yang tergoda menambahkan pemeriksaan radius di sini "supaya lebih cepat",
 * ingat bahwa apa pun yang diputuskan di browser bisa diubah pemakainya.
 */

export interface Koordinat {
  lat: number;
  lng: number;
  accuracy: number;
}

export class GpsError extends Error {
  constructor(message: string, readonly kode: 'TIDAK_DIDUKUNG' | 'DITOLAK' | 'GAGAL') {
    super(message);
    this.name = 'GpsError';
  }
}

export function ambilLokasi(timeoutMs = 15000): Promise<Koordinat> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GpsError('Perangkat ini tidak mendukung GPS.', 'TIDAK_DIDUKUNG'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GpsError(
            'Izin lokasi ditolak. Aktifkan akses lokasi untuk aplikasi ini di pengaturan browser, lalu coba lagi.',
            'DITOLAK',
          ));
          return;
        }
        reject(new GpsError(
          'Lokasi belum bisa dibaca. Pastikan GPS menyala dan Anda berada di tempat terbuka.',
          'GAGAL',
        ));
      },
      // enableHighAccuracy meminta GPS sungguhan, bukan perkiraan dari menara
      // seluler atau wifi. maximumAge 0 melarang browser menyodorkan posisi
      // yang sudah ia simpan sebelumnya — tanpa ini, bukti kehadiran bisa
      // memakai lokasi dari beberapa menit lalu, dari tempat yang berbeda.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** Peta statis OpenStreetMap; tanpa API key dan tanpa dependensi tambahan. */
export function urlPetaKecil(lat: number, lng: number): string {
  const d = 0.004;
  const bbox = `${lng - d},${lat - d * 0.7},${lng + d},${lat + d * 0.7}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
