import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Pendaftaran mandiri.
 *
 * Akun yang lahir dari sini TIDAK bisa dipakai masuk. Ia tercatat dengan
 * approval_status = 'MENUNGGU' dan active = false sampai admin memeriksanya.
 * Dua kolom itu sengaja diisi di server, bukan dikirim klien — kalau nilainya
 * boleh datang dari badan permintaan, siapa pun bisa mendaftarkan dirinya
 * sendiri sebagai ADMIN yang langsung aktif.
 *
 * Peran juga tidak diterima dari klien sama sekali. Setiap pendaftar menjadi
 * SALES; menaikkannya adalah keputusan admin, di halaman yang hanya bisa
 * dibuka admin.
 */

const BATAS_PANJANG = 120;

function bersih(v: unknown, maks = BATAS_PANJANG): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, maks);
}

export async function POST(request: NextRequest) {
  const db = getAdminClient();

  // Pendaftaran bisa ditutup admin lewat Administrasi → Nilai Bisnis.
  const { data: pengaturan } = await db
    .from('sm_settings').select('value').eq('key', 'registration_open').maybeSingle();

  if (pengaturan && pengaturan.value === false) {
    return NextResponse.json(
      { error: 'Pendaftaran mandiri sedang ditutup. Hubungi admin untuk dibuatkan akun.' },
      { status: 403 },
    );
  }

  const badan = await request.json().catch(() => ({}));

  const username = bersih(badan.username, 40)?.toLowerCase() ?? null;
  const fullName = bersih(badan.full_name);
  const email = bersih(badan.email);
  const password = typeof badan.password === 'string' ? badan.password : '';
  const phone = bersih(badan.phone, 25);
  const division = bersih(badan.division, 60);
  const salesDivision = bersih(badan.sales_division, 60);
  const position = bersih(badan.position, 60);
  const eventCode = bersih(badan.event_code, 40);

  if (!username || !fullName || !email || !password) {
    return NextResponse.json(
      { error: 'Username, nama lengkap, email, dan kata sandi wajib diisi.' },
      { status: 400 },
    );
  }

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return NextResponse.json(
      { error: 'Username hanya boleh huruf kecil, angka, titik, garis bawah, dan strip (3–40 karakter).' },
      { status: 400 },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Format email tidak sah.' }, { status: 400 });
  }

  // Syarat yang sama persis dengan penggantian kata sandi. Kalau di sini lebih
  // longgar, akun baru bisa lahir dengan sandi yang tidak akan pernah lolos
  // saat hendak diganti — aturan yang berbeda di dua pintu masuk selalu
  // berakhir membingungkan pemakainya.
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json(
      { error: 'Kata sandi minimal 8 karakter dan harus memuat huruf serta angka.' },
      { status: 400 },
    );
  }

  if (phone && !/^[0-9+][0-9 ()-]{6,24}$/.test(phone)) {
    return NextResponse.json({ error: 'Format nomor telepon tidak sah.' }, { status: 400 });
  }

  const { data: sudahAda } = await db
    .from('users').select('id').eq('username', username).maybeSingle();

  if (sudahAda) {
    return NextResponse.json({ error: 'Username sudah dipakai. Pilih yang lain.' }, { status: 409 });
  }

  const { data: user, error } = await db.from('users').insert({
    username,
    full_name: fullName,
    email,
    phone,
    division,
    sales_division: salesDivision,
    position,
    event_code: eventCode,
    joined_at: new Date().toISOString().slice(0, 10),
    // Tiga nilai berikut TIDAK pernah datang dari klien.
    role: 'SALES',
    active: false,
    approval_status: 'MENUNGGU',
  }).select('id, username, full_name').single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: galatSandi } = await db.from('user_credentials').insert({
    user_id: user.id,
    password_hash: await bcrypt.hash(password, 10),
    must_change: false,
  });

  if (galatSandi) {
    // Akun tanpa kredensial adalah akun yang tidak bisa dipakai siapa pun dan
    // tidak bisa diperbaiki admin tanpa menyentuh database. Lebih baik
    // dibatalkan seluruhnya supaya orangnya bisa mendaftar ulang.
    await db.from('users').delete().eq('id', user.id);
    return NextResponse.json({ error: galatSandi.message }, { status: 500 });
  }

  await db.from('audit_trail').insert({
    actor_id: user.id,
    action: 'AKUN_MENDAFTAR',
    entity: 'users',
    entity_id: user.id,
    detail: { username, division, position },
  });

  return NextResponse.json({
    ok: true,
    message: 'Pendaftaran diterima. Akun Anda menunggu verifikasi admin sebelum bisa dipakai masuk.',
  });
}
