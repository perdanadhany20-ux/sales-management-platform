'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { usePengaturan } from '@/lib/use-settings';
import { isPengawas, isAdmin, WARNA_PROBABILITY } from '@/lib/constants';
import { tanggalISO, tanggalPendek, rupiah, rupiahRingkas, angka, persen, polaIlike } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar } from '@/components/shared/Bento';
import { CorongTingkat, DonutLegenda, Meter } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Modal, Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { FormPipeline, type Peluang } from './_components/FormPipeline';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

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
  const admin = isAdmin(pengguna?.role);

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
  const [dilihat, setDilihat] = useState<Peluang | null>(null);

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
      q = q.or(`customer_name.ilike.${polaIlike(k)},project_detail.ilike.${polaIlike(k)}`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Peluang[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterSales, filterProb, filterStage, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  // Menyorot baris yang ditunjuk lencana header (?fokus=<id>). Dijalankan
  // setelah daftar selesai dimuat — sebelum itu elemennya belum ada di DOM.
  useFokusBaris(!memuat);

  /** Seluruh baris sesuai penyaring, tanpa paginasi — lihat catatan di
   *  TombolEkspor soal kenapa tidak memakai `daftar` yang sudah di layar. */
  const ambilSemua = useCallback(async () => {
    let q = supabase
      .from('sm_pipeline')
      .select('*')
      .gte('pipeline_date', dari)
      .lte('pipeline_date', sampai)
      .order('estimated_closing', { ascending: true })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (filterProb) q = q.eq('probability', Number(filterProb));
    if (filterStage) q = q.eq('stage', filterStage);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.${polaIlike(k)},project_detail.ilike.${polaIlike(k)}`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Peluang[];
  }, [dari, sampai, filterSales, filterProb, filterStage, cariTertunda]);

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
        <div className="flex items-center gap-2">
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'sales-pipeline',
              namaSheet: 'Pipeline',
              judul: 'Sales Pipeline',
              keterangan: [
                `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
                filterSales ? `Sales: ${namaSales[filterSales] ?? '—'}` : 'Sales: semua',
                filterStage ? `Stage: ${filterStage}` : 'Stage: semua',
                `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
              ],
              kolom: [
                { judul: 'Tanggal', format: 'tanggal', lebar: 12, nilai: (p) => selTanggal(p.pipeline_date) },
                { judul: 'Sales', lebar: 20, nilai: (p) => namaSales[p.sales_user_id] ?? '—' },
                { judul: 'Customer', lebar: 26, nilai: (p) => p.customer_name },
                { judul: 'Kontak', lebar: 18, nilai: (p) => p.contact_person },
                { judul: 'Detail Proyek', lebar: 34, nilai: (p) => p.project_detail },
                { judul: 'Qty', format: 'angka', lebar: 9, nilai: (p) => Number(p.quantity) },
                { judul: 'Satuan', lebar: 10, nilai: (p) => p.unit },
                { judul: 'Nilai Proyek (Rp)', format: 'rupiah', lebar: 18, nilai: (p) => Number(p.project_value) },
                { judul: 'HPP (Rp)', format: 'rupiah', lebar: 16, nilai: (p) => Number(p.project_hpp) },
                { judul: 'GP (Rp)', format: 'rupiah', lebar: 16, nilai: (p) => Number(p.project_gp) },
                { judul: 'GP (%)', format: 'persen', lebar: 10, nilai: (p) => Number(p.gp_percentage) },
                { judul: 'Probability (%)', format: 'persen', lebar: 14, nilai: (p) => Number(p.probability) },
                { judul: 'Perkiraan Closing', format: 'tanggal', lebar: 16, nilai: (p) => selTanggal(p.estimated_closing) },
                { judul: 'Stage', lebar: 12, nilai: (p) => p.stage },
                { judul: 'Next Action', lebar: 30, nilai: (p) => p.next_action },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah peluang', nilai: baris.length },
                { label: 'Total nilai proyek (Rp)',
                  nilai: baris.reduce((t, p) => t + Number(p.project_value ?? 0), 0) },
                { label: 'Total HPP (Rp)',
                  nilai: baris.reduce((t, p) => t + Number(p.project_hpp ?? 0), 0) },
                { label: 'Total gross profit (Rp)',
                  nilai: baris.reduce((t, p) => t + Number(p.project_gp ?? 0), 0) },
                { label: 'Nilai tertimbang probability (Rp)',
                  nilai: Math.round(baris.reduce(
                    (t, p) => t + (Number(p.project_value ?? 0) * Number(p.probability ?? 0)) / 100, 0)) },
              ],
            })}
          />
          <Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
            + Peluang Baru
          </Tombol>
        </div>
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
          <Tabel
            data={daftar}
            kunci={(p) => p.id}
            kolom={[
              {
                label: 'Customer', className: 'w-[36%]',
                render: (p) => {
                  const stage = GAYA_STAGE[p.stage] ?? GAYA_STAGE.OPEN;
                  return (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{p.customer_name}</span>
                        <Lencana {...stage} />
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{p.project_detail}</p>
                    </div>
                  );
                },
              },
              {
                label: 'Probability', className: 'w-24',
                render: (p) => (
                  <span
                    className="inline-flex px-2 py-0.5 rounded-full text-[12px] font-black tabular-nums"
                    style={{
                      background: `${WARNA_PROBABILITY[p.probability] ?? '#1d4ed8'}1a`,
                      color: WARNA_PROBABILITY[p.probability] ?? '#1d4ed8',
                    }}
                  >
                    {p.probability}%
                  </span>
                ),
              },
              {
                label: 'Nilai / GP', className: 'w-40 text-right',
                render: (p) => {
                  const gp = Number(p.project_gp);
                  return (
                    <div className="text-right">
                      <p className="font-bold text-slate-900 tabular-nums">{rupiahRingkas(p.project_value)}</p>
                      <p className={`text-[11px] font-bold tabular-nums ${gp < 0 ? 'text-[#c93c3b]' : 'text-[#008300]'}`}>
                        GP {rupiahRingkas(gp)} · {persen(Number(p.gp_percentage), 1)}
                      </p>
                    </div>
                  );
                },
              },
              {
                label: 'Closing', className: 'w-32 whitespace-nowrap',
                render: (p) => {
                  const sisaHari = Math.ceil(
                    (new Date(p.estimated_closing).getTime() - new Date(tanggalISO()).getTime()) / 86400000,
                  );
                  const lewat = sisaHari < 0 && !['WON', 'LOST'].includes(p.stage);
                  return (
                    <span className={lewat ? 'text-[#c93c3b] font-semibold' : ''}>
                      {tanggalPendek(p.estimated_closing)}
                    </span>
                  );
                },
              },
              ...(pengawas ? [{
                label: 'Sales', className: 'w-36',
                render: (p: Peluang) => (
                  <Lencana label={namaSales[p.sales_user_id] ?? 'Pengguna lain'} color="#1d4ed8" bg="#dbeafe" />
                ),
              }] : []),
            ]}
            aksi={(p) => {
              const milikSendiri = p.sales_user_id === pengguna?.id;
              return (
                <>
                  <TombolIkon rupa="lihat" label="Lihat detail" onClick={() => setDilihat(p)} />
                  {(milikSendiri || admin) && (
                    <TombolIkon rupa="sunting" label="Sunting"
                      onClick={() => { setSedangSunting(p); setFormBuka(true); }} />
                  )}
                  {admin && (
                    <TombolIkon rupa="hapus" label="Hapus" onClick={() => setAkanHapus(p)} />
                  )}
                </>
              );
            }}
          />

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

      {dilihat && (
        <Modal
          buka={Boolean(dilihat)}
          onTutup={() => setDilihat(null)}
          judul={dilihat.customer_name}
          keterangan={`Closing ${tanggalPendek(dilihat.estimated_closing)}`}
          kaki={<Tombol rupa="kedua" onClick={() => setDilihat(null)} className="text-[12px] py-2">Tutup</Tombol>}
        >
          <div className="flex flex-col gap-3">
            {pengawas && <Detail label="Sales" nilai={namaSales[dilihat.sales_user_id] ?? 'Pengguna lain'} />}
            <div className="grid grid-cols-2 formulir:grid-cols-4 gap-3">
              <Detail label="Qty" nilai={`${angka(dilihat.quantity)} ${dilihat.unit}`} />
              <Detail label="Nilai Proyek" nilai={rupiah(dilihat.project_value)} />
              <Detail label="HPP" nilai={rupiah(dilihat.project_hpp)} />
              <Detail label="Gross Profit"
                nilai={`${rupiah(dilihat.project_gp)} (${persen(Number(dilihat.gp_percentage), 2)})`}
                sorot={Number(dilihat.project_gp) >= 0} bahaya={Number(dilihat.project_gp) < 0} />
            </div>
            <Detail label="Contact Person" nilai={dilihat.contact_person} />
            <Detail label="Detail Proyek" nilai={dilihat.project_detail} />
            <Detail label="Next Action" nilai={dilihat.next_action} sorot />
            <div className="pt-1">
              <Meter
                nilai={dilihat.probability} maksimum={100}
                warna={WARNA_PROBABILITY[dilihat.probability] ?? '#1d4ed8'}
                label="Tingkat keyakinan"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
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
