'use client';

import { useCallback, useEffect, useState } from 'react';
import { setDbToken, refreshDbToken, dbTokenExpiryMs } from './supabase';

/**
 * lib/auth.ts — sisi klien dari sesi: memulihkan identitas saat halaman
 * dimuat, dan menjaga token PostgREST tetap segar selama tab terbuka.
 */

export interface PenggunaAktif {
  id: string;
  username: string;
  full_name: string;
  role: string;
  wajib_ganti_sandi?: boolean;
}

export async function masuk(username: string, password: string): Promise<PenggunaAktif> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Gagal masuk.');

  setDbToken(data.db_token ?? null);
  lupakanSesi();
  return data.user as PenggunaAktif;
}

export async function keluar(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    // Token lokal dibuang apa pun hasil permintaannya. Kalau jaringan mati
    // saat logout, yang paling berbahaya adalah token identitas tertinggal
    // di tab yang dikira sudah keluar.
    setDbToken(null);
    lupakanSesi({ keluar: true });
  }
}

/* ── Satu sumber identitas untuk seluruh tab ─────────────────────────────────
 *
 * Dulu setiap komponen yang memanggil usePenggunaAktif() mengambil sesinya
 * sendiri: Shell, halaman, dan form masing-masing satu permintaan. Akibatnya
 * dua: satu kali pindah menu memicu beberapa permintaan /api/auth/session,
 * dan setiap halaman selalu mulai dengan pengguna = null — halaman pengawas
 * sesaat tampil sebagai halaman Sales (judul "aktivitas Anda", filter
 * Pengguna hilang) lalu berganti.
 *
 * Sekarang identitasnya disimpan sekali di tingkat modul. Shell baru
 * merender halaman setelah sesi pulih, jadi halaman mana pun sudah menerima
 * penggunanya sejak render pertama.
 */
let penggunaTersimpan: PenggunaAktif | null = null;
let sudahDimuat = false;
let permintaan: Promise<void> | null = null;
let pewaktuToken: ReturnType<typeof setInterval> | null = null;
const pendengar = new Set<() => void>();

function kabari() { pendengar.forEach((f) => f()); }

// Token diperbarui sebelum habis supaya halaman yang dibiarkan terbuka
// sepanjang hari tidak tiba-tiba kehilangan identitas dan menampilkan tabel
// kosong. Cukup satu pewaktu untuk seluruh tab.
function aturPewaktuToken() {
  if (penggunaTersimpan && !pewaktuToken) {
    pewaktuToken = setInterval(() => {
      const exp = dbTokenExpiryMs();
      if (exp !== null && exp - Date.now() < 5 * 60_000) void refreshDbToken();
    }, 60_000);
  } else if (!penggunaTersimpan && pewaktuToken) {
    clearInterval(pewaktuToken);
    pewaktuToken = null;
  }
}

function ambilSesi(): Promise<void> {
  if (permintaan) return permintaan;
  permintaan = (async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDbToken(data.db_token ?? null);
        penggunaTersimpan = data.user ?? null;
      } else {
        setDbToken(null);
        penggunaTersimpan = null;
      }
    } catch {
      // Jaringan putus bukan berarti sesinya berakhir. Pada muat pertama
      // belum ada identitas untuk dipertahankan; pada pemeriksaan ulang,
      // identitas yang sudah ada tetap dipakai sampai server benar-benar
      // menolaknya.
      if (!sudahDimuat) penggunaTersimpan = null;
    } finally {
      sudahDimuat = true;
      permintaan = null;
      aturPewaktuToken();
      kabari();
    }
  })();
  return permintaan;
}

/**
 * Lupakan identitas tersimpan.
 *
 * Saat masuk, sesi ditandai belum dimuat supaya Shell mengambil identitas
 * yang baru. Saat keluar, sesi justru ditandai SUDAH dimuat dengan pengguna
 * kosong: Shell yang masih tampil selama permintaan logout berjalan langsung
 * menampilkan "Mengalihkan…" (bukan "Memulihkan sesi…"), dan halaman yang
 * dibuka lagi lewat tombol Back tidak memakai identitas lama.
 */
function lupakanSesi({ keluar = false } = {}) {
  penggunaTersimpan = null;
  sudahDimuat = keluar;
  aturPewaktuToken();
  kabari();
}

/**
 * Identitas pengguna yang sedang login, dipulihkan dari cookie httpOnly.
 *
 * `memuat` dibedakan dari `pengguna === null` dengan sengaja: keduanya sama
 * di awal, tapi artinya berbeda. Tanpa pembedaan itu, setiap halaman akan
 * mengedipkan layar "silakan masuk" sepersekian detik sebelum sesinya selesai
 * dipulihkan.
 *
 * `muatUlang` memeriksa sesi ke server tanpa mengosongkan identitas yang
 * sedang tampil, jadi layar tidak berkedip saat pemeriksaan berjalan.
 */
export function usePenggunaAktif() {
  const [, setVersi] = useState(0);

  useEffect(() => {
    const perbarui = () => setVersi((v) => v + 1);
    pendengar.add(perbarui);
    if (!sudahDimuat) void ambilSesi();
    return () => { pendengar.delete(perbarui); };
  }, []);

  const muatUlang = useCallback(() => ambilSesi(), []);

  return { pengguna: penggunaTersimpan, memuat: !sudahDimuat, muatUlang };
}
