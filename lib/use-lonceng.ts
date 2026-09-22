'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { isPengawas } from './constants';
import { tanggalISO } from './format';
import type { PenggunaAktif } from './auth';

/**
 * lib/use-lonceng.ts — angka pada lencana di header.
 *
 * Setiap angka di sini adalah hitungan NYATA dari tabelnya, bukan hiasan.
 * Lencana yang menunjukkan angka karangan jauh lebih merugikan daripada tidak
 * ada lencana sama sekali: orang berhenti mempercayainya, lalu berhenti
 * menengoknya, dan hal yang benar-benar mendesak ikut terlewat.
 *
 * Semua query memakai `head: true` — yang diminta hanya jumlahnya, barisnya
 * tidak pernah ikut terkirim. Bedanya terasa di ponsel dengan sinyal lemah,
 * tempat header ini justru paling sering dilihat.
 */

export interface Lonceng {
  /** Laporan harian hari ini belum diisi (hanya relevan bagi yang membuatnya). */
  laporanBelum: boolean;
  /** Jadwal hari ini yang belum selesai. */
  jadwalHariIni: number;
  /** Meeting hari ini yang masih menunggu check-in atau foto. */
  meetingPerlu: number;
  /** Pipeline yang perkiraan closing-nya dalam 7 hari ke depan dan belum WON/LOST. */
  pipelineDekat: number;
  /** Jadwal yang tanggalnya sudah lewat tapi belum diselesaikan. */
  terlewat: number;
  /** Pengajuan jadwal yang belum ditugaskan ke siapa pun — hanya untuk pengawas. */
  belumDitugaskan: number;
}

const KOSONG: Lonceng = {
  laporanBelum: false,
  jadwalHariIni: 0,
  meetingPerlu: 0,
  pipelineDekat: 0,
  terlewat: 0,
  belumDitugaskan: 0,
};

/** Jumlah hal yang benar-benar menunggu tindakan orang ini. */
export function totalPerluTindakan(l: Lonceng): number {
  return (l.laporanBelum ? 1 : 0) + l.meetingPerlu + l.terlewat + l.belumDitugaskan;
}

export function useLonceng(pengguna: PenggunaAktif | null) {
  const [lonceng, setLonceng] = useState<Lonceng>(KOSONG);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    if (!pengguna) { setLonceng(KOSONG); setMemuat(false); return; }

    const hariIni = tanggalISO();
    const pekanDepan = new Date();
    pekanDepan.setDate(pekanDepan.getDate() + 7);
    const pengawas = isPengawas(pengguna.role);

    const jumlah = (q: { count: number | null }) => q.count ?? 0;

    // Jadwal milik sendiri untuk Sales; seluruh tim untuk pengawas. Penyaringan
    // ini kosmetik — RLS sudah membatasi barisnya — tapi tanpa itu lencana
    // Manager dan Sales akan menunjukkan angka yang sama dan kehilangan arti.

    const [laporan, jadwal, meeting, pipeline, lewat, takDitugaskan] = await Promise.all([
      supabase.from('sm_daily_reports').select('id', { count: 'exact', head: true })
        .eq('sales_user_id', pengguna.id).eq('report_date', hariIni),

      (() => {
        let q = supabase.from('sm_schedules').select('id', { count: 'exact', head: true })
          .eq('schedule_date', hariIni).in('status', ['UPCOMING', 'IN_PROGRESS']);
        if (!pengawas) q = q.eq('assigned_to', pengguna.id);
        return q;
      })(),

      (() => {
        let q = supabase.from('sm_schedules').select('id', { count: 'exact', head: true })
          .eq('requires_attendance', true).eq('schedule_date', hariIni)
          .in('status', ['UPCOMING', 'IN_PROGRESS']);
        if (!pengawas) q = q.eq('assigned_to', pengguna.id);
        return q;
      })(),

      (() => {
        let q = supabase.from('sm_pipeline').select('id', { count: 'exact', head: true })
          .gte('estimated_closing', hariIni).lte('estimated_closing', tanggalISO(pekanDepan))
          .in('stage', ['OPEN', 'QUOTATION']);
        if (!pengawas) q = q.eq('sales_user_id', pengguna.id);
        return q;
      })(),

      (() => {
        let q = supabase.from('sm_schedules').select('id', { count: 'exact', head: true })
          .lt('schedule_date', hariIni).in('status', ['UPCOMING', 'IN_PROGRESS']);
        if (!pengawas) q = q.eq('assigned_to', pengguna.id);
        return q;
      })(),

      pengawas
        ? supabase.from('sm_schedules').select('id', { count: 'exact', head: true })
            .is('assigned_to', null).eq('status', 'UPCOMING')
        : Promise.resolve({ count: 0 }),
    ]);

    setLonceng({
      laporanBelum: jumlah(laporan) === 0,
      jadwalHariIni: jumlah(jadwal),
      meetingPerlu: jumlah(meeting),
      pipelineDekat: jumlah(pipeline),
      terlewat: jumlah(lewat),
      belumDitugaskan: jumlah(takDitugaskan as { count: number | null }),
    });
    setMemuat(false);
  }, [pengguna]);

  useEffect(() => { void muat(); }, [muat]);

  // Disegarkan berkala supaya lencana tidak basi pada tab yang dibiarkan
  // terbuka sepanjang hari — tapi cukup jarang agar tidak menghabiskan kuota
  // data Sales di lapangan.
  useEffect(() => {
    if (!pengguna) return;
    const timer = setInterval(() => { void muat(); }, 3 * 60_000);
    return () => clearInterval(timer);
  }, [pengguna, muat]);

  return { lonceng, memuat, muatUlang: muat };
}
