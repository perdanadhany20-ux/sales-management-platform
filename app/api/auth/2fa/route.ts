// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import {
  rahasiaBaru, enkripsi, dekripsi, periksaKode, uriOtpauth, kodeCadanganBaru, hashCadangan,
} from '@/lib/totp';

export const dynamic = 'force-dynamic';

/**
 * /api/auth/2fa — kelola verifikasi dua langkah milik pengguna yang login.
 *   GET                                   → { aktif, sisa_cadangan }
 *   POST { aksi: 'mulai' }                → rahasia baru (belum aktif) + QR
 *   POST { aksi: 'aktifkan', kode }       → aktif + 8 kode cadangan (tampil sekali)
 *   POST { aksi: 'cadangan', sandi }      → ganti kode cadangan
 *   POST { aksi: 'matikan', sandi, kode } → hapus 2FA
 * Mematikan & membuat ulang kode cadangan wajib sandi: sesi yang tertinggal
 * terbuka di komputer lain tidak cukup untuk melepas pengaman ini.
 */
export async function GET(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const { data } = await getAdminClient().from('user_mfa')
    .select('aktif, kode_cadangan, diaktifkan_at').eq('user_id', p.id).maybeSingle();
  return NextResponse.json({
    aktif: Boolean(data?.aktif),
    sisa_cadangan: data?.aktif ? (data.kode_cadangan?.length ?? 0) : 0,
    diaktifkan_at: data?.aktif ? data.diaktifkan_at : null,
  });
}

async function sandiBenar(userId: string, sandi: unknown): Promise<boolean> {
  if (typeof sandi !== 'string' || !sandi || sandi.length > 128) return false;
  const { data } = await getAdminClient().from('user_credentials').select('password_hash').eq('user_id', userId).maybeSingle();
  return data ? bcrypt.compare(sandi, data.password_hash) : false;
}

export async function POST(request: NextRequest) {
  const p = await getSessionUser(request);
  if (!p) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = getAdminClient();
  const { data: mfa } = await db.from('user_mfa')
    .select('rahasia_enc, aktif, langkah_terakhir').eq('user_id', p.id).maybeSingle();

  const catat = (action: string) => db.from('audit_trail').insert({
    actor_id: p.id, actor_name: p.full_name, action, entity: 'users', entity_id: p.id, detail: {},
  });

  try {
    switch (body.aksi) {
      case 'mulai': {
        if (mfa?.aktif) return NextResponse.json({ error: 'Verifikasi dua langkah sudah aktif.' }, { status: 409 });
        const rahasia = rahasiaBaru();
        const { error } = await db.from('user_mfa').upsert({
          user_id: p.id, rahasia_enc: enkripsi(rahasia), aktif: false, langkah_terakhir: 0, kode_cadangan: [],
          dibuat_at: new Date().toISOString(), diaktifkan_at: null,
        });
        if (error) throw error;
        // Nama penerbit di aplikasi authenticator = nama platform di Branding.
        const { data: s } = await db.from('sm_settings').select('value').eq('key', 'branding').maybeSingle();
        const merek = (s?.value ?? {}) as { nama_pendek?: string; nama_platform?: string };
        const uri = uriOtpauth(rahasia, p.username, merek.nama_pendek || merek.nama_platform || 'Sales Management');
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
        return NextResponse.json({ rahasia, qr });
      }

      case 'aktifkan': {
        if (!mfa || mfa.aktif) return NextResponse.json({ error: 'Mulai ulang pengaturan 2FA.' }, { status: 409 });
        const langkah = periksaKode(dekripsi(mfa.rahasia_enc), String(body.kode ?? ''), 0);
        if (langkah === null) {
          return NextResponse.json({ error: 'Kode tidak cocok. Pastikan jam HP otomatis, lalu masukkan kode terbaru.' }, { status: 400 });
        }
        const cadangan = kodeCadanganBaru();
        const { error } = await db.from('user_mfa').update({
          aktif: true, langkah_terakhir: langkah, kode_cadangan: cadangan.map(hashCadangan),
          diaktifkan_at: new Date().toISOString(),
        }).eq('user_id', p.id);
        if (error) throw error;
        await catat('MFA_DIAKTIFKAN');
        return NextResponse.json({ ok: true, kode_cadangan: cadangan });
      }

      case 'cadangan': {
        if (!mfa?.aktif) return NextResponse.json({ error: 'Verifikasi dua langkah belum aktif.' }, { status: 409 });
        if (!(await sandiBenar(p.id, body.sandi))) return NextResponse.json({ error: 'Kata sandi salah.' }, { status: 400 });
        const cadangan = kodeCadanganBaru();
        const { error } = await db.from('user_mfa').update({ kode_cadangan: cadangan.map(hashCadangan) }).eq('user_id', p.id);
        if (error) throw error;
        await catat('MFA_KODE_CADANGAN_BARU');
        return NextResponse.json({ ok: true, kode_cadangan: cadangan });
      }

      case 'matikan': {
        if (!mfa?.aktif) return NextResponse.json({ error: 'Verifikasi dua langkah belum aktif.' }, { status: 409 });
        if (!(await sandiBenar(p.id, body.sandi))) return NextResponse.json({ error: 'Kata sandi salah.' }, { status: 400 });
        if (periksaKode(dekripsi(mfa.rahasia_enc), String(body.kode ?? ''), Number(mfa.langkah_terakhir)) === null) {
          return NextResponse.json({ error: 'Kode authenticator salah.' }, { status: 400 });
        }
        const { error } = await db.from('user_mfa').delete().eq('user_id', p.id);
        if (error) throw error;
        await catat('MFA_DIMATIKAN');
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'MFA_KUNCI_BELUM_DISET') {
      return NextResponse.json({ error: 'Server belum siap untuk 2FA (SUPABASE_JWT_SECRET belum diset). Hubungi Admin.' }, { status: 503 });
    }
    console.error('[2fa]', e);
    return NextResponse.json({ error: 'Gagal memproses verifikasi dua langkah.' }, { status: 500 });
  }
}
