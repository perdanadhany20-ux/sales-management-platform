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
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function buatTokenSesi(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(COOKIE_SESI)?.value;
  if (!token) return null;

  const supabase = getAdminClient();

  const { data: sesi } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!sesi) return null;
  if (new Date(sesi.expires_at) < new Date()) return null;

  const { data: user } = await supabase
    .from('users')
    .select('id, username, full_name, role, active')
    .eq('id', sesi.user_id)
    .maybeSingle();

  // Akun yang dinonaktifkan harus langsung kehilangan akses, tanpa menunggu
  // sesinya habis sendiri — kalau tidak, menonaktifkan seseorang hari ini
  // baru benar-benar berlaku delapan jam kemudian.
  if (!user || !user.active) return null;

  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
  };
}

export function isAdmin(role: string | null | undefined): boolean {
  return (role ?? '').toUpperCase() === 'ADMIN';
}

/** Manager DAN Admin — padanan sm_is_pengawas() di database. */
export function isPengawas(role: string | null | undefined): boolean {
  return ['MANAGER', 'ADMIN'].includes((role ?? '').toUpperCase());
}
