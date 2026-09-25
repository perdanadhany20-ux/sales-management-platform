import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, COOKIE_SESI, hashToken } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Profil sendiri: baca detail lengkap, dan ubah kontak.
 *
 * Kenapa lewat route handler dan bukan langsung dari klien ke PostgREST:
 * policy `users_admin_kelola` sengaja hanya memberi Admin hak menulis ke
 * tabel users. Menambah policy "boleh menyunting baris sendiri" akan
 * membuka jalan bagi siapa pun untuk mengubah KOLOM MANA PUN pada barisnya
 * — termasuk `role` dan `active`, yang artinya menaikkan pangkat sendiri
 * jadi ADMIN lewat satu permintaan. RLS bekerja per baris, bukan per kolom.
 *
 * Di sini kolom yang boleh berubah ditulis eksplisit, jadi tidak ada cara
 * menitipkan kolom lain lewat badan permintaan.
 */

const KOLOM_PROFIL = `id, username, full_name, email, phone, role, active, created_at,
                      division, sales_division, position, event_code, joined_at,
                      approval_status, address, manager_id`;

export async function GET(request: NextRequest) {
  const pengguna = await getSessionUser(request);
  if (!pengguna) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  const db = getAdminClient();

  const [profil, kredensial, sesi] = await Promise.all([
    db.from('users').select(KOLOM_PROFIL).eq('id', pengguna.id).maybeSingle(),
    db.from('user_credentials').select('updated_at').eq('user_id', pengguna.id).maybeSingle(),
    db.from('user_sessions').select('id, user_agent, created_at, expires_at')
      .eq('user_id', pengguna.id).order('created_at', { ascending: false }),
  ]);

  if (!profil.data) {
    return NextResponse.json({ error: 'Profil tidak ditemukan.' }, { status: 404 });
  }

  // Atasan dan bawahan dibaca terpisah: yang tersimpan di baris sendiri
  // hanya id-nya, sedangkan yang ditampilkan adalah namanya.
  const [atasan, bawahan] = await Promise.all([
    profil.data.manager_id
      ? db.from('users').select('id, full_name').eq('id', profil.data.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('users').select('id, full_name, role').eq('manager_id', pengguna.id).order('full_name'),
  ]);

  // Token mentah tidak pernah dikirim balik; yang dibandingkan hanya hash-nya
  // supaya perangkat ini bisa ditandai tanpa membocorkan apa pun.
  const tokenIni = request.cookies.get(COOKIE_SESI)?.value;
  const hashIni = tokenIni ? hashToken(tokenIni) : null;
  const daftarSesi = (sesi.data ?? []);

  let sesiIni: { created_at: string; expires_at: string; user_agent: string | null } | null = null;
  if (hashIni) {
    const { data } = await db.from('user_sessions')
      .select('created_at, expires_at, user_agent')
      .eq('token_hash', hashIni).maybeSingle();
    sesiIni = data ?? null;
  }

  return NextResponse.json({
    profil: profil.data,
    atasan: atasan.data ?? null,
    bawahan: bawahan.data ?? [],
    sandi_diperbarui: kredensial.data?.updated_at ?? null,
    jumlah_sesi: daftarSesi.length,
    sesi_ini: sesiIni,
  });
}

export async function PATCH(request: NextRequest) {
  const pengguna = await getSessionUser(request);
  if (!pengguna) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  const badan = await request.json().catch(() => ({}));
  const email = typeof badan.email === 'string' ? badan.email.trim() : null;
  const phone = typeof badan.phone === 'string' ? badan.phone.trim() : null;
  const division = typeof badan.division === 'string' ? badan.division.trim().slice(0, 60) : null;
  const salesDivision = typeof badan.sales_division === 'string'
    ? badan.sales_division.trim().slice(0, 60) : null;
  const position = typeof badan.position === 'string' ? badan.position.trim().slice(0, 60) : null;
  // Alamat: biodata pribadi, boleh disunting sendiri — beda dengan `role`/
  // `manager_id` yang keputusan struktur organisasi dan hanya berubah lewat
  // /api/admin/users.
  const address = typeof badan.address === 'string' ? badan.address.trim().slice(0, 300) : null;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Format email tidak sah.' }, { status: 400 });
  }
  if (phone && !/^[0-9+][0-9 ()-]{6,19}$/.test(phone)) {
    return NextResponse.json(
      { error: 'Nomor telepon hanya boleh angka, spasi, tanda kurung, dan tanda hubung.' },
      { status: 400 },
    );
  }

  const db = getAdminClient();

  const { data, error } = await db.from('users')
    .update({
      // Daftar kolom ditulis eksplisit. Menyebarkan isi badan permintaan
      // dengan spread akan membuat `role`, `active`, dan `approval_status`
      // bisa dititipkan dari klien — yaitu menaikkan diri sendiri jadi ADMIN
      // lewat satu permintaan.
      email: email || null,
      phone: phone || null,
      division: division || null,
      sales_division: salesDivision || null,
      position: position || null,
      address: address || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pengguna.id)
    .select(KOLOM_PROFIL)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('audit_trail').insert({
    actor_id: pengguna.id,
    action: 'PROFIL_KONTAK_DIUBAH',
    entity: 'users',
    entity_id: pengguna.id,
    detail: {
      email: email || null, phone: phone || null,
      division: division || null, sales_division: salesDivision || null,
      position: position || null, address: address || null,
    },
  });

  return NextResponse.json({ profil: data });
}
