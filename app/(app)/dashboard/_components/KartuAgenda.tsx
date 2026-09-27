'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BentoCard } from '@/components/shared/Bento';
import {
  intipDailyReport, intipJadwal, intipTerlewat, intipPipeline, intipGp, intipBelumDitugaskan,
  type ButirIntip,
} from '@/lib/intip';
import { PERISTIWA_DATA_BERUBAH } from '@/components/shared/Feedback';

/**
 * Agenda & Tindak Lanjut — jawaban untuk pertanyaan pertama saat membuka
 * aplikasi: "apa yang harus saya kerjakan sekarang?".
 *
 * Kartu lain di dashboard menjawab "bagaimana hasil 30 hari terakhir". Itu
 * berguna, tapi bukan yang dicari Sales jam delapan pagi. Kartu ini berisi
 * DAFTAR yang bisa diklik — setiap baris membuka barisnya langsung (?fokus=),
 * bukan sekadar halamannya.
 *
 * Datanya memakai fungsi yang sama dengan jendela intip di header, jadi angka
 * di sini tidak pernah berbeda dari lencana di atas, dan tidak ada query baru.
 * RLS yang menyaring: Sales hanya melihat miliknya, pengawas seluruh tim.
 */

interface Bagian {
  kunci: string;
  judul: string;
  warna: string;
  butir: ButirIntip[];
  semua: string;
  /** Ditampilkan walau kosong, dengan kalimat ini. */
  kosong?: string;
}

export function KartuAgenda({ userId, peran, pengawas, boleh }: {
  userId: string; peran: string; pengawas: boolean;
  /** Menu yang boleh dibuka akun ini (peran + lisensi). */
  boleh: (menu: string) => boolean;
}) {
  const [bagian, setBagian] = useState<Bagian[] | null>(null);
  const [laporanBelum, setLaporanBelum] = useState(false);

  useEffect(() => {
    let batal = false;

    async function muat() {
      // Semua dipanggil bersamaan — tidak ada yang menunggu yang lain.
      const kosong = Promise.resolve([] as ButirIntip[]);
      const jadwalBoleh = boleh('schedule');
      const [laporan, jadwal, terlewat, closing, gp, belumTugas] = await Promise.all([
        pengawas || !boleh('daily-report') ? kosong : intipDailyReport(userId),
        jadwalBoleh || boleh('meeting') ? intipJadwal(userId, pengawas) : kosong,
        jadwalBoleh ? intipTerlewat(userId, pengawas) : kosong,
        boleh('pipeline') ? intipPipeline(userId, pengawas) : kosong,
        pengawas && boleh('gp') ? intipGp(peran) : kosong,
        pengawas && jadwalBoleh ? intipBelumDitugaskan() : kosong,
      ]);
      if (batal) return;

      setLaporanBelum(!pengawas && laporan.length === 1 && laporan[0].id === 'kosong');
      // Bagian untuk modul yang tidak boleh dibuka tidak ditampilkan sama sekali.
      const menuBagian: Record<string, boolean> = {
        jadwal: jadwalBoleh || boleh('meeting'), terlewat: jadwalBoleh, closing: boleh('pipeline'),
        gp: boleh('gp'), tugas: jadwalBoleh,
      };
      setBagian(([
        { kunci: 'jadwal', judul: 'Hari Ini', warna: '#2a78d6', butir: jadwal,
          semua: '/schedule', kosong: 'Tidak ada jadwal atau meeting hari ini.' },
        { kunci: 'terlewat', judul: 'Terlewat', warna: '#e34948', butir: terlewat,
          semua: '/schedule' },
        { kunci: 'closing', judul: 'Closing ≤ 7 Hari', warna: '#eda100', butir: closing,
          semua: '/pipeline' },
        { kunci: 'gp', judul: 'Menunggu Persetujuan GP', warna: '#7c3aed', butir: gp,
          semua: '/gp' },
        { kunci: 'tugas', judul: 'Belum Ditugaskan', warna: '#eda100', butir: belumTugas,
          semua: '/schedule' },
      ] as Bagian[]).filter((b) => menuBagian[b.kunci]));
    }

    void muat();
    // Selesai menyimpan di halaman lain (toast sukses) → agenda ikut segar.
    const segarkan = () => { void muat(); };
    window.addEventListener(PERISTIWA_DATA_BERUBAH, segarkan);
    return () => { batal = true; window.removeEventListener(PERISTIWA_DATA_BERUBAH, segarkan); };
  }, [userId, peran, pengawas, boleh]);

  const tampil = (bagian ?? []).filter((b) => b.butir.length > 0 || b.kosong);
  const semuaBeres = bagian !== null && !laporanBelum
    && bagian.every((b) => b.kunci === 'jadwal' || b.butir.length === 0);

  return (
    <BentoCard
      rentang={12}
      judul="Agenda & Tindak Lanjut"
      aksi={<span className="text-[11px] font-semibold text-slate-400">{hariIniPanjang()}</span>}
    >
      {bagian === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Memuat agenda">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
              <div className="h-10 rounded-kontrol bg-slate-100 animate-pulse" />
              <div className="h-10 rounded-kontrol bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {laporanBelum && (
            <Link href="/daily-report"
              className="flex items-center justify-between gap-3 rounded-kontrol border border-[#e34948]/30
                         bg-[#fce3e3] px-3.5 py-2.5 text-[13px] text-[#8f2c2b] hover:bg-[#fad4d4]
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-aksen-600">
              <span><strong className="font-bold">Laporan hari ini belum diisi.</strong> Isi sebelum jam kerja berakhir.</span>
              <span className="font-bold whitespace-nowrap">Isi sekarang →</span>
            </Link>
          )}

          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {tampil.map((b) => <BagianAgenda key={b.kunci} bagian={b} />)}
          </div>

          {semuaBeres && (
            <p className="text-[12px] text-slate-500">
              Tidak ada yang terlewat, tidak ada closing mendesak
              {pengawas ? ', dan tidak ada yang menunggu persetujuan Anda' : ''}. 👍
            </p>
          )}
        </div>
      )}
    </BentoCard>
  );
}

function BagianAgenda({ bagian: b }: { bagian: Bagian }) {
  const BATAS_TAMPIL = 4;
  const lebih = b.butir.length - BATAS_TAMPIL;

  return (
    <section aria-labelledby={`agenda-${b.kunci}`} className="flex flex-col gap-1.5 min-w-0">
      <header className="flex items-center justify-between gap-2">
        <h3 id={`agenda-${b.kunci}`}
          className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: b.warna }} aria-hidden />
          {b.judul}
          {b.butir.length > 0 && (
            <span className="text-[11px] font-bold rounded-full px-1.5 py-px"
              style={{ color: b.warna, background: `${b.warna}1a` }}>
              {b.butir.length}{b.butir.length >= 6 ? '+' : ''}
            </span>
          )}
        </h3>
        {b.butir.length > 0 && (
          <Link href={b.semua}
            className="text-[11px] font-semibold text-aksen-700 hover:underline whitespace-nowrap">
            Lihat semua →
          </Link>
        )}
      </header>

      {b.butir.length === 0 ? (
        <p className="text-[12px] text-slate-400 py-2">{b.kosong}</p>
      ) : (
        <ul className="flex flex-col m-0 p-0 list-none">
          {b.butir.slice(0, BATAS_TAMPIL).map((x) => (
            <li key={x.id}>
              <Link href={x.href}
                className="flex items-center gap-2.5 rounded-kontrol px-2 py-2 -mx-2 min-h-[44px]
                           hover:bg-slate-50 focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-aksen-600">
                <span className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ background: x.warna ?? b.warna }} aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-slate-800 truncate">{x.judul}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{x.keterangan}</span>
                </span>
                {x.kanan && (
                  <span className="text-[12px] font-bold text-slate-700 tabular-nums flex-shrink-0">{x.kanan}</span>
                )}
              </Link>
            </li>
          ))}
          {lebih > 0 && (
            <li>
              <Link href={b.semua} className="block text-[11px] text-slate-500 hover:text-aksen-700 px-2 py-1">
                +{lebih} lainnya
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function hariIniPanjang(): string {
  return new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}
