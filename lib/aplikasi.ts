'use client';

/**
 * lib/aplikasi.ts — sisi web dari aplikasi Android (android/).
 *
 * Di dalam APK, halaman web ini berjalan di WebView yang menyediakan
 * window.SMPAndroid (android/.../JembatanWeb.java). Kemampuan native yang
 * dipakai:
 *   • mintaLokasi — lokasi check-in dibaca langsung dari Android, lengkap
 *     dengan penanda "lokasi tiruan" (fake GPS) yang tidak pernah sampai ke
 *     browser, dan ditandatangani supaya server bisa memverifikasinya
 *     (sm_verifikasi_aplikasi, migrasi 039);
 *   • simpanBerkas — ekspor Excel disimpan ke folder Download (WebView tidak
 *     bisa mengunduh blob seperti browser).
 *
 * Di luar APK semua fungsi di sini mundur dengan tenang: halaman tetap
 * berjalan seperti versi web biasa.
 */

interface JembatanAndroid {
  versi(): string;
  kodeVersi(): number;
  mintaLokasi(idPermintaan: string, idJadwal: string): void;
  simpanBerkas(base64: string, nama: string, mime: string): void;
}

export interface LokasiNative {
  ok: true;
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  waktu: string;
  sampel: { lat: number; lng: number; accuracy: number; t: number }[];
  durasi_ms: number;
  mock: boolean;
  native: { payload: string; tanda: string; versi: string; mock: boolean };
}

type HasilNative = LokasiNative | { ok: false; galat: string };

declare global {
  interface Window {
    SMPAndroid?: JembatanAndroid;
    __smpLokasi?: (id: string, hasil: HasilNative) => void;
  }
}

function jembatan(): JembatanAndroid | null {
  return typeof window !== 'undefined' && window.SMPAndroid ? window.SMPAndroid : null;
}

/** Sedang berjalan di dalam aplikasi Android. */
export function diAplikasiAndroid(): boolean {
  return jembatan() !== null;
}

/** HP Android yang membuka lewat browser — calon pengguna aplikasi. */
export function diBrowserAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && !diAplikasiAndroid();
}

export function versiAplikasi(): string | null {
  try { return jembatan()?.versi() ?? null; } catch { return null; }
}

/** -1 bila a < b, 0 bila sama, 1 bila a > b (format 1.2.3). */
export function bandingVersi(a: string, b: string): number {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const penunggu = new Map<string, (h: HasilNative) => void>();

/** Minta lokasi check-in dari Android. Menolak dengan pesan yang bisa ditampilkan. */
export function bacaLokasiNative(idJadwal: string, batasMs = 35_000): Promise<LokasiNative> {
  const j = jembatan();
  if (!j) return Promise.reject(new Error('Aplikasi Android tidak terdeteksi.'));

  if (!window.__smpLokasi) {
    window.__smpLokasi = (id, hasil) => {
      const f = penunggu.get(id);
      if (f) { penunggu.delete(id); f(hasil); }
    };
  }

  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jam = setTimeout(() => {
      penunggu.delete(id);
      reject(new Error('Lokasi belum bisa dibaca. Pastikan GPS menyala dan Anda berada di tempat terbuka.'));
    }, batasMs);
    penunggu.set(id, (h) => {
      clearTimeout(jam);
      if (h.ok) resolve(h);
      else reject(new Error(h.galat));
    });
    j.mintaLokasi(id, idJadwal);
  });
}

/** Simpan blob lewat aplikasi Android. Mengembalikan false bila bukan di APK. */
export async function simpanBlobNative(blob: Blob, nama: string): Promise<boolean> {
  const j = jembatan();
  if (!j) return false;
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  j.simpanBerkas(base64, nama, blob.type || 'application/octet-stream');
  return true;
}
