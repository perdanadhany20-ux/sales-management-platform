import { createClient } from '@supabase/supabase-js';

/**
 * lib/supabase.ts — klien Supabase untuk browser.
 *
 * Diadaptasi dari pola FieldServices. Intinya satu: klien ini adalah
 * singleton yang diimpor puluhan berkas, sedangkan token identitasnya
 * BERUBAH-UBAH (terbit saat login, diperbarui berkala). `global.headers`
 * hanya dibaca sekali saat klien dibuat, jadi tidak bisa dipakai. Override
 * `global.fetch` di bawah adalah cara menyisipkan token yang berubah tanpa
 * membuat klien baru setiap kali.
 */

const TOKEN_KEY = 'smp_db_token';

let dbToken: string | null =
  typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_KEY) : null;

/**
 * Pasang / hapus token. Dipanggil saat login berhasil dan saat sesi dipulihkan
 * dari cookie. Nilainya dibaca ulang dari sessionStorage saat modul dimuat
 * supaya query paling awal sesudah halaman di-refresh tetap membawa
 * identitas, bukan berangkat sebagai anon dan menampilkan halaman kosong.
 *
 * sessionStorage, bukan localStorage: token ikut hilang begitu tab ditutup.
 */
export function setDbToken(token: string | null): void {
  dbToken = token;
  if (typeof window === 'undefined') return;
  if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
  else window.sessionStorage.removeItem(TOKEN_KEY);
}

export function getDbToken(): string | null {
  return dbToken;
}

/**
 * Kapan token kedaluwarsa (epoch ms), dibaca dari klaim `exp`.
 *
 * Yang dibaca di sini SEMATA waktu kedaluwarsanya, untuk menjadwalkan
 * pembaruan. Keabsahan tanda tangannya tetap diverifikasi PostgREST — tidak
 * ada keputusan keamanan yang diambil dari hasil parsing di browser ini.
 */
export function dbTokenExpiryMs(): number | null {
  if (!dbToken) return null;
  try {
    const payload = dbToken.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

let pembaruanBerjalan: Promise<void> | null = null;

/**
 * Perbarui token lewat /api/auth/session, yang menerbitkan token baru selama
 * cookie sesinya masih sah.
 *
 * Satu pembaruan pada satu waktu: tanpa penjaga ini, sepuluh query yang
 * berangkat bersamaan saat token hampir habis akan memicu sepuluh panggilan
 * /api/auth/session sekaligus.
 */
export function refreshDbToken(): Promise<void> {
  if (pembaruanBerjalan) return pembaruanBerjalan;
  pembaruanBerjalan = (async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.status === 401) {
        // Sesi dicabut (logout di tab lain, akun dinonaktifkan, atau habis):
        // token lama dibuang saat itu juga, bukan dibiarkan berlaku sampai exp.
        setDbToken(null);
        if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.href = '/';
        return;
      }
      if (!res.ok) return;
      const { db_token } = await res.json();
      if (db_token) setDbToken(db_token);
    } catch {
      /* jaringan bermasalah — percobaan berikutnya akan mencoba lagi */
    } finally {
      pembaruanBerjalan = null;
    }
  })();
  return pembaruanBerjalan;
}

const fetchWithToken: typeof fetch = async (input, init) => {
  if (dbToken) {
    const exp = dbTokenExpiryMs();
    // Ambang 60 detik menutup kemungkinan token kedaluwarsa persis saat
    // permintaannya sedang di jalan.
    if (exp !== null && exp - Date.now() < 60_000) await refreshDbToken();
  }
  const headers = new Headers(init?.headers);
  if (dbToken) headers.set('Authorization', `Bearer ${dbToken}`);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    // Sesi dikelola cookie httpOnly kita sendiri, bukan oleh pustaka ini.
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithToken },
  },
);
