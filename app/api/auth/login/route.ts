import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';
import { COOKIE_SESI, UMUR_SESI_JAM, buatTokenSesi, hashToken } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/** Percobaan gagal maksimum dalam satu jendela sebelum akun dikunci sementara. */
const BATAS_GAGAL = 8;
const JENDELA_MENIT = 15;
/** Lebih longgar dari batas per-username: satu kantor bisa berbagi satu IP. */
const BATAS_GAGAL_IP = 30;

export async function POST(request: NextRequest) {
  const { username, password } = await request.json().catch(() => ({}));

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json({ error: 'Username dan kata sandi wajib diisi.' }, { status: 400 });
  }
  // bcrypt hanya membaca 72 byte pertama; batas ini juga mencegah username
  // raksasa tercatat utuh di login_attempts.
  if (username.length > 64 || password.length > 128) {
    return NextResponse.json({ error: 'Username atau kata sandi salah.' }, { status: 401 });
  }

  const db = getAdminClient();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const sejak = new Date(Date.now() - JENDELA_MENIT * 60_000).toISOString();

  const { count: gagalTerakhir } = await db
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('username', username)
    .eq('success', false)
    .gte('attempted_at', sejak);

  // Batas per-IP menutup "password spraying": satu sandi umum dicoba ke
  // banyak username, yang tidak pernah menyentuh batas per-username di atas.
  const { count: gagalDariIp } = ip
    ? await db.from('login_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip).eq('success', false).gte('attempted_at', sejak)
    : { count: 0 };

  if ((gagalTerakhir ?? 0) >= BATAS_GAGAL || (gagalDariIp ?? 0) >= BATAS_GAGAL_IP) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${JENDELA_MENIT} menit.` },
      { status: 429 },
    );
  }

  const { data: user } = await db
    .from('users')
    .select('id, username, full_name, role, active, approval_status')
    .eq('username', username)
    .maybeSingle();

  const { data: kredensial } = user
    ? await db.from('user_credentials').select('password_hash, must_change').eq('user_id', user.id).maybeSingle()
    : { data: null };
  const wajibGantiSandi = Boolean(kredensial?.must_change);

  const cocok = kredensial
    ? await bcrypt.compare(password, kredensial.password_hash)
    // Tetap jalankan satu perbandingan walau usernya tidak ada. Tanpa ini,
    // username yang salah dijawab seketika sedangkan username benar dengan
    // sandi salah butuh ~100 ms — selisih yang cukup untuk menebak username
    // mana yang terdaftar.
    : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');

  await db.from('login_attempts').insert({ username, ip, success: Boolean(cocok && user?.active) });

  // Akun yang menunggu persetujuan DIBEDAKAN pesannya — tapi hanya sesudah
  // sandinya terbukti benar. Orang yang baru mendaftar dan tidak bisa masuk
  // tanpa penjelasan akan mengira pendaftarannya gagal lalu mendaftar lagi
  // berulang kali; sedangkan penyerang yang belum tahu sandinya tetap tidak
  // memperoleh petunjuk apa pun dari cabang ini.
  if (user && cocok && user.approval_status === 'MENUNGGU') {
    return NextResponse.json(
      { error: 'Akun Anda masih menunggu verifikasi admin. Anda akan bisa masuk setelah disetujui.' },
      { status: 403 },
    );
  }

  if (user && cocok && user.approval_status === 'DITOLAK') {
    return NextResponse.json(
      { error: 'Pendaftaran akun ini ditolak admin. Hubungi admin untuk keterangan lebih lanjut.' },
      { status: 403 },
    );
  }

  // Satu pesan yang sama untuk semua kegagalan lain: user tidak ada, sandi
  // salah, atau akun dinonaktifkan. Membedakannya berarti memberi tahu
  // penyerang username mana yang benar.
  if (!user || !user.active || !cocok) {
    return NextResponse.json({ error: 'Username atau kata sandi salah.' }, { status: 401 });
  }

  const token = buatTokenSesi();
  const kedaluwarsa = new Date(Date.now() + UMUR_SESI_JAM * 3600_000);

  await db.from('user_sessions').insert({
    user_id: user.id,
    token_hash: hashToken(token),
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    expires_at: kedaluwarsa.toISOString(),
  });

  const res = NextResponse.json({
    user: {
      id: user.id, username: user.username, full_name: user.full_name, role: user.role,
      wajib_ganti_sandi: wajibGantiSandi,
    },
    db_token: wajibGantiSandi ? null : issueDbToken(user),
  });

  res.cookies.set(COOKIE_SESI, token, {
    httpOnly: true,                                   // tidak terbaca JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',                                  // meredam CSRF lintas situs
    path: '/',
    expires: kedaluwarsa,
  });

  return res;
}
