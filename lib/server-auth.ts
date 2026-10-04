// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from './supabase-admin';

/**
 * lib/server-auth.ts — verifikasi sesi dari cookie httpOnly di sisi server.
 *
 * Dipakai route handler yang perlu tahu SIAPA pemanggilnya, bukan sekadar
 * "membawa cookie". Token mentah tidak pernah keluar dari sini; yang
 * dicocokkan ke database hanya hash-nya.
 */

export const COOKIE_SESI = 'smp_session';
export const UMUR_SESI_JAM = 8;

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  /** Sandi dibuat/di-reset Admin dan belum diganti pemiliknya. */
  wajib_ganti_sandi: boolean;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function buatTokenSesi(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Akun yang sandinya masih buatan Admin ditolak di semua rute, kecuali rute
 * yang memang ia butuhkan untuk mengganti sandi (`izinkanSandiSementara`).
 */
export async function getSessionUser(
  request: NextRequest,
  { izinkanSandiSementara = false }: { izinkanSandiSementara?: boolean } = {},
): Promise<SessionUser | null> {
  const token = request.cookies.get(COOKIE_SESI)?.value;
  if (!token) return null;

  const supabase = getAdminClient();

  const { data: sesi } = await supabase
    .from('user_sessions')
    .select('id, user_id, expires_at, last_seen_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!sesi) return null;
  if (new Date(sesi.expires_at) < new Date()) return null;

  // "Terakhir aktif" untuk daftar perangkat di Profil. Ditulis paling sering
  // tiap 5 menit per sesi, bukan setiap permintaan.
  if (!sesi.last_seen_at || Date.now() - new Date(sesi.last_seen_at).getTime() > 5 * 60_000) {
    void supabase.from('user_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sesi.id).then(() => {});
  }

  const { data: user } = await supabase
    .from('users')
    .select('id, username, full_name, role, active')
    .eq('id', sesi.user_id)
    .maybeSingle();

  // Akun yang dinonaktifkan harus langsung kehilangan akses, tanpa menunggu
  // sesinya habis sendiri — kalau tidak, menonaktifkan seseorang hari ini
  // baru benar-benar berlaku delapan jam kemudian.
  if (!user || !user.active) return null;

  const { data: kredensial } = await supabase
    .from('user_credentials').select('must_change').eq('user_id', user.id).maybeSingle();
  if (kredensial?.must_change && !izinkanSandiSementara) return null;

  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    wajib_ganti_sandi: Boolean(kredensial?.must_change),
  };
}

export function isAdmin(role: string | null | undefined): boolean {
  return (role ?? '').toUpperCase() === 'ADMIN';
}

/**
 * Peran pengawas — HARUS sama dengan sm_is_pengawas() di database dan
 * isPengawas() di lib/constants.ts. Dulu versi server ini hanya memuat Manager
 * dan Admin, sehingga Director/Finance melihat tombol yang lalu ditolak API,
 * padahal RLS sudah mengizinkan mereka.
 */
export function isPengawas(role: string | null | undefined): boolean {
  return ['MANAGER', 'ADMIN', 'DIRECTOR', 'FINANCE'].includes((role ?? '').toUpperCase());
}

/** Alamat IP pemanggil (Vercel menaruhnya di x-forwarded-for). */
export function ipPemanggil(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

/**
 * Buat sesi baru setelah identitas terbukti (sandi, dan kode 2FA bila aktif).
 * Mengembalikan token mentah untuk cookie dan waktu kedaluwarsanya.
 */
export async function buatSesi(request: NextRequest, userId: string): Promise<{ token: string; kedaluwarsa: Date }> {
  const token = buatTokenSesi();
  const kedaluwarsa = new Date(Date.now() + UMUR_SESI_JAM * 3600_000);
  await getAdminClient().from('user_sessions').insert({
    user_id: userId,
    token_hash: hashToken(token),
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    ip: ipPemanggil(request),
    expires_at: kedaluwarsa.toISOString(),
    last_seen_at: new Date().toISOString(),
  });
  return { token, kedaluwarsa };
}

export function pasangCookieSesi(res: { cookies: { set: (n: string, v: string, o: object) => void } }, token: string, kedaluwarsa: Date): void {
  res.cookies.set(COOKIE_SESI, token, {
    httpOnly: true,                                   // tidak terbaca JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',                                  // meredam CSRF lintas situs
    path: '/',
    expires: kedaluwarsa,
  });
}
