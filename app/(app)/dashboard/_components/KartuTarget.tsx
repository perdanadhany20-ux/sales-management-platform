'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BentoCard } from '@/components/shared/Bento';
import { BatangTarget, warnaCapaian } from '@/components/shared/Charts';
import { Kosong, KerangkaKartu } from '@/components/shared/Feedback';
import { useBagianAdmin } from '@/components/shared/Shell';
import { rupiahRingkas } from '@/lib/format';
import {
  ambilPencapaian, ambilUkuran, rentangPeriode, LABEL_PERIODE,
  type JenisPeriode, type Pencapaian, type Ukuran,
} from '@/lib/target';

/**
 * Pencapaian target penjualan — "masih jauh atau sudah over?".
 *
 * Sales melihat dirinya sendiri; pengawas melihat total tim dan satu baris
 * per Sales dengan skala yang sama, sehingga panjang batangnya bisa
 * dibandingkan langsung antarorang. Baris datanya disaring RLS di
 * sm_pencapaian_target(), bukan di sini.
 */
export function KartuTarget({ pengawas }: { pengawas: boolean }) {
  const [periode, setPeriode] = useState<JenisPeriode>('bulan');
  const [ukuran, setUkuran] = useState<Ukuran>('nilai');
  const [data, setData] = useState<Pencapaian[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [saring, setSaring] = useState<'semua' | 'kurang' | 'tercapai' | 'tanpa'>('semua');
  const router = useRouter();
  const { setBagian } = useBagianAdmin();

  const rentang = useMemo(() => rentangPeriode(periode), [periode]);

  useEffect(() => {
    let batal = false;
    setData(null);
    setGalat(null);
    ambilPencapaian(rentang.dari, rentang.sampai)
      .then((d) => { if (!batal) setData(d); })
      .catch((e: Error) => { if (!batal) setGalat(e.message); });
    return () => { batal = true; };
  }, [rentang]);

  const baris = useMemo(() => (data ?? []).map((p) => ({ p, ...ambilUkuran(p, ukuran) })), [data, ukuran]);
  const total = baris.reduce((a, b) => ({ target: a.target + b.target, realisasi: a.realisasi + b.realisasi }),
    { target: 0, realisasi: 0 });
  const skala = Math.max(0, ...baris.map((b) => Math.max(b.target, b.realisasi)));
  const adaTarget = baris.some((b) => b.target > 0);

  const pengatur = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Saklar opsi={[['nilai', 'Nilai'], ['gp', 'GP']]} nilai={ukuran} onUbah={(v) => setUkuran(v as Ukuran)} />
      <Saklar
        opsi={(Object.keys(LABEL_PERIODE) as JenisPeriode[]).map((k) => [k, LABEL_PERIODE[k].replace(' Ini', '')])}
        nilai={periode} onUbah={(v) => setPeriode(v as JenisPeriode)} />
    </div>
  );

  return (
    <BentoCard rentang={12} tinggi="auto" judul={`Pencapaian Target · ${rentang.label}`} aksi={pengatur}>
      {galat ? (
        <p className="text-[12px] text-[#8f2c2b]">Gagal memuat target: {galat}</p>
      ) : data === null ? (
        <KerangkaKartu tinggi={120} />
      ) : !adaTarget && total.realisasi === 0 ? (
        <Kosong
          judul="Target belum ditetapkan"
          keterangan={pengawas
            ? 'Tetapkan target bulanan tiap Sales di Admin Panel → Target Sales.'
            : 'Atasan Anda belum menetapkan target untuk periode ini.'}
          aksi={pengawas ? (
            <button type="button"
              onClick={() => { setBagian('target'); router.push('/admin'); }}
              className="inline-flex items-center rounded-kontrol bg-aksen-700 text-white px-4 py-2 text-[12px] font-semibold hover:bg-aksen-800">
              Atur Target
            </button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Ringkasan target={total.target} realisasi={total.realisasi}
            judul={pengawas ? 'Total tim' : 'Capaian Anda'} ukuran={ukuran} />

          {pengawas && (
            <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                <input type="search" value={cari} onChange={(e) => setCari(e.target.value)}
                  placeholder="Cari nama Sales…" aria-label="Cari nama Sales"
                  className="flex-1 min-w-[180px] max-w-xs rounded-kontrol border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] outline-none focus:border-aksen-400 focus:bg-white" />
                <Saklar
                  opsi={[
                    ['semua', `Semua (${baris.length})`],
                    ['kurang', `Belum capai (${baris.filter((b) => b.target > 0 && b.realisasi < b.target).length})`],
                    ['tercapai', `Tercapai (${baris.filter((b) => b.target > 0 && b.realisasi >= b.target).length})`],
                    ['tanpa', `Tanpa target (${baris.filter((b) => b.target <= 0).length})`],
                  ]}
                  nilai={saring} onUbah={(v) => setSaring(v as typeof saring)} />
              </div>
              {(() => {
                const k = cari.trim().toLowerCase();
                const tampil = [...baris]
                  .filter((b) => !k || b.p.full_name.toLowerCase().includes(k))
                  .filter((b) => saring === 'semua'
                    || (saring === 'kurang' && b.target > 0 && b.realisasi < b.target)
                    || (saring === 'tercapai' && b.target > 0 && b.realisasi >= b.target)
                    || (saring === 'tanpa' && b.target <= 0))
                  .sort((a, b) => rasio(b) - rasio(a));
                return tampil.length === 0 ? (
                  <p className="text-[12px] text-slate-400 text-center py-3">Tidak ada Sales yang cocok.</p>
                ) : tampil.map((b) => (
                  <BarisSales key={b.p.sales_user_id} nama={b.p.full_name}
                    target={b.target} realisasi={b.realisasi} skala={skala} won={b.p.jumlah_won} />
                ));
              })()}
              <Legenda />
              <button type="button" onClick={() => { setBagian('target'); router.push('/admin'); }}
                className="self-end text-[11px] font-bold text-aksen-700 hover:underline">
                Atur target →
              </button>
            </div>
          )}
        </div>
      )}
    </BentoCard>
  );
}

function rasio(b: { target: number; realisasi: number }) {
  return b.target > 0 ? b.realisasi / b.target : -1;
}

/** Kalimat status yang menjawab langsung "masih jauh atau sudah over". */
function status(target: number, realisasi: number): { teks: string; warna: string } {
  if (target <= 0) return { teks: 'Target belum ditetapkan', warna: '#64748b' };
  const selisih = realisasi - target;
  if (selisih >= 0) {
    return { teks: selisih === 0 ? 'Target tercapai' : `Over target ${rupiahRingkas(selisih)}`, warna: '#008300' };
  }
  return { teks: `Kurang ${rupiahRingkas(-selisih)} lagi`, warna: warnaCapaian(realisasi / target) };
}

function Ringkasan({ judul, target, realisasi, ukuran }: {
  judul: string; target: number; realisasi: number; ukuran: Ukuran;
}) {
  const st = status(target, realisasi);
  const pct = target > 0 ? Math.round((realisasi / target) * 100) : null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-center">
      <div>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{judul}</p>
        <p className="text-[34px] font-black leading-none tabular-nums mt-1" style={{ color: pct === null ? '#64748b' : warnaCapaian(realisasi / target) }}>
          {pct === null ? '—' : `${pct}%`}
        </p>
        <p className="text-[12px] font-bold mt-1" style={{ color: st.warna }}>{st.teks}</p>
      </div>
      <div className="flex flex-col gap-2">
        <BatangTarget realisasi={realisasi} target={target} tinggi={14} />
        <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
          <span>Realisasi {ukuran === 'gp' ? 'GP' : 'penjualan'} <b className="text-slate-800">{rupiahRingkas(realisasi)}</b></span>
          <span>Target <b className="text-slate-800">{target > 0 ? rupiahRingkas(target) : '—'}</b></span>
        </div>
      </div>
    </div>
  );
}

function BarisSales({ nama, target, realisasi, skala, won }: {
  nama: string; target: number; realisasi: number; skala: number; won: number;
}) {
  const st = status(target, realisasi);
  const pct = target > 0 ? Math.round((realisasi / target) * 100) : null;
  return (
    <div className="grid grid-cols-[minmax(90px,150px)_1fr_minmax(120px,170px)] gap-3 items-center">
      <div className="min-w-0">
        <p className="text-[12px] font-bold text-slate-800 truncate">{nama}</p>
        <p className="text-[10px] text-slate-400">{won} deal WON</p>
      </div>
      <BatangTarget realisasi={realisasi} target={target} skalaMaks={skala} />
      <div className="text-right min-w-0">
        <p className="text-[12px] font-black tabular-nums" style={{ color: pct === null ? '#94a3b8' : warnaCapaian(realisasi / target) }}>
          {pct === null ? '—' : `${pct}%`}
          <span className="text-[11px] font-semibold text-slate-400"> · {rupiahRingkas(realisasi)}</span>
        </p>
        <p className="text-[10px] font-semibold truncate" style={{ color: st.warna }}>{st.teks}</p>
      </div>
    </div>
  );
}

function Legenda() {
  const item = (warna: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: warna }} />{label}
    </span>
  );
  return (
    <div className="flex items-center gap-4 flex-wrap text-[10px] font-semibold text-slate-500 pt-1">
      {item('#e34948', '< 50%')}
      {item('#eda100', '50–99%')}
      {item('#008300', 'Tercapai / over')}
      <span className="flex items-center gap-1.5"><span className="w-[3px] h-3 rounded-full bg-slate-800" />Garis target</span>
    </div>
  );
}

function Saklar({ opsi, nilai, onUbah }: {
  opsi: [string, string][]; nilai: string; onUbah: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-kontrol bg-slate-100 p-0.5" role="group">
      {opsi.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onUbah(k)} aria-pressed={nilai === k}
          className={`px-2.5 py-1 rounded-[6px] text-[11px] font-bold transition-colors
                      ${nilai === k ? 'bg-white text-aksen-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

