import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { COOKIE_SESI, hashToken } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_SESI)?.value;

  // Barisnya dihapus dari database, bukan sekadar cookie-nya dibuang. Cookie
  // yang sudah disalin sebelum logout akan tetap berlaku kalau sesinya masih
  // berdiri di server.
  if (token) {
    await getAdminClient().from('user_sessions').delete().eq('token_hash', hashToken(token));
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESI, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
