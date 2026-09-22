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

/* ════════════════════════════════════════════════════════════════════════════
 * Bagian yang belum tercakup sm_dashboard(): GP Calculation, Proyek, tahapan
 * pipeline, corong, per-Sales, dan customer teratas.
 *
 * Dipisah sebagai hook sendiri karena RPC-nya memang terpisah (migrasi 019).
 * Keduanya dipanggil berdampingan dari halaman dashboard, bukan berurutan —
 * yang kedua tidak menunggu yang pertama selesai.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface DataDashboardPlus {
  gp: {
    jumlah: number; nilai: number; dpp: number; profit: number; margin: number;
    draft: number; menunggu: number; selesai: number; ditolak: number;
    di_bawah_target: number;
  };
  gp_mutu: { mutu: string; jumlah: number; nilai: number }[];
  proyek: {
    jumlah: number; aktif: number; selesai: number;
    nilai_pipeline: number; profit_gp: number; tanpa_catatan: number;
  };
  stage: { stage: string; jumlah: number; nilai: number }[];
  corong: { laporan: number; peluang: number; meeting: number; gp: number; gp_gol: number };
  per_sales: {
    user_id: string; nama: string; laporan: number; peluang: number;
    nilai: number; gp: number; profit: number; meeting: number;
  }[];
  customer_teratas: { nama: string; jumlah: number; nilai: number }[];
}

export function useDashboardPlus(hariKeBelakang = 29) {
  const [data, setData] = useState<DataDashboardPlus | null>(null);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    setMemuat(true);

    const sampai = new Date();
    const dari = new Date();
    dari.setDate(dari.getDate() - hariKeBelakang);

    const { data: hasil, error } = await supabase.rpc('sm_dashboard_plus', {
      p_dari: tanggalISO(dari),
      p_sampai: tanggalISO(sampai),
    });

    // Galat TIDAK dinaikkan ke halaman. Bagian ini pelengkap; kalau gagal
    // dimuat, dashboard intinya harus tetap tampil utuh — bukan berganti jadi
    // satu panel error yang menyembunyikan angka yang sebenarnya baik-baik
    // saja.
    if (!error && hasil) setData(hasil as DataDashboardPlus);
    setMemuat(false);
  }, [hariKeBelakang]);

  useEffect(() => { void muat(); }, [muat]);

  return { data, memuat, muatUlang: muat };
}
