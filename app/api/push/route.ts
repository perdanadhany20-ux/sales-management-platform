// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { kirimPush, vapidPublik } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * /api/push — langganan notifikasi push perangkat ini.
 *   GET                         → { tersedia, kunci }
 *   POST { langganan }          → simpan (PushSubscription.toJSON())
 *   POST { uji: true }          → kirim notifikasi uji ke perangkat pemanggil
 *   DELETE { endpoint }         → berhenti berlangganan
 */
export async function GET(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  return NextResponse.json({ tersedia: Boolean(vapidPublik()), kunci: vapidPublik() });
}

export async function POST(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  if (!vapidPublik()) return NextResponse.json({ error: 'Notifikasi push belum diaktifkan Admin server.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));

  if (body.uji === true) {
    const n = await kirimPush([p.id], {
      judul: 'Notifikasi push aktif ✅', isi: 'Anda akan menerima pengingat walau aplikasi tertutup.', url: '/profil', tag: 'uji',
    }, (l) => l.endpoint === String(body.endpoint ?? ''));
    return NextResponse.json({ ok: n > 0 });
  }

  const s = body.langganan as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = String(s?.endpoint ?? ''), p256dh = String(s?.keys?.p256dh ?? ''), auth = String(s?.keys?.auth ?? '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
    return NextResponse.json({ error: 'Data langganan tidak sah.' }, { status: 400 });
  }
  // Endpoint unik per perangkat: perangkat yang dipakai bergantian
  // berpindah ke pemilik yang terakhir masuk.
  const { error } = await getAdminClient().from('sm_push_langganan').upsert({
    user_id: p.id, endpoint, p256dh, auth, user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  }, { onConflict: 'endpoint' });
  if (error) return NextResponse.json({ error: 'Gagal menyimpan langganan.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const { endpoint } = await request.json().catch(() => ({}));
  await getAdminClient().from('sm_push_langganan').delete().eq('user_id', p.id).eq('endpoint', String(endpoint ?? ''));
  return NextResponse.json({ ok: true });
}
