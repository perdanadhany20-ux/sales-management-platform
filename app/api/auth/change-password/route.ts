import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, COOKIE_SESI, hashToken } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Ganti kata sandi sendiri.
 *
 * Sandi lama tetap diminta walau sesinya sudah terbukti sah. Alasannya bukan
 * birokrasi: perangkat yang ditinggalkan terbuka adalah cara paling lazim
 * sebuah akun diambil alih, dan tanpa langkah ini siapa pun yang lewat bisa
 * mengunci pemiliknya keluar dari akunnya sendiri.
 */
export async function POST(request: NextRequest) {
  const pengguna = await getSessionUser(request, { izinkanSandiSementara: true });
  if (!pengguna) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  const { password_lama: lama, password_baru: baru } = await request.json().catch(() => ({}));

  if (typeof lama !== 'string' || typeof baru !== 'string' || !lama || !baru) {
    return NextResponse.json({ error: 'Kata sandi lama dan baru wajib diisi.' }, { status: 400 });
  }
  if (baru.length < 8 || !/[a-zA-Z]/.test(baru) || !/[0-9]/.test(baru)) {
    return NextResponse.json(
      { error: 'Kata sandi baru minimal 8 karakter dan harus memuat huruf serta angka.' },
      { status: 400 },
    );
  }
  if (lama === baru) {
    return NextResponse.json({ error: 'Kata sandi baru harus berbeda dari yang lama.' }, { status: 400 });
  }

  const db = getAdminClient();

  const { data: kredensial } = await db
    .from('user_credentials').select('password_hash').eq('user_id', pengguna.id).maybeSingle();

  if (!kredensial || !(await bcrypt.compare(lama, kredensial.password_hash))) {
    return NextResponse.json({ error: 'Kata sandi lama salah.' }, { status: 401 });
  }

  const { error } = await db.from('user_credentials').update({
    password_hash: await bcrypt.hash(baru, 10),
    must_change: false,
    updated_at: new Date().toISOString(),
  }).eq('user_id', pengguna.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Semua sesi LAIN dihapus; sesi yang sedang dipakai dipertahankan supaya
  // orangnya tidak terlempar keluar tepat setelah berhasil mengganti sandi.
  const tokenSekarang = request.cookies.get(COOKIE_SESI)?.value;
  let hapus = db.from('user_sessions').delete().eq('user_id', pengguna.id);
  if (tokenSekarang) hapus = hapus.neq('token_hash', hashToken(tokenSekarang));
  await hapus;

  await db.from('audit_trail').insert({
    actor_id: pengguna.id, actor_name: pengguna.full_name,
    action: 'PASSWORD_CHANGED', entity: 'users', entity_id: pengguna.id, detail: {},
  });

  return NextResponse.json({ ok: true });
}
