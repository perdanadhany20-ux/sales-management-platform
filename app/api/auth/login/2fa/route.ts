// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';
import { buatSesi, pasangCookieSesi, ipPemanggil } from '@/lib/server-auth';
import { bacaTiket, dekripsi, periksaKode, hashCadangan } from '@/lib/totp';

export const dynamic = 'force-dynamic';

const BATAS_GAGAL = 8;
const JENDELA_MENIT = 15;

/**
 * POST /api/auth/login/2fa — langkah kedua login.
 * Body: { tiket, kode } — kode 6 digit authenticator ATAU kode cadangan.
 * Percobaan gagal ikut dihitung di login_attempts (batas yang sama dengan
 * sandi), jadi kode 6 digit tidak bisa ditebak beruntun.
 */
export async function POST(request: NextRequest) {
  const { tiket, kode } = await request.json().catch(() => ({}));
  if (typeof tiket !== 'string' || typeof kode !== 'string' || !kode.trim()) {
    return NextResponse.json({ error: 'Kode verifikasi wajib diisi.' }, { status: 400 });
  }
  let userId: string | null;
  try { userId = bacaTiket(tiket); } catch { userId = null; }
  if (!userId) {
    return NextResponse.json({ error: 'Sesi verifikasi berakhir. Masukkan ulang username dan kata sandi.', ulang: true }, { status: 401 });
  }

  const db = getAdminClient();
  const ip = ipPemanggil(request);
  const { data: user } = await db.from('users')
    .select('id, username, full_name, role, active').eq('id', userId).maybeSingle();
  if (!user || !user.active) {
    return NextResponse.json({ error: 'Sesi verifikasi berakhir. Masukkan ulang username dan kata sandi.', ulang: true }, { status: 401 });
  }

  const sejak = new Date(Date.now() - JENDELA_MENIT * 60_000).toISOString();
  const { count: gagal } = await db.from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('username', user.username).eq('success', false).gte('attempted_at', sejak);
  if ((gagal ?? 0) >= BATAS_GAGAL) {
    return NextResponse.json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${JENDELA_MENIT} menit.` }, { status: 429 });
  }

  const { data: mfa } = await db.from('user_mfa')
    .select('rahasia_enc, aktif, langkah_terakhir, kode_cadangan').eq('user_id', user.id).maybeSingle();
  if (!mfa?.aktif) {
    return NextResponse.json({ error: 'Sesi verifikasi berakhir. Masukkan ulang username dan kata sandi.', ulang: true }, { status: 401 });
  }

  const masukan = kode.trim();
  let sah = false;
  let pakaiCadangan = false;
  if (/^\d{3}\s?\d{3}$/.test(masukan)) {
    const langkah = periksaKode(dekripsi(mfa.rahasia_enc), masukan, Number(mfa.langkah_terakhir));
    if (langkah !== null) {
      // Simpan bersyarat: dua permintaan serentak dengan kode yang sama
      // hanya satu yang lolos.
      const { data: ok } = await db.from('user_mfa').update({ langkah_terakhir: langkah })
        .eq('user_id', user.id).lt('langkah_terakhir', langkah).select('user_id');
      sah = Boolean(ok?.length);
    }
  } else {
    const h = hashCadangan(masukan);
    const daftar: string[] = mfa.kode_cadangan ?? [];
    if (daftar.includes(h)) {
      const { data: ok } = await db.from('user_mfa').update({ kode_cadangan: daftar.filter((x) => x !== h) })
        .eq('user_id', user.id).contains('kode_cadangan', [h]).select('user_id');
      sah = Boolean(ok?.length);
      pakaiCadangan = sah;
    }
  }

  await db.from('login_attempts').insert({ username: user.username, ip, success: sah });
  if (!sah) return NextResponse.json({ error: 'Kode verifikasi salah atau sudah dipakai.' }, { status: 401 });

  if (pakaiCadangan) {
    await db.from('audit_trail').insert({
      actor_id: user.id, actor_name: user.full_name, action: 'MFA_KODE_CADANGAN_DIPAKAI',
      entity: 'users', entity_id: user.id, detail: { sisa: (mfa.kode_cadangan?.length ?? 1) - 1 },
    });
  }

  const { data: kred } = await db.from('user_credentials').select('must_change').eq('user_id', user.id).maybeSingle();
  const wajibGantiSandi = Boolean(kred?.must_change);
  const { token, kedaluwarsa } = await buatSesi(request, user.id);
  const res = NextResponse.json({
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, wajib_ganti_sandi: wajibGantiSandi },
    db_token: wajibGantiSandi ? null : issueDbToken(user),
    sisa_cadangan: pakaiCadangan ? (mfa.kode_cadangan?.length ?? 1) - 1 : undefined,
  });
  pasangCookieSesi(res, token, kedaluwarsa);
  return res;
}
