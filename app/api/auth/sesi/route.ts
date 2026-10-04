// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, COOKIE_SESI, hashToken } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * /api/auth/sesi — perangkat yang sedang masuk ke akun ini.
 *   GET                            → daftar sesi aktif (token tidak pernah keluar)
 *   DELETE { id }                  → putus satu sesi
 *   DELETE { semua_kecuali_ini }   → putus semua sesi selain perangkat ini
 */
export async function GET(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const ini = hashToken(request.cookies.get(COOKIE_SESI)?.value ?? '');
  const { data, error } = await getAdminClient().from('user_sessions')
    .select('id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at')
    .eq('user_id', p.id).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Gagal memuat sesi.' }, { status: 500 });
  return NextResponse.json({
    sesi: ((data ?? []) as { token_hash: string }[]).map(({ token_hash, ...s }) => ({ ...s, ini: token_hash === ini })),
  });
}

export async function DELETE(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ini = hashToken(request.cookies.get(COOKIE_SESI)?.value ?? '');
  const db = getAdminClient();

  let q = db.from('user_sessions').delete().eq('user_id', p.id).neq('token_hash', ini);
  if (!body.semua_kecuali_ini) {
    if (typeof body.id !== 'string') return NextResponse.json({ error: 'Sesi tidak dikenal.' }, { status: 400 });
    q = q.eq('id', body.id);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: 'Gagal memutus sesi.' }, { status: 500 });
  await db.from('audit_trail').insert({
    actor_id: p.id, actor_name: p.full_name, action: 'SESI_DIPUTUS', entity: 'users', entity_id: p.id,
    detail: { semua: Boolean(body.semua_kecuali_ini) },
  });
  return NextResponse.json({ ok: true });
}
