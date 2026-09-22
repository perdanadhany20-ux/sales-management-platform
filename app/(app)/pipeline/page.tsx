'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { usePengaturan } from '@/lib/use-settings';
import { isPengawas, WARNA_PROBABILITY } from '@/lib/constants';
import { tanggalISO, tanggalPendek, rupiah, rupiahRingkas, angka, persen } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar } from '@/components/shared/Bento';
import { CorongTingkat, DonutLegenda, Meter } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Konfirmasi } from '@/components/shared/Modal';
import { FormPipeline, type Peluang } from './_components/FormPipeline';

const PER_HALAMAN = 20;

interface Sales { id: string; full_name: string }

const GAYA_STAGE: Record<string, { label: string; color: string; bg: string }> = {
  OPEN:      { label: 'Open',      color: '#2a78d6', bg: '#e3edfb' },
  QUOTATION: { label: 'Quotation', color: '#eda100', bg: '#fef3d9' },
  WON:       { label: 'Won',       color: '#008300', bg: '#e0f2e0' },
  LOST:      { label: 'Lost',      color: '#e34948', bg: '#fce3e3' },
};

/**
 * Sales Pipeline (§17–§22).
 *
 * Angka uang di halaman ini datang apa adanya dari database — GP dan margin
 * adalah kolom GENERATED, bukan hasil hitungan ulang di browser. Itu yang
 * membuat angka di layar Sales dan di layar manajer mustahil berbeda.
 */
export default function HalamanPipeline() {
  const { pengguna } = usePenggunaAktif();
  const { pengaturan } = usePengaturan();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);

  const [daftar, setDaftar] = useState<Peluang[]>([]);
  const [namaSales, setNamaSales] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<Sales[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [dari, setDari] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 89);
    return tanggalISO(d);
  });
  const [sampai, setSampai] = useState(tanggalISO());
  const [filterSales, setFilterSales] = useState('');
  const [filterProb, setFilterProb] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<Peluang | null>(null);
  const [akanHapus, setAkanHapus] = useState<Peluang | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_pipeline')
      .select('*', { count: 'exact' })
      .gte('pipeline_date', dari)
      .lte('pipeline_date', sampai)
      .order('estimated_closing', { ascending: true })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (filterProb) q = q.eq('probability', Number(filterProb));
    if (filterStage) q = q.eq('stage', filterStage);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.%${k}%,project_detail.ilike.%${k}%`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Peluang[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterSales, filterProb, filterStage, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  useEffect(() => {
    if (!pengawas) return;
    (async () => {
      const { data } = await supabase
        .from('users').select('id, full_name, role')
        .eq('active', true).order('full_name');
      const semua = (data ?? []) as (Sales & { role: string })[];
      setDaftarSales(semua.filter((u) => u.role === 'SALES'));
      setNamaSales(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
    })();
  }, [pengawas]);

  /**
   * Ringkasan dihitung dari halaman yang sedang tampil, dan itu keterbatasan
   * yang disengaja: menarik seluruh baris hanya untuk menjumlahkannya adalah
   * hal yang §63 minta dihindari. Angka lintas-seluruh-periode ada di
   * Dashboard, yang memakai agregat sisi server.
   */
  const ringkas = useMemo(() => {
    const nilai = daftar.reduce((s, p) => s + Number(p.project_value), 0);
    const hpp = daftar.reduce((s, p) => s + Number(p.project_hpp), 0);
    const gp = nilai - hpp;
    return {
      nilai, hpp, gp,
      margin: nilai > 0 ? (gp / nilai) * 100 : 0,
      positif: daftar.filter((p) => Number(p.project_gp) > 0).length,
      nol: daftar.filter((p) => Number(p.project_gp) === 0).length,
      negatif: daftar.filter((p) => Number(p.project_gp) < 0).length,
    };
  }, [daftar]);

  const sebaranProb = useMemo(() => {
    const peta = new Map<number, { jumlah: number; nilai: number }>();
    for (const p of daftar) {
      const k = peta.get(p.probability) ?? { jumlah: 0, nilai: 0 };
      peta.set(p.probability, { jumlah: k.jumlah + 1, nilai: k.nilai + Number(p.project_value) });
    }
    return [...peta.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([prob, v]) => ({
        label: `${prob}%`,
        jumlah: v.jumlah,
        nilai: rupiahRingkas(v.nilai),
        color: WARNA_PROBABILITY[prob] ?? '#1d4ed8',
      }));
  }, [daftar]);

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_pipeline').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${error.message}`); return; }
    toast('sukses', 'Peluang dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const adaFilter = Boolean(cariTertunda || filterSales || filterProb || filterStage);

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Sales Pipeline</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {pengawas ? 'Peluang seluruh tim Sales.' : 'Peluang yang Anda kelola.'}
          </p>
        </div>
        <Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
          + Peluang Baru
        </Tombol>
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="sedang" rupa="sorot" judul="Nilai Peluang">
          <AngkaJangkar
            terang
            nilai={rupiahRingkas(ringkas.nilai)}
            keterangan={`${angka(daftar.length)} peluang pada halaman ini`}
          />
          <div className="mt-4 space-y-2">
            <BarisTerang label="HPP" nilai={rupiahRingkas(ringkas.hpp)} />
            <div className="h-px bg-white/15" />
            <BarisTerang label="Gross Profit" nilai={rupiahRingkas(ringkas.gp)} tebal />
            <BarisTerang label="Margin" nilai={persen(ringkas.margin, 2)} tebal />
          </div>
        </BentoCard>

        <BentoCard rentang={6} tinggi="sedang" judul="Sebaran Probability"
          aksi={<span className="text-[10px] text-slate-400">peluang · nilai</span>}>
          {sebaranProb.length === 0 ? (
            <Kosong judul="Belum ada peluang"
              keterangan="Peluang yang Anda catat akan dikelompokkan per tingkat probability di sini." />
          ) : (
            <CorongTingkat data={sebaranProb} />
          )}
        </BentoCard>

        <BentoCard rentang={3} tinggi="sedang" judul="Kondisi Margin">
          {daftar.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
          ) : (
            <>
              <DonutLegenda
                judul="" ukuran={104}
                nilaiTengah={daftar.length} labelTengah="PELUANG"
                data={[
                  { label: 'GP positif', value: ringkas.positif, color: '#008300' },
                  { label: 'GP nol',     value: ringkas.nol,     color: '#94a3b8' },
                  { label: 'GP negatif', value: ringkas.negatif, color: '#e34948' },
                ].filter((d) => d.value > 0)}
              />
              {ringkas.negatif > 0 && (
                <p className="text-[11px] font-semibold text-[#c93c3b] mt-2 text-center leading-snug">
                  {ringkas.negatif} peluang HPP-nya melebihi nilai proyek.
                </p>
              )}
            </>
          )}
        </BentoCard>
      </BentoGrid>

      {/* ── Penyaring (§67) ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="p-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
          <Teks id="p-dari" type="date" value={dari}
            onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="p-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
          <Teks id="p-sampai" type="date" value={sampai}
            onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
        </div>

        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label htmlFor="p-sales" className="text-[11px] font-semibold text-slate-600">Sales</label>
            <PilihCari id="p-sales" nilai={filterSales}
              onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua Sales"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
          </div>
        )}

        <div className="flex flex-col gap-1 min-w-[140px]">
          <label htmlFor="p-prob" className="text-[11px] font-semibold text-slate-600">Probability</label>
          <PilihCari id="p-prob" nilai={filterProb}
            onUbah={(v) => { setFilterProb(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua"
            opsi={pengaturan.probability_options.map((p) => ({ value: String(p), label: `${p}%` }))} />
        </div>

        <div className="flex flex-col gap-1 min-w-[150px]">
          <label htmlFor="p-stage" className="text-[11px] font-semibold text-slate-600">Tahapan</label>
          <PilihCari id="p-stage" nilai={filterStage}
            onUbah={(v) => { setFilterStage(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua"
            opsi={Object.entries(GAYA_STAGE).map(([v, g]) => ({ value: v, label: g.label }))} />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[170px]">
          <label htmlFor="p-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="p-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Customer atau detail proyek…" />
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat pipeline: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={6} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada peluang"
            keterangan={adaFilter
              ? 'Tidak ada peluang yang cocok dengan penyaring saat ini.'
              : 'Catat peluang pertama Anda — GP dan margin dihitung otomatis.'}
            aksi={<Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>+ Peluang Baru</Tombol>}
          />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {daftar.map((p) => (
              <li key={p.id}>
                <KartuPeluang
                  peluang={p}
                  namaSales={pengawas ? (namaSales[p.sales_user_id] ?? 'Pengguna lain') : null}
                  milikSendiri={p.sales_user_id === pengguna?.id}
                  onSunting={() => { setSedangSunting(p); setFormBuka(true); }}
                  onHapus={() => setAkanHapus(p)}
                />
              </li>
            ))}
          </ul>

          <Paginasi halaman={halaman} totalHalaman={totalHalaman} total={total} onPindah={setHalaman} />
        </>
      )}

      {formBuka && pengguna && (
        <FormPipeline
          buka={formBuka}
          onTutup={() => setFormBuka(false)}
          onTersimpan={muat}
          awal={sedangSunting}
          userId={pengguna.id}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanHapus)}
        onTutup={() => setAkanHapus(null)}
        onSetuju={hapus}
        memproses={menghapus}
        bahaya
        judul="Hapus peluang ini?"
        pesan={`Peluang ${akanHapus?.customer_name ?? ''} senilai ${rupiah(akanHapus?.project_value ?? 0)} akan dihapus permanen.`}
        labelSetuju="Hapus"
      />
    </div>
  );
}

function KartuPeluang({
  peluang: p, namaSales, milikSendiri, onSunting, onHapus,
}: {
  peluang: Peluang;
  namaSales: string | null;
  milikSendiri: boolean;
  onSunting: () => void;
  onHapus: () => void;
}) {
  const [buka, setBuka] = useState(false);
  const gp = Number(p.project_gp);
  const gpNegatif = gp < 0;
  const stage = GAYA_STAGE[p.stage] ?? GAYA_STAGE.OPEN;

  // Hari menuju perkiraan closing. Yang sudah lewat tanpa ditutup adalah
  // sinyal paling berguna di halaman ini — itulah peluang yang perlu disentuh.
  const sisaHari = Math.ceil(
    (new Date(p.estimated_closing).getTime() - new Date(tanggalISO()).getTime()) / 86400000,
  );
  const lewat = sisaHari < 0 && !['WON', 'LOST'].includes(p.stage);

  return (
    <article className={`bg-white rounded-kartu border overflow-hidden
                         ${lewat ? 'border-[#e34948]/40' : 'border-slate-200'}`}>
      <button
        type="button" onClick={() => setBuka((b) => !b)} aria-expanded={buka}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors"
      >
        <span
          className="flex-shrink-0 w-11 h-11 rounded-kontrol grid place-items-center text-[13px] font-black tabular-nums"
          style={{
            background: `${WARNA_PROBABILITY[p.probability] ?? '#1d4ed8'}1a`,
            color: WARNA_PROBABILITY[p.probability] ?? '#1d4ed8',
          }}
        >
          {p.probability}%
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-900 truncate">{p.customer_name}</p>
            <Lencana {...stage} />
            {namaSales && <Lencana label={namaSales} color="#1d4ed8" bg="#dbeafe" />}
          </div>
          <p className="text-[12px] text-slate-500 line-clamp-1 mt-0.5">{p.project_detail}</p>
          <p className={`text-[11px] font-semibold mt-0.5 ${lewat ? 'text-[#c93c3b]' : 'text-slate-400'}`}>
            {lewat
              ? `Perkiraan closing lewat ${Math.abs(sisaHari)} hari — ${tanggalPendek(p.estimated_closing)}`
              : `Closing ${tanggalPendek(p.estimated_closing)}`}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-black text-slate-900 tabular-nums">{rupiahRingkas(p.project_value)}</p>
          <p className={`text-[11px] font-bold tabular-nums ${gpNegatif ? 'text-[#c93c3b]' : 'text-[#008300]'}`}>
            GP {rupiahRingkas(gp)} · {persen(Number(p.gp_percentage), 1)}
          </p>
        </div>
      </button>

      {buka && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 flex flex-col gap-3">
          <div className="grid grid-cols-2 formulir:grid-cols-4 gap-3">
            <Detail label="Qty" nilai={`${angka(p.quantity)} ${p.unit}`} />
            <Detail label="Nilai Proyek" nilai={rupiah(p.project_value)} />
            <Detail label="HPP" nilai={rupiah(p.project_hpp)} />
            <Detail label="Gross Profit" nilai={`${rupiah(gp)} (${persen(Number(p.gp_percentage), 2)})`} sorot={!gpNegatif} bahaya={gpNegatif} />
          </div>
          <Detail label="Contact Person" nilai={p.contact_person} />
          <Detail label="Detail Proyek" nilai={p.project_detail} />
          <Detail label="Next Action" nilai={p.next_action} sorot />

          <div className="pt-1">
            <Meter
              nilai={p.probability} maksimum={100}
              warna={WARNA_PROBABILITY[p.probability] ?? '#1d4ed8'}
              label="Tingkat keyakinan"
            />
          </div>

          {milikSendiri && (
            <div className="flex items-center gap-2 pt-1">
              <Tombol rupa="kedua" onClick={onSunting} className="text-[12px] py-2">Sunting</Tombol>
              <Tombol rupa="hantu" onClick={onHapus} className="text-[12px] py-2 text-[#e34948]">Hapus</Tombol>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Detail({ label, nilai, sorot, bahaya }: {
  label: string; nilai: string | null | undefined; sorot?: boolean; bahaya?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-[13px] mt-0.5 leading-relaxed whitespace-pre-wrap
                     ${bahaya ? 'text-[#c93c3b] font-bold'
                       : sorot ? 'text-aksen-800 font-semibold' : 'text-slate-700'}`}>
        {String(nilai ?? '').trim() || '—'}
      </p>
    </div>
  );
}

function BarisTerang({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-white/60">{label}</span>
      <span className={`text-[12px] tabular-nums ${tebal ? 'font-black text-white' : 'font-semibold text-white/85'}`}>
        {nilai}
      </span>
    </div>
  );
}

function Paginasi({ halaman, totalHalaman, total, onPindah }: {
  halaman: number; totalHalaman: number; total: number; onPindah: (h: number) => void;
}) {
  if (totalHalaman <= 1) {
    return <p className="text-[11px] text-slate-400 text-center py-2">{angka(total)} peluang</p>;
  }
  return (
    <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
      <p className="text-[11px] text-slate-500">
        Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
        <span className="font-bold tabular-nums">{totalHalaman}</span>
        <span className="text-slate-400"> · {angka(total)} peluang</span>
      </p>
      <div className="flex items-center gap-2">
        <Tombol rupa="kedua" disabled={halaman === 0}
          onClick={() => onPindah(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
        <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
          onClick={() => onPindah(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
      </div>
    </nav>
  );
}
