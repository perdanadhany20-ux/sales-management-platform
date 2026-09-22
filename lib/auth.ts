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
  }
}

/**
 * Identitas pengguna yang sedang login, dipulihkan dari cookie httpOnly.
 *
 * `memuat` dibedakan dari `pengguna === null` dengan sengaja: keduanya sama
 * di awal, tapi artinya berbeda. Tanpa pembedaan itu, setiap halaman akan
 * mengedipkan layar "silakan masuk" sepersekian detik sebelum sesinya selesai
 * dipulihkan.
 */
export function usePenggunaAktif() {
  const [pengguna, setPengguna] = useState<PenggunaAktif | null>(null);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) { setPengguna(null); return; }
      const data = await res.json();
      setDbToken(data.db_token ?? null);
      setPengguna(data.user ?? null);
    } catch {
      setPengguna(null);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  // Token diperbarui sebelum habis supaya query yang berjalan lama — halaman
  // dashboard yang dibiarkan terbuka sepanjang hari — tidak tiba-tiba
  // kehilangan identitas dan menampilkan tabel kosong.
  useEffect(() => {
    if (!pengguna) return;
    const timer = setInterval(() => {
      const exp = dbTokenExpiryMs();
      if (exp !== null && exp - Date.now() < 5 * 60_000) void refreshDbToken();
    }, 60_000);
    return () => clearInterval(timer);
  }, [pengguna]);

  return { pengguna, memuat, muatUlang: muat };
}
