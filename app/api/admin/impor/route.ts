// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, isAdmin } from '@/lib/server-auth';
import { tolakJikaTakBerlisensi } from '@/lib/lisensi/server';
import type { KunciFitur } from '@/lib/lisensi/kontrak';
import { pesanGalat } from '@/lib/pesan-galat';
import {
  DEFINISI_IMPOR, MAKS_BARIS_IMPOR, validasiBaris, kunciDuplikat, type JenisImpor, type BarisValid,
} from '@/lib/impor-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * app/api/admin/impor — impor data lama dari Excel (migrasi 043).
 *
 * Lewat server, bukan langsung dari browser: baris yang diimpor milik Sales
 * lain, dan RLS (benar) melarang siapa pun menulis atas nama orang lain.
 * Maka penulisan memakai service role SETELAH peran Admin diperiksa dari
 * sesi di database — peran kiriman klien tidak pernah dipercaya — dan setiap
 * baris dinilai ulang dengan aturan yang sama dengan pratinjau
 * (lib/impor-data.ts), karena hasil pratinjau bisa saja diubah di klien.
 *
 * POST   { jenis, nama_berkas, sales_bawaan, baris: [{ no, nilai }] }
 * GET    riwayat impor
 * DELETE ?id=…  membatalkan satu kali impor
 */

const TABEL: Record<JenisImpor, string> = {
  customer: 'sm_customers', daily_report: 'sm_daily_reports', pipeline: 'sm_pipeline', schedule: 'sm_schedules',
};

async function penjaga(request: NextRequest) {
  const pemanggil = await getSessionUser(request);
  if (!pemanggil) return { galat: NextResponse.json({ error: 'Sesi tidak ditemukan.' }, { status: 401 }) };
  if (!isAdmin(pemanggil.role)) return { galat: NextResponse.json({ error: 'Hanya Admin yang boleh mengimpor data.' }, { status: 403 }) };
  const tolak = await tolakJikaTakBerlisensi('admin_settings');
  if (tolak) return { galat: tolak };
  return { pemanggil };
}

const hariIniWib = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
const normal = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Ambil semua baris (melewati batas 1000 baris PostgREST) secara bertahap. */
async function ambilSemua<T>(buat: (dari: number, sampai: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const hasil: T[] = [];
  for (let dari = 0; dari < 50_000; dari += 1000) {
    const { data, error } = await buat(dari, dari + 999);
    if (error) throw error;
    hasil.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return hasil;
}

export async function GET(request: NextRequest) {
  const { galat } = await penjaga(request);
  if (galat) return galat;
  const db = getAdminClient();
  const { data, error } = await db.from('sm_impor')
    .select('id, jenis, nama_berkas, jumlah, dilewati, dibuat_oleh, created_at, dibatalkan_at')
    .order('created_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: pesanGalat(error) }, { status: 500 });
  return NextResponse.json({ riwayat: data ?? [] });
}

interface BarisMasuk { no: number; nilai: Record<string, unknown> }

export async function POST(request: NextRequest) {
  const { galat, pemanggil } = await penjaga(request);
  if (galat) return galat;

  const body = await request.json().catch(() => ({}));
  const jenis = String(body.jenis ?? '') as JenisImpor;
  const def = DEFINISI_IMPOR[jenis];
  if (!def) return NextResponse.json({ error: 'Jenis data tidak dikenal.' }, { status: 400 });
  const tolakModul = await tolakJikaTakBerlisensi(def.fitur as KunciFitur);
  if (tolakModul) return tolakModul;

  const baris: BarisMasuk[] = Array.isArray(body.baris) ? body.baris : [];
  if (baris.length === 0) return NextResponse.json({ error: 'Tidak ada baris untuk diimpor.' }, { status: 400 });
  if (baris.length > MAKS_BARIS_IMPOR) {
    return NextResponse.json({ error: `Maksimal ${MAKS_BARIS_IMPOR} baris per berkas. Pecah berkasnya menjadi beberapa bagian.` }, { status: 400 });
  }

  const db = getAdminClient();

  // ── Sales yang dikenal: username atau nama lengkap, akun aktif ──
  const { data: pengguna, error: galatUser } = await db.from('users').select('id, username, full_name, active');
  if (galatUser) return NextResponse.json({ error: pesanGalat(galatUser) }, { status: 500 });
  const petaSales = new Map<string, string>();
  for (const u of (pengguna ?? []) as { id: string; username: string; full_name: string; active: boolean }[]) {
    if (!u.active) continue;
    petaSales.set(normal(u.username), u.id);
    if (!petaSales.has(normal(u.full_name))) petaSales.set(normal(u.full_name), u.id);
  }
  const salesBawaan = typeof body.sales_bawaan === 'string' && [...petaSales.values()].includes(body.sales_bawaan) ? body.sales_bawaan : null;
  const konteks = { cariSales: (t: string) => petaSales.get(normal(t)) ?? null, salesBawaan, hariIni: hariIniWib() };

  // ── Nilai ulang setiap baris ──
  const ditolak: { no: number; galat: string[] }[] = [];
  const valid: (BarisValid & { no: number })[] = [];
  for (const b of baris) {
    const r = validasiBaris(jenis, (b?.nilai ?? {}) as Record<string, unknown>, konteks);
    if (r.ok) valid.push({ ...r.baris, no: Number(b.no) || 0 }); else ditolak.push({ no: Number(b.no) || 0, galat: r.galat });
  }

  // ── Duplikat: di dalam berkas & yang sudah ada di platform ──
  const salesIds = [...new Set(valid.map((v) => v.sales_user_id))];
  const sudahAda = new Set<string>();
  try {
    if (salesIds.length) {
      if (jenis === 'customer') {
        const ada = await ambilSemua<{ created_by: string; name: string }>((a, z) =>
          db.from('sm_customers').select('created_by, name').in('created_by', salesIds).range(a, z));
        ada.forEach((r) => sudahAda.add(kunciDuplikat('customer', r.created_by, r)));
      } else if (jenis === 'daily_report') {
        const ada = await ambilSemua<{ sales_user_id: string; report_date: string; customer_name: string; activity: string }>((a, z) =>
          db.from('sm_daily_reports').select('sales_user_id, report_date, customer_name, activity').in('sales_user_id', salesIds).range(a, z));
        ada.forEach((r) => sudahAda.add(kunciDuplikat('daily_report', r.sales_user_id, r)));
      } else if (jenis === 'pipeline') {
        const ada = await ambilSemua<{ sales_user_id: string; customer_name: string; project_detail: string; pipeline_date: string }>((a, z) =>
          db.from('sm_pipeline').select('sales_user_id, customer_name, project_detail, pipeline_date').in('sales_user_id', salesIds).range(a, z));
        ada.forEach((r) => sudahAda.add(kunciDuplikat('pipeline', r.sales_user_id, r)));
      } else {
        const ada = await ambilSemua<{ assigned_to: string; schedule_date: string; schedule_time: string | null; customer_name: string }>((a, z) =>
          db.from('sm_schedules').select('assigned_to, schedule_date, schedule_time, customer_name').in('assigned_to', salesIds).range(a, z));
        ada.forEach((r) => sudahAda.add(kunciDuplikat('schedule', r.assigned_to, r)));
      }
    }
  } catch (e) {
    return NextResponse.json({ error: pesanGalat(e as { message?: string }) }, { status: 500 });
  }

  const dilewati: { no: number; alasan: string }[] = [];
  const masuk: typeof valid = [];
  for (const v of valid) {
    const k = kunciDuplikat(jenis, v.sales_user_id, v.data);
    if (sudahAda.has(k)) { dilewati.push({ no: v.no, alasan: 'Sudah ada di platform (atau terulang di berkas).' }); continue; }
    sudahAda.add(k);
    masuk.push(v);
  }

  if (masuk.length === 0) {
    return NextResponse.json({ impor_id: null, masuk: 0, dilewati, ditolak });
  }

  // ── Catat satu kali impor ──
  const { data: impor, error: galatImpor } = await db.from('sm_impor').insert({
    jenis, nama_berkas: String(body.nama_berkas ?? '').slice(0, 200) || null, dibuat_oleh: pemanggil!.id,
  }).select('id').single();
  if (galatImpor || !impor) return NextResponse.json({ error: pesanGalat(galatImpor) }, { status: 500 });
  const imporId = impor.id as string;

  try {
    if (jenis === 'customer') {
      await sisipBertahap(db, 'sm_customers', masuk.map((v) => ({
        name: v.data.name, segment: v.data.segment, contact_person: v.data.contact_person,
        contact_position: v.data.contact_position, phone: v.data.phone, email: v.data.email,
        address: v.data.address, city: v.data.city, notes: v.data.notes,
        created_by: v.sales_user_id, impor_id: imporId,
      })));
    } else {
      const idCustomer = await pastikanCustomer(db, masuk, imporId);
      const cid = (v: BarisValid) => idCustomer.get(`${v.sales_user_id}|${normal(v.data.customer_name)}`) ?? null;
      if (jenis === 'daily_report') {
        await sisipBertahap(db, 'sm_daily_reports', masuk.map((v) => ({
          sales_user_id: v.sales_user_id, report_date: v.data.report_date, customer_id: cid(v),
          customer_name: v.data.customer_name, contact_person: v.data.contact_person, position: v.data.position,
          phone_whatsapp: v.data.phone_whatsapp, lead_project: v.data.lead_project,
          activity: v.data.activity, result: v.data.result, next_action: v.data.next_action, impor_id: imporId,
        })));
      } else if (jenis === 'pipeline') {
        await sisipBertahap(db, 'sm_pipeline', masuk.map((v) => ({
          sales_user_id: v.sales_user_id, pipeline_date: v.data.pipeline_date, customer_id: cid(v),
          customer_name: v.data.customer_name, contact_person: v.data.contact_person, project_detail: v.data.project_detail,
          quantity: v.data.quantity, unit: v.data.unit, project_value: v.data.project_value, project_hpp: v.data.project_hpp,
          probability: v.data.probability, stage: v.data.stage, estimated_closing: v.data.estimated_closing,
          won_at: v.data.won_at, next_action: v.data.next_action, impor_id: imporId,
        })));
      } else {
        await sisipBertahap(db, 'sm_schedules', masuk.map((v) => ({
          schedule_date: v.data.schedule_date, schedule_time: v.data.schedule_time, customer_id: cid(v),
          customer_name: v.data.customer_name, project: v.data.project, category: v.data.category,
          detail: v.data.detail, notes: v.data.notes, requires_attendance: false,
          assigned_to: v.sales_user_id, status: v.data.status, created_by: pemanggil!.id,
          completed_at: v.data.status === 'COMPLETED'
            ? new Date(`${v.data.schedule_date}T${(v.data.schedule_time as string | null) ?? '17:00'}:00+07:00`).toISOString() : null,
          impor_id: imporId,
        })));
      }
    }
  } catch (e) {
    // Gagal di tengah jalan → buang semua yang sempat masuk, supaya tidak ada
    // impor setengah jadi yang membingungkan.
    await hapusImpor(db, jenis, imporId);
    await db.from('sm_impor').delete().eq('id', imporId);
    return NextResponse.json({ error: `Impor dibatalkan, tidak ada data yang masuk: ${pesanGalat(e as { message?: string })}` }, { status: 500 });
  }

  await db.from('sm_impor').update({ jumlah: masuk.length, dilewati: dilewati.length + ditolak.length }).eq('id', imporId);
  await db.from('audit_trail').insert({
    actor_id: pemanggil!.id, actor_name: pemanggil!.full_name,
    action: 'DATA_DIIMPOR', entity: 'sm_impor', entity_id: imporId,
    detail: { jenis: def.label, berkas: body.nama_berkas ?? null, masuk: masuk.length, dilewati: dilewati.length, ditolak: ditolak.length },
  });

  return NextResponse.json({ impor_id: imporId, masuk: masuk.length, dilewati, ditolak });
}

async function sisipBertahap(db: SupabaseClient, tabel: string, baris: Record<string, unknown>[]) {
  for (let i = 0; i < baris.length; i += 500) {
    const { error } = await db.from(tabel).insert(baris.slice(i, i + 500));
    if (error) throw error;
  }
}

/** Customer per Sales: pakai yang sudah ada (nama sama, pemilik sama),
 *  buat yang belum ada — ditandai impor_id supaya ikut terbatalkan. */
async function pastikanCustomer(db: SupabaseClient, masuk: BarisValid[], imporId: string): Promise<Map<string, string>> {
  const peta = new Map<string, string>();
  const salesIds = [...new Set(masuk.map((v) => v.sales_user_id))];
  const ada = await ambilSemua<{ id: string; created_by: string; name: string }>((a, z) =>
    db.from('sm_customers').select('id, created_by, name').in('created_by', salesIds).range(a, z));
  for (const c of ada) peta.set(`${c.created_by}|${normal(c.name)}`, c.id);

  const baru = new Map<string, { name: string; created_by: string; impor_id: string }>();
  for (const v of masuk) {
    const k = `${v.sales_user_id}|${normal(v.data.customer_name)}`;
    if (!peta.has(k) && !baru.has(k)) baru.set(k, { name: String(v.data.customer_name).trim(), created_by: v.sales_user_id, impor_id: imporId });
  }
  const daftar = [...baru.values()];
  for (let i = 0; i < daftar.length; i += 500) {
    const { data, error } = await db.from('sm_customers').insert(daftar.slice(i, i + 500)).select('id, created_by, name');
    if (error) throw error;
    for (const c of (data ?? []) as { id: string; created_by: string; name: string }[]) peta.set(`${c.created_by}|${normal(c.name)}`, c.id);
  }
  return peta;
}

/** Hapus semua baris satu kali impor, termasuk customer yang ia buat dan
 *  tidak dipakai catatan lain. */
async function hapusImpor(db: SupabaseClient, jenis: JenisImpor, imporId: string) {
  if (jenis !== 'customer') {
    const { error } = await db.from(TABEL[jenis]).delete().eq('impor_id', imporId);
    if (error) throw error;
  }
  const { data: cust } = await db.from('sm_customers').select('id').eq('impor_id', imporId);
  const ids: string[] = (cust ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return;
  const dipakai = new Set<string>();
  for (const t of ['sm_daily_reports', 'sm_pipeline', 'sm_schedules', 'sm_projects', 'sm_gp_calculations']) {
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await db.from(t).select('customer_id').in('customer_id', ids.slice(i, i + 300));
      (data ?? []).forEach((r: { customer_id: string }) => dipakai.add(r.customer_id));
    }
  }
  const bebas = ids.filter((id) => !dipakai.has(id));
  for (let i = 0; i < bebas.length; i += 300) {
    const { error } = await db.from('sm_customers').delete().in('id', bebas.slice(i, i + 300));
    if (error) throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const { galat, pemanggil } = await penjaga(request);
  if (galat) return galat;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  const db = getAdminClient();
  const { data: impor } = await db.from('sm_impor').select('id, jenis, nama_berkas, dibatalkan_at').eq('id', id).maybeSingle();
  if (!impor) return NextResponse.json({ error: 'Riwayat impor tidak ditemukan.' }, { status: 404 });
  if (impor.dibatalkan_at) return NextResponse.json({ error: 'Impor ini sudah dibatalkan.' }, { status: 409 });
  try {
    await hapusImpor(db, impor.jenis as JenisImpor, id);
  } catch (e) {
    return NextResponse.json({ error: pesanGalat(e as { message?: string }) }, { status: 500 });
  }
  await db.from('sm_impor').update({ dibatalkan_at: new Date().toISOString(), dibatalkan_oleh: pemanggil!.id }).eq('id', id);
  await db.from('audit_trail').insert({
    actor_id: pemanggil!.id, actor_name: pemanggil!.full_name,
    action: 'IMPOR_DIBATALKAN', entity: 'sm_impor', entity_id: id,
    detail: { jenis: DEFINISI_IMPOR[impor.jenis as JenisImpor]?.label ?? impor.jenis, berkas: impor.nama_berkas },
  });
  return NextResponse.json({ ok: true });
}
