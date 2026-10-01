// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { ajukanPermintaan, batalkanPermintaan } from '@/lib/lisensi/server';
import {
  BAWAAN_LISENSI, JENIS_PERMINTAAN, adalahKunciFitur, adalahPaket, type KunciFitur,
} from '@/lib/lisensi/kontrak';

export const dynamic = 'force-dynamic';

const DURASI_SAH = [30, 90, 180, 365, 730];

/**
 * POST /api/lisensi/permintaan — Admin mengajukan lisensi baru, perpanjangan,
 * atau perubahan paket. Diteruskan ke License Authority, yang memberi tahu
 * developer lewat Telegram. Deployment ini TIDAK memutuskan apa pun sendiri.
 *
 * { aksi: 'batal', id } membatalkan permintaan yang masih menunggu.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: 'Hanya Admin yang dapat mengajukan lisensi.' }, { status: 403 });

  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const pelaku = { id: user.id, nama: user.full_name };

  if (b.aksi === 'batal') {
    const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null;
    if (!id) return NextResponse.json({ error: 'Permintaan tidak dikenal.' }, { status: 400 });
    const h = await batalkanPermintaan(id, pelaku);
    return h.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: h.error, code: h.code }, { status: h.status });
  }

  const kind = String(b.kind ?? '');
  if (!(JENIS_PERMINTAAN as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Jenis permintaan tidak dikenal.' }, { status: 400 });
  }
  const paket = b.requested_package ?? BAWAAN_LISENSI.paket;
  if (!adalahPaket(paket)) return NextResponse.json({ error: 'Paket tidak dikenal.' }, { status: 400 });

  const durasi = b.duration_days == null ? null : Number(b.duration_days);
  if (kind !== 'CHANGE_PACKAGE' && (durasi === null || !DURASI_SAH.includes(durasi))) {
    return NextResponse.json({ error: 'Pilih durasi yang tersedia.' }, { status: 400 });
  }

  let fitur: Partial<Record<KunciFitur, boolean>> | undefined;
  if (paket === 'CUSTOM') {
    const src = (b.requested_features && typeof b.requested_features === 'object') ? b.requested_features as Record<string, unknown> : {};
    fitur = Object.fromEntries(Object.entries(src).filter(([k, v]) => adalahKunciFitur(k) && typeof v === 'boolean')) as Partial<Record<KunciFitur, boolean>>;
  }

  const catatan = typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) || null : null;

  const h = await ajukanPermintaan({
    kind: kind as typeof JENIS_PERMINTAAN[number],
    requested_package: paket,
    duration_days: kind === 'CHANGE_PACKAGE' ? null : durasi,
    requested_features: fitur,
    notes: catatan,
  }, pelaku);

  return h.ok
    ? NextResponse.json({ ok: true, id: h.id }, { status: 201 })
    : NextResponse.json({ error: h.error, code: h.code }, { status: h.status });
}
