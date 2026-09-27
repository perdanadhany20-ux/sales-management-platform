import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { aktifkanKode } from '@/lib/lisensi/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/lisensi/aktivasi — Admin menempel Kode Aktivasi dari Kantor Pusat.
 * Kode disimpan hanya setelah Kantor Pusat mengakuinya (token bertanda tangan
 * sah); kode itu sendiri tidak pernah dikirim balik ke browser.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: 'Hanya Admin yang dapat mengaktifkan lisensi.' }, { status: 403 });

  const b = await request.json().catch(() => ({})) as { kode?: unknown };
  if (typeof b.kode !== 'string' || !b.kode.trim()) {
    return NextResponse.json({ error: 'Kode Aktivasi wajib diisi.' }, { status: 400 });
  }

  const h = await aktifkanKode(b.kode, { id: user.id, nama: user.full_name });
  return h.ok
    ? NextResponse.json({ ok: true, perusahaan: h.perusahaan, status: h.status })
    : NextResponse.json({ error: h.error, code: h.code }, { status: h.status });
}
