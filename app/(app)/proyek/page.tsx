'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { isPengawas, isAdmin } from '@/lib/constants';
import { tanggalPendek, rupiah, rupiahRingkas, persen, angka } from '@/lib/format';
import {
  STATUS_PROYEK, tahapProyek, type ProyekRingkasan, type StatusProyek,
} from '@/lib/proyek';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import { DonutLegenda, Meter } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';
import { FormProyek } from './_components/FormProyek';
import { PanelProyek } from './_components/PanelProyek';

/**
 * Proyek — penyatu seluruh modul.
 *
 * Sampai modul ini ada, setiap catatan berdiri sendiri: pipeline di satu
 * halaman, jadwal di halaman lain, GP di halaman ketiga. Atasan yang ingin
 * tahu "proyek Balaikota sudah sampai mana" harus membuka empat halaman dan
 * mencocokkan sendiri berdasarkan nama yang kebetulan mirip.
 *
 * Di sini semuanya menyatu: satu baris proyek membawa hitungan pipeline,
 * jadwal, meeting beserta buktinya, laporan harian, dan GP Calculation —
 * dan panel detailnya menampilkan seluruh catatannya tanpa berpindah halaman.
 *
 * Isolasi antar-Sales tetap berlaku lewat policy `proyek_baca`.
 */

const PER_HALAMAN = 20;

export default function HalamanProyek() {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);
  const admin = isAdmin(pengguna?.role);

  const [daftar, setDaftar] = useState<ProyekRingkasan[]>([]);
  const [namaOrang, setNamaOrang] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<{ id: string; full_name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [filterStatus, setFilterStatus] = useState('AKTIF');
  const [filterSales, setFilterSales] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<ProyekRingkasan | null>(null);
  const [dibuka, setDibuka] = useState<ProyekRingkasan | null>(null);
  const [akanHapus, setAkanHapus] = useState<ProyekRingkasan | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_proyek_ringkasan')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterStatus) q = q.eq('status', filterStatus);
    if (filterSales) q = q.eq('owner_user_id', filterSales);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`name.ilike.%${k}%,customer_name.ilike.%${k}%,kode.ilike.%${k}%`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as ProyekRingkasan[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [filterStatus, filterSales, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  const bukaDariFokus = useCallback((id: string) => {
    const p = daftar.find((x) => x.id === id);
    if (p) setDibuka(p);
  }, [daftar]);

  useFokusBaris(!memuat && daftar.length > 0, bukaDariFokus);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users').select('id, full_name, role').eq('active', true).order('full_name');
      const semua = (data ?? []) as { id: string; full_name: string; role: string }[];
      setNamaOrang(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
      setDaftarSales(semua.filter((u) => u.role === 'SALES'));
    })();
  }, []);

  const ambilSemua = useCallback(async () => {
    let q = supabase.from('sm_proyek_ringkasan').select('*')
      .order('created_at', { ascending: false }).limit(BATAS_BARIS_EKSPOR + 1);
    if (filterStatus) q = q.eq('status', filterStatus);
    if (filterSales) q = q.eq('owner_user_id', filterSales);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as ProyekRingkasan[];
  }, [filterStatus, filterSales]);

  const ringkas = useMemo(() => {
    const perStatus: Record<string, number> = {};
    for (const p of daftar) perStatus[p.status] = (perStatus[p.status] ?? 0) + 1;
    return {
      perStatus,
      nilaiPipeline: daftar.reduce((t, p) => t + Number(p.nilai_pipeline ?? 0), 0),
      profitGp: daftar.reduce((t, p) => t + Number(p.profit_gp ?? 0), 0),
      gpMenunggu: daftar.reduce((t, p) => t + Number(p.gp_menunggu ?? 0), 0),
      tanpaCatatan: daftar.filter((p) => tahapProyek(p).tahap === 0).length,
    };
  }, [daftar]);

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_projects').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${error.message}`); return; }
    toast('sukses', 'Proyek dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const proyekTerbuka = useMemo(
    () => (dibuka ? daftar.find((p) => p.id === dibuka.id) ?? dibuka : null),
    [dibuka, daftar],
  );

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Proyek</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
            Satu proyek, satu ringkasan — pipeline, jadwal, meeting, laporan, dan GP Calculation
            dalam satu layar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'proyek',
              namaSheet: 'Proyek',
              judul: 'Rekap Proyek',
              keterangan: [
                filterStatus ? `Status: ${STATUS_PROYEK[filterStatus as StatusProyek]?.label ?? filterStatus}` : 'Status: semua',
                filterSales ? `Pemilik: ${namaOrang[filterSales] ?? '—'}` : 'Pemilik: semua yang boleh Anda lihat',
                `Diekspor oleh ${pengguna?.full_name ?? '—'}`,
              ],
              kolom: [
                { judul: 'Kode', lebar: 18, nilai: (p) => p.kode },
                { judul: 'Proyek', lebar: 28, nilai: (p) => p.name },
                { judul: 'Customer', lebar: 26, nilai: (p) => p.customer_name },
                { judul: 'Pemilik', lebar: 20, nilai: (p) => namaOrang[p.owner_user_id] ?? '—' },
                { judul: 'Status', lebar: 12,
                  nilai: (p) => STATUS_PROYEK[p.status as StatusProyek]?.label ?? p.status },
                { judul: 'Mulai', format: 'tanggal', lebar: 12, nilai: (p) => selTanggal(p.start_date) },
                { judul: 'Selesai', format: 'tanggal', lebar: 12, nilai: (p) => selTanggal(p.end_date) },
                { judul: 'Target (Rp)', format: 'rupiah', lebar: 18, nilai: (p) => Number(p.target_value) },
                { judul: 'Peluang', format: 'angka', lebar: 10, nilai: (p) => Number(p.jumlah_pipeline) },
                { judul: 'Nilai Pipeline (Rp)', format: 'rupiah', lebar: 20, nilai: (p) => Number(p.nilai_pipeline) },
                { judul: 'Jadwal', format: 'angka', lebar: 10, nilai: (p) => Number(p.jumlah_jadwal) },
                { judul: 'Meeting Selesai', format: 'angka', lebar: 15, nilai: (p) => Number(p.meeting_selesai) },
                { judul: 'Laporan', format: 'angka', lebar: 10, nilai: (p) => Number(p.jumlah_laporan) },
                { judul: 'Dokumen GP', format: 'angka', lebar: 12, nilai: (p) => Number(p.jumlah_gp) },
                { judul: 'Nilai GP (Rp)', format: 'rupiah', lebar: 18, nilai: (p) => Number(p.nilai_gp) },
                { judul: 'Net Profit GP (Rp)', format: 'rupiah', lebar: 20, nilai: (p) => Number(p.profit_gp) },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah proyek', nilai: baris.length },
                { label: 'Total nilai pipeline (Rp)',
                  nilai: baris.reduce((t, p) => t + Number(p.nilai_pipeline ?? 0), 0) },
                { label: 'Total net profit GP (Rp)',
                  nilai: baris.reduce((t, p) => t + Number(p.profit_gp ?? 0), 0) },
              ],
            })}
          />
          <Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
            + Proyek Baru
          </Tombol>
        </div>
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Nilai Pipeline">
          <AngkaJangkar
            terang
            nilai={rupiahRingkas(ringkas.nilaiPipeline)}
            keterangan={`${angka(daftar.length)} proyek pada penyaring ini`}
          />
        </BentoCard>

        <BentoCard rentang={3} tinggi="pendek" judul="Net Profit GP">
          <AngkaJangkar
            nilai={rupiahRingkas(ringkas.profitGp)}
            keterangan={ringkas.gpMenunggu > 0
              ? `${ringkas.gpMenunggu} dokumen menunggu tanda tangan`
              : 'Tidak ada dokumen yang menunggu.'}
          />
        </BentoCard>

        <BentoCard rentang={6} tinggi="sedang" judul="Status Proyek">
          {daftar.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
          ) : (
            <div className="flex flex-col gap-2">
              <DonutLegenda
                judul="" ukuran={92}
                nilaiTengah={daftar.length} labelTengah="PROYEK"
                data={(Object.keys(STATUS_PROYEK) as StatusProyek[])
                  .map((k) => ({
                    label: STATUS_PROYEK[k].label,
                    value: ringkas.perStatus[k] ?? 0,
                    color: STATUS_PROYEK[k].color,
                  }))
                  .filter((d) => d.value > 0)}
              />
              {ringkas.tanpaCatatan > 0 && (
                <BarisBento
                  warna="#eda100"
                  kiri={
                    <>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">Belum ada catatan</p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                        Proyek tanpa satu pun pipeline, jadwal, atau laporan tertaut.
                      </p>
                    </>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{ringkas.tanpaCatatan}</span>}
                />
              )}
            </div>
          )}
        </BentoCard>
      </BentoGrid>

      {/* ── Penyaring ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label htmlFor="pr-status" className="text-[11px] font-semibold text-slate-600">Status</label>
          <PilihCari id="pr-status" nilai={filterStatus}
            onUbah={(v) => { setFilterStatus(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua status"
            opsi={(Object.keys(STATUS_PROYEK) as StatusProyek[]).map((k) => ({
              value: k, label: STATUS_PROYEK[k].label,
            }))} />
        </div>

        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label htmlFor="pr-sales" className="text-[11px] font-semibold text-slate-600">Pemilik</label>
            <PilihCari id="pr-sales" nilai={filterSales}
              onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua Sales"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
          </div>
        )}

        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="pr-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="pr-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama proyek, customer, atau kode…" />
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat proyek: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={5} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada proyek"
            keterangan="Buat proyek pertama, lalu tautkan pipeline, jadwal, dan GP Calculation kepadanya dari modulnya masing-masing."
            aksi={<Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>+ Proyek Baru</Tombol>}
          />
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(p) => p.id}
            kolom={[
              {
                label: 'Proyek',
                render: (p) => {
                  const gaya = STATUS_PROYEK[p.status as StatusProyek] ?? STATUS_PROYEK.AKTIF;
                  const langkah = tahapProyek(p);
                  return (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{p.name}</span>
                        <Lencana {...gaya} />
                        {p.gp_menunggu > 0 && (
                          <Lencana label={`${p.gp_menunggu} GP menunggu`} color="#eda100" bg="#fef3d9" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        {p.customer_name} <span className="text-slate-400">· {p.kode}</span>
                      </p>
                      <div className="mt-1 max-w-[220px]">
                        <Meter nilai={langkah.tahap} maksimum={langkah.total} label={langkah.label} />
                      </div>
                    </div>
                  );
                },
              },
              {
                label: 'Catatan', className: 'w-56',
                render: (p) => (
                  <span className="text-[11px] text-slate-500">
                    {angka(p.jumlah_pipeline)} peluang · {angka(p.jumlah_jadwal)} jadwal ·{' '}
                    {angka(p.meeting_selesai)}/{angka(p.jumlah_meeting)} meeting ·{' '}
                    {angka(p.jumlah_laporan)} laporan · {angka(p.jumlah_gp)} GP
                  </span>
                ),
              },
              {
                label: 'Pipeline / Profit', className: 'w-40 text-right',
                render: (p) => (
                  <div className="text-right">
                    <p className="font-bold text-slate-900 tabular-nums">{rupiah(p.nilai_pipeline)}</p>
                    {Number(p.jumlah_gp) > 0 && (
                      <p className="text-[11px] font-semibold tabular-nums"
                        style={{ color: Number(p.profit_gp) >= 0 ? '#008300' : '#e34948' }}>
                        profit {rupiahRingkas(p.profit_gp)}
                      </p>
                    )}
                  </div>
                ),
              },
              ...(pengawas ? [{
                label: 'Pemilik', className: 'w-36',
                render: (p: ProyekRingkasan) => (
                  <Lencana label={namaOrang[p.owner_user_id] ?? '—'} color="#1d4ed8" bg="#dbeafe" />
                ),
              }] : []),
            ]}
            aksi={(p) => {
              const milikSendiri = p.owner_user_id === pengguna?.id;
              return (
                <>
                  <TombolIkon rupa="lihat" label="Lihat detail" onClick={() => setDibuka(p)} />
                  {(milikSendiri || pengawas) && (
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

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} proyek</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0}
                  onClick={() => setHalaman(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
                  onClick={() => setHalaman(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-1">{angka(total)} proyek</p>
          )}
        </>
      )}

      {formBuka && (
        <FormProyek
          buka={formBuka}
          onTutup={() => setFormBuka(false)}
          onTersimpan={muat}
          awal={sedangSunting}
        />
      )}

      {proyekTerbuka && (
        <PanelProyek
          buka={Boolean(dibuka)}
          onTutup={() => setDibuka(null)}
          proyek={proyekTerbuka}
          namaOrang={namaOrang}
          onSunting={() => { setSedangSunting(proyekTerbuka); setDibuka(null); setFormBuka(true); }}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanHapus)}
        onTutup={() => setAkanHapus(null)}
        onSetuju={hapus}
        memproses={menghapus}
        bahaya
        judul="Hapus proyek ini?"
        pesan={`Proyek ${akanHapus?.name ?? ''} (${akanHapus?.kode ?? ''}) akan dihapus permanen. Pipeline, jadwal, laporan, dan GP yang tertaut tidak ikut terhapus, hanya kehilangan tautannya.`}
        labelSetuju="Hapus"
      />
    </div>
  );
}
