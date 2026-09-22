'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { isPengawas, PESAN_GPS, WARNA_CHART } from '@/lib/constants';
import { tanggalISO, tanggalPendek, waktuPendek, angka, rupiahRingkas, jarak } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar } from '@/components/shared/Bento';
import { DonutLegenda } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat } from '@/components/shared/Feedback';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

/**
 * Activity — riwayat aktivitas dalam satu urutan waktu.
 *
 * Datanya berasal dari view sm_activity_feed (migrasi 011), yang menyatukan
 * jejak yang sudah ditulis modul lain: laporan harian, pipeline, jadwal,
 * check-in (termasuk yang GAGAL), foto bukti, dan override. Tidak ada satu
 * baris pun yang dikarang halaman ini, dan tidak ada tabel aktivitas terpisah
 * yang bisa melenceng dari sumbernya.
 *
 * Yang terlihat mengikuti RLS tabel asalnya: Sales melihat jejaknya sendiri,
 * Manager dan Admin melihat seluruh tim. Itu berlaku karena view-nya dibuat
 * dengan security_invoker — bukan karena penyaringan di halaman ini.
 */

const PER_HALAMAN = 30;

interface Aktivitas {
  id: string;
  jenis: string;
  terjadi_pada: string;
  tanggal_acuan: string | null;
  user_id: string | null;
  judul: string | null;
  keterangan: string | null;
  tambahan: string | null;
  entitas: string;
  entitas_id: string;
  nilai: number | null;
  status: string | null;
}

interface GayaJenis { label: string; ikon: string; warna: string; bg: string }

const JENIS: Record<string, GayaJenis> = {
  DAILY_REPORT:     { label: 'Laporan Harian',   ikon: '📝', warna: '#1d4ed8', bg: '#dbeafe' },
  PIPELINE:         { label: 'Pipeline',         ikon: '📊', warna: '#0891b2', bg: '#e0f2fe' },
  SCHEDULE:         { label: 'Jadwal Dibuat',    ikon: '🗓️', warna: '#64748b', bg: '#f1f5f9' },
  SCHEDULE_SELESAI: { label: 'Jadwal Selesai',   ikon: '✓',  warna: '#008300', bg: '#e0f2e0' },
  MEETING_SELESAI:  { label: 'Meeting Selesai',  ikon: '✓',  warna: '#008300', bg: '#e0f2e0' },
  CHECK_IN:         { label: 'Check-in',         ikon: '📍', warna: '#2a78d6', bg: '#e3edfb' },
  BUKTI:            { label: 'Foto Bukti',       ikon: '📷', warna: '#7c3aed', bg: '#ede9fe' },
  OVERRIDE:         { label: 'Override',         ikon: '⚠️', warna: '#eda100', bg: '#fef3d9' },
};

const JENIS_BAWAAN: GayaJenis = { label: 'Aktivitas', ikon: '•', warna: '#64748b', bg: '#f1f5f9' };

export default function HalamanActivity() {
  const { pengguna } = usePenggunaAktif();
  const pengawas = isPengawas(pengguna?.role);

  const [daftar, setDaftar] = useState<Aktivitas[]>([]);
  const [namaOrang, setNamaOrang] = useState<Record<string, string>>({});
  const [daftarOrang, setDaftarOrang] = useState<{ id: string; full_name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [dari, setDari] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return tanggalISO(d);
  });
  const [sampai, setSampai] = useState(() => tanggalISO());
  const [filterJenis, setFilterJenis] = useState('');
  const [filterOrang, setFilterOrang] = useState('');

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    // `sampai` ditambah satu hari karena terjadi_pada bertipe timestamp:
    // membandingkannya dengan tanggal murni akan memotong seluruh aktivitas
    // hari terakhir yang terjadi setelah pukul 00:00.
    const batasAtas = new Date(sampai);
    batasAtas.setDate(batasAtas.getDate() + 1);

    let q = supabase
      .from('sm_activity_feed')
      .select('*', { count: 'exact' })
      .gte('terjadi_pada', `${dari}T00:00:00`)
      .lt('terjadi_pada', `${tanggalISO(batasAtas)}T00:00:00`)
      .order('terjadi_pada', { ascending: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterJenis) q = q.eq('jenis', filterJenis);
    if (filterOrang) q = q.eq('user_id', filterOrang);

    const { data, error, count } = await q;
    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Aktivitas[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterJenis, filterOrang, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  /** Seluruh jejak sesuai penyaring, tanpa paginasi. */
  const ambilSemua = useCallback(async () => {
    const batasAtas = new Date(sampai);
    batasAtas.setDate(batasAtas.getDate() + 1);

    let q = supabase
      .from('sm_activity_feed')
      .select('*')
      .gte('terjadi_pada', `${dari}T00:00:00`)
      .lt('terjadi_pada', `${tanggalISO(batasAtas)}T00:00:00`)
      .order('terjadi_pada', { ascending: false })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterJenis) q = q.eq('jenis', filterJenis);
    if (filterOrang) q = q.eq('user_id', filterOrang);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Aktivitas[];
  }, [dari, sampai, filterJenis, filterOrang]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users').select('id, full_name').eq('active', true).order('full_name');
      const semua = (data ?? []) as { id: string; full_name: string }[];
      setDaftarOrang(semua);
      setNamaOrang(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
    })();
  }, []);

  const ringkas = useMemo(() => {
    const per: Record<string, number> = {};
    for (const a of daftar) per[a.jenis] = (per[a.jenis] ?? 0) + 1;

    const gagalGps = daftar.filter(
      (a) => a.jenis === 'CHECK_IN' && a.status && a.status !== 'VALID',
    ).length;
    const nilai = daftar
      .filter((a) => a.jenis === 'PIPELINE')
      .reduce((t, a) => t + Number(a.nilai ?? 0), 0);

    return { per, gagalGps, nilai };
  }, [daftar]);

  /** Aktivitas dikelompokkan per tanggal — feed tanpa pemisah hari jadi satu
   *  gulungan panjang yang sulit dibaca begitu datanya menumpuk. */
  const perHari = useMemo(() => {
    const peta = new Map<string, Aktivitas[]>();
    for (const a of daftar) {
      const kunci = a.terjadi_pada.slice(0, 10);
      const isi = peta.get(kunci);
      if (isi) isi.push(a);
      else peta.set(kunci, [a]);
    }
    return Array.from(peta.entries());
  }, [daftar]);

  function geserRentang(hari: number) {
    const mulai = new Date();
    mulai.setDate(mulai.getDate() - hari);
    setDari(tanggalISO(mulai));
    setSampai(tanggalISO());
    setHalaman(0);
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const adaFilter = Boolean(filterJenis || filterOrang);

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Activity</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
            {pengawas
              ? 'Jejak seluruh tim dari modul yang sudah berjalan — termasuk check-in yang ditolak.'
              : 'Jejak aktivitas Anda dari seluruh modul, tersusun menurut waktu.'}
          </p>
        </div>
        <TombolEkspor
          ambil={ambilSemua}
          susun={(baris) => ({
            namaBerkas: 'riwayat-aktivitas',
            namaSheet: 'Activity',
            judul: 'Riwayat Aktivitas',
            keterangan: [
              `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
              filterJenis ? `Jenis: ${(JENIS[filterJenis] ?? JENIS_BAWAAN).label}` : 'Jenis: semua',
              filterOrang ? `Pengguna: ${namaOrang[filterOrang] ?? '—'}` : 'Pengguna: semua yang boleh Anda lihat',
              `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
            ],
            kolom: [
              { judul: 'Waktu', lebar: 18,
                nilai: (a) => `${tanggalPendek(a.terjadi_pada)} ${waktuPendek(a.terjadi_pada)}` },
              { judul: 'Jenis', lebar: 18, nilai: (a) => (JENIS[a.jenis] ?? JENIS_BAWAAN).label },
              { judul: 'Pengguna', lebar: 20,
                nilai: (a) => (a.user_id ? (namaOrang[a.user_id] ?? '—') : '—') },
              { judul: 'Judul', lebar: 26, nilai: (a) => a.judul },
              { judul: 'Keterangan', lebar: 40, nilai: (a) => a.keterangan },
              { judul: 'Tambahan', lebar: 30, nilai: (a) => a.tambahan },
              { judul: 'Status', lebar: 18, nilai: (a) => a.status },
              { judul: 'Nilai', format: 'angka', lebar: 16,
                nilai: (a) => (a.nilai != null ? Number(a.nilai) : null) },
            ],
            baris,
            ringkasan: [
              { label: 'Jumlah jejak', nilai: baris.length },
              { label: 'Check-in ditolak',
                nilai: baris.filter((a) => a.jenis === 'CHECK_IN' && a.status && a.status !== 'VALID').length },
              { label: 'Override pengawas', nilai: baris.filter((a) => a.jenis === 'OVERRIDE').length },
            ],
          })}
        />
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Aktivitas">
          <AngkaJangkar
            terang
            nilai={angka(total)}
            satuan="jejak"
            keterangan={`${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`}
          />
        </BentoCard>

        <BentoCard rentang={3} tinggi="pendek" judul="Nilai Pipeline Dicatat">
          <AngkaJangkar
            nilai={rupiahRingkas(ringkas.nilai)}
            keterangan="Dari baris pipeline pada halaman ini."
          />
        </BentoCard>

        <BentoCard rentang={6} tinggi="sedang" judul="Sebaran Jenis Aktivitas">
          {daftar.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
          ) : (
            <DonutLegenda
              judul="" ukuran={104}
              nilaiTengah={daftar.length} labelTengah="JEJAK"
              filterAktif={filterJenis ? (JENIS[filterJenis] ?? JENIS_BAWAAN).label : null}
              onKlikIrisan={(label) => {
                const kunci = Object.keys(JENIS).find((k) => JENIS[k].label === label);
                setFilterJenis((j) => (j === kunci ? '' : kunci ?? ''));
                setHalaman(0);
              }}
              data={Object.entries(ringkas.per).map(([jenis, jml], i) => ({
                label: (JENIS[jenis] ?? JENIS_BAWAAN).label,
                value: jml,
                color: (JENIS[jenis] ?? JENIS_BAWAAN).warna || WARNA_CHART[i % WARNA_CHART.length],
              }))}
            />
          )}
        </BentoCard>
      </BentoGrid>

      {ringkas.gagalGps > 0 && (
        <p className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] border border-[#e34948]/25 rounded-kontrol px-3.5 py-2.5 leading-snug">
          <strong className="font-bold">{ringkas.gagalGps} percobaan check-in ditolak</strong> pada
          rentang ini. Percobaan yang gagal sengaja ikut tercatat — tanpa itu, pola check-in
          berulang dari luar radius tidak akan pernah terlihat.
        </p>
      )}

      {/* ── Penyaring ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip aktif={dari === tanggalISO()} onClick={() => geserRentang(0)}>Hari Ini</Chip>
          <Chip aktif={false} onClick={() => geserRentang(7)}>7 Hari</Chip>
          <Chip aktif={false} onClick={() => geserRentang(30)}>30 Hari</Chip>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <label htmlFor="a-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
            <Teks id="a-dari" type="date" value={dari}
              onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
          </div>
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <label htmlFor="a-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
            <Teks id="a-sampai" type="date" value={sampai}
              onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
          </div>

          {pengawas && (
            <div className="flex flex-col gap-1 min-w-[170px] flex-1">
              <label htmlFor="a-orang" className="text-[11px] font-semibold text-slate-600">Pengguna</label>
              <PilihCari id="a-orang" nilai={filterOrang}
                onUbah={(v) => { setFilterOrang(v); setHalaman(0); }}
                bolehKosong labelKosong="Semua pengguna"
                opsi={daftarOrang.map((o) => ({ value: o.id, label: o.full_name }))} />
            </div>
          )}

          <div className="flex flex-col gap-1 min-w-[170px] flex-1">
            <label htmlFor="a-jenis" className="text-[11px] font-semibold text-slate-600">Jenis</label>
            <PilihCari id="a-jenis" nilai={filterJenis}
              onUbah={(v) => { setFilterJenis(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua jenis"
              opsi={Object.entries(JENIS).map(([k, v]) => ({ value: k, label: v.label }))} />
          </div>
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat aktivitas: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={6} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada aktivitas"
            keterangan={adaFilter
              ? 'Tidak ada jejak yang cocok dengan penyaring saat ini.'
              : 'Jejak akan muncul sendiri begitu laporan, pipeline, atau meeting dikerjakan.'}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {perHari.map(([tanggal, isi]) => (
              <section key={tanggal}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                    {tanggalPendek(tanggal)}
                  </h2>
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                    {isi.length} jejak
                  </span>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {isi.map((a) => (
                    <li key={a.id}>
                      <BarisAktivitas
                        aktivitas={a}
                        nama={a.user_id ? (namaOrang[a.user_id] ?? null) : null}
                        tampilkanNama={pengawas}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} jejak</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0}
                  onClick={() => setHalaman(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
                  onClick={() => setHalaman(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-1">{angka(total)} jejak</p>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ aktif, onClick, children }: {
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

function BarisAktivitas({ aktivitas: a, nama, tampilkanNama }: {
  aktivitas: Aktivitas; nama: string | null; tampilkanNama: boolean;
}) {
  const gaya = JENIS[a.jenis] ?? JENIS_BAWAAN;
  const gagal = a.jenis === 'CHECK_IN' && a.status !== null && a.status !== 'VALID';

  return (
    <article className={`bg-white rounded-kartu border px-3.5 py-3 flex items-start gap-3
                         ${gagal ? 'border-[#e34948]/30' : 'border-slate-200'}`}>
      <span
        aria-hidden="true"
        className="flex-shrink-0 w-8 h-8 rounded-full grid place-items-center text-[13px]"
        style={{ background: gaya.bg, color: gaya.warna }}
      >
        {gaya.ikon}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-bold text-slate-900 truncate">{a.judul || '—'}</p>
          <Lencana label={gaya.label} color={gaya.warna} bg={gaya.bg} />
          {gagal && (
            <Lencana label="Ditolak" color="#e34948" bg="#fce3e3" />
          )}
        </div>

        {a.keterangan && (
          <p className="text-[12px] text-slate-600 mt-0.5 leading-snug line-clamp-2">
            {a.keterangan}
          </p>
        )}

        {gagal && (
          <p className="text-[11px] text-[#8f2c2b] mt-1 leading-snug">
            {PESAN_GPS[a.status ?? ''] ?? 'Check-in tidak diterima.'}
            {a.nilai != null && ` (${jarak(a.nilai)} dari titik lokasi)`}
          </p>
        )}

        {a.tambahan && !gagal && (
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-1">
            {a.tambahan}
          </p>
        )}

        <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
          {waktuPendek(a.terjadi_pada)}
          {tampilkanNama && nama && <span className="text-slate-500"> · {nama}</span>}
          {a.jenis === 'PIPELINE' && a.nilai != null && (
            <span className="text-slate-500"> · {rupiahRingkas(a.nilai)}</span>
          )}
        </p>
      </div>
    </article>
  );
}
