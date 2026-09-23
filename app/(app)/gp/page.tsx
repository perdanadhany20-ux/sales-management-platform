'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { isPengawas, isAdmin } from '@/lib/constants';
import { tanggalISO, tanggalPendek, rupiah, rupiahRingkas, persen, angka } from '@/lib/format';
import {
  STATUS_GP, MUTU_MARGIN, menungguPeran, bolehMenyetujui,
  type GpRingkasan, type GpItem, type StatusGp,
} from '@/lib/gp';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import { DonutLegenda } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';
import { FormGp } from './_components/FormGp';
import { PanelGp } from './_components/PanelGp';

/**
 * GP Calculation (§ tambahan — permintaan langsung pemilik platform).
 *
 * Dipakai saat proyek sudah deal: Sales menyusun perhitungan gross profit
 * lengkap, lalu mengajukannya lewat rantai tanda tangan Manager → Director →
 * Finance.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR: antar Sales tidak boleh saling melihat.
 * Penegakannya ada di policy `gp_baca` (migrasi 016), bukan di halaman ini;
 * yang di sini hanya penyaring tampilan. Sales yang mengetik URL ini langsung
 * tetap hanya menemukan dokumennya sendiri.
 */

const PER_HALAMAN = 20;

export default function HalamanGp() {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);
  const admin = isAdmin(pengguna?.role);
  const peran = (pengguna?.role ?? '').toUpperCase();

  const [daftar, setDaftar] = useState<GpRingkasan[]>([]);
  const [namaOrang, setNamaOrang] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<{ id: string; full_name: string }[]>([]);
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
  const [filterStatus, setFilterStatus] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');
  const [hanyaTugasSaya, setHanyaTugasSaya] = useState(false);

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<GpRingkasan | null>(null);
  const [itemSunting, setItemSunting] = useState<GpItem[]>([]);

  const [dibuka, setDibuka] = useState<GpRingkasan | null>(null);
  const [itemDibuka, setItemDibuka] = useState<GpItem[]>([]);

  const [akanHapus, setAkanHapus] = useState<GpRingkasan | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_gp_ringkasan')
      .select('*', { count: 'exact' })
      .gte('calc_date', dari)
      .lte('calc_date', sampai)
      .order('calc_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (filterStatus) q = q.eq('status', filterStatus);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.%${k}%,project_name.ilike.%${k}%,nomor.ilike.%${k}%,po_spk_no.ilike.%${k}%`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as GpRingkasan[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterSales, filterStatus, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users').select('id, full_name, role').eq('active', true).order('full_name');
      const semua = (data ?? []) as { id: string; full_name: string; role: string }[];
      setNamaOrang(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
      setDaftarSales(semua.filter((u) => u.role === 'SALES'));
    })();
  }, []);

  /** Item dimuat saat dokumennya dibuka, bukan sekaligus untuk seluruh daftar:
   *  dua puluh dokumen berisi puluhan item masing-masing adalah unduhan yang
   *  tidak pernah dilihat kalau yang dibuka cuma satu. */
  const bukaDokumen = useCallback(async (gp: GpRingkasan) => {
    setDibuka(gp);
    const { data } = await supabase.from('sm_gp_items')
      .select('*').eq('calculation_id', gp.id).order('urutan');
    setItemDibuka((data ?? []) as GpItem[]);
  }, []);

  // Dari lencana header (?fokus=<id>): yang dituju dokumennya, bukan
  // halamannya. Ditaruh sesudah bukaDokumen supaya tidak merujuk variabel
  // yang belum sempat didefinisikan.
  const bukaDariFokus = useCallback((id: string) => {
    const g = daftar.find((x) => x.id === id);
    if (g) void bukaDokumen(g);
  }, [daftar, bukaDokumen]);

  useFokusBaris(!memuat && daftar.length > 0, bukaDariFokus);

  async function suntingDokumen(gp: GpRingkasan) {
    const { data } = await supabase.from('sm_gp_items')
      .select('*').eq('calculation_id', gp.id).order('urutan');
    setItemSunting((data ?? []) as GpItem[]);
    setSedangSunting(gp);
    setDibuka(null);
    setFormBuka(true);
  }

  const ambilSemua = useCallback(async () => {
    let q = supabase
      .from('sm_gp_ringkasan')
      .select('*')
      .gte('calc_date', dari)
      .lte('calc_date', sampai)
      .order('calc_date', { ascending: false })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (filterStatus) q = q.eq('status', filterStatus);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as GpRingkasan[];
  }, [dari, sampai, filterSales, filterStatus]);

  const terlihat = useMemo(
    () => (hanyaTugasSaya ? daftar.filter((g) => bolehMenyetujui(g.status, peran)) : daftar),
    [daftar, hanyaTugasSaya, peran],
  );

  const ringkas = useMemo(() => {
    const perStatus: Record<string, number> = {};
    for (const g of daftar) perStatus[g.status] = (perStatus[g.status] ?? 0) + 1;
    return {
      perStatus,
      nilai: daftar.reduce((t, g) => t + Number(g.total_selling ?? 0), 0),
      profit: daftar.reduce((t, g) => t + Number(g.net_profit ?? 0), 0),
      menungguSaya: daftar.filter((g) => bolehMenyetujui(g.status, peran)).length,
      diBawahTarget: daftar.filter((g) => g.mutu_margin === 'DIRECTOR APPROVAL').length,
    };
  }, [daftar, peran]);

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_gp_calculations').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${error.message}`); return; }
    toast('sukses', 'Perhitungan GP dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const dokumenTerbuka = useMemo(
    () => (dibuka ? daftar.find((g) => g.id === dibuka.id) ?? dibuka : null),
    [dibuka, daftar],
  );

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">GP Calculation</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
            {pengawas
              ? 'Perhitungan gross profit seluruh tim, beserta rantai tanda tangannya.'
              : 'Perhitungan gross profit proyek Anda. Hanya Anda dan pemeriksa yang bisa melihatnya.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'gp-calculation',
              namaSheet: 'GP Calculation',
              judul: 'Rekap GP Calculation',
              keterangan: [
                `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
                filterSales ? `Sales: ${namaOrang[filterSales] ?? '—'}` : 'Sales: semua yang boleh Anda lihat',
                filterStatus ? `Status: ${STATUS_GP[filterStatus as StatusGp]?.label ?? filterStatus}` : 'Status: semua',
                `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
              ],
              kolom: [
                { judul: 'Nomor', lebar: 18, nilai: (g) => g.nomor },
                { judul: 'Tanggal', format: 'tanggal', lebar: 12, nilai: (g) => selTanggal(g.calc_date) },
                { judul: 'Sales', lebar: 20, nilai: (g) => namaOrang[g.sales_user_id] ?? '—' },
                { judul: 'Customer', lebar: 26, nilai: (g) => g.customer_name },
                { judul: 'Proyek', lebar: 26, nilai: (g) => g.project_name },
                { judul: 'PO / SPK', lebar: 18, nilai: (g) => g.po_spk_no },
                { judul: 'Total Selling (Rp)', format: 'rupiah', lebar: 18, nilai: (g) => Number(g.total_selling) },
                { judul: 'DPP (Rp)', format: 'rupiah', lebar: 18, nilai: (g) => Number(g.dpp) },
                { judul: 'Total Costing (Rp)', format: 'rupiah', lebar: 18, nilai: (g) => Number(g.total_costing) },
                { judul: 'Net Profit (Rp)', format: 'rupiah', lebar: 18, nilai: (g) => Number(g.net_profit) },
                { judul: 'Net Margin (%)', format: 'persen', lebar: 14, nilai: (g) => Number(g.net_margin) * 100 },
                { judul: 'GP Target (%)', format: 'persen', lebar: 14, nilai: (g) => Number(g.gp_target) * 100 },
                { judul: 'Mutu Margin', lebar: 18, nilai: (g) => g.mutu_margin },
                { judul: 'Status', lebar: 18,
                  nilai: (g) => STATUS_GP[g.status as StatusGp]?.label ?? g.status },
                { judul: 'Diperiksa', lebar: 20, nilai: (g) => (g.checked_by ? namaOrang[g.checked_by] ?? '—' : '') },
                { judul: 'Disetujui', lebar: 20, nilai: (g) => (g.approved_by ? namaOrang[g.approved_by] ?? '—' : '') },
                { judul: 'Diverifikasi', lebar: 20, nilai: (g) => (g.verified_by ? namaOrang[g.verified_by] ?? '—' : '') },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah dokumen', nilai: baris.length },
                { label: 'Total selling (Rp)', nilai: baris.reduce((t, g) => t + Number(g.total_selling ?? 0), 0) },
                { label: 'Total net profit (Rp)', nilai: baris.reduce((t, g) => t + Number(g.net_profit ?? 0), 0) },
                { label: 'Di bawah target', nilai: baris.filter((g) => g.mutu_margin === 'DIRECTOR APPROVAL').length },
              ],
            })}
          />
          <Tombol onClick={() => { setSedangSunting(null); setItemSunting([]); setFormBuka(true); }}>
            + GP Baru
          </Tombol>
        </div>
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Menunggu Anda">
          <AngkaJangkar
            terang
            nilai={ringkas.menungguSaya}
            satuan="dokumen"
            keterangan={ringkas.menungguSaya === 0
              ? 'Tidak ada yang menunggu tanda tangan Anda.'
              : 'Perlu diperiksa atau disetujui.'}
          />
        </BentoCard>

        <BentoCard rentang={3} tinggi="pendek" judul="Nilai Proyek">
          <AngkaJangkar
            nilai={rupiahRingkas(ringkas.nilai)}
            keterangan={`Net profit ${rupiahRingkas(ringkas.profit)}`}
          />
        </BentoCard>

        <BentoCard rentang={6} tinggi="sedang" judul="Status Dokumen">
          {daftar.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
          ) : (
            <DonutLegenda
              judul="" ukuran={104}
              nilaiTengah={daftar.length} labelTengah="DOKUMEN"
              filterAktif={filterStatus ? STATUS_GP[filterStatus as StatusGp]?.label : null}
              onKlikIrisan={(label) => {
                const kunci = (Object.keys(STATUS_GP) as StatusGp[])
                  .find((k) => STATUS_GP[k].label === label);
                setFilterStatus((s) => (s === kunci ? '' : kunci ?? ''));
                setHalaman(0);
              }}
              data={(Object.keys(STATUS_GP) as StatusGp[])
                .map((k) => ({
                  label: STATUS_GP[k].label,
                  value: ringkas.perStatus[k] ?? 0,
                  color: STATUS_GP[k].color,
                }))
                .filter((d) => d.value > 0)}
            />
          )}
        </BentoCard>
      </BentoGrid>

      {ringkas.diBawahTarget > 0 && (
        <p className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] border border-[#e34948]/25 rounded-kontrol px-3.5 py-2.5 leading-snug">
          <b className="font-bold">{ringkas.diBawahTarget} perhitungan di bawah target margin.</b>{' '}
          Marginnya lebih dari 5 poin di bawah GP Target, yang pada formulir aslinya berarti
          tidak boleh lolos tanpa Director benar-benar melihatnya.
        </p>
      )}

      {/* ── Penyaring ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="g-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
          <Teks id="g-dari" type="date" value={dari}
            onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="g-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
          <Teks id="g-sampai" type="date" value={sampai}
            onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
        </div>

        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label htmlFor="g-sales" className="text-[11px] font-semibold text-slate-600">Sales</label>
            <PilihCari id="g-sales" nilai={filterSales}
              onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua Sales"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
          </div>
        )}

        <div className="flex flex-col gap-1 min-w-[170px]">
          <label htmlFor="g-status" className="text-[11px] font-semibold text-slate-600">Status</label>
          <PilihCari id="g-status" nilai={filterStatus}
            onUbah={(v) => { setFilterStatus(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua status"
            opsi={(Object.keys(STATUS_GP) as StatusGp[]).map((k) => ({
              value: k, label: STATUS_GP[k].label,
            }))} />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[170px]">
          <label htmlFor="g-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="g-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nomor, customer, proyek, atau PO…" />
        </div>

        {pengawas && (
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 cursor-pointer select-none pb-2">
            <input type="checkbox" checked={hanyaTugasSaya}
              onChange={(e) => setHanyaTugasSaya(e.target.checked)}
              className="w-4 h-4 accent-aksen-700" />
            Hanya yang menunggu saya
          </label>
        )}
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat perhitungan: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={5} />
      ) : terlihat.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul={hanyaTugasSaya ? 'Tidak ada yang menunggu Anda' : 'Belum ada GP Calculation'}
            keterangan={hanyaTugasSaya
              ? 'Semua dokumen pada rentang ini sudah lewat dari meja Anda.'
              : 'Buat perhitungan pertama begitu proyek deal — item, biaya, dan marginnya dihitung otomatis.'}
            aksi={!hanyaTugasSaya && (
              <Tombol onClick={() => { setSedangSunting(null); setItemSunting([]); setFormBuka(true); }}>
                + GP Baru
              </Tombol>
            )}
          />
        </div>
      ) : (
        <>
          <Tabel
            data={terlihat}
            kunci={(g) => g.id}
            kolom={[
              {
                label: 'Dokumen', className: 'w-[42%]',
                render: (g) => {
                  const gaya = STATUS_GP[g.status as StatusGp] ?? STATUS_GP.DRAFT;
                  const mutu = MUTU_MARGIN[g.mutu_margin] ?? MUTU_MARGIN['TANPA NILAI'];
                  const ditunggu = menungguPeran(g.status);
                  return (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{g.project_name}</span>
                        <Lencana {...gaya} />
                        <Lencana {...mutu} />
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        {g.customer_name} <span className="text-slate-400">· {g.nomor}</span>
                      </p>
                      {ditunggu && (
                        <p className="text-[11px] text-[#eda100] font-semibold">
                          Menunggu {ditunggu === 'MANAGER' ? 'Manager' : ditunggu === 'DIRECTOR' ? 'Director' : 'Finance'}
                        </p>
                      )}
                    </div>
                  );
                },
              },
              {
                label: 'Tanggal', className: 'w-24 whitespace-nowrap',
                render: (g) => tanggalPendek(g.calc_date),
              },
              {
                label: 'Selling / Margin', className: 'w-40 text-right',
                render: (g) => {
                  const mutu = MUTU_MARGIN[g.mutu_margin] ?? MUTU_MARGIN['TANPA NILAI'];
                  return (
                    <div className="text-right">
                      <p className="font-bold text-slate-900 tabular-nums">{rupiah(g.total_selling)}</p>
                      <p className="text-[11px] font-semibold tabular-nums" style={{ color: mutu.color }}>
                        margin {persen(Number(g.net_margin) * 100)}
                      </p>
                    </div>
                  );
                },
              },
              ...(pengawas ? [{
                label: 'Sales', className: 'w-36',
                render: (g: GpRingkasan) => (
                  <Lencana label={namaOrang[g.sales_user_id] ?? '—'} color="#1d4ed8" bg="#dbeafe" />
                ),
              }] : []),
            ]}
            aksi={(g) => {
              const milikSendiri = g.sales_user_id === pengguna?.id;
              return (
                <>
                  <TombolIkon rupa="lihat" label="Lihat detail" onClick={() => void bukaDokumen(g)} />
                  {(g.status === 'DRAFT' && milikSendiri || admin) && (
                    <TombolIkon rupa="sunting" label="Sunting" onClick={() => void suntingDokumen(g)} />
                  )}
                  {admin && (
                    <TombolIkon rupa="hapus" label="Hapus" onClick={() => setAkanHapus(g)} />
                  )}
                </>
              );
            }}
          />

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} dokumen</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0}
                  onClick={() => setHalaman(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
                  onClick={() => setHalaman(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-1">{angka(total)} dokumen</p>
          )}
        </>
      )}

      {formBuka && (
        <FormGp
          buka={formBuka}
          onTutup={() => setFormBuka(false)}
          onTersimpan={() => void muat()}
          awal={sedangSunting}
          awalItem={itemSunting}
        />
      )}

      {dokumenTerbuka && (
        <PanelGp
          buka={Boolean(dibuka)}
          onTutup={() => setDibuka(null)}
          gp={dokumenTerbuka}
          item={itemDibuka}
          peran={peran}
          namaOrang={namaOrang}
          onBerubah={muat}
          onSunting={() => void suntingDokumen(dokumenTerbuka)}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanHapus)}
        onTutup={() => setAkanHapus(null)}
        onSetuju={hapus}
        memproses={menghapus}
        bahaya
        judul="Hapus perhitungan GP ini?"
        pesan={`Dokumen ${akanHapus?.nomor ?? ''} (${akanHapus?.project_name ?? ''}) akan dihapus permanen, beserta seluruh itemnya.`}
        labelSetuju="Hapus"
      />
    </div>
  );
}

