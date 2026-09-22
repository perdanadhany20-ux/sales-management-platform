'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { type PenggunaAktif } from '@/lib/auth';
import { type Branding } from '@/lib/branding';
import { useLonceng, totalPerluTindakan } from '@/lib/use-lonceng';
import { isPengawas } from '@/lib/constants';
import { tanggalPendek, rupiahRingkas } from '@/lib/format';

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
  const pengawas = isPengawas(pengguna.role);

  const total = totalPerluTindakan(lonceng);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="px-3 sm:px-5 h-14 flex items-center gap-3">

        {/* ── Identitas platform ── */}
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
          <LogoMerek branding={branding} ukuran={34} />
          <span className="min-w-0 hidden sm:block">
            <span className="block text-[14px] font-black text-slate-900 leading-tight truncate">
              {branding.nama_platform}
              {branding.nama_portal && (
                <span className="font-bold ml-1.5" style={{ color: branding.warna_aksen }}>
                  {branding.nama_portal}
                </span>
              )}
            </span>
            <span className="block text-[10px] text-slate-400 leading-tight truncate">
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
                       px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <span aria-hidden="true">🔍</span>
            <span className="hidden formulir:inline">Pencarian</span>
          </button>

          <Pintasan href="/daily-report" ikon="📝" label="Daily Report"
            jumlah={lonceng.laporanBelum ? '!' : 0}
            warna={lonceng.laporanBelum ? 'merah' : 'netral'}
            judul={lonceng.laporanBelum
              ? 'Laporan harian hari ini belum diisi'
              : 'Laporan harian hari ini sudah diisi'} />

          <Pintasan href="/meeting" ikon="📍" label="Meeting"
            jumlah={lonceng.meetingPerlu} warna="biru"
            judul={`${lonceng.meetingPerlu} meeting hari ini menunggu dieksekusi`} />

          <Pintasan href="/schedule" ikon="🗓️" label="Hari Ini"
            jumlah={lonceng.jadwalHariIni} warna="netral"
            judul={`${lonceng.jadwalHariIni} jadwal hari ini belum selesai`} />

          <Pintasan href="/pipeline" ikon="📊" label="Closing" tersembunyiDiPonsel
            jumlah={lonceng.pipelineDekat} warna="kuning"
            judul={`${lonceng.pipelineDekat} pipeline diperkirakan closing dalam 7 hari`} />

          {/* ── Lonceng ── */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => { setBukaNotif((b) => !b); void muatUlang(); }}
              aria-expanded={bukaNotif}
              aria-label={`Notifikasi, ${total} perlu tindakan`}
              className={`inline-flex items-center gap-1.5 rounded-kontrol px-3 py-1.5 text-[12px] font-bold transition-colors
                          ${total > 0
                            ? 'bg-[#e34948] text-white hover:bg-[#c93c3b]'
                            : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
            >
              <span aria-hidden="true">🔔</span>
              <span className="hidden formulir:inline">Notifikasi</span>
              <span className={`inline-grid place-items-center min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-black tabular-nums
                                ${total > 0 ? 'bg-white text-[#e34948]' : 'bg-slate-100 text-slate-500'}`}>
                {total}
              </span>
            </button>

            {bukaNotif && (
              <PanelNotifikasi
                lonceng={lonceng}
                pengawas={pengawas}
                onTutup={() => setBukaNotif(false)}
              />
            )}
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
    <span className="w-8 h-8 rounded-full bg-aksen-100 text-aksen-800 grid place-items-center text-[11px] font-black">
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

function Pintasan({ href, ikon, label, jumlah, warna, judul, tersembunyiDiPonsel }: {
  href: string;
  ikon: string;
  label: string;
  jumlah: number | '!';
  warna: keyof typeof WARNA_LENCANA;
  judul: string;
  tersembunyiDiPonsel?: boolean;
}) {
  const menyala = jumlah === '!' || jumlah > 0;
  return (
    <Link
      href={href} title={judul}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-kontrol border px-2.5 py-1.5
                  text-[12px] font-semibold transition-colors
                  ${tersembunyiDiPonsel ? 'hidden formulir:inline-flex' : ''}
                  ${menyala
                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'}`}
    >
      <span aria-hidden="true">{ikon}</span>
      <span className="hidden satulayar:inline">{label}</span>
      <span className={`inline-grid place-items-center min-w-[18px] h-[18px] rounded-full px-1
                        text-[10px] font-black tabular-nums
                        ${menyala ? WARNA_LENCANA[warna] : 'bg-slate-100 text-slate-400'}`}>
        {jumlah}
      </span>
    </Link>
  );
}

/* ── Panel notifikasi ─────────────────────────────────────────────────────── */

interface Butir { ikon: string; judul: string; keterangan: string; href: string; warna: string }

function PanelNotifikasi({ lonceng, pengawas, onTutup }: {
  lonceng: ReturnType<typeof useLonceng>['lonceng'];
  pengawas: boolean;
  onTutup: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Klik di luar dan tombol Escape menutup panel. Tanpa keduanya, satu-satunya
  // cara menutupnya adalah menekan tombol loncengnya lagi — dan orang yang
  // tidak menemukannya akan mengira halamannya macet.
  useEffect(() => {
    const klik = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onTutup();
    };
    const tombol = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    document.addEventListener('mousedown', klik);
    document.addEventListener('keydown', tombol);
    return () => {
      document.removeEventListener('mousedown', klik);
      document.removeEventListener('keydown', tombol);
    };
  }, [onTutup]);

  const butir: Butir[] = [];

  if (lonceng.laporanBelum) {
    butir.push({
      ikon: '📝', warna: '#e34948',
      judul: 'Daily Report hari ini belum diisi',
      keterangan: 'Isi sebelum jam kerja berakhir.',
      href: '/daily-report',
    });
  }
  if (lonceng.meetingPerlu > 0) {
    butir.push({
      ikon: '📍', warna: '#1d4ed8',
      judul: `${lonceng.meetingPerlu} meeting hari ini menunggu`,
      keterangan: 'Check-in GPS dan foto bukti belum lengkap.',
      href: '/meeting',
    });
  }
  if (lonceng.terlewat > 0) {
    butir.push({
      ikon: '⏰', warna: '#e34948',
      judul: `${lonceng.terlewat} jadwal sudah lewat tanggal`,
      keterangan: 'Belum diselesaikan maupun dibatalkan.',
      href: '/schedule',
    });
  }
  if (pengawas && lonceng.belumDitugaskan > 0) {
    butir.push({
      ikon: '👤', warna: '#eda100',
      judul: `${lonceng.belumDitugaskan} pengajuan belum ditugaskan`,
      keterangan: 'Menunggu Anda menunjuk Sales pelaksananya.',
      href: '/schedule',
    });
  }
  if (lonceng.pipelineDekat > 0) {
    butir.push({
      ikon: '📊', warna: '#eda100',
      judul: `${lonceng.pipelineDekat} pipeline mendekati closing`,
      keterangan: 'Perkiraan closing dalam 7 hari ke depan.',
      href: '/pipeline',
    });
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-[calc(100%+8px)] w-[300px] max-w-[calc(100vw-24px)]
                 bg-white rounded-kartu border border-slate-200 shadow-dropdown overflow-hidden z-50"
    >
      <header className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center gap-2">
        <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide flex-1">
          Perlu Tindakan
        </h2>
        <span className="text-[10px] text-slate-400">{tanggalPendek(new Date().toISOString())}</span>
      </header>

      {butir.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xl mb-1" aria-hidden="true">✓</p>
          <p className="text-[12px] font-bold text-slate-600">Semua tertangani</p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            Tidak ada laporan, meeting, atau jadwal yang menunggu.
          </p>
        </div>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto">
          {butir.map((b) => (
            <li key={b.judul}>
              <Link
                href={b.href} onClick={onTutup}
                className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
              >
                <span aria-hidden="true" className="text-[13px] mt-0.5">{b.ikon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold text-slate-800 leading-snug">{b.judul}</span>
                  <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{b.keterangan}</span>
                </span>
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: b.warna }} />
              </Link>
            </li>
          ))}
        </ul>
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

      const [pelanggan, jadwal, pipeline, laporan] = await Promise.all([
        supabase.from('sm_customers').select('id, name, city, address').ilike('name', k).limit(5),
        supabase.from('sm_schedules')
          .select('id, customer_name, category, schedule_date, status')
          .or(`customer_name.ilike.${k},project.ilike.${k}`)
          .order('schedule_date', { ascending: false }).limit(5),
        supabase.from('sm_pipeline')
          .select('id, customer_name, project_detail, project_value')
          .or(`customer_name.ilike.${k},project_detail.ilike.${k}`)
          .order('pipeline_date', { ascending: false }).limit(5),
        supabase.from('sm_daily_reports')
          .select('id, customer_name, activity, report_date')
          .or(`customer_name.ilike.${k},activity.ilike.${k}`)
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
