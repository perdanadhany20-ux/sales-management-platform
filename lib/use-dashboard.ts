'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { tanggalISO } from './format';
import { pesanGalat } from './pesan-galat';

/**
 * lib/use-dashboard.ts — satu panggilan RPC untuk seluruh angka dashboard.
 *
 * Bentuk datanya sengaja dicerminkan persis dari sm_dashboard() (migrasi 009).
 * Tidak ada perhitungan ulang di sini: kalau angka di layar berbeda dari yang
 * ada di database, penyebabnya cuma satu tempat untuk dicari.
 */

export interface DataDashboard {
  periode: { dari: string; sampai: string };
  daily_report: {
    total_sales: number; sudah_lapor: number; belum_lapor: number; dalam_periode: number;
  };
  pipeline: {
    jumlah: number; total_nilai: number; total_hpp: number; total_gp: number;
    gp_persen: number; akan_closing: number;
  };
  probability: { probability: number; jumlah: number; nilai: number }[];
  gp_kondisi: { positif: number; nol: number; negatif: number };
  jadwal: {
    upcoming: number; berjalan: number; selesai: number; terlewat: number;
    dibatalkan: number; hari_ini: number;
  };
  meeting: {
    total: number; selesai: number; belum_mulai: number;
    menunggu_foto: number; siap_selesai: number; exception: number;
  };
  gps_gagal: Record<string, number>;
  tren_bulanan: { bulan: string; laporan: number; pipeline: number; nilai: number }[];
  /** Nilai pipeline pada jendela sebelumnya yang sama panjang (mis. 30 hari
   *  sebelum 30 hari terakhir). Pembanding lencana tren — bukan bulan
   *  kalender, yang di awal bulan selalu bernilai ~0 dan membuat lencana
   *  keliru menunjukkan ▼100%. Diisi di sisi klien, bukan oleh RPC. */
  pipeline_sebelumnya?: number;
}

export function useDashboard(hariKeBelakang = 29) {
  const [data, setData] = useState<DataDashboard | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    const sampai = new Date();
    const dari = new Date();
    dari.setDate(dari.getDate() - hariKeBelakang);

    const dariLalu = new Date(dari);
    dariLalu.setDate(dariLalu.getDate() - hariKeBelakang - 1);
    const sampaiLalu = new Date(dari);
    sampaiLalu.setDate(sampaiLalu.getDate() - 1);

    const [{ data: hasil, error }, lalu] = await Promise.all([
      supabase.rpc('sm_dashboard', { p_dari: tanggalISO(dari), p_sampai: tanggalISO(sampai) }),
      // Disaring RLS yang sama dengan RPC-nya: Sales hanya menjumlah miliknya.
      supabase.from('sm_pipeline').select('project_value')
        .gte('pipeline_date', tanggalISO(dariLalu)).lte('pipeline_date', tanggalISO(sampaiLalu)),
    ]);

    if (error) setGalat(pesanGalat(error));
    else {
      const sebelumnya = ((lalu.data ?? []) as { project_value: number }[])
        .reduce((t, b) => t + Number(b.project_value ?? 0), 0);
      setData({ ...(hasil as DataDashboard), pipeline_sebelumnya: sebelumnya });
    }

    setMemuat(false);
  }, [hariKeBelakang]);

  useEffect(() => { void muat(); }, [muat]);

  return { data, memuat, galat, muatUlang: muat };
}
