'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from './supabase';
import { PERISTIWA_DATA_BERUBAH } from '@/components/shared/Feedback';
import type { PenggunaAktif } from './auth';

/**
 * lib/use-lonceng.ts — angka pada lencana di header.
 *
 * Setiap angka di sini adalah hitungan NYATA dari tabelnya, bukan hiasan.
 * Lencana yang menunjukkan angka karangan jauh lebih merugikan daripada tidak
 * ada lencana sama sekali: orang berhenti mempercayainya, lalu berhenti
 * menengoknya, dan hal yang benar-benar mendesak ikut terlewat.
 *
 * Keenam angkanya diambil lewat SATU panggilan RPC sm_lonceng() (migrasi 014),
 * bukan enam query terpisah seperti versi pertama. Audit performa §108
 * menemukan versi lama menembakkan enam permintaan HTTP tiap tiga menit — di
 * meja kantor tidak terasa, di lapangan dengan satu bar sinyal itu berarti
 * header yang angkanya menetes satu per satu.
 *
 * Fungsinya SECURITY INVOKER, jadi RLS tetap berlaku: angka yang dilihat Sales
 * dihitung dari barisnya sendiri, bukan dari baris seluruh tim.
 */

export interface Lonceng {
  /** Laporan harian hari ini belum diisi. */
  laporanBelum: boolean;
  /** Jadwal hari ini yang belum selesai. */
  jadwalHariIni: number;
  /** Meeting hari ini yang masih menunggu check-in atau foto. */
  meetingPerlu: number;
  /** Pipeline yang perkiraan closing-nya dalam 7 hari dan belum WON/LOST. */
  pipelineDekat: number;
  /** Jadwal yang tanggalnya sudah lewat tapi belum diselesaikan. */
  terlewat: number;
  /** Pengajuan jadwal yang belum ditugaskan — selalu 0 bagi Sales. */
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

interface BalasanRpc {
  laporan_belum?: boolean;
  jadwal_hari_ini?: number;
  meeting_perlu?: number;
  pipeline_dekat?: number;
  terlewat?: number;
  belum_ditugaskan?: number;
}

export function useLonceng(pengguna: PenggunaAktif | null) {
  const [lonceng, setLonceng] = useState<Lonceng>(KOSONG);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    if (!pengguna) { setLonceng(KOSONG); setMemuat(false); return; }

    const { data, error } = await supabase.rpc('sm_lonceng');
    setMemuat(false);

    // Lencana yang gagal dimuat dibiarkan pada nilai terakhirnya, bukan
    // dinolkan. Menampilkan "0 perlu tindakan" saat jaringan putus adalah
    // kebohongan yang menenangkan — persis kebalikan dari gunanya lencana ini.
    if (error || !data) return;

    const d = data as BalasanRpc;
    setLonceng({
      laporanBelum: Boolean(d.laporan_belum),
      jadwalHariIni: Number(d.jadwal_hari_ini ?? 0),
      meetingPerlu: Number(d.meeting_perlu ?? 0),
      pipelineDekat: Number(d.pipeline_dekat ?? 0),
      terlewat: Number(d.terlewat ?? 0),
      belumDitugaskan: Number(d.belum_ditugaskan ?? 0),
    });
  }, [pengguna]);

  const pathname = usePathname();
  useEffect(() => { void muat(); }, [muat, pathname]);

  useEffect(() => {
    const segarkan = () => { void muat(); };
    window.addEventListener(PERISTIWA_DATA_BERUBAH, segarkan);
    return () => window.removeEventListener(PERISTIWA_DATA_BERUBAH, segarkan);
  }, [muat]);

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
