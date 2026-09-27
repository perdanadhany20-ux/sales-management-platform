import { NextResponse, type NextRequest } from 'next/server';

/**
 * Dashboard web developer dilindungi Basic Auth (pengguna `developer`, sandi
 * CENTRAL_ADMIN_SECRET). API deployment (/api/v1), webhook Telegram, dan cron
 * punya autentikasinya sendiri dan tidak lewat sini.
 * Tanpa CENTRAL_ADMIN_SECRET yang layak, dashboard dimatikan — tidak ada
 * sandi bawaan.
 */
function samaPanjangTetap(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

export function middleware(request: NextRequest) {
  const rahasia = process.env.CENTRAL_ADMIN_SECRET ?? '';
  if (rahasia.length < 24) {
    return new NextResponse('Dashboard dinonaktifkan: CENTRAL_ADMIN_SECRET belum diset (min. 24 karakter).', { status: 503 });
  }
  const harap = `Basic ${btoa(`developer:${rahasia}`)}`;
  if (samaPanjangTetap(request.headers.get('authorization') ?? '', harap)) return NextResponse.next();
  return new NextResponse('Autentikasi diperlukan.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="License Authority", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!api/v1/|api/telegram/|api/cron|_next/static|_next/image|favicon.ico).*)'],
};
