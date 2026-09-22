'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useState } from 'react';
import { keluar, usePenggunaAktif, type PenggunaAktif } from '@/lib/auth';
import { LayarMemuat } from './Feedback';
import { isPengawas, LABEL_PERAN, type Peran } from '@/lib/constants';
import { useBranding } from '@/lib/branding';
import { HeaderAtas } from './HeaderAtas';
import {
  bagianUntuk, URUTAN_KELOMPOK, type KunciBagian,
} from '@/lib/admin-bagian';

/**
 * Bagian Admin Panel yang sedang dibuka.
 *
 * Tinggal di Shell, bukan di halaman /admin, karena yang MENAMPILKAN sub-menu
 * itu adalah sidebar — dan sidebar berada di atas halaman dalam pohon React.
 * Dengan begitu menekan "Dashboard Setting" di sidebar langsung mengganti isi
 * halaman, tanpa halaman dan sidebar saling menyalin daftar bagian.
 */
const KonteksBagian = createContext<{
  bagian: KunciBagian;
  setBagian: (b: KunciBagian) => void;
}>({ bagian: 'pengguna', setBagian: () => {} });

export function useBagianAdmin() {
  return useContext(KonteksBagian);
}

/**
 * components/shared/Shell.tsx — kerangka navigasi seluruh aplikasi.
 *
 * Dua bentuk navigasi untuk dua cara pakai yang memang berbeda: sidebar di
 * layar lebar untuk Admin/Manager yang bekerja berjam-jam di meja, dan bilah
 * bawah di ponsel untuk Sales yang membukanya sambil berdiri di lobi kantor
 * klien. Bilah bawah dipilih karena bisa dijangkau ibu jari satu tangan —
 * menu di pojok kanan atas tidak.
 *
 * PENYEMBUNYIAN MENU DI SINI MURNI KOSMETIK. Menyembunyikan tautan Admin dari
 * Sales membuat antarmukanya bersih, bukan membuat datanya aman; yang
 * mengamankan adalah RLS di migrasi 005. Mengetik /admin langsung di bilah
 * alamat akan memuat halamannya, tapi halaman itu tidak akan menemukan satu
 * baris pun yang boleh ia baca.
 */

export interface Menu {
  href: string;
  label: string;
  ikon: React.ReactNode;
  /** Tampil untuk siapa. Tanpa ini berarti semua peran. */
  untuk?: (peran: string) => boolean;
  /** Muncul di bilah bawah ponsel (maksimal 5 supaya tetap bisa disentuh). */
  utama?: boolean;
}

const I = (d: string) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const MENU_APLIKASI: Menu[] = [
  { href: '/dashboard',    label: 'Dashboard',    utama: true,  ikon: I('M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z') },
  { href: '/daily-report', label: 'Daily Report', utama: true,  ikon: I('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4') },
  { href: '/proyek',       label: 'Proyek',       utama: true,  ikon: I('M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z') },
  { href: '/pipeline',     label: 'Pipeline',     ikon: I('M3 4h18M6 9h12M9 14h6M11 19h2') },
  { href: '/schedule',     label: 'Schedule',     utama: true,  ikon: I('M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z') },
  { href: '/meeting',      label: 'Meeting',      utama: true,  ikon: I('M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z') },
  { href: '/gp',           label: 'GP Calculation', ikon: I('M9 7h6M9 11h6M9 15h3M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z') },
  { href: '/activity',     label: 'Activity',     ikon: I('M3 12h4l3 8 4-16 3 8h4') },
  { href: '/admin',        label: 'Admin Panel',  untuk: isPengawas, ikon: I('M10.3 4.3a1.9 1.9 0 013.4 0l.5 1a1.9 1.9 0 002.3 1l1-.3a1.9 1.9 0 012.1 2.9l-.6.9a1.9 1.9 0 000 2.4l.6.9a1.9 1.9 0 01-2.1 2.9l-1-.3a1.9 1.9 0 00-2.3 1l-.5 1a1.9 1.9 0 01-3.4 0l-.5-1a1.9 1.9 0 00-2.3-1l-1 .3a1.9 1.9 0 01-2.1-2.9l.6-.9a1.9 1.9 0 000-2.4l-.6-.9a1.9 1.9 0 012.1-2.9l1 .3a1.9 1.9 0 002.3-1l.5-1z M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z') },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { pengguna, memuat } = usePenggunaAktif();
  const { branding } = useBranding();
  const pathname = usePathname();
  const router = useRouter();
  const [bagian, setBagian] = useState<KunciBagian>('pengguna');
  const konteks = useMemo(() => ({ bagian, setBagian }), [bagian]);

  if (memuat) return <LayarMemuat pesan="Memulihkan sesi…" />;

  if (!pengguna) {
    // Middleware biasanya sudah mengalihkan sebelum sampai sini. Ini jaring
    // pengaman untuk cookie yang ada tapi sesinya sudah dihapus di server.
    router.replace('/');
    return <LayarMemuat pesan="Mengalihkan…" />;
  }

  const menu = MENU_APLIKASI.filter((m) => !m.untuk || m.untuk(pengguna.role));
  const menuPonsel = menu.filter((m) => m.utama).slice(0, 5);

  return (
    <KonteksBagian.Provider value={konteks}>
    <div className="min-h-[100dvh] flex flex-col">
      {/* Bilah judul membentang penuh di atas sidebar, bukan di sampingnya:
          identitas platform dan lencana notifikasi harus terlihat sama di
          setiap halaman, termasuk saat sidebar disembunyikan di ponsel. */}
      <HeaderAtas pengguna={pengguna} branding={branding} />

      <div className="flex-1 flex min-h-0">
        <SidebarLebar menu={menu} pathname={pathname} pengguna={pengguna} />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Ruang bawah menghindari bilah navigasi ponsel menutupi isi
              halaman — termasuk tombol simpan di dasar formulir. */}
          <main className="flex-1 px-3 sm:px-5 py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sidebar:pb-6 max-w-[1500px] w-full mx-auto">
            {children}
          </main>
        </div>
      </div>

      <BilahBawah menu={menuPonsel} pathname={pathname} />
    </div>
    </KonteksBagian.Provider>
  );
}

function SidebarLebar({ menu, pathname, pengguna }: {
  menu: Menu[]; pathname: string; pengguna: PenggunaAktif;
}) {
  return (
    <aside className="hidden sidebar:flex w-[228px] flex-shrink-0 flex-col bg-white border-r border-slate-200
                      sticky top-14 h-[calc(100dvh-3.5rem)]">
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">
        <p className="px-3 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">Menu</p>
        {menu.map((m) => (
          <div key={m.href}>
            <TautanMenu menu={m} aktif={pathname.startsWith(m.href)} />
            {/* Sub-menu Admin Panel muncul DI SINI, menempel pada menu
                induknya di sidebar — bukan sebagai panel terpisah di dalam
                area isi. Panel navigasi yang mengambang di tengah halaman
                terbaca sebagai bagian dari isi, bukan sebagai navigasi. */}
            {m.href === '/admin' && pathname.startsWith('/admin') && (
              <SubMenuAdmin peran={pengguna.role} />
            )}
          </div>
        ))}
      </nav>

      <KartuPengguna pengguna={pengguna} />
    </aside>
  );
}

function SubMenuAdmin({ peran }: { peran: string }) {
  const { bagian, setBagian } = useBagianAdmin();
  const tersedia = bagianUntuk(peran);

  return (
    <div className="ml-4 mt-1 mb-1 pl-2.5 border-l border-slate-200 flex flex-col gap-0.5">
      {URUTAN_KELOMPOK.map((kelompok) => {
        const isi = tersedia.filter((b) => b.kelompok === kelompok);
        if (isi.length === 0) return null;
        return (
          <div key={kelompok} className="flex flex-col gap-0.5">
            <p className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-[0.12em]">
              {kelompok}
            </p>
            {isi.map((b) => {
              const ini = b.kunci === bagian;
              return (
                <button
                  key={b.kunci}
                  type="button"
                  aria-current={ini ? 'true' : undefined}
                  onClick={() => setBagian(b.kunci)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-kontrol text-left text-[12px]
                              font-semibold transition-colors
                              ${ini
                                ? 'bg-aksen-50 text-aksen-800'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                >
                  <span aria-hidden="true" className="text-[11px]">{b.ikon}</span>
                  {b.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function TautanMenu({ menu, aktif }: { menu: Menu; aktif: boolean }) {
  return (
    <Link
      href={menu.href}
      aria-current={aktif ? 'page' : undefined}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-kontrol text-[13px] font-semibold transition-colors
                  ${aktif
                    ? 'bg-aksen-50 text-aksen-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      <span className={aktif ? 'text-aksen-700' : 'text-slate-400'}>{menu.ikon}</span>
      {menu.label}
    </Link>
  );
}

function KartuPengguna({ pengguna }: { pengguna: PenggunaAktif }) {
  const [keluarBerjalan, setKeluarBerjalan] = useState(false);
  const router = useRouter();

  async function lakukanKeluar() {
    setKeluarBerjalan(true);
    await keluar();
    router.replace('/');
  }

  return (
    <div className="px-2.5 py-3 border-t border-slate-100">
      <Link
        href="/profil"
        className="flex items-center gap-2.5 px-2 py-2 rounded-kontrol hover:bg-slate-50 transition-colors"
      >
        <Inisial nama={pengguna.full_name} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-slate-800 truncate">{pengguna.full_name}</p>
          <p className="text-[10px] text-slate-400">
            {LABEL_PERAN[(pengguna.role as Peran)] ?? pengguna.role}
          </p>
        </div>
      </Link>
      <button
        type="button" onClick={lakukanKeluar} disabled={keluarBerjalan}
        className="w-full mt-1 px-3 py-2 rounded-kontrol text-[12px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-[#e34948] transition-colors text-left disabled:opacity-50"
      >
        {keluarBerjalan ? 'Keluar…' : 'Keluar'}
      </button>
    </div>
  );
}

function Inisial({ nama }: { nama: string }) {
  const huruf = nama.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="w-8 h-8 rounded-full bg-aksen-100 text-aksen-800 grid place-items-center text-[11px] font-black flex-shrink-0">
      {huruf || '?'}
    </span>
  );
}

function BilahBawah({ menu, pathname }: { menu: Menu[]; pathname: string }) {
  return (
    <nav className="sidebar:hidden fixed bottom-0 inset-x-0 z-30 bg-white/97 backdrop-blur border-t border-slate-200
                    pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {menu.map((m) => {
          const aktif = pathname.startsWith(m.href);
          return (
            <Link
              key={m.href} href={m.href}
              aria-current={aktif ? 'page' : undefined}
              // min-h 56px: sasaran sentuh di bawah itu sering meleset,
              // terutama saat dipakai sambil berdiri.
              className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2
                          ${aktif ? 'text-aksen-700' : 'text-slate-400'}`}
            >
              {m.ikon}
              <span className="text-[9.5px] font-bold leading-none">{m.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
