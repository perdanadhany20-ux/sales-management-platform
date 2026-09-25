import { NextResponse, type NextRequest } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, isPengawas } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * app/api/lokasi — Sales pin lokasi customer langsung dari form Proyek.
 *
 * Lewat route handler, BUKAN langsung dari browser ke PostgREST, karena satu
 * hal yang tidak boleh dipercayakan ke klien: radius GPS. Nilai itu dipakai
 * sm_check_in() untuk memutuskan sah-tidaknya kehadiran (migrasi 004) — kalau
 * Sales bisa mengirim radius sendiri lewat body permintaan, verifikasi lokasi
 * kehilangan arti persis seperti yang dicatat di TabLokasi.tsx. Radius di
 * sini SELALU diambil dari sm_settings('default_gps_radius_m'), tidak pernah
 * dari body.
 *
 * Sales yang mengajukan mendapat approval_status MENUNGGU dan active=false —
 * lokasinya tidak bisa dipilih di jadwal manapun sampai admin/manager
 * menyetujuinya lewat PATCH /api/admin/locations. Admin/Manager yang
 * mengajukan lewat jalur yang sama langsung disetujui, sama seperti perilaku
 * menu Lokasi Meeting yang sudah ada.
 */
export async function POST(request: NextRequest) {
  const pemanggil = await getSessionUser(request);
  if (!pemanggil) {
    return NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  const address = String(body.address ?? '').trim();
  const projectId = String(body.project_id ?? '').trim();
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);

  if (!name) return NextResponse.json({ error: 'Nama lokasi wajib diisi.' }, { status: 400 });
  if (!projectId) return NextResponse.json({ error: 'Proyek wajib diisi.' }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Koordinat tidak sah.' }, { status: 400 });
  }

  const db = getAdminClient();

  // Kepemilikan proyek diperiksa ulang di server — bukan sekadar percaya
  // project_id yang dikirim klien memang milik pemanggil.
  const { data: proyek, error: galatProyek } = await db
    .from('sm_projects').select('id, owner_user_id').eq('id', projectId).maybeSingle();
  if (galatProyek) return NextResponse.json({ error: galatProyek.message }, { status: 500 });
  if (!proyek) return NextResponse.json({ error: 'Proyek tidak ditemukan.' }, { status: 404 });
  if (proyek.owner_user_id !== pemanggil.id && !isPengawas(pemanggil.role)) {
    return NextResponse.json({ error: 'Anda tidak berhak menautkan lokasi ke proyek ini.' }, { status: 403 });
  }

  const { data: pengaturan } = await db
    .from('sm_settings').select('value').eq('key', 'default_gps_radius_m').maybeSingle();
  const radius = Number(pengaturan?.value) || 50;

  const pengawas = isPengawas(pemanggil.role);

  const { data: lokasi, error: galatLokasi } = await db
    .from('sm_locations')
    .insert({
      name,
      address: address || null,
      latitude: lat,
      longitude: lng,
      gps_radius_m: radius,
      active: pengawas,
      project_id: projectId,
      created_by: pemanggil.id,
      approval_status: pengawas ? 'DISETUJUI' : 'MENUNGGU',
      approved_by: pengawas ? pemanggil.id : null,
      approved_at: pengawas ? new Date().toISOString() : null,
    })
    .select('id, name, address, latitude, longitude, gps_radius_m, active, approval_status')
    .single();

  if (galatLokasi) return NextResponse.json({ error: galatLokasi.message }, { status: 500 });

  const { error: galatTaut } = await db
    .from('sm_projects').update({ location_id: lokasi.id }).eq('id', projectId);
  if (galatTaut) return NextResponse.json({ error: galatTaut.message }, { status: 500 });

  await db.from('audit_trail').insert({
    actor_id: pemanggil.id, actor_name: pemanggil.full_name,
    action: pengawas ? 'LOKASI_DIBUAT' : 'LOKASI_DIAJUKAN',
    entity: 'sm_locations', entity_id: lokasi.id,
    detail: { name, project_id: projectId },
  });

  return NextResponse.json({ lokasi });
}
