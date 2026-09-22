'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * lib/use-settings.ts — pengaturan bisnis dari tabel sm_settings.
 *
 * Nilai bawaan di bawah BUKAN sumber kebenaran; ia hanya jaring pengaman agar
 * formulir tetap bisa dipakai saat jaringan gagal atau baris pengaturannya
 * terhapus. Sumber sebenarnya tetap database (§21, §47), sehingga admin bisa
 * mengubah kategori dan opsi probability tanpa menyentuh kode.
 */

export interface KategoriJadwal {
  name: string;
  requires_attendance: boolean;
}

export interface KartuDashboard {
  key: string;
  label: string;
  aktif: boolean;
}

export interface Pengaturan {
  schedule_categories: KategoriJadwal[];
  probability_options: number[];
  default_gps_radius_m: number;
  gps_accuracy_threshold_m: number;
  pipeline_units: string[];
  activity_categories: string[];
  dashboard_widgets: KartuDashboard[];
}

const BAWAAN: Pengaturan = {
  schedule_categories: [
    { name: 'Meeting', requires_attendance: true },
    { name: 'Other Sales Activity', requires_attendance: false },
  ],
  probability_options: [10, 25, 50, 75, 90],
  default_gps_radius_m: 50,
  gps_accuracy_threshold_m: 100,
  pipeline_units: ['unit', 'set', 'titik', 'paket', 'lot', 'meter'],
  activity_categories: ['Meeting', 'Follow Up', 'Quotation', 'Customer Visit', 'Survey', 'Other'],
  // Bawaan: semua kartu tampil. Kalau baris pengaturannya belum ada, dashboard
  // harus tetap lengkap — bukan kosong.
  dashboard_widgets: [
    { key: 'kepatuhan', label: 'Kepatuhan Laporan Hari Ini', aktif: true },
    { key: 'nilai_pipeline', label: 'Nilai Pipeline', aktif: true },
    { key: 'gross_profit', label: 'Gross Profit', aktif: true },
    { key: 'probability', label: 'Sebaran Probability', aktif: true },
    { key: 'status_jadwal', label: 'Status Jadwal', aktif: true },
    { key: 'tren', label: 'Aktivitas 6 Bulan Terakhir', aktif: true },
    { key: 'meeting', label: 'Meeting', aktif: true },
    { key: 'pengecualian', label: 'Perlu Ditindaklanjuti', aktif: true },
  ],
};

// Pengaturan nyaris tidak pernah berubah dalam satu sesi, sedangkan hampir
// setiap halaman membutuhkannya. Tanpa cache di level modul, berpindah menu
// memicu query yang sama berulang kali — pemborosan yang §62 minta dihindari.
let cache: Pengaturan | null = null;

export function usePengaturan() {
  const [data, setData] = useState<Pengaturan>(cache ?? BAWAAN);
  const [memuat, setMemuat] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let batal = false;

    (async () => {
      const { data: baris } = await supabase.from('sm_settings').select('key, value');
      if (batal) return;

      if (baris) {
        const peta: Record<string, unknown> = Object.fromEntries(
          (baris as { key: string; value: unknown }[]).map((b) => [b.key, b.value]),
        );
        // Tiap nilai dibaca lewat penolong yang jatuh ke bawaan bila baris
        // pengaturannya hilang ATAU bentuknya tidak seperti yang diharapkan.
        // Kolomnya jsonb dan bisa disunting admin, jadi "ada tapi salah
        // bentuk" adalah kemungkinan nyata — bukan hanya "tidak ada".
        const ambil = <T,>(kunci: keyof Pengaturan, bawaan: T, harusArray: boolean): T => {
          const v = peta[kunci as string];
          if (v == null) return bawaan;
          if (harusArray && !Array.isArray(v)) return bawaan;
          if (!harusArray && typeof v !== 'number') return bawaan;
          return v as T;
        };

        const gabung: Pengaturan = {
          schedule_categories:      ambil('schedule_categories',      BAWAAN.schedule_categories,      true),
          probability_options:      ambil('probability_options',      BAWAAN.probability_options,      true),
          pipeline_units:           ambil('pipeline_units',           BAWAAN.pipeline_units,           true),
          activity_categories:      ambil('activity_categories',      BAWAAN.activity_categories,      true),
          dashboard_widgets:        ambil('dashboard_widgets',        BAWAAN.dashboard_widgets,        true),
          default_gps_radius_m:     ambil('default_gps_radius_m',     BAWAAN.default_gps_radius_m,     false),
          gps_accuracy_threshold_m: ambil('gps_accuracy_threshold_m', BAWAAN.gps_accuracy_threshold_m, false),
        };
        cache = gabung;
        setData(gabung);
      }
      setMemuat(false);
    })();

    return () => { batal = true; };
  }, []);

  return { pengaturan: data, memuat };
}

/** Dipanggil sesudah admin menyimpan perubahan, supaya tab ini ikut segar. */
export function kosongkanCachePengaturan() {
  cache = null;
}
