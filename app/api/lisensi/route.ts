import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { getAdminClient } from '@/lib/supabase-admin';
import { statusLisensi, peringatanLisensi } from '@/lib/lisensi/server';
import { LABEL_PAKET, pesanKode } from '@/lib/lisensi/kontrak';

export const dynamic = 'force-dynamic';

/**
 * GET /api/lisensi — keadaan lisensi deployment ini.
 *
 * Setiap pengguna yang masuk mendapat bagian yang ia butuhkan untuk
 * menggambar navigasi: fitur yang aktif dan peringatan keadaan terbatas.
 * Admin mendapat rinciannya (masa berlaku, permintaan, pemeriksaan terakhir,
 * riwayat peristiwa). Tidak ada kunci, token, atau alamat Authority yang
 * pernah keluar dari sini (§17, §51).
 *
 * Panggilan ini juga "detak" verifikasi: bila salinan sudah jatuh tempo,
 * server menghubungi Authority di sini — tidak di setiap halaman (§59).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });

  const s = await statusLisensi();
  const e = s.evaluasi;
  const pesan = pesanKode(e.kode);

  const ringkas = {
    kode: e.kode,
    status: e.status,
    berlaku: e.berlaku,
    fitur: e.fitur,
    judul: pesan.judul,
    keterangan: pesan.keterangan,
    paket: s.muatan ? (LABEL_PAKET[s.muatan.package] ?? s.muatan.package) : null,
    sisa_hari: e.sisaHari,
    peringatan: peringatanLisensi(e),
    mode_pengembangan: s.modePengembangan,
  };

  if (!isAdmin(user.role)) return NextResponse.json({ lisensi: ringkas });

  const { data: peristiwa } = await getAdminClient()
    .from('audit_trail')
    .select('id, action, actor_name, detail, created_at')
    .eq('entity', 'lisensi')
    .order('created_at', { ascending: false })
    .limit(20);

  const m = s.muatan;
  return NextResponse.json({
    lisensi: {
      ...ringkas,
      detail: {
        perusahaan: m?.company_name ?? null,
        license_id: m?.license_id ?? null,
        deployment_id: m?.deployment_id ?? null,
        paket_kode: m?.package ?? null,
        jenis: m?.license_type ?? null,
        mulai: m?.starts_at ?? null,
        berakhir: m?.expires_at ?? null,
        fitur_peta: m?.features ?? null,
        permintaan: m?.requests ?? [],
        dikonfigurasi: s.dikonfigurasi,
        terakhir_terverifikasi: s.terakhirTerverifikasi,
        terakhir_gagal: s.terakhirGagal,
        galat_terakhir: s.galatTerakhir ? pesanKode(s.galatTerakhir).judul : null,
        tenggang_berakhir: e.tenggangBerakhir,
        versi: s.versi,
      },
      peristiwa: peristiwa ?? [],
    },
  });
}
