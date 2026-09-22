'use client';

import { useState } from 'react';
import { usePenggunaAktif } from '@/lib/auth';
import { isAdmin, isPengawas } from '@/lib/constants';
import { LayarMemuat, Kosong } from '@/components/shared/Feedback';
import { TabPengguna } from './_components/TabPengguna';
import { TabLokasi } from './_components/TabLokasi';
import { TabKonfigurasi } from './_components/TabKonfigurasi';
import { TabAudit } from './_components/TabAudit';

type Kunci = 'pengguna' | 'lokasi' | 'konfigurasi' | 'audit';

interface Tab {
  kunci: Kunci;
  label: string;
  keterangan: string;
  /** Tab yang hanya untuk Admin; Manager tidak melihatnya. */
  adminSaja?: boolean;
}

const TAB: Tab[] = [
  { kunci: 'pengguna',    label: 'Pengguna',    keterangan: 'Akun, peran, dan reset kata sandi', adminSaja: true },
  { kunci: 'lokasi',      label: 'Lokasi',      keterangan: 'Titik meeting beserta radius GPS' },
  { kunci: 'konfigurasi', label: 'Konfigurasi', keterangan: 'Nilai bisnis dan tampilan dashboard', adminSaja: true },
  { kunci: 'audit',       label: 'Audit Log',   keterangan: 'Jejak tindakan penting' },
];

/**
 * Administrasi.
 *
 * Manager sengaja dibiarkan masuk ke sini, tapi hanya melihat Lokasi dan
 * Audit Log — keduanya memang wewenangnya (policy `lok_kelola` dan
 * `audit_baca` di migrasi 005 memberi Manager akses). Pengelolaan akun dan
 * nilai bisnis khusus Admin.
 *
 * Seperti di tempat lain, penyembunyian tab ini kosmetik. Yang menolak
 * sungguhan adalah RLS dan pemeriksaan peran di route handler.
 */
export default function HalamanAdmin() {
  const { pengguna, memuat } = usePenggunaAktif();
  const [aktif, setAktif] = useState<Kunci>('pengguna');

  if (memuat) return <LayarMemuat />;
  if (!pengguna) return null;

  const admin = isAdmin(pengguna.role);
  const pengawas = isPengawas(pengguna.role);

  if (!pengawas) {
    return (
      <div className="bg-white rounded-kartu border border-slate-200 max-w-lg mx-auto mt-8">
        <Kosong
          judul="Halaman ini bukan untuk peran Anda"
          keterangan="Administrasi hanya terbuka untuk Manager dan Admin. Kalau Anda merasa ini keliru, hubungi Admin."
        />
      </div>
    );
  }

  const tersedia = TAB.filter((t) => admin || !t.adminSaja);
  // Manager mendarat di tab pertama yang memang boleh ia buka, bukan di
  // "Pengguna" yang tidak ada dalam daftarnya.
  const kunciAktif = tersedia.some((t) => t.kunci === aktif) ? aktif : tersedia[0].kunci;
  const tabAktif = tersedia.find((t) => t.kunci === kunciAktif)!;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Administrasi</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">{tabAktif.keterangan}</p>
      </header>

      <div
        role="tablist"
        aria-label="Bagian administrasi"
        className="flex gap-1 bg-white rounded-kartu border border-slate-200 p-1 overflow-x-auto"
      >
        {tersedia.map((t) => {
          const ini = t.kunci === kunciAktif;
          return (
            <button
              key={t.kunci}
              role="tab"
              aria-selected={ini}
              type="button"
              onClick={() => setAktif(t.kunci)}
              className={`flex-shrink-0 px-4 py-2 rounded-kontrol text-[13px] font-semibold transition-colors
                          ${ini ? 'bg-aksen-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {kunciAktif === 'pengguna' && <TabPengguna pemanggilId={pengguna.id} />}
        {kunciAktif === 'lokasi' && <TabLokasi />}
        {kunciAktif === 'konfigurasi' && <TabKonfigurasi />}
        {kunciAktif === 'audit' && <TabAudit />}
      </div>
    </div>
  );
}
