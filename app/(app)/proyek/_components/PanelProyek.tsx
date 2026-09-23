'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { rupiah, rupiahRingkas, persen, tanggalPendek, angka } from '@/lib/format';
import { STATUS_JADWAL, type StatusJadwal } from '@/lib/constants';
import { STATUS_GP, MUTU_MARGIN, type StatusGp } from '@/lib/gp';
import { STATUS_PROYEK, tahapProyek, type ProyekRingkasan, type StatusProyek } from '@/lib/proyek';
import { Modal } from '@/components/shared/Modal';
import { Tombol, Lencana } from '@/components/shared/FormParts';
import { Meter } from '@/components/shared/Charts';

/**
 * Panel 360° satu proyek.
 *
 * Inilah jawaban atas pertanyaan yang sebelumnya tidak bisa dijawab platform
 * ini: "proyek Balaikota sudah sampai mana?" — pipeline, jadwal, meeting
 * beserta buktinya, laporan harian, dan GP Calculation dalam satu layar,
 * tanpa berpindah halaman.
 *
 * Setiap baris di sini tetap bisa diklik menuju modul asalnya, karena tempat
 * MENGERJAKANNYA memang di sana. Panel ini untuk melihat, bukan untuk
 * mengerjakan — menggandakan formulir pipeline dan GP ke sini akan
 * menghasilkan dua tempat yang harus dijaga tetap sama, dan keduanya pasti
 * berbeda pada akhirnya.
 */

interface BarisPipeline {
  id: string; customer_name: string; project_detail: string;
  project_value: number; gp_percentage: number; probability: number;
  estimated_closing: string; stage: string;
}

interface BarisJadwal {
  id: string; customer_name: string; category: string; schedule_date: string;
  status: string; requires_attendance: boolean;
}

interface BarisLaporan {
  id: string; report_date: string; customer_name: string; activity: string; result: string;
}

interface BarisGp {
  id: string; nomor: string; project_name: string; status: string;
  total_selling: number; net_profit: number; net_margin: number; mutu_margin: string;
}

interface Lokasi {
  id: string; name: string; address: string | null; approval_status: string; rejection_reason: string | null;
}

const GAYA_LOKASI: Record<string, { label: string; color: string; bg: string }> = {
  MENUNGGU:  { label: 'Menunggu persetujuan admin', color: '#eda100', bg: '#fef3d9' },
  DISETUJUI: { label: 'Disetujui — siap dipakai check-in', color: '#008300', bg: '#e0f2e0' },
  DITOLAK:   { label: 'Ditolak', color: '#e34948', bg: '#fce3e3' },
};

export function PanelProyek({ buka, onTutup, proyek, namaOrang, onSunting }: {
  buka: boolean;
  onTutup: () => void;
  proyek: ProyekRingkasan;
  namaOrang: Record<string, string>;
  onSunting: () => void;
}) {
  const [pipeline, setPipeline] = useState<BarisPipeline[]>([]);
  const [jadwal, setJadwal] = useState<BarisJadwal[]>([]);
  const [laporan, setLaporan] = useState<BarisLaporan[]>([]);
  const [gp, setGp] = useState<BarisGp[]>([]);
  const [lokasi, setLokasi] = useState<Lokasi | null>(null);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    setMemuat(true);

    // Lima query paralel, bukan berurutan. Panel ini dibuka untuk melihat
    // seluruh gambaran sekaligus; memuatnya satu per satu berarti isinya
    // menetes selama beberapa detik.
    const [pl, sc, dr, g, lk] = await Promise.all([
      supabase.from('sm_pipeline')
        .select('id, customer_name, project_detail, project_value, gp_percentage, probability, estimated_closing, stage')
        .eq('project_id', proyek.id).order('estimated_closing', { ascending: true }).limit(20),
      supabase.from('sm_schedules')
        .select('id, customer_name, category, schedule_date, status, requires_attendance')
        .eq('project_id', proyek.id).order('schedule_date', { ascending: false }).limit(20),
      supabase.from('sm_daily_reports')
        .select('id, report_date, customer_name, activity, result')
        .eq('project_id', proyek.id).order('report_date', { ascending: false }).limit(20),
      supabase.from('sm_gp_ringkasan')
        .select('id, nomor, project_name, status, total_selling, net_profit, net_margin, mutu_margin')
        .eq('project_id', proyek.id).order('calc_date', { ascending: false }).limit(20),
      supabase.from('sm_locations')
        .select('id, name, address, approval_status, rejection_reason')
        .eq('project_id', proyek.id).maybeSingle(),
    ]);

    setPipeline((pl.data ?? []) as BarisPipeline[]);
    setJadwal((sc.data ?? []) as BarisJadwal[]);
    setLaporan((dr.data ?? []) as BarisLaporan[]);
    setGp((g.data ?? []) as BarisGp[]);
    setLokasi((lk.data ?? null) as Lokasi | null);
    setMemuat(false);
  }, [proyek.id]);

  useEffect(() => { if (buka) void muat(); }, [buka, muat]);

  const gaya = STATUS_PROYEK[proyek.status as StatusProyek] ?? STATUS_PROYEK.AKTIF;
  const langkah = tahapProyek(proyek);

  return (
    <Modal
      buka={buka}
      onTutup={onTutup}
      judul={proyek.name}
      keterangan={`${proyek.customer_name} · ${proyek.kode}`}
      lebar="lebar"
      kaki={
        <>
          <Tombol rupa="kedua" onClick={onTutup} className="text-[12px] py-2">Tutup</Tombol>
          <Tombol rupa="kedua" onClick={onSunting} className="text-[12px] py-2">Sunting Proyek</Tombol>
        </>
      }
    >
      <div className="flex flex-col gap-4">

        <div className="flex items-center gap-2 flex-wrap">
          <Lencana {...gaya} />
          <span className="text-[11px] text-slate-500">
            Pemilik <b className="text-slate-700">{namaOrang[proyek.owner_user_id] ?? '—'}</b>
          </span>
          {proyek.start_date && (
            <span className="text-[11px] text-slate-400">
              {tanggalPendek(proyek.start_date)}
              {proyek.end_date && ` – ${tanggalPendek(proyek.end_date)}`}
            </span>
          )}
        </div>

        {/* ── Ringkasan angka ── */}
        <section className="grid grid-cols-2 formulir:grid-cols-4 gap-2">
          <Kotak label="Nilai Pipeline" nilai={rupiah(proyek.nilai_pipeline)}
            keterangan={`${angka(proyek.jumlah_pipeline)} peluang`} />
          <Kotak label="Nilai GP" nilai={rupiah(proyek.nilai_gp)}
            keterangan={`${angka(proyek.jumlah_gp)} dokumen`} />
          <Kotak label="Net Profit GP" nilai={rupiah(proyek.profit_gp)}
            warna={Number(proyek.profit_gp) >= 0 ? '#008300' : '#e34948'}
            keterangan={`${angka(proyek.gp_disetujui)} disetujui`} />
          <Kotak label="Target Proyek" nilai={rupiah(proyek.target_value)}
            keterangan={Number(proyek.target_value) > 0
              ? `tercapai ${persen((Number(proyek.nilai_pipeline) / Number(proyek.target_value)) * 100, 0)}`
              : 'belum diisi'} />
        </section>

        {/* ── Tahapan ── */}
        <section className="rounded-kartu border border-slate-200 p-3">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Tahapan</p>
            <p className="text-[11px] font-semibold text-slate-600">{langkah.label}</p>
          </div>
          <Meter nilai={langkah.tahap} maksimum={langkah.total} label="" />
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            Dihitung dari jejak yang benar-benar ada — pipeline, jadwal, bukti kunjungan,
            GP disusun, GP disetujui — bukan dari persentase yang diketik sendiri.
          </p>
        </section>

        {lokasi && (
          <section className="rounded-kartu border border-slate-200 p-3">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Lokasi</p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13px] font-bold text-slate-800">{lokasi.name}</p>
              <Lencana {...(GAYA_LOKASI[lokasi.approval_status] ?? GAYA_LOKASI.MENUNGGU)} />
            </div>
            {lokasi.address && <p className="text-[11px] text-slate-500 mt-0.5">{lokasi.address}</p>}
            {lokasi.approval_status === 'DITOLAK' && lokasi.rejection_reason && (
              <p className="text-[11px] text-[#8f2c2b] mt-1">{lokasi.rejection_reason}</p>
            )}
          </section>
        )}

        {proyek.description && (
          <p className="text-[12px] text-slate-600 leading-relaxed whitespace-pre-wrap
                        bg-slate-50 rounded-kontrol px-3 py-2.5">
            {proyek.description}
          </p>
        )}

        {memuat ? (
          <p className="text-[12px] text-slate-400 py-4 text-center">Memuat catatan proyek…</p>
        ) : (
          <>
            {/* ── Pipeline ── */}
            <Bagian judul="Pipeline" jumlah={pipeline.length} href="/pipeline" kosong="Belum ada peluang tertaut.">
              {pipeline.map((p) => (
                <Baris key={p.id} href={`/pipeline?fokus=${p.id}`}
                  judul={p.project_detail}
                  keterangan={`${p.customer_name} · ${persen(p.probability, 0)} · closing ${tanggalPendek(p.estimated_closing)}`}
                  kanan={rupiahRingkas(p.project_value)}
                  bawah={`GP ${persen(p.gp_percentage)}`}
                  warna={p.stage === 'WON' ? '#008300' : p.stage === 'LOST' ? '#e34948' : '#2a78d6'} />
              ))}
            </Bagian>

            {/* ── Jadwal & Meeting ── */}
            <Bagian judul="Jadwal & Meeting" jumlah={jadwal.length} href="/schedule"
              kosong="Belum ada jadwal tertaut.">
              {jadwal.map((j) => {
                const g = STATUS_JADWAL[j.status as StatusJadwal] ?? STATUS_JADWAL.UPCOMING;
                return (
                  <Baris key={j.id}
                    href={j.requires_attendance ? `/meeting?fokus=${j.id}` : `/schedule?fokus=${j.id}`}
                    judul={j.customer_name}
                    keterangan={`${j.category}${j.requires_attendance ? ' · wajib bukti' : ''} · ${tanggalPendek(j.schedule_date)}`}
                    kanan={g.label}
                    warna={g.color} />
                );
              })}
            </Bagian>

            {/* ── GP Calculation ── */}
            <Bagian judul="GP Calculation" jumlah={gp.length} href="/gp"
              kosong="Belum ada perhitungan GP untuk proyek ini.">
              {gp.map((g) => {
                const s = STATUS_GP[g.status as StatusGp] ?? STATUS_GP.DRAFT;
                const m = MUTU_MARGIN[g.mutu_margin] ?? MUTU_MARGIN['TANPA NILAI'];
                return (
                  <Baris key={g.id} href={`/gp?fokus=${g.id}`}
                    judul={g.nomor}
                    keterangan={`${s.label} · ${m.label}`}
                    kanan={rupiahRingkas(g.total_selling)}
                    bawah={`margin ${persen(Number(g.net_margin) * 100)} · profit ${rupiahRingkas(g.net_profit)}`}
                    warna={m.color} />
                );
              })}
            </Bagian>

            {/* ── Laporan harian ── */}
            <Bagian judul="Laporan Harian" jumlah={laporan.length} href="/daily-report"
              kosong="Belum ada laporan harian tertaut.">
              {laporan.map((l) => (
                <Baris key={l.id} href={`/daily-report?fokus=${l.id}`}
                  judul={l.customer_name}
                  keterangan={l.activity}
                  kanan={tanggalPendek(l.report_date)}
                  bawah={l.result}
                  warna="#1d4ed8" />
              ))}
            </Bagian>

            <Link href={`/activity?proyek=${proyek.id}`}
              className="text-[12px] font-bold text-aksen-700 hover:underline underline-offset-2">
              Lihat seluruh jejak aktivitas proyek ini →
            </Link>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ── Bagian kecil ─────────────────────────────────────────────────────────── */

function Kotak({ label, nilai, keterangan, warna }: {
  label: string; nilai: string; keterangan?: string; warna?: string;
}) {
  return (
    <div className="rounded-kontrol bg-slate-50 border border-slate-200 px-3 py-2.5 min-w-0">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-[14px] font-black tabular-nums mt-1 truncate"
        style={{ color: warna ?? '#0f172a' }}>{nilai}</p>
      {keterangan && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{keterangan}</p>}
    </div>
  );
}

function Bagian({ judul, jumlah, href, kosong, children }: {
  judul: string; jumlah: number; href: string; kosong: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-2 pb-1 border-b border-slate-200">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
          {judul} <span className="text-slate-400">({angka(jumlah)})</span>
        </h3>
        <Link href={href} className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">
          Buka modul →
        </Link>
      </div>
      {jumlah === 0 ? (
        <p className="text-[12px] text-slate-400 py-2">{kosong}</p>
      ) : (
        <ul className="flex flex-col gap-1">{children}</ul>
      )}
    </section>
  );
}

function Baris({ href, judul, keterangan, kanan, bawah, warna }: {
  href: string; judul: string; keterangan: string;
  kanan?: string; bawah?: string; warna?: string;
}) {
  return (
    <li>
      <Link href={href}
        className="flex items-start gap-2.5 rounded-kontrol border border-slate-200 px-3 py-2
                   hover:bg-slate-50 transition-colors">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
          style={{ background: warna ?? '#94a3b8' }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-bold text-slate-800 truncate">{judul}</span>
          <span className="block text-[11px] text-slate-500 truncate">{keterangan}</span>
          {bawah && <span className="block text-[10px] text-slate-400 truncate">{bawah}</span>}
        </span>
        {kanan && (
          <span className="text-[11.5px] font-bold text-slate-600 tabular-nums flex-shrink-0">
            {kanan}
          </span>
        )}
      </Link>
    </li>
  );
}
