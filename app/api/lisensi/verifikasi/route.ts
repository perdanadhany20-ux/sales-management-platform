import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { statusLisensi } from '@/lib/lisensi/server';
import { pesanKode } from '@/lib/lisensi/kontrak';

export const dynamic = 'force-dynamic';

/** POST /api/lisensi/verifikasi — Admin meminta pemeriksaan lisensi sekarang juga. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: 'Hanya Admin yang dapat memeriksa lisensi.' }, { status: 403 });

  const s = await statusLisensi({ paksa: true });
  return NextResponse.json({
    ok: s.galatTerakhir === null,
    kode: s.evaluasi.kode,
    pesan: s.galatTerakhir ? pesanKode(s.galatTerakhir).judul : 'Lisensi berhasil diperiksa.',
  });
}
