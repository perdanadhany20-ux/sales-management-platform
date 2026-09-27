import { NextResponse, type NextRequest } from 'next/server';
import { LicenseService } from '@/lib/license-service';
import { identitasDeployment, tidakDiizinkan } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/v1/requests/cancel — batalkan permintaan milik deployment ini yang masih menunggu. */
export async function POST(request: NextRequest) {
  const id = await identitasDeployment(request);
  if (!id.ok) return id.res;
  const rid = typeof id.badan.request_id === 'string' && /^[0-9a-f-]{36}$/i.test(id.badan.request_id) ? id.badan.request_id : null;
  if (!rid) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const h = await LicenseService.cancelRequest(id.deployment, id.license, id.kunci, rid).catch(() => null);
  if (!h) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  if (!h.ok) return h.code === 'UNAUTHORIZED' ? tidakDiizinkan() : NextResponse.json({ error: 'conflict', code: h.code }, { status: 409 });
  return NextResponse.json({ ok: true });
}
