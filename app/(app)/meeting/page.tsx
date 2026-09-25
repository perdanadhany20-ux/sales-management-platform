'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import {
  isPengawas, STATUS_JADWAL, STATE_KEHADIRAN, statusEfektif,
  type StatusJadwal, type StateKehadiran,
} from '@/lib/constants';
import { tanggalISO, tanggalPendek, angka, polaIlike } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import { Meter } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat } from '@/components/shared/Feedback';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { PanelMeeting, type Meeting, type Lokasi } from './_components/PanelMeeting';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

/**
 * Halaman Meeting (§28–§39) — tempat jadwal berkehadiran DIEKSEKUSI.
 *
 * Yang tampil di sini hanya jadwal dengan requires_attendance = true. Jadwal
 * biasa diselesaikan dari halaman Schedule; membawanya ke sini hanya membuat
 * daftar yang harus dipakai sambil berdiri di depan kantor klien jadi penuh
 * baris yang tidak bisa ditindaklanjuti.
 *
 * Susunannya mobile-first dengan sengaja (§62): kartu satu kolom, tombol
 * selebar layar, dan penyaring yang bawaannya HARI INI — karena yang membuka
 * halaman ini hampir selalu sedang menjalankan meeting hari itu juga.
 */

const PER_HALAMAN = 20;

interface BarisMeeting extends Meeting {
  // distance_m dan accuracy_m hanya ikut terbaca pada query ekspor; daftar di
  // layar tidak memintanya karena tidak menampilkannya.
  sm_attendance: {
    id?: string;
    state: string;
    gps_verified: boolean;
    distance_m?: number | null;
    accuracy_m?: number | null;
    checkin_at?: string | null;
  } | null;
  sm_evidence: { id: string }[];
}

interface Sales { id: string; full_name: string }

/** PostgREST mengembalikan relasi 1:1 sebagai objek, tapi versi lama sebagai
 *  larik berisi satu elemen. Dinormalkan di satu tempat supaya sisa berkas
 *  tidak perlu memikirkannya. */
function satu<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default function HalamanMeeting() {
  const { pengguna } = usePenggunaAktif();
  const pengawas = isPengawas(pengguna?.role);

  const [daftar, setDaftar] = useState<BarisMeeting[]>([]);
  const [namaSales, setNamaSales] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<Sales[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [dari, setDari] = useState(() => tanggalISO());
  const [sampai, setSampai] = useState(() => tanggalISO());
  const [filterSales, setFilterSales] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari.trim()); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const [dibuka, setDibuka] = useState<BarisMeeting | null>(null);

  const muat = useCallback(async () => {
    if (!pengguna) return;
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_schedules')
      .select(
        `id, schedule_date, schedule_time, customer_name, project, category, detail,
         notes, status, assigned_to, location_id, completed_at,
         sm_locations ( id, name, address, latitude, longitude, gps_radius_m ),
         sm_attendance ( id, state, gps_verified ),
         sm_evidence ( id )`,
        { count: 'exact' },
      )
      .eq('requires_attendance', true)
      .gte('schedule_date', dari)
      .lte('schedule_date', sampai)
      .order('schedule_date', { ascending: true })
      .order('schedule_time', { ascending: true, nullsFirst: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    // Sales hanya mengeksekusi meeting miliknya sendiri; menampilkan milik
    // orang lain hanya menambah baris yang pasti ditolak sm_check_in().
    if (!pengawas) q = q.eq('assigned_to', pengguna.id);
    else if (filterSales) q = q.eq('assigned_to', filterSales);
    if (filterStatus === 'MISSED') {
      q = q.or(`status.eq.MISSED,and(status.in.(UPCOMING,IN_PROGRESS),schedule_date.lt.${tanggalISO()})`);
    } else if (filterStatus === 'UPCOMING' || filterStatus === 'IN_PROGRESS') {
      q = q.eq('status', filterStatus).gte('schedule_date', tanggalISO());
    } else if (filterStatus) {
      q = q.eq('status', filterStatus);
    }
    if (cariTertunda) {
      q = q.or(`customer_name.ilike.${polaIlike(cariTertunda)},project.ilike.${polaIlike(cariTertunda)},detail.ilike.${polaIlike(cariTertunda)}`);
    }

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar(((data ?? []) as unknown[]).map((r) => {
      const baris = r as Record<string, unknown>;
      return {
        ...(baris as unknown as BarisMeeting),
        sm_locations: satu<Lokasi>(baris.sm_locations as Lokasi | Lokasi[] | null),
        sm_attendance: satu(baris.sm_attendance as BarisMeeting['sm_attendance']),
        sm_evidence: (baris.sm_evidence ?? []) as { id: string }[],
      };
    }));
    setTotal(count ?? 0);
    setMemuat(false);
  }, [pengguna, pengawas, dari, sampai, filterSales, filterStatus, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  // Bawaan penyaring adalah hari ini, jadi meeting kemarin yang belum ditutup
  // tidak kelihatan sama sekali kalau tidak diingatkan terpisah.
  const [jumlahTerlewat, setJumlahTerlewat] = useState(0);
  useEffect(() => {
    if (!pengguna) return;
    let q = supabase
      .from('sm_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('requires_attendance', true)
      .in('status', ['UPCOMING', 'IN_PROGRESS'])
      .lt('schedule_date', tanggalISO());
    if (!pengawas) q = q.eq('assigned_to', pengguna.id);
    void (async () => {
      const { count } = await q;
      setJumlahTerlewat(count ?? 0);
    })();
  }, [pengguna, pengawas, daftar]);

  function tampilkanTerlewat() {
    const mulai = new Date();
    mulai.setDate(mulai.getDate() - 90);
    const kemarin = new Date();
    kemarin.setDate(kemarin.getDate() - 1);
    setDari(tanggalISO(mulai));
    setSampai(tanggalISO(kemarin));
    setFilterStatus('MISSED');
    setHalaman(0);
  }

  // Dari lencana header, yang dituju bukan kartunya melainkan panel
  // eksekusinya — orang yang menekan "Meeting" di header hendak check-in,
  // bukan hendak melihat kartunya.
  const bukaDariFokus = useCallback((id: string) => {
    const m = daftar.find((x) => x.id === id);
    if (m) setDibuka(m);
  }, [daftar]);

  useFokusBaris(!memuat && daftar.length > 0, bukaDariFokus);

  /** Seluruh meeting sesuai penyaring, lengkap dengan hasil verifikasinya. */
  const ambilSemua = useCallback(async () => {
    if (!pengguna) return [];
    let q = supabase
      .from('sm_schedules')
      .select(
        `id, schedule_date, schedule_time, customer_name, project, category, status,
         assigned_to, completed_at,
         sm_locations ( name, gps_radius_m ),
         sm_attendance ( state, gps_verified, distance_m, accuracy_m, checkin_at ),
         sm_evidence ( id )`,
      )
      .eq('requires_attendance', true)
      .gte('schedule_date', dari)
      .lte('schedule_date', sampai)
      .order('schedule_date', { ascending: true })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (!pengawas) q = q.eq('assigned_to', pengguna.id);
    else if (filterSales) q = q.eq('assigned_to', filterSales);
    if (filterStatus === 'MISSED') {
      q = q.or(`status.eq.MISSED,and(status.in.(UPCOMING,IN_PROGRESS),schedule_date.lt.${tanggalISO()})`);
    } else if (filterStatus === 'UPCOMING' || filterStatus === 'IN_PROGRESS') {
      q = q.eq('status', filterStatus).gte('schedule_date', tanggalISO());
    } else if (filterStatus) {
      q = q.eq('status', filterStatus);
    }
    if (cariTertunda) {
      q = q.or(`customer_name.ilike.${polaIlike(cariTertunda)},project.ilike.${polaIlike(cariTertunda)},detail.ilike.${polaIlike(cariTertunda)}`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown[]).map((r) => {
      const b = r as Record<string, unknown>;
      return {
        ...(b as unknown as BarisMeeting),
        sm_locations: satu<Lokasi>(b.sm_locations as Lokasi | Lokasi[] | null),
        sm_attendance: satu(b.sm_attendance as BarisMeeting['sm_attendance']),
        sm_evidence: (b.sm_evidence ?? []) as { id: string }[],
      };
    });
  }, [pengguna, pengawas, dari, sampai, filterSales, filterStatus, cariTertunda]);

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

  // Panel yang terbuka harus ikut menyegar sesudah check-in / unggah foto,
  // jadi rujukannya diambil ulang dari daftar terbaru, bukan disalin.
  const meetingTerbuka = useMemo(
    () => (dibuka ? daftar.find((m) => m.id === dibuka.id) ?? dibuka : null),
    [dibuka, daftar],
  );

  const ringkas = useMemo(() => {
    const belumMulai = daftar.filter((m) => m.status !== 'COMPLETED' && !m.sm_attendance?.gps_verified).length;
    const perluFoto = daftar.filter((m) => m.sm_attendance?.gps_verified && m.sm_evidence.length === 0).length;
    const siapSelesai = daftar.filter((m) => m.status !== 'COMPLETED' && m.sm_evidence.length > 0).length;
    const selesai = daftar.filter((m) => m.status === 'COMPLETED').length;
    return { belumMulai, perluFoto, siapSelesai, selesai, jumlah: daftar.length };
  }, [daftar]);

  function geserRentang(hari: number) {
    const mulai = new Date();
    const akhir = new Date();
    if (hari < 0) mulai.setDate(mulai.getDate() + hari);
    else akhir.setDate(akhir.getDate() + hari);
    setDari(tanggalISO(mulai));
    setSampai(tanggalISO(akhir));
    setHalaman(0);
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const hariIni = dari === tanggalISO() && sampai === tanggalISO();

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Meeting</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
            Check-in GPS, foto bukti, lalu penyelesaian — tiga langkah yang diperiksa di server.
          </p>
        </div>
        <TombolEkspor
          ambil={ambilSemua}
          susun={(baris) => ({
            namaBerkas: 'meeting-kehadiran',
            namaSheet: 'Meeting',
            judul: 'Meeting — Kehadiran & Bukti',
            keterangan: [
              `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
              pengawas && filterSales ? `Sales: ${namaSales[filterSales] ?? '—'}` : 'Sales: semua yang boleh Anda lihat',
              `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
            ],
            kolom: [
              { judul: 'Tanggal', format: 'tanggal', lebar: 12, nilai: (m) => selTanggal(m.schedule_date) },
              { judul: 'Jam', lebar: 9, nilai: (m) => m.schedule_time?.slice(0, 5) ?? '' },
              { judul: 'Customer', lebar: 26, nilai: (m) => m.customer_name },
              { judul: 'Proyek', lebar: 24, nilai: (m) => m.project },
              { judul: 'Lokasi', lebar: 24, nilai: (m) => m.sm_locations?.name ?? 'Belum diatur' },
              { judul: 'Radius (m)', format: 'angka', lebar: 12,
                nilai: (m) => (m.sm_locations ? Number(m.sm_locations.gps_radius_m) : null) },
              { judul: 'Sales', lebar: 20,
                nilai: (m) => (m.assigned_to ? (namaSales[m.assigned_to] ?? '—') : 'Belum ditugaskan') },
              { judul: 'Status Jadwal', lebar: 14,
                nilai: (m) => STATUS_JADWAL[statusEfektif(m)]?.label ?? m.status },
              { judul: 'State Kehadiran', lebar: 18,
                nilai: (m) => STATE_KEHADIRAN[(m.sm_attendance?.state ?? 'NOT_STARTED') as StateKehadiran]?.label ?? '—' },
              { judul: 'GPS Terverifikasi', lebar: 16,
                nilai: (m) => (m.sm_attendance?.gps_verified ? 'Ya' : 'Tidak') },
              { judul: 'Jarak (m)', format: 'angka', lebar: 12,
                nilai: (m) => (m.sm_attendance?.distance_m != null ? Number(m.sm_attendance.distance_m) : null) },
              { judul: 'Akurasi (m)', format: 'angka', lebar: 12,
                nilai: (m) => (m.sm_attendance?.accuracy_m != null ? Number(m.sm_attendance.accuracy_m) : null) },
              { judul: 'Jumlah Foto', format: 'angka', lebar: 12, nilai: (m) => m.sm_evidence.length },
            ],
            baris,
            ringkasan: [
              { label: 'Jumlah meeting', nilai: baris.length },
              { label: 'Selesai', nilai: baris.filter((m) => m.status === 'COMPLETED').length },
              { label: 'GPS terverifikasi', nilai: baris.filter((m) => m.sm_attendance?.gps_verified).length },
              { label: 'Tanpa foto bukti', nilai: baris.filter((m) => m.sm_evidence.length === 0).length },
            ],
          })}
        />
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Perlu Dieksekusi">
          <AngkaJangkar
            terang
            nilai={ringkas.belumMulai + ringkas.perluFoto}
            satuan="meeting"
            keterangan={
              ringkas.belumMulai + ringkas.perluFoto === 0
                ? 'Tidak ada yang menunggu tindakan pada rentang ini.'
                : `${ringkas.belumMulai} belum check-in · ${ringkas.perluFoto} menunggu foto`
            }
          />
        </BentoCard>

        <BentoCard rentang={3} tinggi="pendek" judul="Selesai">
          <AngkaJangkar
            nilai={ringkas.selesai}
            satuan={`dari ${ringkas.jumlah}`}
            keterangan="Meeting tertutup lengkap dengan bukti."
          />
        </BentoCard>

        <BentoCard rentang={6} tinggi="pendek" rupa="garis" judul="Kemajuan">
          {ringkas.jumlah === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">Belum ada meeting pada rentang ini</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Meter nilai={ringkas.selesai} maksimum={ringkas.jumlah} label="Meeting selesai" />
              {ringkas.perluFoto > 0 && (
                <BarisBento
                  warna="#eda100"
                  kiri={
                    <p className="text-[12px] font-bold text-slate-700 leading-tight">
                      Sudah check-in, foto belum diunggah
                    </p>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{ringkas.perluFoto}</span>}
                />
              )}
            </div>
          )}
        </BentoCard>
      </BentoGrid>

      {jumlahTerlewat > 0 && filterStatus !== 'MISSED' && (
        <div className="rounded-kartu border border-[#e34948]/30 bg-[#fce3e3] px-4 py-3 flex items-center gap-3 flex-wrap">
          <p className="flex-1 min-w-[240px] text-[12px] text-[#8f2c2b] leading-snug">
            <b className="font-bold">{jumlahTerlewat} meeting lewat tanggal</b> belum diselesaikan.
            {' '}Check-in sudah tidak bisa dilakukan untuk tanggal yang lewat —{' '}
            {pengawas ? 'tutup lewat Override bila meeting memang terjadi.' : 'hubungi atasan Anda untuk ditindaklanjuti.'}
          </p>
          <Tombol rupa="kedua" className="text-[12px] py-2" onClick={tampilkanTerlewat}>
            Tampilkan
          </Tombol>
        </div>
      )}

      {/* ── Penyaring ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ChipRentang aktif={hariIni} onClick={() => geserRentang(0)}>Hari Ini</ChipRentang>
          <ChipRentang aktif={false} onClick={() => geserRentang(-7)}>7 Hari Lalu</ChipRentang>
          <ChipRentang aktif={false} onClick={() => geserRentang(30)}>30 Hari ke Depan</ChipRentang>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <label htmlFor="m-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
            <Teks id="m-dari" type="date" value={dari}
              onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
          </div>
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <label htmlFor="m-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
            <Teks id="m-sampai" type="date" value={sampai}
              onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
          </div>

          {pengawas && (
            <div className="flex flex-col gap-1 min-w-[170px] flex-1">
              <label htmlFor="m-sales" className="text-[11px] font-semibold text-slate-600">Sales</label>
              <PilihCari id="m-sales" nilai={filterSales}
                onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
                bolehKosong labelKosong="Semua Sales"
                opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
            </div>
          )}

          <div className="flex flex-col gap-1 min-w-[150px] flex-1">
            <label htmlFor="m-status" className="text-[11px] font-semibold text-slate-600">Status</label>
            <PilihCari id="m-status" nilai={filterStatus}
              onUbah={(v) => { setFilterStatus(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua status"
              opsi={(Object.keys(STATUS_JADWAL) as StatusJadwal[]).map((k) => ({
                value: k, label: STATUS_JADWAL[k].label,
              }))} />
          </div>

          <div className="flex flex-col gap-1 min-w-[200px] flex-[2]">
            <label htmlFor="m-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
            <Teks id="m-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
              placeholder="Customer, proyek, atau detail…" />
          </div>
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat meeting: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={4} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Tidak ada meeting"
            keterangan={cariTertunda
              ? `Tidak ada meeting yang cocok dengan “${cariTertunda}” pada rentang ini.`
              : hariIni
              ? 'Tidak ada meeting berkehadiran yang ditugaskan untuk hari ini.'
              : 'Tidak ada meeting pada rentang tanggal ini.'}
            aksi={
              <Link
                href="/schedule"
                className="inline-flex items-center rounded-kontrol bg-aksen-700 text-white px-4 py-2 text-[12px] font-semibold hover:bg-aksen-800 transition-colors"
              >
                Buka Request Schedule
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(m) => m.id}
            kolom={[
              {
                label: 'Tanggal', className: 'w-28 whitespace-nowrap',
                urut: (m) => `${m.schedule_date} ${m.schedule_time ?? ''}`,
                render: (m) => (
                  <>
                    {tanggalPendek(m.schedule_date)}
                    {m.schedule_time && <span className="text-slate-400"> · {m.schedule_time.slice(0, 5)}</span>}
                  </>
                ),
              },
              {
                label: 'Customer', className: 'w-[36%]',
                urut: (m) => m.customer_name,
                render: (m) => (
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{m.customer_name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      📍 {m.sm_locations?.name ?? 'Lokasi belum diatur'}{m.project ? ` · ${m.project}` : ''}
                    </p>
                  </div>
                ),
              },
              {
                label: 'Status', className: 'w-56',
                urut: (m) => STATUS_JADWAL[statusEfektif(m)]?.label,
                render: (m) => {
                  const state = (m.sm_attendance?.state ?? 'NOT_STARTED') as StateKehadiran;
                  return (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Lencana {...(STATUS_JADWAL[statusEfektif(m)] ?? STATUS_JADWAL.UPCOMING)} />
                      <Lencana {...(STATE_KEHADIRAN[state] ?? STATE_KEHADIRAN.NOT_STARTED)} />
                      {m.sm_evidence.length > 0 && (
                        <Lencana label={`${m.sm_evidence.length} foto`} color="#1d4ed8" bg="#dbeafe" />
                      )}
                    </div>
                  );
                },
              },
              ...(pengawas ? [{
                label: 'Sales', className: 'w-36',
                urut: (m: BarisMeeting) => (m.assigned_to ? namaSales[m.assigned_to] : null),
                render: (m: BarisMeeting) => (
                  <span className="text-slate-600">
                    {m.assigned_to ? (namaSales[m.assigned_to] ?? 'Pengguna lain') : '—'}
                  </span>
                ),
              }] : []),
            ]}
            aksi={(m) => {
              const selesai = m.status === 'COMPLETED';
              const label = selesai
                ? 'Lihat Bukti'
                : !m.sm_attendance?.gps_verified
                  ? 'Mulai Check-in'
                  : m.sm_evidence.length === 0
                    ? 'Unggah Foto'
                    : 'Selesaikan';
              return <TombolIkon rupa="lihat" label={label} onClick={() => setDibuka(m)} />;
            }}
          />

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} meeting</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0}
                  onClick={() => setHalaman(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
                  onClick={() => setHalaman(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-1">{angka(total)} meeting</p>
          )}
        </>
      )}

      {meetingTerbuka && pengguna && (
        <PanelMeeting
          buka={Boolean(dibuka)}
          onTutup={() => setDibuka(null)}
          meeting={meetingTerbuka}
          userId={pengguna.id}
          pengawas={pengawas}
          onBerubah={muat}
        />
      )}
    </div>
  );
}

function ChipRentang({ aktif, onClick, children }: {
  aktif: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={aktif}
      className={`rounded-kecil px-3 py-1.5 text-[11px] font-semibold transition-colors
                  ${aktif ? 'bg-aksen-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  );
}

