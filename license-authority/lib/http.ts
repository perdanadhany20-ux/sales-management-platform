import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

export const POLA_KODE = /^[A-Z0-9][A-Z0-9-]{3,63}$/;

/** Identitas deployment dari permintaan /api/v1/* — divalidasi bentuknya dulu. */
export async function identitasDeployment(request: NextRequest): Promise<
  | { ok: true; deployment: string; license: string; kunci: string; versi: string; badan: Record<string, unknown> }
  | { ok: false; res: NextResponse }
> {
  const auth = request.headers.get('authorization') ?? '';
  const kunci = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const badan = await request.json().catch(() => null) as Record<string, unknown> | null;
  const deployment = typeof badan?.deployment_id === 'string' ? badan.deployment_id : '';
  const license = typeof badan?.license_id === 'string' ? badan.license_id : '';

  // Bentuk yang salah dijawab sama persis dengan kunci yang salah (§29).
  if (!badan || kunci.length < 32 || kunci.length > 200 || !POLA_KODE.test(deployment) || !POLA_KODE.test(license)) {
    return { ok: false, res: tidakDiizinkan() };
  }
  const versi = typeof badan.application_version === 'string' ? badan.application_version.slice(0, 40) : '';
  return { ok: true, deployment, license, kunci, versi, badan };
}

export function tidakDiizinkan() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function terlaluSering() {
  return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
}

export function cocokBearer(request: NextRequest, rahasia: string | undefined): boolean {
  const harap = `Bearer ${rahasia ?? ''}`;
  const diterima = request.headers.get('authorization') ?? '';
  return Boolean(rahasia) && (rahasia ?? '').length >= 16 && diterima.length === harap.length
    && crypto.timingSafeEqual(Buffer.from(diterima), Buffer.from(harap));
}
