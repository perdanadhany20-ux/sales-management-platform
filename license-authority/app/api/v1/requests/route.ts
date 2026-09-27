import { NextResponse, type NextRequest } from 'next/server';
import { JENIS_PERMINTAAN, adalahPaket } from '@kontrak/kontrak.ts';
import { LicenseService } from '@/lib/license-service';
import { identitasDeployment, terlaluSering, tidakDiizinkan } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/requests — Admin pelanggan mengajukan lisensi/perpanjangan/
 * perubahan paket. Pusat mencatatnya sebagai PENDING_APPROVAL lalu memberi
 * tahu developer lewat Telegram dengan tombol APPROVE/REJECT (§19, §23).
 */
export async function POST(request: NextRequest) {
  const id = await identitasDeployment(request);
  if (!id.ok) return id.res;
  const b = id.badan;

  const kind = String(b.kind ?? '');
  if (!(JENIS_PERMINTAAN as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'invalid_kind', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (!adalahPaket(b.requested_package)) {
    return NextResponse.json({ error: 'invalid_package', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const durasi = b.duration_days == null ? null : Number(b.duration_days);
  if (durasi !== null && (!Number.isInteger(durasi) || durasi < 1 || durasi > 3660)) {
    return NextResponse.json({ error: 'invalid_duration', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (kind !== 'CHANGE_PACKAGE' && durasi === null) {
    return NextResponse.json({ error: 'duration_required', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  let h;
  try {
    h = await LicenseService.createRequest(id.deployment, id.license, id.kunci, {
      kind,
      requested_package: b.requested_package,
      requested_features: b.requested_features,
      duration_days: durasi,
      notes: typeof b.notes === 'string' ? b.notes.slice(0, 500) : null,
      requested_by: typeof b.requested_by === 'string' ? b.requested_by.slice(0, 120) : null,
    });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  if (!h.ok) {
    if (h.code === 'UNAUTHORIZED') return tidakDiizinkan();
    if (h.code === 'RATE_LIMITED') return terlaluSering();
    return NextResponse.json({ error: 'conflict', code: h.code }, { status: 409 });
  }
  return NextResponse.json({ id: h.request_id, status: 'PENDING_APPROVAL' }, { status: 201 });
}
