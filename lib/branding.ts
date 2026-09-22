'use client';

import { useEffect, useState } from 'react';

/**
 * lib/branding.ts — identitas visual platform.
 *
 * Dibaca lewat /api/branding, BUKAN langsung dari sm_settings. Alasannya:
 * halaman masuk harus menampilkan logo dan nama sebelum siapa pun punya sesi,
 * sedangkan policy `settings_baca` hanya melayani peran `authenticated`.
 * Route handler-nya membaca satu baris saja dengan service role dan
 * mengembalikan nilai yang memang untuk dilihat umum.
 */

export interface Branding {
  nama_platform: string;
  nama_pendek: string;
  nama_portal: string;
  nama_perusahaan: string;
  kredit: string;
  kontak_bantuan: string;
  warna_utama: string;
  warna_utama_2: string;
  warna_aksen: string;
  logo_url: string;
  latar_login_url: string;
  latar_dashboard_url: string;
}

export const BRANDING_BAWAAN: Branding = {
  nama_platform: 'Sales Management Platform',
  nama_pendek: 'Sales MP',
  nama_portal: '',
  nama_perusahaan: '',
  kredit: '',
  kontak_bantuan: '',
  warna_utama: '#1d4ed8',
  warna_utama_2: '#1e40af',
  warna_aksen: '#eda100',
  logo_url: '',
  latar_login_url: '',
  latar_dashboard_url: '',
};

/* ── Warna ────────────────────────────────────────────────────────────────── */

function keRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const penuh = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(penuh)) return null;
  return [
    parseInt(penuh.slice(0, 2), 16),
    parseInt(penuh.slice(2, 4), 16),
    parseInt(penuh.slice(4, 6), 16),
  ];
}

/** Campur warna dengan putih (rasio > 0) atau hitam (rasio < 0). */
function campur([r, g, b]: [number, number, number], rasio: number): string {
  const target = rasio > 0 ? 255 : 0;
  const k = Math.abs(rasio);
  const c = (v: number) => Math.round(v + (target - v) * k);
  return `${c(r)} ${c(g)} ${c(b)}`;
}

/**
 * Pasang warna merek sebagai variabel CSS.
 *
 * Seluruh kelas `aksen-*` Tailwind menunjuk ke variabel ini (lihat
 * tailwind.config.ts), jadi satu warna yang diatur admin langsung mengalir ke
 * tombol, sidebar, dan kartu sorot tanpa perlu menyentuh satu komponen pun.
 *
 * Tingkat 50–900 diturunkan dari warna utama dengan mencampurnya ke putih dan
 * hitam. Hasilnya tidak seindah palet yang dikurasi tangan, tapi jauh lebih
 * baik daripada memaksa admin memilih sepuluh warna satu per satu — dan
 * kontrasnya tetap terjaga karena tingkat gelapnya benar-benar gelap.
 */
export function terapkanWarna(b: Branding): void {
  if (typeof document === 'undefined') return;

  const utama = keRgb(b.warna_utama) ?? keRgb(BRANDING_BAWAAN.warna_utama)!;
  const utama2 = keRgb(b.warna_utama_2) ?? utama;
  const aksen = keRgb(b.warna_aksen) ?? keRgb(BRANDING_BAWAAN.warna_aksen)!;

  const akar = document.documentElement.style;
  akar.setProperty('--aksen-50',  campur(utama,  0.94));
  akar.setProperty('--aksen-100', campur(utama,  0.86));
  akar.setProperty('--aksen-200', campur(utama,  0.72));
  akar.setProperty('--aksen-300', campur(utama,  0.54));
  akar.setProperty('--aksen-400', campur(utama,  0.30));
  akar.setProperty('--aksen-500', campur(utama,  0.14));
  akar.setProperty('--aksen-600', campur(utama,  0.00));
  akar.setProperty('--aksen-700', campur(utama, -0.10));
  akar.setProperty('--aksen-800', campur(utama2, -0.05));
  akar.setProperty('--aksen-900', campur(utama2, -0.25));
  akar.setProperty('--merek-aksen', campur(aksen, 0));
}

/* ── Pembacaan ────────────────────────────────────────────────────────────── */

let cache: Branding | null = null;
let berjalan: Promise<Branding> | null = null;

export async function ambilBranding(): Promise<Branding> {
  if (cache) return cache;
  if (berjalan) return berjalan;

  berjalan = (async () => {
    try {
      const res = await fetch('/api/branding');
      if (!res.ok) throw new Error('gagal');
      const data = await res.json();
      cache = { ...BRANDING_BAWAAN, ...(data.branding ?? {}) };
    } catch {
      // Jaringan gagal bukan alasan menampilkan halaman tanpa nama sama
      // sekali; nilai bawaan tetap membuatnya terbaca.
      cache = BRANDING_BAWAAN;
    } finally {
      berjalan = null;
    }
    return cache!;
  })();

  return berjalan;
}

export function kosongkanCacheBranding(): void {
  cache = null;
}

export function useBranding() {
  const [branding, setBranding] = useState<Branding>(cache ?? BRANDING_BAWAAN);
  const [memuat, setMemuat] = useState(!cache);

  useEffect(() => {
    let batal = false;
    void ambilBranding().then((b) => {
      if (batal) return;
      setBranding(b);
      setMemuat(false);
      terapkanWarna(b);
    });
    return () => { batal = true; };
  }, []);

  return { branding, memuat, setBranding };
}
