'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { tanggalISO } from './format';

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

    const { data: hasil, error } = await supabase.rpc('sm_dashboard', {
      p_dari: tanggalISO(dari),
      p_sampai: tanggalISO(sampai),
    });

    if (error) setGalat(error.message);
    else setData(hasil as DataDashboard);

    setMemuat(false);
  }, [hariKeBelakang]);

  useEffect(() => { void muat(); }, [muat]);

  return { data, memuat, galat, muatUlang: muat };
}
