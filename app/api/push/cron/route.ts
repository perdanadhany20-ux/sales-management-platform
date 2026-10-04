// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';
import { kirimPush, ringkasLonceng, vapidPublik } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cocokRahasia(request: NextRequest): boolean {
  const harap = process.env.CRON_SECRET ?? '';
  const ada = request.headers.get('authorization') ?? '';
  if (harap.length < 16) return false;
  const a = Buffer.from(ada), b = Buffer.from(`Bearer ${harap}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/push/cron — Vercel Cron (CRON_SECRET), pagi & siang WIB.
 * Setiap pengguna yang berlangganan menerima SATU ringkasan isi loncengnya
 * (hanya bila ada yang perlu tindakan). Satu slot per hari tidak terkirim dua
 * kali walau cron terpanggil ulang.
 */
export async function GET(request: NextRequest) {
  if (!cocokRahasia(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!vapidPublik()) return NextResponse.json({ ok: true, dilewati: 'VAPID belum diset' });

  const wib = new Date(Date.now() + 7 * 3600_000);
  const slot = `${wib.toISOString().slice(0, 10)}-${wib.getUTCHours() < 12 ? 'pagi' : 'siang'}`;
  const db = getAdminClient();
  const { data } = await db.from('sm_push_langganan').select('user_id, slot_terakhir');
  const pengguna = [...new Set(((data ?? []) as { user_id: string; slot_terakhir: string | null }[])
    .filter((l) => l.slot_terakhir !== slot).map((l) => l.user_id))];

  let terkirim = 0;
  for (const id of pengguna) {
    const { data: l } = await db.rpc('sm_lonceng_untuk', { p_user: id });
    const pesan = ringkasLonceng(l);
    if (pesan) terkirim += await kirimPush([id], pesan);
    await db.from('sm_push_langganan').update({ slot_terakhir: slot, terakhir_kirim: new Date().toISOString() }).eq('user_id', id);
  }
  return NextResponse.json({ ok: true, slot, pengguna: pengguna.length, terkirim });
}
