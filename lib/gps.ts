'use client';

/**
 * lib/gps.ts — pembacaan lokasi di browser.
 *
 * Berkas ini HANYA membaca dan melaporkan. Ia tidak menghitung jarak, tidak
 * membandingkan dengan radius, tidak menilai sah/tidak sah, dan tidak pernah
 * menyimpulkan sendiri bahwa sebuah lokasi palsu — semua itu diputuskan
 * sm_check_in() di database (§29, migrasi 032). Kalau suatu saat ada yang
 * tergoda menambahkan pemeriksaan di sini "supaya lebih cepat", ingat bahwa
 * apa pun yang diputuskan di browser bisa diubah pemakainya.
 *
 * Yang dikerjakan berkas ini untuk melawan fake GPS hanya satu: MENGUMPULKAN
 * BAHAN MENTAH yang cukup supaya database punya sesuatu untuk dinilai —
 * beberapa sampel berurutan (bukan satu), ketinggian, kecepatan, arah, jam
 * perangkat, dan hasil pemeriksaan apakah Geolocation API-nya masih asli.
 * Penjelasan lengkap tentang apa yang bisa dan tidak bisa dideteksi dari
 * peramban ada di kepala berkas migrasi 032.
 */

export interface Koordinat {
  lat: number;
  lng: number;
  accuracy: number;
}

/** Satu pembacaan mentah. Dikirim apa adanya ke database untuk dinilai. */
export interface Sampel {
  lat: number;
  lng: number;
  accuracy: number;
  t: number;
}

/**
 * Hasil pemeriksaan di sisi klien. Perhatikan: isinya bisa dikarang oleh
 * pemakai yang benar-benar berniat memalsukan. Nilainya tetap ada karena
 * pemalsu termurah — ekstensi peramban dan aplikasi mock location dari toko
 * aplikasi — tidak menambal isi laporan ini. Database memperlakukan laporan
 * yang HILANG sebagai mencurigakan, bukan sebagai lulus.
 */
export interface SinyalKlien {
  /** Geolocation API masih fungsi bawaan peramban, belum ditimpa. */
  api_asli: boolean;
  /** Objek posisi benar-benar dari peramban, bukan objek JavaScript biasa. */
  objek_asli: boolean;
  /** Perangkat punya layar sentuh — kehadiran lapangan semestinya dari ponsel. */
  sentuh: boolean;
  /** Selisih jam perangkat terhadap waktu pembacaan (ms). */
  selisih_jam_ms: number;
  jumlah_sampel: number;
  /** Rentang waktu pengumpulan sampel (ms). */
  durasi_ms: number;
}

export interface BacaanKehadiran extends Koordinat {
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** Jam perangkat saat pembacaan diambil, ISO. */
  waktu: string;
  sampel: Sampel[];
  sinyal: SinyalKlien;
}

export class GpsError extends Error {
  constructor(message: string, readonly kode: 'TIDAK_DIDUKUNG' | 'DITOLAK' | 'GAGAL') {
    super(message);
    this.name = 'GpsError';
  }
}

function galatDari(err: GeolocationPositionError): GpsError {
  if (err.code === err.PERMISSION_DENIED) {
    return new GpsError(
      'Izin lokasi ditolak. Aktifkan akses lokasi untuk aplikasi ini di pengaturan browser, lalu coba lagi.',
      'DITOLAK',
    );
  }
  return new GpsError(
    'Lokasi belum bisa dibaca. Pastikan GPS menyala dan Anda berada di tempat terbuka.',
    'GAGAL',
  );
}

// enableHighAccuracy meminta GPS sungguhan, bukan perkiraan dari menara
// seluler atau wifi. maximumAge 0 melarang browser menyodorkan posisi yang
// sudah ia simpan sebelumnya — tanpa ini, bukti kehadiran bisa memakai lokasi
// dari beberapa menit lalu, dari tempat yang berbeda.
const OPSI: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

/**
 * Pembacaan tunggal. Dipakai di tempat yang bukan bukti kehadiran — misalnya
 * admin menandai koordinat sebuah lokasi, di mana ia memang sedang berdiri di
 * sana dan tidak ada yang perlu dicurigai.
 */
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
      (err) => reject(galatDari(err)),
      { ...OPSI, timeout: timeoutMs },
    );
  });
}

/**
 * Apakah Geolocation API masih milik peramban.
 *
 * Fungsi bawaan peramban selalu melaporkan dirinya sebagai `[native code]`
 * kalau di-toString. Ekstensi pemalsu lokasi dan potongan kode di konsol
 * devtools menggantinya dengan fungsi JavaScript biasa, yang isi tubuhnya
 * terbaca apa adanya — itulah yang tertangkap di sini.
 *
 * Diperiksa juga bahwa metodenya masih diwarisi dari Geolocation.prototype,
 * bukan properti yang ditempelkan langsung ke objek geolocation. Di seluruh
 * peramban arus utama metode itu memang tidak pernah menjadi properti sendiri,
 * jadi kalau ia menjadi properti sendiri, ada yang menempelkannya.
 */
function apiAsli(): boolean {
  try {
    const g = navigator.geolocation;
    const bawaan = (f: unknown) =>
      typeof f === 'function' &&
      /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(f));

    if (!bawaan(g.getCurrentPosition) || !bawaan(g.watchPosition)) return false;
    if (Object.prototype.hasOwnProperty.call(g, 'getCurrentPosition')) return false;
    if (Object.prototype.hasOwnProperty.call(g, 'watchPosition')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Apakah objek posisinya benar-benar dari peramban.
 *
 * Objek asli punya tag kelas sendiri — '[object GeolocationCoordinates]', atau
 * '[object Coordinates]' di peramban lama. Pemalsu yang menyodorkan objek
 * JavaScript biasa menghasilkan '[object Object]', dan hanya itu yang ditolak
 * di sini. Sengaja dibuat sesempit itu supaya tidak ada peramban jujur yang
 * ikut tertuduh hanya karena nama tag-nya berbeda.
 */
function objekAsli(pos: GeolocationPosition): boolean {
  try {
    return Object.prototype.toString.call(pos.coords) !== '[object Object]';
  } catch {
    return false;
  }
}

function perangkatSentuh(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
}

/**
 * Pembacaan untuk bukti kehadiran.
 *
 * Mengumpulkan beberapa sampel selama beberapa detik, bukan satu tembakan.
 * Inilah bahan terpenting bagi penilaian di database: sinyal satelit sungguhan
 * selalu bergoyang antar sampel, sedangkan lokasi buatan mengembalikan angka
 * yang sama persis setiap kali. Tanpa beberapa sampel, goyangan itu tidak ada
 * yang bisa diukur.
 *
 * Yang dikembalikan sebagai koordinat utama adalah sampel dengan akurasi
 * terbaik — bukan yang pertama, karena pembacaan pertama biasanya masih hasil
 * perkiraan wifi sebelum satelitnya terkunci.
 */
export function ambilLokasiKehadiran(
  { minSampel = 3, maksSampel = 6, durasiMs = 6000 } = {},
): Promise<BacaanKehadiran> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GpsError('Perangkat ini tidak mendukung GPS.', 'TIDAK_DIDUKUNG'));
      return;
    }

    // Diperiksa sebelum pembacaan dimulai: kalau API-nya sudah ditimpa, hasil
    // pembacaan apa pun sesudah ini tidak bisa dipercaya.
    const apiMasihAsli = apiAsli();

    const mulai = Date.now();
    const sampel: Sampel[] = [];
    let terbaik: GeolocationPosition | null = null;
    let objekMasihAsli = true;
    let selesai = false;
    let jamTimeout: ReturnType<typeof setTimeout>;
    let idPantau: number;

    function tutup() {
      if (selesai) return;
      selesai = true;
      clearTimeout(jamTimeout);
      try { navigator.geolocation.clearWatch(idPantau); } catch { /* tidak apa-apa */ }
    }

    function beres() {
      tutup();
      if (!terbaik) {
        reject(new GpsError(
          'Lokasi belum bisa dibaca. Pastikan GPS menyala dan Anda berada di tempat terbuka.',
          'GAGAL',
        ));
        return;
      }
      const c = terbaik.coords;
      resolve({
        lat: c.latitude,
        lng: c.longitude,
        accuracy: c.accuracy,
        altitude: c.altitude ?? null,
        altitudeAccuracy: c.altitudeAccuracy ?? null,
        speed: c.speed ?? null,
        heading: c.heading ?? null,
        waktu: new Date(terbaik.timestamp).toISOString(),
        sampel,
        sinyal: {
          api_asli: apiMasihAsli,
          objek_asli: objekMasihAsli,
          sentuh: perangkatSentuh(),
          selisih_jam_ms: Date.now() - terbaik.timestamp,
          jumlah_sampel: sampel.length,
          durasi_ms: Date.now() - mulai,
        },
      });
    }

    idPantau = navigator.geolocation.watchPosition(
      (pos) => {
        if (selesai) return;
        if (!objekAsli(pos)) objekMasihAsli = false;

        sampel.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          t: pos.timestamp,
        });
        if (!terbaik || pos.coords.accuracy < terbaik.coords.accuracy) terbaik = pos;

        // Cukup sampelnya DAN waktunya sudah lewat: keduanya, bukan salah satu.
        // Enam sampel dalam 200 ms tidak membuktikan apa pun tentang goyangan —
        // yang dinilai database adalah pergeseran sepanjang waktu.
        if (sampel.length >= maksSampel || (sampel.length >= minSampel && Date.now() - mulai >= durasiMs)) {
          beres();
        }
      },
      (err) => {
        // Kalau sudah ada sampel, kegagalan di tengah jalan tidak membatalkan
        // apa pun — lebih baik melaporkan yang sudah terkumpul daripada
        // memaksa pemakainya mengulang dari nol di tempat yang sinyalnya tipis.
        if (sampel.length > 0) { beres(); return; }
        tutup();
        reject(galatDari(err));
      },
      OPSI,
    );

    // Batas waktu keseluruhan. Ditambah OPSI.timeout supaya pembacaan pertama
    // yang lambat tidak dipotong sebelum peramban sendiri menyerah.
    jamTimeout = setTimeout(beres, durasiMs + OPSI.timeout!);
  });
}

/** Peta statis OpenStreetMap; tanpa API key dan tanpa dependensi tambahan. */
export function urlPetaKecil(lat: number, lng: number): string {
  const d = 0.004;
  const bbox = `${lng - d},${lat - d * 0.7},${lng + d},${lat + d * 0.7}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
