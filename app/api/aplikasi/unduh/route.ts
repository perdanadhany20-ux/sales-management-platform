// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Unduh aplikasi Android deployment ini.
 *
 * APK disimpan di bucket PRIVAT `aplikasi` (Supabase Storage deployment ini
 * sendiri — satu pelanggan, satu APK). Ia memuat kunci tanda tangan laporan
 * lokasi, jadi tidak disebar bebas: hanya pengguna yang sedang masuk yang
 * mendapat tautan sementara (5 menit).
 */
const BERKAS = 'sales-management.apk';

export async function GET(request: NextRequest) {
  const pengguna = await getSessionUser(request);
  if (!pengguna) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const { data, error } = await getAdminClient().storage
    .from('aplikasi')
    .createSignedUrl(BERKAS, 300, { download: BERKAS });

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: 'Aplikasi Android belum tersedia untuk diunduh. Hubungi Admin.' },
      { status: 404 },
    );
  }
  return NextResponse.redirect(data.signedUrl);
}
