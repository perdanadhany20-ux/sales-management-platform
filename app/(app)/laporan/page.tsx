// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { isPengawas } from '@/lib/constants';
import { rupiah, rupiahRingkas, angka } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar } from '@/components/shared/Bento';
import { BatangTarget, warnaCapaian } from '@/components/shared/Charts';
import { PilihCari } from '@/components/shared/PilihCari';
import { KerangkaBaris, PanelGalat, Kosong } from '@/components/shared/Feedback';
import { Tabel } from '@/components/shared/Tabel';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { pesanGalat } from '@/lib/pesan-galat';

/**
 * app/(app)/laporan — Laporan lanjutan (lisensi advanced_reporting).
 * Semua angka dari satu RPC, sm_laporan_bulanan (migrasi 047), yang tetap
 * disaring RLS: Sales melihat dirinya, pengawas melihat seluruh tim.
 */

interface BarisBulan {
  bulan: string; sales_user_id: string; full_name: string;
  laporan: number; meeting_selesai: number; peluang_baru: number; nilai_peluang: number;
  won: number; nilai_won: number; gp_won: number; target_nilai: number; target_gp: number | null;
}

type Preset = '3' | '6' | '12' | 'tahun';
const OPSI_PRESET = [
  { value: '3', label: '3 bulan terakhir' }, { value: '6', label: '6 bulan terakhir' },
  { value: '12', label: '12 bulan terakhir' }, { value: 'tahun', label: 'Tahun ini' },
];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rentang(p: Preset): { dari: string; sampai: string; label: string } {
  const kini = new Date();
  const sampai = new Date(kini.getFullYear(), kini.getMonth() + 1, 0);
  const dari = p === 'tahun' ? new Date(kini.getFullYear(), 0, 1) : new Date(kini.getFullYear(), kini.getMonth() - Number(p) + 1, 1);
  const f = (d: Date) => d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  return { dari: iso(dari), sampai: iso(sampai), label: `${f(dari)} – ${f(sampai)}` };
}
const namaBulan = (b: string) => new Date(`${b}T00:00:00`).toLocaleDateString('id-ID', { month: 'short' });
const angkaN = (v: unknown) => Number(v) || 0;

export default function HalamanLaporan() {
  const { pengguna } = usePenggunaAktif();
  const pengawas = isPengawas(pengguna?.role);
  const [preset, setPreset] = useState<Preset>('6');
  const [filterSales, setFilterSales] = useState('');
  const [data, setData] = useState<BarisBulan[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const r = useMemo(() => rentang(preset), [preset]);

  async function ambil(dari: string, sampai: string): Promise<BarisBulan[]> {
    const { data: d, error } = await supabase.rpc('sm_laporan_bulanan', { p_dari: dari, p_sampai: sampai });
    if (error) throw error;
    return ((d ?? []) as BarisBulan[]).map((x) => ({
      ...x, laporan: angkaN(x.laporan), meeting_selesai: angkaN(x.meeting_selesai), peluang_baru: angkaN(x.peluang_baru),
      nilai_peluang: angkaN(x.nilai_peluang), won: angkaN(x.won), nilai_won: angkaN(x.nilai_won), gp_won: angkaN(x.gp_won),
      target_nilai: angkaN(x.target_nilai), target_gp: x.target_gp === null ? null : angkaN(x.target_gp),
    }));
  }

  useEffect(() => {
    let batal = false;
    setData(null); setGalat(null);
    ambil(r.dari, r.sampai)
      .then((d) => { if (!batal) setData(d); })
      .catch((e) => { if (!batal) setGalat(pesanGalat(e, 'Gagal memuat laporan.')); });
    return () => { batal = true; };
  }, [r]);

  const tersaring = useMemo(() => (data ?? []).filter((b) => !filterSales || b.sales_user_id === filterSales), [data, filterSales]);
  const opsiSales = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of data ?? []) m.set(b.sales_user_id, b.full_name);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const perBulan = useMemo(() => {
    const m = new Map<string, { bulan: string; won: number; target: number; laporan: number; peluang: number }>();
    for (const b of tersaring) {
      const x = m.get(b.bulan) ?? { bulan: b.bulan, won: 0, target: 0, laporan: 0, peluang: 0 };
      x.won += b.nilai_won; x.target += b.target_nilai; x.laporan += b.laporan; x.peluang += b.nilai_peluang;
      m.set(b.bulan, x);
    }
    return [...m.values()].sort((a, b) => a.bulan.localeCompare(b.bulan));
  }, [tersaring]);

  const perSales = useMemo(() => {
    const m = new Map<string, { id: string; nama: string; laporan: number; meeting: number; peluang: number; nilaiPeluang: number; won: number; nilaiWon: number; gp: number; target: number }>();
    for (const b of tersaring) {
      const x = m.get(b.sales_user_id) ?? { id: b.sales_user_id, nama: b.full_name, laporan: 0, meeting: 0, peluang: 0, nilaiPeluang: 0, won: 0, nilaiWon: 0, gp: 0, target: 0 };
      x.laporan += b.laporan; x.meeting += b.meeting_selesai; x.peluang += b.peluang_baru; x.nilaiPeluang += b.nilai_peluang;
      x.won += b.won; x.nilaiWon += b.nilai_won; x.gp += b.gp_won; x.target += b.target_nilai;
      m.set(b.sales_user_id, x);
    }
    return [...m.values()].sort((a, b) => b.nilaiWon - a.nilaiWon);
  }, [tersaring]);

  const total = useMemo(() => perSales.reduce((t, s) => ({
    laporan: t.laporan + s.laporan, meeting: t.meeting + s.meeting, peluang: t.peluang + s.peluang,
    nilaiPeluang: t.nilaiPeluang + s.nilaiPeluang, won: t.won + s.won, nilaiWon: t.nilaiWon + s.nilaiWon, gp: t.gp + s.gp, target: t.target + s.target,
  }), { laporan: 0, meeting: 0, peluang: 0, nilaiPeluang: 0, won: 0, nilaiWon: 0, gp: 0, target: 0 }), [perSales]);

  const capaian = total.target > 0 ? total.nilaiWon / total.target : null;
  const skalaSales = Math.max(0, ...perSales.map((s) => Math.max(s.nilaiWon, s.target)));
  const maksBulan = Math.max(1, ...perBulan.map((b) => Math.max(b.won, b.target)));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Laporan</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Tren bulanan, target vs realisasi, dan peringkat {pengawas ? 'seluruh tim Sales' : 'kinerja Anda'} · {r.label}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="min-w-[170px]">
            <PilihCari id="lap-periode" nilai={preset} onUbah={(v) => setPreset((v || '6') as Preset)} opsi={OPSI_PRESET} />
          </div>
          {pengawas && (
            <div className="min-w-[180px]">
              <PilihCari id="lap-sales" nilai={filterSales} onUbah={setFilterSales} bolehKosong labelKosong="Semua Sales" opsi={opsiSales} />
            </div>
          )}
          <TombolEkspor<BarisBulan>
            ambil={async () => (await ambil(r.dari, r.sampai)).filter((b) => !filterSales || b.sales_user_id === filterSales)}
            susun={(baris) => ({
              namaBerkas: 'laporan-kinerja-sales', namaSheet: 'Kinerja Bulanan', judul: 'Laporan Kinerja Sales per Bulan',
              keterangan: [
                `Periode: ${r.label}`,
                `Sales: ${filterSales ? (opsiSales.find((o) => o.value === filterSales)?.label ?? '—') : 'semua'}`,
                'Realisasi: peluang berstatus WON menurut tanggal closing',
              ],
              kolom: [
                { judul: 'Bulan', lebar: 14, nilai: (b) => new Date(`${b.bulan}T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) },
                { judul: 'Sales', lebar: 22, nilai: (b) => b.full_name },
                { judul: 'Laporan Harian', format: 'angka', lebar: 11, nilai: (b) => b.laporan },
                { judul: 'Meeting Selesai', format: 'angka', lebar: 11, nilai: (b) => b.meeting_selesai },
                { judul: 'Peluang Baru', format: 'angka', lebar: 10, nilai: (b) => b.peluang_baru },
                { judul: 'Nilai Peluang (Rp)', format: 'rupiah', lebar: 17, nilai: (b) => b.nilai_peluang },
                { judul: 'Closing (WON)', format: 'angka', lebar: 10, nilai: (b) => b.won },
                { judul: 'Nilai WON (Rp)', format: 'rupiah', lebar: 17, nilai: (b) => b.nilai_won },
                { judul: 'GP WON (Rp)', format: 'rupiah', lebar: 16, nilai: (b) => b.gp_won },
                { judul: 'Target (Rp)', format: 'rupiah', lebar: 17, nilai: (b) => b.target_nilai },
                { judul: 'Capaian (%)', format: 'persen', lebar: 10, nilai: (b) => (b.target_nilai > 0 ? Math.round((b.nilai_won / b.target_nilai) * 1000) / 10 : null) },
              ],
              baris,
              ringkasan: [
                { label: 'Total laporan harian', nilai: baris.reduce((t, b) => t + b.laporan, 0) },
                { label: 'Total meeting selesai', nilai: baris.reduce((t, b) => t + b.meeting_selesai, 0) },
                { label: 'Total nilai WON (Rp)', nilai: baris.reduce((t, b) => t + b.nilai_won, 0) },
                { label: 'Total target (Rp)', nilai: baris.reduce((t, b) => t + b.target_nilai, 0) },
              ],
            })}
          />
        </div>
      </header>

      {galat ? <PanelGalat pesan={galat} /> : !data ? <KerangkaBaris jumlah={6} /> : perSales.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong judul="Belum ada data" keterangan="Belum ada Sales aktif atau aktivitas pada periode ini." />
        </div>
      ) : (
        <>
          <BentoGrid>
            <BentoCard rentang={3} rupa="sorot" judul="Closing (WON)">
              <AngkaJangkar terang nilai={rupiahRingkas(total.nilaiWon)} keterangan={`${angka(total.won)} proyek · GP ${rupiahRingkas(total.gp)}`} />
            </BentoCard>
            <BentoCard rentang={3} judul="Capaian Target">
              <AngkaJangkar nilai={capaian === null ? '—' : `${Math.round(capaian * 100)}%`}
                keterangan={total.target > 0 ? `dari target ${rupiahRingkas(total.target)}` : 'Target belum diatur (Admin → Target)'} />
              {total.target > 0 && <div className="mt-2"><BatangTarget realisasi={total.nilaiWon} target={total.target} /></div>}
            </BentoCard>
            <BentoCard rentang={3} judul="Peluang Baru">
              <AngkaJangkar nilai={angka(total.peluang)} keterangan={`senilai ${rupiahRingkas(total.nilaiPeluang)}`} />
            </BentoCard>
            <BentoCard rentang={3} judul="Aktivitas Lapangan">
              <AngkaJangkar nilai={angka(total.laporan)} satuan="laporan" keterangan={`${angka(total.meeting)} meeting selesai`} />
            </BentoCard>

            <BentoCard rentang={12} judul="Tren bulanan — realisasi WON vs target">
              <div className="flex items-end gap-2 sm:gap-3 h-[190px] pt-4">
                {perBulan.map((b) => {
                  const tW = Math.max(3, (b.won / maksBulan) * 150);
                  const tT = b.target > 0 ? Math.max(3, (b.target / maksBulan) * 150) : 0;
                  return (
                    <div key={b.bulan} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                      <span className="text-[9.5px] font-bold tabular-nums leading-none" style={{ color: warnaCapaian(b.target > 0 ? b.won / b.target : null) }}>
                        {b.target > 0 ? `${Math.round((b.won / b.target) * 100)}%` : b.won > 0 ? rupiahRingkas(b.won) : ''}
                      </span>
                      <div className="w-full flex items-end justify-center gap-1 h-[150px]">
                        <div className="w-[42%] max-w-7 rounded-t-kecil bg-aksen-600" style={{ height: tW }} title={`WON ${rupiah(b.won)}`} />
                        {tT > 0 && <div className="w-[42%] max-w-7 rounded-t-kecil bg-slate-300" style={{ height: tT }} title={`Target ${rupiah(b.target)}`} />}
                      </div>
                      <span className="text-[10px] text-slate-500 leading-none">{namaBulan(b.bulan)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-[11px] text-slate-500 mt-2">
                <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-aksen-600" /> Realisasi WON</span>
                <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-slate-300" /> Target</span>
              </div>
            </BentoCard>
          </BentoGrid>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-bold text-slate-700">Peringkat Sales</h2>
            <Tabel
              data={perSales}
              kunci={(s) => s.id}
              kolom={[
                { label: 'Sales', className: 'w-[20%]', urut: (s) => s.nama, render: (s) => <span className="font-bold text-slate-900">{s.nama}</span> },
                { label: 'Laporan', className: 'w-20 text-right', urut: (s) => s.laporan, render: (s) => <span className="tabular-nums">{angka(s.laporan)}</span> },
                { label: 'Meeting', className: 'w-20 text-right', urut: (s) => s.meeting, render: (s) => <span className="tabular-nums">{angka(s.meeting)}</span> },
                { label: 'Peluang', className: 'w-24 text-right', urut: (s) => s.nilaiPeluang, render: (s) => <span className="tabular-nums">{rupiahRingkas(s.nilaiPeluang)}</span> },
                { label: 'WON', className: 'w-28 text-right', urut: (s) => s.nilaiWon, render: (s) => <span className="tabular-nums font-bold">{rupiahRingkas(s.nilaiWon)}</span> },
                { label: 'GP', className: 'w-24 text-right', urut: (s) => s.gp, render: (s) => <span className="tabular-nums">{rupiahRingkas(s.gp)}</span> },
                {
                  label: 'Capaian Target', className: 'w-[22%]', urut: (s) => (s.target > 0 ? s.nilaiWon / s.target : null),
                  render: (s) => (
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><BatangTarget realisasi={s.nilaiWon} target={s.target} skalaMaks={skalaSales} /></div>
                      <span className="w-10 text-right text-[11px] font-bold tabular-nums" style={{ color: warnaCapaian(s.target > 0 ? s.nilaiWon / s.target : null) }}>
                        {s.target > 0 ? `${Math.round((s.nilaiWon / s.target) * 100)}%` : '—'}
                      </span>
                    </div>
                  ),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}
