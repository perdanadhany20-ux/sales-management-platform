'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { usePengaturan } from '@/lib/use-settings';
import { isPengawas, STATUS_JADWAL, type StatusJadwal } from '@/lib/constants';
import { tanggalISO, tanggalPendek, angka } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import { DonutLegenda, Meter } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Modal, Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { FormJadwal, type Jadwal } from './_components/FormJadwal';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

const PER_HALAMAN = 20;

interface Sales { id: string; full_name: string }

/**
 * Request Schedule (§23–§26, §76).
 *
 * Penyelesaian jadwal TIDAK dilakukan lewat UPDATE dari halaman ini. Untuk
 * kategori berkehadiran, satu-satunya jalan adalah alur Meeting; untuk yang
 * lain, lewat RPC sm_complete_schedule() yang tetap memeriksa wewenang. Lihat
 * catatan di migrasi 005 soal kenapa Sales sengaja tidak punya policy UPDATE.
 */
export default function HalamanSchedule() {
  const { pengguna } = usePenggunaAktif();
  const { pengaturan } = usePengaturan();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);

  const [daftar, setDaftar] = useState<Jadwal[]>([]);
  const [namaSales, setNamaSales] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<Sales[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [dari, setDari] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return tanggalISO(d);
  });
  const [sampai, setSampai] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return tanggalISO(d);
  });
  const [filterSales, setFilterSales] = useState('');
  const [filterKategori, setFilterKategori] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<Jadwal | null>(null);
  const [akanSelesai, setAkanSelesai] = useState<Jadwal | null>(null);
  const [memproses, setMemproses] = useState(false);
  const [dilihat, setDilihat] = useState<Jadwal | null>(null);
  const [akanHapus, setAkanHapus] = useState<Jadwal | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_schedules')
      .select('*', { count: 'exact' })
      .gte('schedule_date', dari)
      .lte('schedule_date', sampai)
      .order('schedule_date', { ascending: true })
      .order('schedule_time', { ascending: true, nullsFirst: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterSales) q = q.eq('assigned_to', filterSales);
    if (filterKategori) q = q.eq('category', filterKategori);
    if (filterStatus) q = q.eq('status', filterStatus);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.%${k}%,project.ilike.%${k}%,detail.ilike.%${k}%`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Jadwal[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterSales, filterKategori, filterStatus, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  // Menyorot baris yang ditunjuk lencana header (?fokus=<id>). Dijalankan
  // setelah daftar selesai dimuat — sebelum itu elemennya belum ada di DOM.
  useFokusBaris(!memuat);

  /** Seluruh jadwal sesuai penyaring, tanpa paginasi. */
  const ambilSemua = useCallback(async () => {
    let q = supabase
      .from('sm_schedules')
      .select('*')
      .gte('schedule_date', dari)
      .lte('schedule_date', sampai)
      .order('schedule_date', { ascending: true })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterSales) q = q.eq('assigned_to', filterSales);
    if (filterKategori) q = q.eq('category', filterKategori);
    if (filterStatus) q = q.eq('status', filterStatus);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.%${k}%,project.ilike.%${k}%,detail.ilike.%${k}%`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Jadwal[];
  }, [dari, sampai, filterSales, filterKategori, filterStatus, cariTertunda]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users').select('id, full_name, role')
        .eq('active', true).order('full_name');
      const semua = (data ?? []) as (Sales & { role: string })[];
      setDaftarSales(semua.filter((u) => u.role === 'SALES'));
      setNamaSales(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
    })();
  }, []);

  const ringkas = useMemo(() => {
    const hitung = (s: string) => daftar.filter((j) => j.status === s).length;
    const hariIni = tanggalISO();
    return {
      upcoming: hitung('UPCOMING'),
      berjalan: hitung('IN_PROGRESS'),
      selesai: hitung('COMPLETED'),
      terlewat: hitung('MISSED'),
      dibatalkan: hitung('CANCELLED'),
      hariIni: daftar.filter((j) => j.schedule_date === hariIni && ['UPCOMING', 'IN_PROGRESS'].includes(j.status)).length,
      belumDitugaskan: daftar.filter((j) => !j.assigned_to && j.status === 'UPCOMING').length,
      meeting: daftar.filter((j) => j.requires_attendance).length,
    };
  }, [daftar]);

  async function selesaikan() {
    if (!akanSelesai) return;
    setMemproses(true);
    const { data, error } = await supabase.rpc('sm_complete_schedule', {
      p_schedule_id: akanSelesai.id,
    });
    setMemproses(false);

    if (error) { toast('galat', error.message); return; }

    const hasil = data as { ok: boolean; message?: string };
    if (!hasil.ok) {
      toast('galat', hasil.message ?? 'Jadwal belum memenuhi syarat penyelesaian.');
      return;
    }

    toast('sukses', 'Jadwal ditandai selesai.');
    setAkanSelesai(null);
    void muat();
  }

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_schedules').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${error.message}`); return; }
    toast('sukses', 'Jadwal dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const adaFilter = Boolean(cariTertunda || filterSales || filterKategori || filterStatus);

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Request Schedule</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {pengawas ? 'Jadwal seluruh tim, termasuk pengajuan yang menunggu penugasan.' : 'Jadwal yang ditugaskan kepada Anda dan pengajuan Anda.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'request-schedule',
              namaSheet: 'Schedule',
              judul: 'Request Schedule',
              keterangan: [
                `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
                filterSales ? `Sales: ${namaSales[filterSales] ?? '—'}` : 'Sales: semua',
                filterKategori ? `Kategori: ${filterKategori}` : 'Kategori: semua',
                `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
              ],
              kolom: [
                { judul: 'Tanggal', format: 'tanggal', lebar: 12, nilai: (j) => selTanggal(j.schedule_date) },
                { judul: 'Jam', lebar: 9, nilai: (j) => j.schedule_time?.slice(0, 5) ?? '' },
                { judul: 'Customer', lebar: 26, nilai: (j) => j.customer_name },
                { judul: 'Proyek', lebar: 24, nilai: (j) => j.project },
                { judul: 'Kategori', lebar: 18, nilai: (j) => j.category },
                { judul: 'Wajib Bukti', lebar: 12, nilai: (j) => (j.requires_attendance ? 'Ya' : 'Tidak') },
                { judul: 'Ditugaskan ke', lebar: 20,
                  nilai: (j) => (j.assigned_to ? (namaSales[j.assigned_to] ?? '—') : 'Belum ditugaskan') },
                { judul: 'Status', lebar: 14,
                  nilai: (j) => STATUS_JADWAL[j.status as StatusJadwal]?.label ?? j.status },
                { judul: 'Detail', lebar: 34, nilai: (j) => j.detail },
                { judul: 'Catatan', lebar: 28, nilai: (j) => j.notes },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah jadwal', nilai: baris.length },
                { label: 'Selesai', nilai: baris.filter((j) => j.status === 'COMPLETED').length },
                { label: 'Terlewat', nilai: baris.filter((j) => j.status === 'MISSED').length },
                { label: 'Wajib bukti (Meeting)', nilai: baris.filter((j) => j.requires_attendance).length },
                { label: 'Belum ditugaskan', nilai: baris.filter((j) => !j.assigned_to).length },
              ],
            })}
          />
          <Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
            {pengawas ? '+ Jadwal Baru' : '+ Ajukan Jadwal'}
          </Tombol>
        </div>
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Hari Ini">
          <AngkaJangkar
            terang
            nilai={ringkas.hariIni}
            satuan="jadwal"
            keterangan={ringkas.hariIni === 0 ? 'Tidak ada yang dijadwalkan hari ini.' : 'Menunggu dieksekusi hari ini.'}
          />
        </BentoCard>

        <BentoCard rentang={3} tinggi="sedang" judul="Status Jadwal">
          {daftar.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
          ) : (
            <DonutLegenda
              judul="" ukuran={104}
              nilaiTengah={daftar.length} labelTengah="JADWAL"
              filterAktif={filterStatus ? STATUS_JADWAL[filterStatus as StatusJadwal]?.label : null}
              onKlikIrisan={(label) => {
                // Klik irisan menyaring halaman — donat yang tidak bisa
                // ditindaklanjuti hanya jadi hiasan.
                const kunci = (Object.keys(STATUS_JADWAL) as StatusJadwal[])
                  .find((k) => STATUS_JADWAL[k].label === label);
                setFilterStatus((s) => (s === kunci ? '' : kunci ?? ''));
                setHalaman(0);
              }}
              data={[
                { label: STATUS_JADWAL.UPCOMING.label,    value: ringkas.upcoming,   color: STATUS_JADWAL.UPCOMING.color },
                { label: STATUS_JADWAL.IN_PROGRESS.label, value: ringkas.berjalan,   color: STATUS_JADWAL.IN_PROGRESS.color },
                { label: STATUS_JADWAL.COMPLETED.label,   value: ringkas.selesai,    color: STATUS_JADWAL.COMPLETED.color },
                { label: STATUS_JADWAL.MISSED.label,      value: ringkas.terlewat,   color: STATUS_JADWAL.MISSED.color },
                { label: STATUS_JADWAL.CANCELLED.label,   value: ringkas.dibatalkan, color: STATUS_JADWAL.CANCELLED.color },
              ].filter((d) => d.value > 0)}
            />
          )}
        </BentoCard>

        <BentoCard rentang={6} tinggi="sedang" rupa="garis" judul="Perlu Ditindaklanjuti">
          {ringkas.belumDitugaskan === 0 && ringkas.terlewat === 0 ? (
            <div className="text-center py-4">
              <p className="text-2xl mb-1" aria-hidden="true">✓</p>
              <p className="text-[12px] font-bold text-slate-600">Semua tertangani</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tidak ada pengajuan menganggur maupun jadwal terlewat.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {ringkas.belumDitugaskan > 0 && (
                <BarisBento
                  warna="#eda100"
                  kiri={
                    <>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">Belum ditugaskan</p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                        {pengawas ? 'Pengajuan menunggu Anda menugaskan Sales.' : 'Menunggu ditugaskan Manager/Admin.'}
                      </p>
                    </>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{ringkas.belumDitugaskan}</span>}
                />
              )}
              {ringkas.terlewat > 0 && (
                <BarisBento
                  warna="#e34948"
                  kiri={
                    <>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">Terlewat</p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                        Tanggalnya sudah lewat tanpa diselesaikan.
                      </p>
                    </>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{ringkas.terlewat}</span>}
                />
              )}
              {ringkas.meeting > 0 && (
                <div className="pt-2 mt-1 border-t border-slate-200">
                  <Meter
                    nilai={ringkas.selesai} maksimum={Math.max(1, ringkas.meeting)}
                    label="Meeting selesai pada halaman ini"
                  />
                </div>
              )}
            </div>
          )}
        </BentoCard>
      </BentoGrid>

      {/* ── Penyaring (§67) ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="s-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
          <Teks id="s-dari" type="date" value={dari}
            onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label htmlFor="s-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
          <Teks id="s-sampai" type="date" value={sampai}
            onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
        </div>

        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label htmlFor="s-sales" className="text-[11px] font-semibold text-slate-600">Sales</label>
            <PilihCari id="s-sales" nilai={filterSales}
              onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua Sales"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
          </div>
        )}

        <div className="flex flex-col gap-1 min-w-[170px]">
          <label htmlFor="s-kategori" className="text-[11px] font-semibold text-slate-600">Kategori</label>
          <PilihCari id="s-kategori" nilai={filterKategori}
            onUbah={(v) => { setFilterKategori(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua kategori"
            opsi={pengaturan.schedule_categories.map((k) => ({ value: k.name, label: k.name }))} />
        </div>

        <div className="flex flex-col gap-1 min-w-[150px]">
          <label htmlFor="s-status" className="text-[11px] font-semibold text-slate-600">Status</label>
          <PilihCari id="s-status" nilai={filterStatus}
            onUbah={(v) => { setFilterStatus(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua status"
            opsi={(Object.keys(STATUS_JADWAL) as StatusJadwal[]).map((k) => ({
              value: k, label: STATUS_JADWAL[k].label,
            }))} />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[170px]">
          <label htmlFor="s-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="s-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Customer, proyek, atau detail…" />
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat jadwal: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={6} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada jadwal"
            keterangan={adaFilter
              ? 'Tidak ada jadwal yang cocok dengan penyaring saat ini.'
              : 'Buat jadwal pertama — kategori Meeting akan menuntut bukti lokasi dan foto saat dieksekusi.'}
            aksi={<Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
              {pengawas ? '+ Jadwal Baru' : '+ Ajukan Jadwal'}
            </Tombol>}
          />
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(j) => j.id}
            kolom={[
              {
                label: 'Tanggal', className: 'w-28 whitespace-nowrap',
                render: (j) => (
                  <>
                    {tanggalPendek(j.schedule_date)}
                    {j.schedule_time && <span className="text-slate-400"> · {j.schedule_time.slice(0, 5)}</span>}
                  </>
                ),
              },
              {
                label: 'Customer', className: 'w-[38%]',
                render: (j) => (
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 truncate">{j.customer_name}</span>
                      {j.requires_attendance && <Lencana label="📍 Meeting" color="#1d4ed8" bg="#dbeafe" />}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {j.category}{j.project ? ` · ${j.project}` : ''}
                    </p>
                  </div>
                ),
              },
              {
                label: 'Ditugaskan', className: 'w-40',
                render: (j) => (j.assigned_to
                  ? <span className="text-slate-600">{namaSales[j.assigned_to] ?? 'Pengguna lain'}</span>
                  : <span className="text-[#eda100] font-semibold text-[12px]">Belum ditugaskan</span>),
              },
              {
                label: 'Status', className: 'w-32',
                render: (j) => <Lencana {...(STATUS_JADWAL[j.status as StatusJadwal] ?? STATUS_JADWAL.UPCOMING)} />,
              },
            ]}
            aksi={(j) => {
              const ditugaskanKeSaya = j.assigned_to === pengguna?.id;
              const bolehSunting = pengawas
                || (j.created_by === pengguna?.id && !j.assigned_to && j.status === 'UPCOMING');
              return (
                <>
                  <TombolIkon rupa="lihat" label="Lihat detail" onClick={() => setDilihat(j)} />
                  {bolehSunting && (
                    <TombolIkon rupa="sunting" label={j.assigned_to ? 'Sunting' : 'Tugaskan/Sunting'}
                      onClick={() => { setSedangSunting(j); setFormBuka(true); }} />
                  )}
                  {pengawas && (
                    <TombolIkon rupa="hapus" label="Hapus" onClick={() => setAkanHapus(j)} />
                  )}
                </>
              );
            }}
          />

          <Paginasi halaman={halaman} totalHalaman={totalHalaman} total={total} onPindah={setHalaman} />
        </>
      )}

      {formBuka && pengguna && (
        <FormJadwal
          buka={formBuka}
          onTutup={() => setFormBuka(false)}
          onTersimpan={muat}
          awal={sedangSunting}
          userId={pengguna.id}
          pengawas={pengawas}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanSelesai)}
        onTutup={() => setAkanSelesai(null)}
        onSetuju={selesaikan}
        memproses={memproses}
        judul="Tandai jadwal selesai?"
        pesan={`Jadwal ${akanSelesai?.customer_name ?? ''} pada ${tanggalPendek(akanSelesai?.schedule_date)} akan ditandai selesai. Syaratnya diperiksa ulang oleh database.`}
        labelSetuju="Tandai Selesai"
      />

      <Konfirmasi
        buka={Boolean(akanHapus)}
        onTutup={() => setAkanHapus(null)}
        onSetuju={hapus}
        memproses={menghapus}
        bahaya
        judul="Hapus jadwal ini?"
        pesan={`Jadwal ${akanHapus?.customer_name ?? ''} pada ${tanggalPendek(akanHapus?.schedule_date)} akan dihapus permanen.`}
        labelSetuju="Hapus"
      />

      {dilihat && (
        <Modal
          buka={Boolean(dilihat)}
          onTutup={() => setDilihat(null)}
          judul={dilihat.customer_name}
          keterangan={`${tanggalPendek(dilihat.schedule_date)}${dilihat.schedule_time ? ` · ${dilihat.schedule_time.slice(0, 5)}` : ''}`}
          kaki={(() => {
            const ditugaskanKeSaya = dilihat.assigned_to === pengguna?.id;
            const bisaSelesai = dilihat.status !== 'COMPLETED' && dilihat.status !== 'CANCELLED'
              && (pengawas || ditugaskanKeSaya);
            return (
              <>
                <Tombol rupa="kedua" onClick={() => setDilihat(null)} className="text-[12px] py-2">Tutup</Tombol>
                {bisaSelesai && !dilihat.requires_attendance && (
                  <Tombol onClick={() => { setAkanSelesai(dilihat); setDilihat(null); }} className="text-[12px] py-2">
                    Tandai Selesai
                  </Tombol>
                )}
                {bisaSelesai && dilihat.requires_attendance && (
                  <Link
                    href="/meeting"
                    className="inline-flex items-center rounded-kontrol bg-aksen-700 text-white px-4 py-2.5 text-sm font-semibold hover:bg-aksen-800 transition-colors"
                  >
                    Eksekusi Meeting →
                  </Link>
                )}
              </>
            );
          })()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Lencana {...(STATUS_JADWAL[dilihat.status as StatusJadwal] ?? STATUS_JADWAL.UPCOMING)} />
              {dilihat.requires_attendance && <Lencana label="📍 Meeting" color="#1d4ed8" bg="#dbeafe" />}
            </div>
            <Detail label="Kategori" nilai={`${dilihat.category}${dilihat.project ? ` · ${dilihat.project}` : ''}`} />
            <Detail label="Ditugaskan" nilai={dilihat.assigned_to ? (namaSales[dilihat.assigned_to] ?? 'Pengguna lain') : 'Belum ditugaskan'} />
            <Detail label="Detail" nilai={dilihat.detail} />
            <Detail label="Catatan" nilai={dilihat.notes} />

            {dilihat.requires_attendance && (
              <p className="text-[11px] text-slate-500 bg-slate-50 rounded-kontrol px-3 py-2 leading-relaxed">
                Jadwal ini menuntut check-in GPS di dalam radius lokasi dan foto bukti.
                Eksekusinya dilakukan di halaman{' '}
                <Link href="/meeting" className="font-bold text-aksen-700 underline underline-offset-2">Meeting</Link>.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Detail({ label, nilai }: { label: string; nilai: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-[13px] mt-0.5 leading-relaxed whitespace-pre-wrap text-slate-700">
        {nilai?.trim() || '—'}
      </p>
    </div>
  );
}

function Paginasi({ halaman, totalHalaman, total, onPindah }: {
  halaman: number; totalHalaman: number; total: number; onPindah: (h: number) => void;
}) {
  if (totalHalaman <= 1) {
    return <p className="text-[11px] text-slate-400 text-center py-2">{angka(total)} jadwal</p>;
  }
  return (
    <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
      <p className="text-[11px] text-slate-500">
        Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
        <span className="font-bold tabular-nums">{totalHalaman}</span>
        <span className="text-slate-400"> · {angka(total)} jadwal</span>
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
