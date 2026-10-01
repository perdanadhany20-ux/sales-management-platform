// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import { tolakJikaTakBerlisensi } from '@/lib/lisensi/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, isPengawas } from '@/lib/server-auth';
import { pesanGalat } from '@/lib/pesan-galat';

export const dynamic = 'force-dynamic';

/**
 * app/api/admin/locations — persetujuan lokasi yang diajukan Sales dari form
 * Proyek (lihat app/api/lokasi). Manager DAN Admin boleh memutuskan, sama
 * seperti hak kelola Lokasi Meeting yang sudah ada (sm_is_pengawas).
 *
 * Menyetujui mengaktifkan lokasi (active=true) sehingga baru sesudah ini ia
 * bisa dipilih di formulir jadwal — sebelum disetujui, radius dan titiknya
 * sudah tersimpan tapi TIDAK bisa dipakai untuk check-in mana pun.
 */
export async function PATCH(request: NextRequest) {
  const pemanggil = await getSessionUser(request);
  if (!pemanggil) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }
  if (!isPengawas(pemanggil.role)) {
    return NextResponse.json({ error: 'Hanya pengawas (Manager, Admin, Director, Finance) yang boleh memutuskan lokasi.' }, { status: 403 });
  }
  const tolak = await tolakJikaTakBerlisensi('meeting', 'project');
  if (tolak) return tolak;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? '');
  const keputusan = String(body.approval_status ?? '').toUpperCase();

  if (!id) return NextResponse.json({ error: 'ID lokasi wajib diisi.' }, { status: 400 });
  if (!['DISETUJUI', 'DITOLAK'].includes(keputusan)) {
    return NextResponse.json({ error: 'Status persetujuan tidak dikenal.' }, { status: 400 });
  }

  const db = getAdminClient();
  const perubahan: Record<string, unknown> = {
    approval_status: keputusan,
    approved_by: pemanggil.id,
    approved_at: new Date().toISOString(),
  };

  if (keputusan === 'DITOLAK') {
    const alasan = String(body.rejection_reason ?? '').trim();
    if (alasan.length < 10) {
      return NextResponse.json({ error: 'Alasan penolakan wajib diisi minimal 10 karakter.' }, { status: 400 });
    }
    perubahan.rejection_reason = alasan;
    perubahan.active = false;
  } else {
    perubahan.rejection_reason = null;
    perubahan.active = true;
  }

  const { error } = await db.from('sm_locations').update(perubahan).eq('id', id);
  if (error) return NextResponse.json({ error: pesanGalat(error) }, { status: 500 });

  await db.from('audit_trail').insert({
    actor_id: pemanggil.id, actor_name: pemanggil.full_name,
    action: keputusan === 'DISETUJUI' ? 'LOKASI_DISETUJUI' : 'LOKASI_DITOLAK',
    entity: 'sm_locations', entity_id: id, detail: perubahan,
  });

  return NextResponse.json({ ok: true });
}
