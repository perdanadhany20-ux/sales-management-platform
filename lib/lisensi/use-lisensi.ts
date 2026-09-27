'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  KodeLisensi, KunciFitur, Peringatan, RingkasanPermintaan, StatusLisensi,
} from './kontrak';

/**
 * lib/lisensi/use-lisensi.ts — keadaan lisensi di browser.
 *
 * Satu permintaan /api/lisensi per 5 menit untuk seluruh komponen (cache
 * modul, sama seperti lib/branding.ts). Hasilnya HANYA untuk menggambar:
 * menyembunyikan menu, memasang layar "fitur tidak tersedia", dan banner.
 * Mengubah nilai ini di konsol peramban tidak membuka apa pun — penolakan
 * sesungguhnya ada di RLS (migrasi 037) dan di route handler.
 */

export interface PeristiwaLisensiUI {
  id: number;
  action: string;
  actor_name: string | null;
  detail: { judul?: string; keterangan?: string; [k: string]: unknown } | null;
  created_at: string;
}

export interface DetailLisensi {
  perusahaan: string | null;
  license_id: string | null;
  deployment_id: string | null;
  paket_kode: string | null;
  jenis: string | null;
  mulai: string | null;
  berakhir: string | null;
  fitur_peta: Record<string, boolean> | null;
  permintaan: RingkasanPermintaan[];
  dikonfigurasi: boolean;
  sumber: 'env' | 'aktivasi' | null;
  terakhir_terverifikasi: string | null;
  terakhir_gagal: string | null;
  galat_terakhir: string | null;
  tenggang_berakhir: string | null;
  versi: string;
}

export interface Lisensi {
  kode: KodeLisensi;
  status: StatusLisensi | null;
  berlaku: boolean;
  fitur: KunciFitur[];
  judul: string;
  keterangan: string;
  paket: string | null;
  sisa_hari: number | null;
  peringatan: Peringatan[];
  mode_pengembangan: boolean;
  trial: boolean;
  /** Hanya untuk Admin. */
  detail?: DetailLisensi;
  peristiwa?: PeristiwaLisensiUI[];
}

const UMUR_MS = 5 * 60_000;
let cache: { nilai: Lisensi; sampai: number } | null = null;
let berjalan: Promise<Lisensi | null> | null = null;
const pendengar = new Set<(l: Lisensi) => void>();

export async function ambilLisensi(paksa = false): Promise<Lisensi | null> {
  if (!paksa && cache && cache.sampai > Date.now()) return cache.nilai;
  if (berjalan) return berjalan;

  berjalan = (async () => {
    try {
      const res = await fetch('/api/lisensi', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return cache?.nilai ?? null;
      const data = await res.json();
      const nilai = data.lisensi as Lisensi;
      cache = { nilai, sampai: Date.now() + UMUR_MS };
      pendengar.forEach((f) => f(nilai));
      return nilai;
    } catch {
      // Jaringan putus: pakai nilai terakhir. Tanpa nilai sama sekali,
      // pemanggil menahan render — tidak pernah menganggap "semua terbuka".
      return cache?.nilai ?? null;
    } finally {
      berjalan = null;
    }
  })();
  return berjalan;
}

export function kosongkanCacheLisensiKlien(): void {
  cache = null;
}

/** Berlangganan perubahan lisensi (dipakai penyusun menu). */
export function dengarLisensi(f: (l: Lisensi) => void): () => void {
  pendengar.add(f);
  return () => { pendengar.delete(f); };
}

/*
 * Penyegaran berkala: tab yang dibiarkan terbuka tetap mengikuti keputusan
 * developer (cabut, tangguhkan, ubah paket) tanpa perlu dimuat ulang. Hanya
 * satu pewaktu untuk seluruh tab, dan tidak berjalan saat tab tersembunyi.
 */
let pewaktu: ReturnType<typeof setInterval> | null = null;
function pasangPenyegaran() {
  if (pewaktu || typeof window === 'undefined') return;
  pewaktu = setInterval(() => {
    if (document.visibilityState === 'visible') void ambilLisensi(true);
  }, UMUR_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!cache || cache.sampai - UMUR_MS + 60_000 < Date.now())) {
      void ambilLisensi(true);
    }
  });
}

/** null = masih memuat. */
export function useLisensi(aktif = true) {
  const [lisensi, setLisensi] = useState<Lisensi | null>(cache?.nilai ?? null);

  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    const terima = (l: Lisensi) => { if (!batal) setLisensi(l); };
    pendengar.add(terima);
    pasangPenyegaran();
    void ambilLisensi().then((l) => { if (!batal && l) setLisensi(l); });
    return () => { batal = true; pendengar.delete(terima); };
  }, [aktif]);

  const muatUlang = useCallback(async () => {
    const l = await ambilLisensi(true);
    if (l) setLisensi(l);
    return l;
  }, []);

  return { lisensi, muatUlang };
}

export function fiturAktif(lisensi: Lisensi | null, fitur: KunciFitur): boolean {
  return Boolean(lisensi?.fitur.includes(fitur));
}
