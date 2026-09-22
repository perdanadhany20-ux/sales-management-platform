import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, isAdmin } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users — kelola akun.
 *
 * Lewat route handler, BUKAN langsung dari browser ke PostgREST, karena dua
 * hal yang mustahil dilakukan klien dengan aman: menghitung hash bcrypt, dan
 * menulis ke user_credentials — tabel yang sengaja tidak punya policy RLS
 * sama sekali (migrasi 005), sehingga hanya service role yang bisa
 * menyentuhnya.
 *
 * Setiap handler memeriksa ulang peran pemanggil dari sesi di database.
 * Peran yang dikirim klien tidak pernah dipercaya.
 */

const PERAN_SAH = ['SALES', 'MANAGER', 'ADMIN'];

/** Aturan sandi minimum — ditegakkan di sini, bukan hanya di formulir. */
function sandiLemah(sandi: string): string | null {
  if (sandi.length < 8) return 'Kata sandi minimal 8 karakter.';
  if (!/[a-zA-Z]/.test(sandi)) return 'Kata sandi harus memuat huruf.';
  if (!/[0-9]/.test(sandi)) return 'Kata sandi harus memuat angka.';
  return null;
}

async function penjaga(request: NextRequest) {
  const pemanggil = await getSessionUser(request);
  if (!pemanggil) {
    return { galat: NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 }) };
  }
  if (!isAdmin(pemanggil.role)) {
    return { galat: NextResponse.json({ error: 'Hanya Admin yang boleh mengelola akun.' }, { status: 403 }) };
  }
  return { pemanggil };
}

export async function GET(request: NextRequest) {
  const { galat } = await penjaga(request);
  if (galat) return galat;

  const { data, error } = await getAdminClient()
    .from('users')
    .select('id, username, full_name, email, phone, role, active, created_at')
    .order('full_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { galat, pemanggil } = await penjaga(request);
  if (galat) return galat;

  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const role = String(body.role ?? 'SALES').toUpperCase();
  const sandi = String(body.password ?? '');

  if (!username || !fullName) {
    return NextResponse.json({ error: 'Username dan nama lengkap wajib diisi.' }, { status: 400 });
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: 'Username hanya boleh huruf kecil, angka, titik, garis bawah, atau strip (3–32 karakter).' },
      { status: 400 },
    );
  }
  if (!PERAN_SAH.includes(role)) {
    return NextResponse.json({ error: 'Peran tidak dikenal.' }, { status: 400 });
  }
  const lemah = sandiLemah(sandi);
  if (lemah) return NextResponse.json({ error: lemah }, { status: 400 });

  const db = getAdminClient();

  const { data: baru, error: galatUser } = await db
    .from('users')
    .insert({
      username, full_name: fullName, role,
      email: String(body.email ?? '').trim() || null,
      phone: String(body.phone ?? '').trim() || null,
    })
    .select('id, username, full_name, role, active')
    .single();

  if (galatUser) {
    // 23505 = username sudah dipakai; satu-satunya UNIQUE di tabel ini.
    if (galatUser.code === '23505') {
      return NextResponse.json({ error: `Username "${username}" sudah dipakai.` }, { status: 409 });
    }
    return NextResponse.json({ error: galatUser.message }, { status: 500 });
  }

  const { error: galatKredensial } = await db.from('user_credentials').insert({
    user_id: baru.id,
    password_hash: await bcrypt.hash(sandi, 10),
    must_change: true,
  });

  if (galatKredensial) {
    // Akun tanpa kredensial tidak bisa dipakai login sama sekali — lebih baik
    // dibatalkan seluruhnya daripada meninggalkan baris setengah jadi yang
    // tampak ada di daftar tapi selalu gagal masuk.
    await db.from('users').delete().eq('id', baru.id);
    return NextResponse.json({ error: galatKredensial.message }, { status: 500 });
  }

  await db.from('audit_trail').insert({
    actor_id: pemanggil!.id, actor_name: pemanggil!.full_name,
    action: 'USER_CREATED', entity: 'users', entity_id: baru.id,
    detail: { username, role },
  });

  return NextResponse.json({ user: baru });
}

export async function PATCH(request: NextRequest) {
  const { galat, pemanggil } = await penjaga(request);
  if (galat) return galat;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ error: 'ID pengguna wajib diisi.' }, { status: 400 });

  const db = getAdminClient();
  const perubahan: Record<string, unknown> = {};

  if (typeof body.full_name === 'string') perubahan.full_name = body.full_name.trim();
  if (typeof body.email === 'string') perubahan.email = body.email.trim() || null;
  if (typeof body.phone === 'string') perubahan.phone = body.phone.trim() || null;

  if (typeof body.role === 'string') {
    const role = body.role.toUpperCase();
    if (!PERAN_SAH.includes(role)) {
      return NextResponse.json({ error: 'Peran tidak dikenal.' }, { status: 400 });
    }
    // Admin terakhir tidak boleh menurunkan perannya sendiri. Tanpa penjaga
    // ini, satu klik bisa membuat sistem tidak punya Admin sama sekali — dan
    // memulihkannya hanya mungkin lewat SQL langsung ke database.
    if (id === pemanggil!.id && role !== 'ADMIN') {
      const { count } = await db.from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'ADMIN').eq('active', true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Anda satu-satunya Admin aktif. Angkat Admin lain terlebih dahulu.' },
          { status: 409 },
        );
      }
    }
    perubahan.role = role;
  }

  if (typeof body.active === 'boolean') {
    if (id === pemanggil!.id && !body.active) {
      return NextResponse.json({ error: 'Anda tidak bisa menonaktifkan akun sendiri.' }, { status: 409 });
    }
    perubahan.active = body.active;
  }

  if (Object.keys(perubahan).length > 0) {
    const { error } = await db.from('users').update(perubahan).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reset sandi ditangani terpisah: nilainya tidak boleh ikut tercatat di
  // audit_trail bersama perubahan lain.
  if (typeof body.password === 'string' && body.password) {
    const lemah = sandiLemah(body.password);
    if (lemah) return NextResponse.json({ error: lemah }, { status: 400 });

    const { error } = await db.from('user_credentials').upsert({
      user_id: id,
      password_hash: await bcrypt.hash(body.password, 10),
      must_change: true,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Sesi lama dibunuh agar sandi baru benar-benar berlaku seketika.
    // Tanpa ini, orang yang sandinya direset karena akunnya diduga bocor
    // tetap bisa diakses penyusup yang sudah memegang cookie.
    await db.from('user_sessions').delete().eq('user_id', id);

    await db.from('audit_trail').insert({
      actor_id: pemanggil!.id, actor_name: pemanggil!.full_name,
      action: 'USER_PASSWORD_RESET', entity: 'users', entity_id: id, detail: {},
    });
  }

  if (Object.keys(perubahan).length > 0) {
    await db.from('audit_trail').insert({
      actor_id: pemanggil!.id, actor_name: pemanggil!.full_name,
      action: 'USER_UPDATED', entity: 'users', entity_id: id, detail: perubahan,
    });
  }

  return NextResponse.json({ ok: true });
}
