import { NextResponse, type NextRequest } from 'next/server';

/**
 * middleware.ts — pengalih cepat untuk pengunjung yang belum masuk.
 *
 * YANG DILAKUKAN DI SINI HANYA MEMERIKSA KEBERADAAN COOKIE, dan itu memang
 * batasnya. Middleware berjalan di edge runtime, tempat klien service role
 * Supabase tidak tersedia, jadi ia tidak bisa memastikan sesinya sungguh sah.
 *
 * Karena itu berkas ini BUKAN lapisan keamanan — ia kenyamanan navigasi
 * belaka. Cookie palsu berisi sembarang teks akan lolos dari sini, lalu
 * berhenti total satu langkah kemudian: /api/auth/session menolaknya, tidak
 * ada token PostgREST yang terbit, dan setiap query berangkat tanpa identitas
 * sehingga RLS mengembalikan tabel kosong. Penegakan sesungguhnya ada di
 * policy RLS (migrasi 005) dan di route handler.
 */

const COOKIE_SESI = 'smp_session';

/** Rute yang boleh dibuka tanpa sesi. */
const TERBUKA = ['/', '/api/auth/login', '/api/auth/session', '/api/auth/logout'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (TERBUKA.includes(pathname)) return NextResponse.next();

  const punyaCookie = Boolean(request.cookies.get(COOKIE_SESI)?.value);
  if (punyaCookie) return NextResponse.next();

  // Permintaan API dijawab 401, bukan dialihkan. Pengalihan 307 ke halaman
  // HTML akan sampai ke fetch() sebagai respons sukses berisi markup, dan
  // pemanggilnya gagal saat mem-parse JSON — galat yang menyesatkan, jauh
  // dari sebab sebenarnya.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  const tujuan = request.nextUrl.clone();
  tujuan.pathname = '/';
  return NextResponse.redirect(tujuan);
}

export const config = {
  matcher: [
    // Aset statis dan berkas publik dilewati: menjalankan middleware untuk
    // setiap ikon dan bundel JS hanya menambah latensi tanpa manfaat.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
