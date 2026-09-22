'use client';

import { useState } from 'react';
import { usePenggunaAktif } from '@/lib/auth';
import { isAdmin, isPengawas, LABEL_PERAN, type Peran } from '@/lib/constants';
import { LayarMemuat, Kosong } from '@/components/shared/Feedback';
import { TabPengguna } from './_components/TabPengguna';
import { TabLokasi } from './_components/TabLokasi';
import { TabKonfigurasi } from './_components/TabKonfigurasi';
import { TabTampilan } from './_components/TabTampilan';
import { TabAudit } from './_components/TabAudit';

type Kunci = 'pengguna' | 'lokasi' | 'tampilan' | 'konfigurasi' | 'audit';

interface Bagian {
  kunci: Kunci;
  label: string;
  judul: string;
  keterangan: string;
  ikon: string;
  kelompok: 'ORGANISASI' | 'TAMPILAN' | 'SISTEM';
  /** Bagian yang hanya untuk Admin; Manager tidak melihatnya. */
  adminSaja?: boolean;
}

const BAGIAN: Bagian[] = [
  {
    kunci: 'pengguna', label: 'Pengguna', kelompok: 'ORGANISASI', ikon: '👥', adminSaja: true,
    judul: 'Manajemen Pengguna',
    keterangan: 'Akun, peran, status aktif, dan pengaturan ulang kata sandi.',
  },
  {
    kunci: 'lokasi', label: 'Lokasi Meeting', kelompok: 'ORGANISASI', ikon: '📍',
    judul: 'Lokasi Meeting',
    keterangan: 'Titik meeting beserta radius GPS yang diterima saat check-in.',
  },
  {
    kunci: 'tampilan', label: 'Dashboard Setting', kelompok: 'TAMPILAN', ikon: '🎨', adminSaja: true,
    judul: 'Dashboard Setting',
    keterangan: 'Logo, nama, warna merek, tampilan halaman masuk, dan kartu dashboard.',
  },
  {
    kunci: 'konfigurasi', label: 'Nilai Bisnis', kelompok: 'SISTEM', ikon: '⚙️', adminSaja: true,
    judul: 'Konfigurasi Nilai Bisnis',
    keterangan: 'Kategori jadwal, opsi probability, satuan, dan ambang verifikasi lokasi.',
  },
  {
    kunci: 'audit', label: 'Audit Log', kelompok: 'SISTEM', ikon: '🧾',
    judul: 'Audit Log',
    keterangan: 'Jejak tindakan penting: check-in, penyelesaian, override, dan perubahan akun.',
  },
];

const URUTAN_KELOMPOK: Bagian['kelompok'][] = ['ORGANISASI', 'TAMPILAN', 'SISTEM'];

/**
 * Admin Panel.
 *
 * Tata letaknya mengikuti pola Work Management yang dipakai Mas Putu: panel
 * gelap di kiri berisi daftar pengaturan yang dikelompokkan, isi di kanan.
 * Dipilih menggantikan deretan tab karena jumlah bagiannya terus bertambah —
 * dan deretan tab yang memanjang ke samping akan memaksa penggulungan
 * horizontal, bentuk navigasi yang paling mudah terlewat.
 *
 * Manager sengaja dibiarkan masuk, tapi hanya melihat Lokasi dan Audit Log —
 * keduanya memang wewenangnya (policy `lok_kelola` dan `audit_baca` di migrasi
 * 005). Pengelolaan akun, identitas platform, dan nilai bisnis khusus Admin.
 *
 * Seperti di tempat lain, penyembunyian menu ini kosmetik. Yang menolak
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

  const tersedia = BAGIAN.filter((b) => admin || !b.adminSaja);
  // Manager mendarat di bagian pertama yang memang boleh ia buka, bukan di
  // "Pengguna" yang tidak ada dalam daftarnya.
  const kunciAktif = tersedia.some((b) => b.kunci === aktif) ? aktif : tersedia[0].kunci;
  const bagianAktif = tersedia.find((b) => b.kunci === kunciAktif)!;

  return (
    <div className="flex flex-col satulayar:flex-row gap-4 items-start">

      {/* ══ Panel kiri ══ */}
      <aside className="w-full satulayar:w-[250px] flex-shrink-0 rounded-kartu overflow-hidden
                        bg-slate-900 text-white shadow-bento satulayar:sticky satulayar:top-4">
        <header className="px-4 py-4 flex items-center gap-2.5 border-b border-white/10">
          <span className="w-9 h-9 rounded-kontrol bg-aksen-600 grid place-items-center flex-shrink-0">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3l7 3v5.5c0 4.2-2.9 8.1-7 9.5-4.1-1.4-7-5.3-7-9.5V6l7-3z"
                stroke="white" strokeWidth="1.9" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="1.9"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-black leading-tight">Admin Panel</p>
            <p className="text-[10px] text-white/50 leading-tight">
              {LABEL_PERAN[pengguna.role as Peran] ?? pengguna.role} · pengaturan platform
            </p>
          </div>
        </header>

        {/* Di layar sempit seluruh tombol mengalir sebagai satu baris chip
            yang membungkus (label kelompok disembunyikan supaya tidak memakan
            tinggi layar); di layar lebar barulah ia jadi daftar berkelompok
            seperti panel pengaturan pada umumnya. */}
        <nav aria-label="Bagian administrasi"
          className="p-2.5 flex flex-wrap gap-1.5 satulayar:flex-col satulayar:flex-nowrap satulayar:gap-3">
          {URUTAN_KELOMPOK.map((kelompok) => {
            const isi = tersedia.filter((b) => b.kelompok === kelompok);
            if (isi.length === 0) return null;
            return (
              <div key={kelompok} className="contents satulayar:flex satulayar:flex-col satulayar:gap-0.5">
                <p className="hidden satulayar:block px-2.5 pt-1.5 pb-1 text-[9px] font-bold text-white/35 uppercase tracking-[0.12em]">
                  {kelompok}
                </p>
                {isi.map((b) => {
                  const ini = b.kunci === kunciAktif;
                  return (
                    <button
                      key={b.kunci}
                      type="button"
                      aria-current={ini ? 'page' : undefined}
                      onClick={() => setAktif(b.kunci)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-kontrol text-left
                                  text-[13px] font-semibold transition-colors whitespace-nowrap
                                  ${ini
                                    ? 'bg-aksen-600 text-white shadow-sm'
                                    : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                    >
                      <span aria-hidden="true" className="text-[13px]">{b.ikon}</span>
                      {b.label}
                      {ini && <span aria-hidden="true" className="ml-auto text-[8px]">●</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ══ Isi kanan ══ */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        <header className="bg-white rounded-kartu border border-slate-200 shadow-bento px-4 sm:px-5 py-3.5 flex items-center gap-3">
          <span className="w-10 h-10 rounded-kontrol bg-aksen-50 border border-aksen-100 grid place-items-center text-[16px] flex-shrink-0"
            aria-hidden="true">
            {bagianAktif.ikon}
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] sm:text-base font-black text-slate-900 tracking-tight leading-tight">
              {bagianAktif.judul}
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{bagianAktif.keterangan}</p>
          </div>
        </header>

        <div>
          {kunciAktif === 'pengguna' && <TabPengguna pemanggilId={pengguna.id} />}
          {kunciAktif === 'lokasi' && <TabLokasi />}
          {kunciAktif === 'tampilan' && <TabTampilan />}
          {kunciAktif === 'konfigurasi' && <TabKonfigurasi />}
          {kunciAktif === 'audit' && <TabAudit />}
        </div>
      </div>
    </div>
  );
}
