import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { statusLisensi } from '@/lib/lisensi/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/lisensi/cron — verifikasi harian walau tidak ada yang membuka
 * aplikasi (dijadwalkan di vercel.json). Vercel Cron mengirim
 * `Authorization: Bearer <CRON_SECRET>`; tanpa rahasia yang cocok, ditolak.
 */
export async function GET(request: NextRequest) {
  const rahasia = process.env.CRON_SECRET ?? '';
  const diterima = request.headers.get('authorization') ?? '';
  const harapan = `Bearer ${rahasia}`;
  const cocok = rahasia.length >= 16 && diterima.length === harapan.length
    && crypto.timingSafeEqual(Buffer.from(diterima), Buffer.from(harapan));
  if (!cocok) return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 });

  const s = await statusLisensi({ paksa: true });
  return NextResponse.json({ ok: s.galatTerakhir === null, kode: s.evaluasi.kode });
}
