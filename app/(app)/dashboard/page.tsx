'use client';

import Link from 'next/link';
import { useDashboard } from '@/lib/use-dashboard';
import { usePenggunaAktif } from '@/lib/auth';
import { usePengaturan } from '@/lib/use-settings';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import {
  DonutLegenda, CincinCapaian, CorongTingkat, BatangPeriode, Sparkline, Meter, LencanaTren,
} from '@/components/shared/Charts';
import { KerangkaKartu, PanelGalat, Kosong } from '@/components/shared/Feedback';
import { rupiahRingkas, angka, persen, hitungDelta } from '@/lib/format';
import { WARNA_PROBABILITY, PESAN_GPS, isPengawas } from '@/lib/constants';
import { KartuTarget } from './_components/KartuTarget';

/**
 * Dashboard — ikhtisar operasional, bukan hiasan (§9).
 *
 * Tata letaknya sengaja tidak seragam. Kartu jangkar berlatar gradien biru,
 * satu kartu gelap sebagai penyeimbang, sisanya putih polos dan satu bergaris
 * putus-putus untuk panel pengecualian. Rentang kolomnya berganti-ganti
 * (4-4-4, lalu 8-4, lalu 6-3-3) supaya matanya punya irama, bukan deretan
 * kotak identik.
 *
 * Setiap grafik menjawab satu pertanyaan yang benar-benar ditanyakan orang
 * saat membuka halaman ini, dan bentuknya dipilih mengikuti pertanyaannya —
 * bukan sebaliknya.
 */
export default function HalamanDashboard() {
  const { pengguna } = usePenggunaAktif();
  const { data, memuat, galat, muatUlang } = useDashboard();
  const { pengaturan } = usePengaturan();

  const pengawas = isPengawas(pengguna?.role);

  /**
   * Kartu mana yang boleh tampil, diatur Admin lewat Administrasi → Tampilan.
   *
   * Kartu yang key-nya TIDAK ada di pengaturan tetap ditampilkan. Itu
   * disengaja: menambah kartu baru di kode tidak boleh membuatnya tersembunyi
   * diam-diam hanya karena baris pengaturannya belum menyebutnya.
   */
  const tampil = (key: string) =>
    pengaturan.dashboard_widgets.find((k) => k.key === key)?.aktif ?? true;

  if (galat) {
    return (
      <div className="max-w-xl mx-auto mt-8">
        <PanelGalat pesan={`Gagal memuat dashboard: ${galat}`} onCoba={muatUlang} />
      </div>
    );
  }

  if (memuat || !data) {
    return (
      <div className="flex flex-col gap-4">
        <TajukHalaman nama={pengguna?.full_name} pengawas={pengawas} />
        <BentoGrid>
          <div className="sm:col-span-3 lg:col-span-4"><KerangkaKartu tinggi={208} /></div>
          <div className="sm:col-span-3 lg:col-span-4"><KerangkaKartu tinggi={208} /></div>
          <div className="sm:col-span-6 lg:col-span-4"><KerangkaKartu tinggi={208} /></div>
          <div className="sm:col-span-6 lg:col-span-8"><KerangkaKartu tinggi={240} /></div>
          <div className="sm:col-span-6 lg:col-span-4"><KerangkaKartu tinggi={240} /></div>
        </BentoGrid>
      </div>
    );
  }

  const { daily_report: dr, pipeline: pl, jadwal, meeting, probability, gps_gagal, tren_bulanan } = data;

  const trenLaporan = tren_bulanan.map((t) => t.laporan);
  const trenNilai = tren_bulanan.map((t) => t.nilai);
  const deltaNilai = hitungDelta(
    trenNilai[trenNilai.length - 1] ?? 0,
    trenNilai[trenNilai.length - 2] ?? 0,
  );

  // Untuk Sales, "total_sales" adalah seluruh tim tapi laporan yang terlihat
  // hanya miliknya — jadi pembandingnya harus 1, bukan jumlah tim. Tanpa
  // penyesuaian ini, seorang Sales dari tim berisi 8 orang melihat kepatuhan
  // dirinya sendiri sebagai 12%, padahal ia sudah melapor.
  const targetLapor = pengawas ? dr.total_sales : 1;
  const sudahLapor = pengawas ? dr.sudah_lapor : Math.min(1, dr.sudah_lapor);

  const daftarGpsGagal = Object.entries(gps_gagal).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-4">
      <TajukHalaman nama={pengguna?.full_name} pengawas={pengawas} />

      <BentoGrid>

        {/* ── Jangkar: kepatuhan laporan harian ── */}
        {tampil('kepatuhan') && (
        <BentoCard
          rentang={4} tinggi="sedang" rupa="sorot"
          judul={pengawas ? 'Kepatuhan Laporan Hari Ini' : 'Laporan Hari Ini'}
        >
          <CincinCapaian
            terang
            nilai={sudahLapor}
            maksimum={targetLapor}
            warna="#ffffff"
            label={pengawas ? `${sudahLapor} dari ${targetLapor} Sales` : (sudahLapor ? 'Sudah dikirim' : 'Belum dikirim')}
          />
          {pengawas && dr.belum_lapor > 0 && (
            <p className="text-[12px] text-white/80 text-center mt-3">
              <span className="font-bold">{dr.belum_lapor} Sales</span> belum mengirim laporan
            </p>
          )}
          {!pengawas && sudahLapor === 0 && (
            <Link
              href="/daily-report"
              className="mt-3 mx-auto block w-fit rounded-kontrol bg-white/15 hover:bg-white/25 px-4 py-2 text-[12px] font-bold text-white transition-colors"
            >
              Buat laporan sekarang
            </Link>
          )}
        </BentoCard>
        )}

        {/* ── Nilai pipeline ── */}
        {tampil('nilai_pipeline') && (
        <BentoCard rentang={4} tinggi="sedang" judul="Nilai Pipeline" aksi={<TautanKecil href="/pipeline" />}>
          <AngkaJangkar
            nilai={rupiahRingkas(pl.total_nilai)}
            keterangan={`${angka(pl.jumlah)} peluang dalam 30 hari terakhir`}
            tren={<LencanaTren delta={deltaNilai} />}
          />
          <div className="mt-4 flex items-center gap-3">
            <Sparkline values={trenNilai} width={90} height={26} />
            <span className="text-[10px] text-slate-400 leading-tight">
              6 bulan<br />terakhir
            </span>
          </div>
          <div className="mt-4">
            <Meter
              nilai={pl.akan_closing} maksimum={pl.jumlah}
              label="Diperkirakan closing ≤30 hari"
            />
          </div>
        </BentoCard>
        )}

        {/* ── Kartu gelap: GP ── */}
        {tampil('gross_profit') && (
        <BentoCard rentang={4} tinggi="sedang" rupa="gelap" judul="Gross Profit">
          <AngkaJangkar
            terang
            nilai={rupiahRingkas(pl.total_gp)}
            keterangan={`Margin rata-rata tertimbang ${persen(pl.gp_persen, 2)}`}
          />
          <div className="mt-4 space-y-2.5">
            <BarisTerang label="Nilai proyek" nilai={rupiahRingkas(pl.total_nilai)} />
            <BarisTerang label="HPP" nilai={rupiahRingkas(pl.total_hpp)} />
            <div className="h-px bg-white/10" />
            <BarisTerang label="Selisih (GP)" nilai={rupiahRingkas(pl.total_gp)} tebal />
          </div>
        </BentoCard>
        )}

        {tampil('target') && <KartuTarget pengawas={pengawas} />}

        {/* ── Corong probability ── */}
        {tampil('probability') && (
        <BentoCard
          rentang={8} tinggi="sedang"
          judul="Sebaran Probability Pipeline"
          aksi={<span className="text-[10px] text-slate-400">jumlah peluang · nilai</span>}
        >
          {probability.length === 0 ? (
            <Kosong
              judul="Belum ada Pipeline"
              keterangan="Peluang yang Anda catat akan muncul di sini, dikelompokkan per tingkat probability."
            />
          ) : (
            <CorongTingkat
              data={probability.map((p) => ({
                label: `${p.probability}%`,
                jumlah: p.jumlah,
                nilai: rupiahRingkas(p.nilai),
                color: WARNA_PROBABILITY[p.probability] ?? '#1d4ed8',
              }))}
            />
          )}
        </BentoCard>
        )}

        {/* ── Status jadwal ── */}
        {tampil('status_jadwal') && (
        <BentoCard rentang={4} tinggi="sedang" judul="Status Jadwal" aksi={<TautanKecil href="/schedule" />}>
          <DonutLegenda
            judul=""
            nilaiTengah={jadwal.upcoming + jadwal.berjalan + jadwal.selesai + jadwal.terlewat}
            labelTengah="JADWAL"
            data={[
              { label: 'Akan Datang', value: jadwal.upcoming, color: '#64748b' },
              { label: 'Berjalan',    value: jadwal.berjalan, color: '#2a78d6' },
              { label: 'Selesai',     value: jadwal.selesai,  color: '#008300' },
              { label: 'Terlewat',    value: jadwal.terlewat, color: '#e34948' },
            ].filter((d) => d.value > 0)}
          />
        </BentoCard>
        )}

        {/* ── Tren bulanan ── */}
        {tampil('tren') && (
        <BentoCard rentang={6} tinggi="sedang" judul="Aktivitas 6 Bulan Terakhir">
          <BatangPeriode
            data={tren_bulanan.map((t) => ({ label: t.bulan, value: t.laporan }))}
          />
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100">
            <KeteranganKecil warna="#1d4ed8" label="Laporan harian" />
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums">
              total {angka(trenLaporan.reduce((a, b) => a + b, 0))}
            </span>
          </div>
        </BentoCard>
        )}

        {/* ── Meeting ── */}
        {tampil('meeting') && (
        <BentoCard rentang={3} tinggi="sedang" judul="Meeting" aksi={<TautanKecil href="/meeting" />}>
          {meeting.total === 0 ? (
            <Kosong judul="Belum ada meeting" keterangan="Jadwal berkategori Meeting akan tampil di sini." />
          ) : (
            <DonutLegenda
              judul=""
              ukuran={104}
              nilaiTengah={meeting.total}
              labelTengah="MEETING"
              data={[
                { label: 'Selesai',      value: meeting.selesai,       color: '#008300' },
                { label: 'Belum mulai',  value: meeting.belum_mulai,   color: '#64748b' },
                { label: 'Tunggu foto',  value: meeting.menunggu_foto, color: '#eda100' },
                { label: 'Siap selesai', value: meeting.siap_selesai,  color: '#2a78d6' },
                { label: 'Exception',    value: meeting.exception,     color: '#7c3aed' },
              ].filter((d) => d.value > 0)}
            />
          )}
        </BentoCard>
        )}

        {/* ── Panel pengecualian: yang butuh tindakan ── */}
        {tampil('pengecualian') && (
        <BentoCard
          rentang={3} tinggi="sedang" rupa="garis"
          judul="Perlu Ditindaklanjuti"
        >
          {daftarGpsGagal.length === 0 && meeting.menunggu_foto === 0 ? (
            <div className="text-center py-4">
              <p className="text-2xl mb-1" aria-hidden="true">✓</p>
              <p className="text-[12px] font-bold text-slate-600">Tidak ada pengecualian</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Semua verifikasi lokasi lolos.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {meeting.menunggu_foto > 0 && (
                <BarisBento
                  warna="#eda100"
                  kiri={
                    <>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">Menunggu foto bukti</p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                        Sudah check-in, foto belum diunggah
                      </p>
                    </>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{meeting.menunggu_foto}</span>}
                />
              )}
              {daftarGpsGagal.map(([status, jml]) => (
                <BarisBento
                  key={status}
                  warna="#e34948"
                  kiri={
                    <>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">
                        {LABEL_GAGAL[status] ?? status}
                      </p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5 line-clamp-2">
                        {PESAN_GPS[status] ?? ''}
                      </p>
                    </>
                  }
                  kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{jml}</span>}
                />
              ))}
            </div>
          )}
        </BentoCard>
        )}

      </BentoGrid>
    </div>
  );
}

/** Judul pendek untuk panel pengecualian — PESAN_GPS terlalu panjang di sini. */
const LABEL_GAGAL: Record<string, string> = {
  OUTSIDE_RADIUS:      'Di luar radius',
  LOW_ACCURACY:        'Akurasi GPS rendah',
  ASSIGNMENT_MISMATCH: 'Bukan petugasnya',
  SCHEDULE_MISMATCH:   'Bukan jadwal hari ini',
  NO_LOCATION:         'Lokasi belum diatur',
  SUSPECTED_MOCK:      'Lokasi diduga palsu',
};

function TajukHalaman({ nama, pengawas }: { nama?: string; pengawas: boolean }) {
  const jam = new Date().getHours();
  const sapa = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 19 ? 'Selamat sore' : 'Selamat malam';
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
          {sapa}{nama ? `, ${nama.split(' ')[0]}` : ''}
        </h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          {pengawas ? 'Ikhtisar seluruh tim Sales — 30 hari terakhir.' : 'Ikhtisar aktivitas Anda — 30 hari terakhir.'}
        </p>
      </div>
    </div>
  );
}

function TautanKecil({ href }: { href: string }) {
  return (
    <Link href={href} className="text-[11px] font-bold text-aksen-700 hover:text-aksen-800 flex-shrink-0">
      Lihat →
    </Link>
  );
}

function BarisTerang({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-white/55">{label}</span>
      <span className={`text-[12px] tabular-nums ${tebal ? 'font-black text-white' : 'font-semibold text-white/85'}`}>
        {nilai}
      </span>
    </div>
  );
}

function KeteranganKecil({ warna, label }: { warna: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: warna }} />
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
    </span>
  );
}
