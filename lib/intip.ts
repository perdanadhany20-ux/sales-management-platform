'use client';

import { supabase } from './supabase';
import { tanggalISO, tanggalPendek, rupiahRingkas, persen } from './format';
import { STATUS_JADWAL, type StatusJadwal } from './constants';

/**
 * lib/intip.ts — isi jendela kecil di balik lencana header.
 *
 * Versi pertama lencana ini menautkan langsung ke halaman modulnya. Itu keliru
 * dan langsung terasa saat dipakai: angka "3" di lencana Meeting tidak
 * memberitahu meeting yang MANA, sehingga menekannya selalu berarti membuka
 * halaman penuh lalu mencari sendiri. Lencana yang menuntut pencarian ulang
 * setiap kali hanya memindahkan pekerjaan, bukan menghematnya.
 *
 * Karena itu setiap lencana kini membuka daftar pendek berisi butir
 * sesungguhnya, dan setiap butir menuju ke BARIS ITU — bukan ke halamannya.
 */

export interface ButirIntip {
  id: string;
  judul: string;
  keterangan: string;
  /** Angka atau label pendek di sisi kanan, mis. jam atau nilai proyek. */
  kanan?: string;
  /** Tujuan, sudah termasuk penanda fokus baris. */
  href: string;
  warna?: string;
}

/** Jumlah butir yang ditampilkan. Lebih dari ini bukan lagi "mengintip". */
const BATAS = 6;

function hrefFokus(rute: string, id: string): string {
  return `${rute}?fokus=${id}`;
}

/* ── Daily Report ─────────────────────────────────────────────────────────── */

export async function intipDailyReport(userId: string): Promise<ButirIntip[]> {
  const hariIni = tanggalISO();

  const { data } = await supabase
    .from('sm_daily_reports')
    .select('id, customer_name, activity, report_date')
    .eq('sales_user_id', userId)
    .eq('report_date', hariIni)
    .order('created_at', { ascending: false })
    .limit(BATAS);

  const isi = (data ?? []) as {
    id: string; customer_name: string; activity: string; report_date: string;
  }[];

  if (isi.length === 0) {
    // Bukan daftar kosong melainkan satu butir yang bisa ditindaklanjuti:
    // yang dicari orang saat membuka lencana ini justru tombol mengisinya.
    return [{
      id: 'kosong',
      judul: 'Laporan hari ini belum diisi',
      keterangan: 'Isi sebelum jam kerja berakhir.',
      href: '/daily-report',
      warna: '#e34948',
    }];
  }

  return isi.map((r) => ({
    id: r.id,
    judul: r.customer_name,
    keterangan: r.activity,
    kanan: '✓',
    href: hrefFokus('/daily-report', r.id),
    warna: '#008300',
  }));
}

/* ── Meeting hari ini ─────────────────────────────────────────────────────── */

export async function intipMeeting(userId: string, pengawas: boolean): Promise<ButirIntip[]> {
  const hariIni = tanggalISO();

  let q = supabase
    .from('sm_schedules')
    .select('id, customer_name, schedule_time, status, sm_locations ( name )')
    .eq('requires_attendance', true)
    .eq('schedule_date', hariIni)
    .in('status', ['UPCOMING', 'IN_PROGRESS'])
    .order('schedule_time', { ascending: true, nullsFirst: false })
    .limit(BATAS);

  if (!pengawas) q = q.eq('assigned_to', userId);

  const { data } = await q;

  return ((data ?? []) as unknown[]).map((r) => {
    const b = r as {
      id: string; customer_name: string; schedule_time: string | null; status: string;
      sm_locations: { name: string } | { name: string }[] | null;
    };
    const lok = Array.isArray(b.sm_locations) ? b.sm_locations[0] : b.sm_locations;
    return {
      id: b.id,
      judul: b.customer_name,
      keterangan: lok?.name ?? 'Lokasi belum diatur',
      kanan: b.schedule_time?.slice(0, 5) ?? '—',
      href: hrefFokus('/meeting', b.id),
      warna: b.status === 'IN_PROGRESS' ? '#2a78d6' : '#eda100',
    };
  });
}

/* ── Jadwal hari ini ──────────────────────────────────────────────────────── */

export async function intipJadwal(userId: string, pengawas: boolean): Promise<ButirIntip[]> {
  const hariIni = tanggalISO();

  let q = supabase
    .from('sm_schedules')
    .select('id, customer_name, category, schedule_time, status')
    .eq('schedule_date', hariIni)
    .in('status', ['UPCOMING', 'IN_PROGRESS'])
    .order('schedule_time', { ascending: true, nullsFirst: false })
    .limit(BATAS);

  if (!pengawas) q = q.eq('assigned_to', userId);

  const { data } = await q;

  return ((data ?? []) as {
    id: string; customer_name: string; category: string;
    schedule_time: string | null; status: string;
  }[]).map((s) => ({
    id: s.id,
    judul: s.customer_name,
    keterangan: s.category,
    kanan: s.schedule_time?.slice(0, 5) ?? '—',
    href: hrefFokus('/schedule', s.id),
    warna: STATUS_JADWAL[s.status as StatusJadwal]?.color,
  }));
}

/* ── Pipeline mendekati closing ───────────────────────────────────────────── */

export async function intipPipeline(userId: string, pengawas: boolean): Promise<ButirIntip[]> {
  const hariIni = tanggalISO();
  const pekan = new Date();
  pekan.setDate(pekan.getDate() + 7);

  let q = supabase
    .from('sm_pipeline')
    .select('id, customer_name, project_detail, project_value, probability, estimated_closing')
    .gte('estimated_closing', hariIni)
    .lte('estimated_closing', tanggalISO(pekan))
    .in('stage', ['OPEN', 'QUOTATION'])
    .order('estimated_closing', { ascending: true })
    .limit(BATAS);

  if (!pengawas) q = q.eq('sales_user_id', userId);

  const { data } = await q;

  return ((data ?? []) as {
    id: string; customer_name: string; project_detail: string;
    project_value: number; probability: number; estimated_closing: string;
  }[]).map((p) => ({
    id: p.id,
    judul: p.customer_name,
    keterangan: `${p.project_detail} · ${tanggalPendek(p.estimated_closing)} · ${persen(p.probability, 0)}`,
    kanan: rupiahRingkas(p.project_value),
    href: hrefFokus('/pipeline', p.id),
    warna: '#eda100',
  }));
}

/* ── Jadwal yang lewat tanggal ────────────────────────────────────────────── */

export async function intipTerlewat(userId: string, pengawas: boolean): Promise<ButirIntip[]> {
  const hariIni = tanggalISO();

  let q = supabase
    .from('sm_schedules')
    .select('id, customer_name, category, schedule_date')
    .lt('schedule_date', hariIni)
    .in('status', ['UPCOMING', 'IN_PROGRESS'])
    .order('schedule_date', { ascending: false })
    .limit(BATAS);

  if (!pengawas) q = q.eq('assigned_to', userId);

  const { data } = await q;

  return ((data ?? []) as {
    id: string; customer_name: string; category: string; schedule_date: string;
  }[]).map((s) => ({
    id: s.id,
    judul: s.customer_name,
    keterangan: `${s.category} · lewat sejak ${tanggalPendek(s.schedule_date)}`,
    href: hrefFokus('/schedule', s.id),
    warna: '#e34948',
  }));
}

/* ── Pengajuan yang belum ditugaskan (pengawas) ───────────────────────────── */

export async function intipBelumDitugaskan(): Promise<ButirIntip[]> {
  const { data } = await supabase
    .from('sm_schedules')
    .select('id, customer_name, category, schedule_date')
    .is('assigned_to', null)
    .eq('status', 'UPCOMING')
    .order('schedule_date', { ascending: true })
    .limit(BATAS);

  return ((data ?? []) as {
    id: string; customer_name: string; category: string; schedule_date: string;
  }[]).map((s) => ({
    id: s.id,
    judul: s.customer_name,
    keterangan: `${s.category} · ${tanggalPendek(s.schedule_date)}`,
    href: hrefFokus('/schedule', s.id),
    warna: '#eda100',
  }));
}

/* ── GP menunggu tanda tangan ─────────────────────────────────────────────── */

export async function intipGp(peran: string): Promise<ButirIntip[]> {
  const p = peran.toUpperCase();
  const status =
    p === 'MANAGER' ? ['DIAJUKAN']
    : p === 'DIRECTOR' ? ['DIPERIKSA']
    : p === 'FINANCE' ? ['DISETUJUI']
    : p === 'ADMIN' ? ['DIAJUKAN', 'DIPERIKSA', 'DISETUJUI']
    : [];

  if (status.length === 0) return [];

  const { data } = await supabase
    .from('sm_gp_ringkasan')
    .select('id, nomor, customer_name, project_name, total_selling, net_margin, status')
    .in('status', status)
    .order('submitted_at', { ascending: true })
    .limit(BATAS);

  return ((data ?? []) as {
    id: string; nomor: string; customer_name: string; project_name: string;
    total_selling: number; net_margin: number;
  }[]).map((g) => ({
    id: g.id,
    judul: g.project_name,
    keterangan: `${g.customer_name} · ${g.nomor} · margin ${persen(Number(g.net_margin) * 100)}`,
    kanan: rupiahRingkas(g.total_selling),
    href: hrefFokus('/gp', g.id),
    warna: '#7c3aed',
  }));
}
