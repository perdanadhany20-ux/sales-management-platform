'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { type PenggunaAktif } from '@/lib/auth';
import { type Branding } from '@/lib/branding';
import { useLonceng, totalPerluTindakan } from '@/lib/use-lonceng';
import { usePengingat } from '@/lib/notifikasi';
import { isPengawas } from '@/lib/constants';
import { tanggalPendek, rupiahRingkas, polaIlike } from '@/lib/format';
import {
  intipDailyReport, intipMeeting, intipJadwal, intipPipeline,
  intipTerlewat, intipBelumDitugaskan, intipGp, type ButirIntip,
} from '@/lib/intip';
import { DropdownMengambang } from './DropdownMengambang';

/**
 * components/shared/HeaderAtas.tsx — bilah judul + lencana di puncak halaman.
 *
 * Bentuknya mengikuti header Work Management yang dipakai Mas Putu: identitas
 * platform di kiri, deretan pintasan berlencana di kanan.
 *
 * Satu aturan yang dipegang di seluruh berkas ini: TIDAK ADA angka hiasan.
 * Setiap lencana adalah hitungan nyata dari tabelnya (lihat lib/use-lonceng.ts)
 * dan setiap lencana bisa diklik ke tempat pekerjaannya. Lencana yang
 * menunjukkan angka tapi tidak membawa ke mana-mana hanya melatih orang untuk
 * mengabaikannya.
 */

export function HeaderAtas({ pengguna, branding }: {
  pengguna: PenggunaAktif;
  branding: Branding;
}) {
  const { lonceng, muatUlang } = useLonceng(pengguna);
  const [bukaNotif, setBukaNotif] = useState(false);
  const [bukaCari, setBukaCari] = useState(false);
  const loncengRef = useRef<HTMLButtonElement>(null);
  // Hanya satu jendela intip terbuka pada satu waktu. Dua panel melayang
  // bersamaan saling menutupi dan tidak ada yang bisa dibaca utuh.
  const [intip, setIntip] = useState<string | null>(null);
  const pengawas = isPengawas(pengguna.role);

  // Pengingat peramban memakai angka yang sama dengan lencana di bawah ini,
  // jadi keduanya mustahil menyebut jumlah yang berbeda.
  usePengingat(lonceng, pengawas);

  const total = totalPerluTindakan(lonceng);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="px-3 sm:px-5 h-14 flex items-center gap-3">

        {/* ── Identitas platform ── */}
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
          <LogoMerek branding={branding} ukuran={34} />
          <span className="min-w-0 hidden sm:block">
            <span className="block text-[14px] sentuhlebar:text-[16px] font-black text-slate-900 leading-tight truncate">
              {branding.nama_platform}
              {branding.nama_portal && (
                <span className="font-bold ml-1.5" style={{ color: branding.warna_aksen }}>
                  {branding.nama_portal}
                </span>
              )}
            </span>
            <span className="block text-[10px] sentuhlebar:text-[12px] text-slate-400 leading-tight truncate">
              {branding.nama_perusahaan || 'Platform internal'}
            </span>
          </span>
          <span className="sm:hidden text-[13px] font-black text-slate-900 truncate">
            {branding.nama_pendek || branding.nama_platform}
          </span>
        </Link>

        <div className="flex-1" />

        {/* ── Pintasan berlencana ──
            Menggulung mendatar di layar sempit, bukan membungkus ke baris
            kedua: header yang tiba-tiba jadi dua baris menggeser seluruh isi
            halaman ke bawah setiap kali satu lencana muncul. */}
        <nav aria-label="Pintasan" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button" onClick={() => setBukaCari(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-kontrol border border-slate-200 bg-slate-50
                       px-3 py-1.5 min-h-[34px] text-[12px] sentuhlebar:text-[14px] font-semibold
                       text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <span aria-hidden="true">🔍</span>
            <span className="hidden sidebar:inline">Pencarian</span>
          </button>

          <Pintasan
            kunci="laporan" ikon="📝" label="Daily Report" href="/daily-report"
            jumlah={lonceng.laporanBelum ? '!' : 0}
            warna={lonceng.laporanBelum ? 'merah' : 'netral'}
            judulPanel="Daily Report hari ini"
            kosong="Belum ada laporan hari ini."
            terbuka={intip === 'laporan'} onToggle={setIntip}
            ambil={() => intipDailyReport(pengguna.id)} />

          <Pintasan
            kunci="meeting" ikon="📍" label="Meeting" href="/meeting"
            jumlah={lonceng.meetingPerlu} warna="biru"
            judulPanel="Meeting hari ini"
            kosong="Tidak ada meeting yang menunggu hari ini."
            terbuka={intip === 'meeting'} onToggle={setIntip}
            ambil={() => intipMeeting(pengguna.id, pengawas)} />

          <Pintasan
            kunci="jadwal" ikon="🗓️" label="Hari Ini" href="/schedule"
            jumlah={lonceng.jadwalHariIni} warna="netral"
            judulPanel="Jadwal hari ini"
            kosong="Tidak ada jadwal yang belum selesai hari ini."
            terbuka={intip === 'jadwal'} onToggle={setIntip}
            ambil={() => intipJadwal(pengguna.id, pengawas)} />

          <Pintasan
            kunci="pipeline" ikon="📊" label="Closing" href="/pipeline" tersembunyiDiPonsel
            jumlah={lonceng.pipelineDekat} warna="kuning"
            judulPanel="Mendekati closing (7 hari)"
            kosong="Tidak ada peluang yang jatuh tempo pekan ini."
            terbuka={intip === 'pipeline'} onToggle={setIntip}
            ambil={() => intipPipeline(pengguna.id, pengawas)} />

          {/* ── Lonceng ── */}
          <div className="relative flex-shrink-0">
            <button
              ref={loncengRef}
              type="button"
              onClick={() => { setIntip(null); setBukaNotif((b) => !b); void muatUlang(); }}
              aria-expanded={bukaNotif}
              aria-label={`Notifikasi, ${total} perlu tindakan`}
              className={`inline-flex items-center gap-1.5 rounded-kontrol px-3 py-1.5 min-h-[34px]
                          text-[12px] sentuhlebar:text-[14px] font-bold transition-colors
                          ${total > 0
                            ? 'bg-[#e34948] text-white hover:bg-[#c93c3b]'
                            : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
            >
              <span aria-hidden="true">🔔</span>
              <span className="hidden sidebar:inline">Notifikasi</span>
              <span className={`inline-grid place-items-center min-w-[18px] h-[18px] sentuhlebar:min-w-[21px]
                                sentuhlebar:h-[21px] rounded-full px-1 text-[10px] sentuhlebar:text-[12px]
                                font-black tabular-nums
                                ${total > 0 ? 'bg-white text-[#e34948]' : 'bg-slate-100 text-slate-500'}`}>
                {total}
              </span>
            </button>

            <DropdownMengambang
              buka={bukaNotif} onTutup={() => setBukaNotif(false)}
              triggerRef={loncengRef} lebar={320}
            >
              <PanelNotifikasi
                lonceng={lonceng}
                pengawas={pengawas}
                peran={pengguna.role}
                userId={pengguna.id}
                onTutup={() => setBukaNotif(false)}
              />
            </DropdownMengambang>
          </div>

          {/*
            Menuju Profil, BUKAN langsung keluar. Sebelumnya avatar semacam ini
            memanggil logout seketika — satu sentuhan tak sengaja di pojok
            layar, yang di ponsel justru area paling sering tersenggol ibu jari,
            langsung mengeluarkan Sales dari akunnya di tengah lapangan.
          */}
          <Link href="/profil" aria-label={`Profil ${pengguna.full_name}`}
            className="flex-shrink-0 ml-0.5">
            <Inisial nama={pengguna.full_name} />
          </Link>
        </nav>
      </div>

      {bukaCari && <ModalCari onTutup={() => setBukaCari(false)} pengawas={pengawas} />}
    </header>
  );
}

function Inisial({ nama }: { nama: string }) {
  const huruf = nama.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="w-8 h-8 sentuhlebar:w-9 sentuhlebar:h-9 rounded-full bg-aksen-100 text-aksen-800 grid place-items-center text-[11px] sentuhlebar:text-[13px] font-black">
      {huruf || '?'}
    </span>
  );
}

/* ── Logo ─────────────────────────────────────────────────────────────────── */

export function LogoMerek({ branding, ukuran }: { branding: Branding; ukuran: number }) {
  if (branding.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logo_url} alt={branding.nama_platform}
        className="rounded-kontrol object-contain flex-shrink-0 bg-white"
        style={{ width: ukuran, height: ukuran }}
      />
    );
  }
  return (
    <span
      className="rounded-kontrol bg-gradient-to-br from-aksen-700 to-aksen-500 grid place-items-center flex-shrink-0"
      style={{ width: ukuran, height: ukuran }}
    >
      <svg width={ukuran * 0.47} height={ukuran * 0.47} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/* ── Pintasan ─────────────────────────────────────────────────────────────── */

const WARNA_LENCANA = {
  merah:  'bg-[#e34948] text-white',
  biru:   'bg-aksen-700 text-white',
  kuning: 'bg-[#eda100] text-white',
  netral: 'bg-slate-200 text-slate-600',
} as const;

function Pintasan({
  kunci, ikon, label, href, jumlah, warna, judulPanel, kosong,
  terbuka, onToggle, ambil, tersembunyiDiPonsel,
}: {
  kunci: string;
  ikon: string;
  label: string;
  /** Tujuan tombol "Lihat semua" di kaki panel. */
  href: string;
  jumlah: number | '!';
  warna: keyof typeof WARNA_LENCANA;
  judulPanel: string;
  kosong: string;
  terbuka: boolean;
  onToggle: (kunci: string | null) => void;
  ambil: () => Promise<ButirIntip[]>;
  tersembunyiDiPonsel?: boolean;
}) {
  const menyala = jumlah === '!' || jumlah > 0;
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`relative flex-shrink-0 ${tersembunyiDiPonsel ? 'hidden sidebar:block' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={terbuka}
        aria-label={`${label}, ${jumlah} perlu dilihat`}
        onClick={() => onToggle(terbuka ? null : kunci)}
        className={`inline-flex items-center gap-1.5 rounded-kontrol border px-2.5 py-1.5
                    min-h-[34px] text-[12px] sentuhlebar:text-[14px] font-semibold transition-colors
                    ${terbuka
                      ? 'border-aksen-300 bg-aksen-50 text-aksen-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
      >
        <span aria-hidden="true">{ikon}</span>
        <span className="hidden sidebar:inline">{label}</span>
        <span className={`inline-grid place-items-center min-w-[18px] h-[18px] sentuhlebar:min-w-[21px]
                          sentuhlebar:h-[21px] rounded-full px-1 text-[10px] sentuhlebar:text-[12px]
                          font-black tabular-nums
                          ${menyala ? WARNA_LENCANA[warna] : 'bg-slate-100 text-slate-400'}`}>
          {jumlah}
        </span>
      </button>

      <DropdownMengambang buka={terbuka} onTutup={() => onToggle(null)} triggerRef={btnRef}>
        <PanelIntip
          judul={judulPanel}
          kosong={kosong}
          hrefSemua={href}
          labelSemua={`Buka ${label}`}
          ambil={ambil}
          onTutup={() => onToggle(null)}
        />
      </DropdownMengambang>
    </div>
  );
}

/* ── Jendela intip ────────────────────────────────────────────────────────── */

/**
 * Daftar pendek berisi butir sesungguhnya di balik sebuah lencana.
 *
 * Isinya diambil SAAT DIBUKA, bukan ikut dimuat bersama header. Header
 * dirender di setiap halaman; memuat isi keenam panel di muka berarti enam
 * query yang hampir selalu tidak pernah dilihat.
 */
function PanelIntip({ judul, kosong, hrefSemua, labelSemua, ambil, onTutup }: {
  judul: string;
  kosong: string;
  hrefSemua: string;
  labelSemua: string;
  ambil: () => Promise<ButirIntip[]>;
  onTutup: () => void;
}) {
  const [butir, setButir] = useState<ButirIntip[] | null>(null);

  useEffect(() => {
    let batal = false;
    void ambil()
      .then((hasil) => { if (!batal) setButir(hasil); })
      .catch(() => { if (!batal) setButir([]); });
    return () => { batal = true; };
    // `ambil` sengaja tidak masuk daftar kebergantungan: ia ditulis sebagai
    // arrow function di tempat pemanggilan, jadi identitasnya berubah setiap
    // render dan memasukkannya akan membuat panel ini mengambil data tanpa
    // henti selama ia terbuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Posisi (fixed, portal ke body) dan klik-di-luar/Escape sudah ditangani
  // DropdownMengambang yang membungkus komponen ini — tidak diulang di sini.
  return (
    <div
      role="dialog"
      aria-label={judul}
      className="w-full max-w-[calc(100vw-24px)]
                 bg-white rounded-kartu border border-slate-200 shadow-dropdown overflow-hidden"
    >
      <header className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/70">
        <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{judul}</h2>
      </header>

      {butir === null ? (
        <p className="px-3.5 py-5 text-[12px] text-slate-400 text-center">Memuat…</p>
      ) : butir.length === 0 ? (
        <p className="px-3.5 py-5 text-[12px] text-slate-400 text-center leading-snug">{kosong}</p>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto">
          {butir.map((b) => (
            <li key={b.id}>
              <Link
                href={b.href} onClick={onTutup}
                className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 transition-colors
                           border-b border-slate-100 last:border-0"
              >
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: b.warna ?? '#94a3b8' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold text-slate-800 leading-snug truncate">
                    {b.judul}
                  </span>
                  <span className="block text-[11px] text-slate-500 leading-snug truncate">
                    {b.keterangan}
                  </span>
                </span>
                {b.kanan && (
                  <span className="text-[11px] font-bold text-slate-500 tabular-nums flex-shrink-0">
                    {b.kanan}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/70">
        <Link href={hrefSemua} onClick={onTutup}
          className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">
          {labelSemua} →
        </Link>
      </footer>
    </div>
  );
}

/* ── Panel notifikasi ─────────────────────────────────────────────────────── */

/**
 * Lonceng: seluruh hal yang menunggu tindakan, sebagai BUTIR, bukan ringkasan.
 *
 * Versi pertama panel ini berisi kalimat rangkuman ("3 meeting menunggu") yang
 * menautkan ke halaman modulnya. Sama seperti lencana, itu memindahkan
 * pekerjaan alih-alih menghematnya: orang tetap harus mencari sendiri yang
 * mana. Kini tiap baris adalah dokumen atau jadwal yang sesungguhnya, dan
 * menekannya membawa langsung ke baris itu.
 */
function PanelNotifikasi({ lonceng, pengawas, peran, userId, onTutup }: {
  lonceng: ReturnType<typeof useLonceng>['lonceng'];
  pengawas: boolean;
  peran: string;
  userId: string;
  onTutup: () => void;
}) {
  const [kelompok, setKelompok] = useState<{ judul: string; butir: ButirIntip[] }[] | null>(null);

  // Posisi (fixed, portal ke body), klik-di-luar, dan Escape sudah ditangani
  // DropdownMengambang yang membungkus komponen ini.
  useEffect(() => {
    let batal = false;

    (async () => {
      // Hanya bagian yang angkanya memang bukan nol yang diambil. Lencana
      // sudah tahu jumlahnya, jadi memanggil query untuk kelompok yang pasti
      // kosong hanya memperlambat panel tanpa menambah satu baris pun.
      const tugas: Promise<{ judul: string; butir: ButirIntip[] }>[] = [];

      if (lonceng.laporanBelum) {
        tugas.push(Promise.resolve({
          judul: 'Daily Report',
          butir: [{
            id: 'laporan-kosong',
            judul: 'Laporan hari ini belum diisi',
            keterangan: 'Isi sebelum jam kerja berakhir.',
            href: '/daily-report',
            warna: '#e34948',
          }],
        }));
      }

      if (lonceng.meetingPerlu > 0) {
        tugas.push(intipMeeting(userId, pengawas)
          .then((butir) => ({ judul: 'Meeting menunggu', butir })));
      }

      if (lonceng.terlewat > 0) {
        tugas.push(intipTerlewat(userId, pengawas)
          .then((butir) => ({ judul: 'Jadwal lewat tanggal', butir })));
      }

      if (pengawas && lonceng.belumDitugaskan > 0) {
        tugas.push(intipBelumDitugaskan()
          .then((butir) => ({ judul: 'Belum ditugaskan', butir })));
      }

      tugas.push(intipGp(peran).then((butir) => ({ judul: 'GP menunggu tanda tangan', butir })));

      if (lonceng.pipelineDekat > 0) {
        tugas.push(intipPipeline(userId, pengawas)
          .then((butir) => ({ judul: 'Mendekati closing', butir })));
      }

      const hasil = await Promise.all(tugas);
      if (!batal) setKelompok(hasil.filter((k) => k.butir.length > 0));
    })();

    return () => { batal = true; };
  }, [lonceng, pengawas, peran, userId]);

  const jumlah = (kelompok ?? []).reduce((t, k) => t + k.butir.length, 0);

  return (
    <div
      role="dialog"
      aria-label="Notifikasi"
      className="w-full max-w-[calc(100vw-24px)]
                 bg-white rounded-kartu border border-slate-200 shadow-dropdown overflow-hidden"
    >
      <header className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center gap-2">
        <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide flex-1">
          Perlu Tindakan
        </h2>
        <span className="text-[10px] text-slate-400">{tanggalPendek(new Date().toISOString())}</span>
      </header>

      {kelompok === null ? (
        <p className="px-4 py-6 text-[12px] text-slate-400 text-center">Memuat…</p>
      ) : jumlah === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xl mb-1" aria-hidden="true">✓</p>
          <p className="text-[12px] font-bold text-slate-600">Semua tertangani</p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            Tidak ada laporan, meeting, jadwal, atau dokumen yang menunggu.
          </p>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          {kelompok.map((k) => (
            <section key={k.judul}>
              <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {k.judul}
              </p>
              <ul>
                {k.butir.map((b) => (
                  <li key={`${k.judul}-${b.id}`}>
                    <Link
                      href={b.href} onClick={onTutup}
                      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-slate-50 transition-colors
                                 border-b border-slate-100 last:border-0"
                    >
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: b.warna ?? '#94a3b8' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-bold text-slate-800 leading-snug truncate">
                          {b.judul}
                        </span>
                        <span className="block text-[11px] text-slate-500 leading-snug truncate">
                          {b.keterangan}
                        </span>
                      </span>
                      {b.kanan && (
                        <span className="text-[11px] font-bold text-slate-500 tabular-nums flex-shrink-0">
                          {b.kanan}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/70">
        <Link href="/activity" onClick={onTutup}
          className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">
          Lihat seluruh riwayat aktivitas →
        </Link>
      </footer>
    </div>
  );
}

/* ── Pencarian ────────────────────────────────────────────────────────────── */

interface Temuan { id: string; jenis: string; judul: string; keterangan: string; href: string }

/**
 * Pencarian lintas modul.
 *
 * Mencari di tabel aslinya, bukan pada daftar yang kebetulan sedang terbuka —
 * karena yang dicari orang hampir selalu justru yang TIDAK ada di layar.
 * Hasilnya tetap tunduk RLS: Sales hanya menemukan barisnya sendiri.
 */
function ModalCari({ onTutup, pengawas }: { onTutup: () => void; pengawas: boolean }) {
  const [kata, setKata] = useState('');
  const [tertunda, setTertunda] = useState('');
  const [hasil, setHasil] = useState<Temuan[]>([]);
  const [mencari, setMencari] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const t = setTimeout(() => setTertunda(kata.trim()), 300);
    return () => clearTimeout(t);
  }, [kata]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onTutup]);

  useEffect(() => {
    if (tertunda.length < 2) { setHasil([]); return; }
    let batal = false;

    (async () => {
      setMencari(true);
      const k = `%${tertunda}%`;
      const p = polaIlike(tertunda);

      const [pelanggan, jadwal, pipeline, laporan] = await Promise.all([
        supabase.from('sm_customers').select('id, name, city, address').ilike('name', k).limit(5),
        supabase.from('sm_schedules')
          .select('id, customer_name, category, schedule_date, status')
          .or(`customer_name.ilike.${p},project.ilike.${p}`)
          .order('schedule_date', { ascending: false }).limit(5),
        supabase.from('sm_pipeline')
          .select('id, customer_name, project_detail, project_value')
          .or(`customer_name.ilike.${p},project_detail.ilike.${p}`)
          .order('pipeline_date', { ascending: false }).limit(5),
        supabase.from('sm_daily_reports')
          .select('id, customer_name, activity, report_date')
          .or(`customer_name.ilike.${p},activity.ilike.${p}`)
          .order('report_date', { ascending: false }).limit(5),
      ]);

      if (batal) return;

      const kumpul: Temuan[] = [
        ...((pelanggan.data ?? []) as { id: string; name: string; city: string | null; address: string | null }[])
          .map((c) => ({
            id: `c-${c.id}`, jenis: 'Customer', judul: c.name,
            keterangan: c.city || c.address || 'Data pelanggan',
            href: '/pipeline',
          })),
        ...((jadwal.data ?? []) as { id: string; customer_name: string; category: string; schedule_date: string }[])
          .map((s) => ({
            id: `s-${s.id}`, jenis: 'Jadwal', judul: s.customer_name,
            keterangan: `${s.category} · ${tanggalPendek(s.schedule_date)}`,
            href: '/schedule',
          })),
        ...((pipeline.data ?? []) as { id: string; customer_name: string; project_detail: string; project_value: number }[])
          .map((p) => ({
            id: `p-${p.id}`, jenis: 'Pipeline', judul: p.customer_name,
            keterangan: `${p.project_detail} · ${rupiahRingkas(p.project_value)}`,
            href: '/pipeline',
          })),
        ...((laporan.data ?? []) as { id: string; customer_name: string; activity: string; report_date: string }[])
          .map((r) => ({
            id: `r-${r.id}`, jenis: 'Laporan', judul: r.customer_name,
            keterangan: `${r.activity} · ${tanggalPendek(r.report_date)}`,
            href: '/daily-report',
          })),
      ];

      setHasil(kumpul);
      setMencari(false);
    })();

    return () => { batal = true; };
  }, [tertunda, pengawas]);

  const dikelompokkan = useMemo(() => {
    const peta = new Map<string, Temuan[]>();
    for (const t of hasil) {
      const isi = peta.get(t.jenis);
      if (isi) isi.push(t);
      else peta.set(t.jenis, [t]);
    }
    return Array.from(peta.entries());
  }, [hasil]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-8" role="dialog" aria-modal="true"
      aria-label="Pencarian">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onTutup} aria-hidden="true" />

      <div className="relative w-full max-w-lg bg-white rounded-kartu shadow-modal border border-slate-200 overflow-hidden mt-[6vh]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
          <span aria-hidden="true" className="text-slate-400">🔍</span>
          <input
            ref={inputRef}
            value={kata} onChange={(e) => setKata(e.target.value)}
            placeholder="Cari customer, jadwal, pipeline, atau laporan…"
            aria-label="Kata kunci pencarian"
            className="flex-1 text-[14px] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={onTutup} aria-label="Tutup"
            className="text-[11px] font-bold text-slate-400 border border-slate-200 rounded-kecil px-1.5 py-0.5">
            ESC
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tertunda.length < 2 ? (
            <p className="px-4 py-6 text-[12px] text-slate-400 text-center">
              Ketik minimal 2 huruf. Hasilnya mengikuti hak akses Anda.
            </p>
          ) : mencari ? (
            <p className="px-4 py-6 text-[12px] text-slate-400 text-center">Mencari…</p>
          ) : hasil.length === 0 ? (
            <p className="px-4 py-6 text-[12px] text-slate-400 text-center">
              Tidak ada yang cocok dengan “{tertunda}”.
            </p>
          ) : (
            dikelompokkan.map(([jenis, isi]) => (
              <section key={jenis}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  {jenis}
                </p>
                <ul>
                  {isi.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => { router.push(t.href); onTutup(); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                      >
                        <span className="block text-[13px] font-bold text-slate-800 truncate">{t.judul}</span>
                        <span className="block text-[11px] text-slate-500 truncate mt-0.5">{t.keterangan}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
