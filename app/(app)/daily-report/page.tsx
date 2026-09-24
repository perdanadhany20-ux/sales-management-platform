'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { isPengawas, isAdmin } from '@/lib/constants';
import { tanggalISO, tanggalPendek, angka, polaIlike } from '@/lib/format';
import { BentoGrid, BentoCard, AngkaJangkar } from '@/components/shared/Bento';
import { CincinCapaian, DonutLegenda, Sparkline } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Modal, Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { FormLaporan, type Laporan } from './_components/FormLaporan';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';

const PER_HALAMAN = 20;

interface Sales { id: string; full_name: string }

/**
 * Daily Sales Report (§12–§16).
 *
 * Yang dilihat Sales dan yang dilihat Manager berbeda isinya, tapi kodenya
 * satu. Itu bukan penyederhanaan yang ceroboh: RLS pada sm_daily_reports
 * (migrasi 005) yang menentukan baris mana yang sampai ke sini, jadi halaman
 * ini tidak perlu — dan tidak boleh — menyaring berdasarkan peran sendiri.
 * Yang berbeda per peran hanya penyajiannya: kolom "Sales" dan penyaringnya
 * tidak ada gunanya bagi orang yang hanya bisa melihat datanya sendiri.
 */
export default function HalamanDailyReport() {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);
  const admin = isAdmin(pengguna?.role);

  const [daftar, setDaftar] = useState<Laporan[]>([]);
  const [namaSales, setNamaSales] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<Sales[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [dari, setDari] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return tanggalISO(d);
  });
  const [sampai, setSampai] = useState(tanggalISO());
  const [filterSales, setFilterSales] = useState('');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<Laporan | null>(null);
  const [akanHapus, setAkanHapus] = useState<Laporan | null>(null);
  const [menghapus, setMenghapus] = useState(false);
  const [dilihat, setDilihat] = useState<Laporan | null>(null);

  // Pencarian ditunda supaya setiap huruf tidak memicu satu query.
  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);

    let q = supabase
      .from('sm_daily_reports')
      // count: 'exact' menyertakan jumlah total dalam respons yang sama,
      // sehingga paginasi tidak perlu query kedua (§69).
      .select('*', { count: 'exact' })
      .gte('report_date', dari)
      .lte('report_date', sampai)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.${polaIlike(k)},lead_project.ilike.${polaIlike(k)},activity.ilike.${polaIlike(k)}`);
    }

    const { data, error, count } = await q;

    if (error) { setGalat(error.message); setMemuat(false); return; }

    setDaftar((data ?? []) as Laporan[]);
    setTotal(count ?? 0);
    setMemuat(false);
  }, [dari, sampai, filterSales, cariTertunda, halaman]);

  useEffect(() => { void muat(); }, [muat]);

  // Menyorot baris yang ditunjuk lencana header (?fokus=<id>). Dijalankan
  // setelah daftar selesai dimuat — sebelum itu elemennya belum ada di DOM.
  useFokusBaris(!memuat);

  /**
   * Seluruh baris yang cocok dengan penyaring — tanpa paginasi.
   *
   * Sengaja mengulang syarat `muat()` alih-alih memakai `daftar` yang sudah
   * ada di layar: `daftar` hanya berisi satu halaman, dan berkas ekspor yang
   * diam-diam hanya memuat 20 dari 300 baris adalah kesalahan yang baru
   * ketahuan setelah angkanya dipakai rapat.
   */
  const ambilSemua = useCallback(async () => {
    let q = supabase
      .from('sm_daily_reports')
      .select('*')
      .gte('report_date', dari)
      .lte('report_date', sampai)
      .order('report_date', { ascending: false })
      .limit(BATAS_BARIS_EKSPOR + 1);

    if (filterSales) q = q.eq('sales_user_id', filterSales);
    if (cariTertunda.trim()) {
      const k = cariTertunda.trim();
      q = q.or(`customer_name.ilike.${polaIlike(k)},lead_project.ilike.${polaIlike(k)},activity.ilike.${polaIlike(k)}`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Laporan[];
  }, [dari, sampai, filterSales, cariTertunda]);

  // Dua hal berbeda dimuat dari satu query, dan pembedaannya penting.
  //
  // `daftarSales` (peran SALES saja) mengisi penyaring — menyaring "per Sales"
  // memang hanya masuk akal untuk Sales.
  //
  // `namaSales` memetakan SELURUH pengguna aktif, termasuk Admin dan Manager.
  // Sebelumnya peta ini hanya berisi peran SALES, sehingga laporan yang
  // dibuat seorang Admin jatuh ke label cadangan 'Tidak dikenal' — yang lalu
  // dipotong `.split(' ')[0]` untuk legenda donat dan tampil sebagai kata
  // "Tidak" begitu saja. Terlihat langsung saat pengujian di peramban.
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

  const hariIni = tanggalISO();

  // Dihitung terpisah dari daftar: daftar ikut tersaring pencarian dan
  // paginasi, sedangkan status hari ini tidak boleh berubah karena itu.
  const [hariIniSaya, setHariIniSaya] = useState<{ jumlah: number; terakhir: string | null }>({ jumlah: 0, terakhir: null });
  useEffect(() => {
    if (!pengguna || pengawas) return;
    void (async () => {
      const { data, count } = await supabase
        .from('sm_daily_reports')
        .select('customer_name', { count: 'exact' })
        .eq('sales_user_id', pengguna.id)
        .eq('report_date', hariIni)
        .order('created_at', { ascending: false })
        .limit(1);
      setHariIniSaya({ jumlah: count ?? 0, terakhir: (data?.[0] as { customer_name: string } | undefined)?.customer_name ?? null });
    })();
  }, [pengguna, pengawas, hariIni, daftar]);
  const laporanHariIni = hariIniSaya.jumlah > 0;

  const salesMelapor = useMemo(() => {
    const idSales = new Set(daftarSales.map((s) => s.id));
    return new Set(daftar.map((l) => l.sales_user_id).filter((id) => idSales.has(id))).size;
  }, [daftar, daftarSales]);

  // Sebaran laporan per hari dalam 14 hari terakhir, untuk sparkline.
  const trenHarian = useMemo(() => {
    const peta = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      peta.set(tanggalISO(d), 0);
    }
    for (const l of daftar) {
      if (peta.has(l.report_date)) peta.set(l.report_date, (peta.get(l.report_date) ?? 0) + 1);
    }
    return [...peta.values()];
  }, [daftar]);

  const perSales = useMemo(() => {
    if (!pengawas) return [];
    const peta = new Map<string, number>();
    for (const l of daftar) {
      peta.set(l.sales_user_id, (peta.get(l.sales_user_id) ?? 0) + 1);
    }
    return [...peta.entries()]
      .map(([id, jml]) => ({ nama: namaSales[id] ?? 'Pengguna lain', jml }))
      .sort((a, b) => b.jml - a.jml)
      .slice(0, 6);
  }, [daftar, namaSales, pengawas]);

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_daily_reports').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${error.message}`); return; }
    toast('sukses', 'Laporan dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));

  return (
    <div className="flex flex-col gap-4">

      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Daily Report</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {pengawas ? 'Laporan harian seluruh tim Sales.' : 'Laporan harian Anda.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'daily-report',
              namaSheet: 'Daily Report',
              judul: 'Daily Sales Report',
              keterangan: [
                `Rentang: ${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`,
                filterSales ? `Sales: ${namaSales[filterSales] ?? '—'}` : 'Sales: semua',
                cariTertunda ? `Kata kunci: ${cariTertunda}` : 'Tanpa kata kunci',
                `Diekspor oleh ${pengguna?.full_name ?? '—'} pada ${tanggalPendek(tanggalISO())}`,
              ],
              kolom: [
                { judul: 'Tanggal', format: 'tanggal', lebar: 12, nilai: (r) => selTanggal(r.report_date) },
                { judul: 'Sales', lebar: 20, nilai: (r) => namaSales[r.sales_user_id] ?? '—' },
                { judul: 'Customer', lebar: 26, nilai: (r) => r.customer_name },
                { judul: 'Kontak', lebar: 18, nilai: (r) => r.contact_person },
                { judul: 'Jabatan', lebar: 16, nilai: (r) => r.position },
                { judul: 'No. WA', lebar: 16, nilai: (r) => r.phone_whatsapp },
                { judul: 'Aktivitas', lebar: 34, nilai: (r) => r.activity },
                { judul: 'Lead / Proyek', lebar: 26, nilai: (r) => r.lead_project },
                { judul: 'Hasil', lebar: 34, nilai: (r) => r.result },
                { judul: 'Next Action', lebar: 30, nilai: (r) => r.next_action },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah laporan', nilai: baris.length },
                { label: 'Jumlah Sales terlibat',
                  nilai: new Set(baris.map((r) => r.sales_user_id)).size },
                { label: 'Customer berbeda',
                  nilai: new Set(baris.map((r) => r.customer_name.toLowerCase())).size },
              ],
            })}
          />
          <Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>
            + Laporan Baru
          </Tombol>
        </div>
      </header>

      {/* ── Analitik ringkas (§16) ── */}
      <BentoGrid>
        {!pengawas ? (
          <BentoCard rentang={4} tinggi="pendek" rupa={laporanHariIni ? 'polos' : 'sorot'} judul="Status Hari Ini">
            {laporanHariIni ? (
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full bg-[#e0f2e0] text-[#008300] grid place-items-center text-lg font-black flex-shrink-0">✓</span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900">
                    {hariIniSaya.jumlah} laporan terkirim
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">Terakhir: {hariIniSaya.terakhir}</p>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm font-black text-white">Belum dikirim</p>
                <p className="text-[11px] text-white/70 mt-0.5 mb-2.5">Laporan hari ini masih kosong.</p>
                <button
                  type="button"
                  onClick={() => { setSedangSunting(null); setFormBuka(true); }}
                  className="rounded-kontrol bg-white/15 hover:bg-white/25 px-3 py-1.5 text-[12px] font-bold text-white transition-colors"
                >
                  Isi sekarang
                </button>
              </div>
            )}
          </BentoCard>
        ) : (
          <BentoCard rentang={4} tinggi="sedang" rupa="sorot" judul="Kepatuhan Periode Ini">
            {daftarSales.length === 0 ? (
              /* Tanpa satu pun akun berperan SALES, persentase kepatuhan tidak
                 punya penyebut yang bermakna. Sebelumnya penyebutnya dipaksa
                 minimal 1, sehingga layar menampilkan "100%" bersanding dengan
                 "1 dari 0 Sales" — angka yang tampak meyakinkan padahal tidak
                 mengukur apa pun. Lebih jujur mengatakan datanya belum ada. */
              <div className="text-center py-2">
                <p className="text-sm font-black text-white">Belum ada akun Sales</p>
                <p className="text-[11px] text-white/70 mt-1 leading-snug">
                  Tambahkan pengguna berperan Sales di menu Administrasi agar
                  kepatuhan laporan bisa diukur.
                </p>
              </div>
            ) : (
              <CincinCapaian
                terang
                nilai={salesMelapor}
                maksimum={daftarSales.length}
                warna="#ffffff"
                label={`${salesMelapor} dari ${daftarSales.length} Sales`}
              />
            )}
          </BentoCard>
        )}

        <BentoCard rentang={4} tinggi={pengawas ? 'sedang' : 'pendek'} judul="Jumlah Laporan">
          <AngkaJangkar
            nilai={angka(total)}
            satuan="laporan"
            keterangan={`${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`}
          />
          <div className="mt-3 flex items-center gap-3">
            <Sparkline values={trenHarian} width={96} height={24} />
            <span className="text-[10px] text-slate-400 leading-tight">14 hari<br />terakhir</span>
          </div>
        </BentoCard>

        {pengawas && (
          <BentoCard rentang={4} tinggi="sedang" judul="Kontribusi per Sales">
            {perSales.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">Belum ada data</p>
            ) : (
              <DonutLegenda
                judul="" ukuran={104}
                nilaiTengah={perSales.reduce((a, b) => a + b.jml, 0)}
                labelTengah="LAPORAN"
                data={perSales.map((s, i) => ({
                  label: s.nama.split(' ')[0],
                  value: s.jml,
                  color: ['#1d4ed8', '#0891b2', '#eda100', '#008300', '#7c3aed', '#64748b'][i],
                }))}
              />
            )}
          </BentoCard>
        )}
      </BentoGrid>

      {/* ── Penyaring (§67) ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[132px]">
          <label htmlFor="f-dari" className="text-[11px] font-semibold text-slate-600">Dari</label>
          <Teks id="f-dari" type="date" value={dari}
            onChange={(e) => { setDari(e.target.value); setHalaman(0); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[132px]">
          <label htmlFor="f-sampai" className="text-[11px] font-semibold text-slate-600">Sampai</label>
          <Teks id="f-sampai" type="date" value={sampai}
            onChange={(e) => { setSampai(e.target.value); setHalaman(0); }} />
        </div>

        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label htmlFor="f-sales" className="text-[11px] font-semibold text-slate-600">Sales</label>
            <PilihCari
              id="f-sales"
              nilai={filterSales}
              onUbah={(v) => { setFilterSales(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua Sales"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))}
            />
          </div>
        )}

        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="f-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="f-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Customer, proyek, atau aktivitas…" />
        </div>
      </div>

      {/* ── Daftar ── */}
      {galat ? (
        <PanelGalat pesan={`Gagal memuat laporan: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={6} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          <Kosong
            judul="Belum ada laporan"
            keterangan={cariTertunda || filterSales
              ? 'Tidak ada laporan yang cocok dengan penyaring saat ini. Coba longgarkan rentang tanggalnya.'
              : 'Catat aktivitas harian pertama Anda agar riwayatnya mulai terbentuk.'}
            aksi={<Tombol onClick={() => { setSedangSunting(null); setFormBuka(true); }}>+ Laporan Baru</Tombol>}
          />
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(l) => l.id}
            kolom={[
              {
                label: 'Tanggal', className: 'w-24 whitespace-nowrap',
                render: (l) => tanggalPendek(l.report_date),
              },
              {
                label: 'Customer', className: 'w-[30%]',
                render: (l) => (
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{l.customer_name}</p>
                    {l.lead_project && (
                      <p className="text-[11px] text-aksen-700 font-semibold truncate">🏷 {l.lead_project}</p>
                    )}
                  </div>
                ),
              },
              {
                label: 'Aktivitas', className: 'w-[36%]',
                render: (l) => <p className="line-clamp-2">{l.activity}</p>,
              },
              ...(pengawas ? [{
                label: 'Sales', className: 'w-36',
                render: (l: Laporan) => (
                  <Lencana label={namaSales[l.sales_user_id] ?? '—'} color="#1d4ed8" bg="#dbeafe" />
                ),
              }] : []),
            ]}
            aksi={(l) => {
              const milikSendiri = l.sales_user_id === pengguna?.id;
              return (
                <>
                  <TombolIkon rupa="lihat" label="Lihat detail" onClick={() => setDilihat(l)} />
                  {(milikSendiri || admin) && (
                    <TombolIkon rupa="sunting" label="Sunting"
                      onClick={() => { setSedangSunting(l); setFormBuka(true); }} />
                  )}
                  {admin && (
                    <TombolIkon rupa="hapus" label="Hapus" onClick={() => setAkanHapus(l)} />
                  )}
                </>
              );
            }}
          />

          <Paginasi
            halaman={halaman} totalHalaman={totalHalaman} total={total}
            onPindah={setHalaman}
          />
        </>
      )}

      {formBuka && pengguna && (
        <FormLaporan
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
        judul="Hapus laporan ini?"
        pesan={`Laporan ${akanHapus?.customer_name ?? ''} tanggal ${tanggalPendek(akanHapus?.report_date)} akan dihapus permanen.`}
        labelSetuju="Hapus"
      />

      {dilihat && (
        <Modal
          buka={Boolean(dilihat)}
          onTutup={() => setDilihat(null)}
          judul={dilihat.customer_name}
          keterangan={tanggalPendek(dilihat.report_date)}
          kaki={<Tombol rupa="kedua" onClick={() => setDilihat(null)} className="text-[12px] py-2">Tutup</Tombol>}
        >
          <div className="flex flex-col gap-3">
            {pengawas && (
              <Detail label="Sales" nilai={namaSales[dilihat.sales_user_id] ?? '—'} />
            )}
            <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3">
              <Detail label="Contact Person" nilai={dilihat.contact_person} />
              <Detail label="Jabatan" nilai={dilihat.position} />
              <Detail label="Telepon / WA" nilai={dilihat.phone_whatsapp} />
              <Detail label="Lead Project" nilai={dilihat.lead_project} />
            </div>
            <Detail label="Aktivitas" nilai={dilihat.activity} blok />
            <Detail label="Hasil" nilai={dilihat.result} blok />
            <Detail label="Next Action" nilai={dilihat.next_action} blok sorot />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Detail({ label, nilai, blok, sorot }: {
  label: string; nilai: string | null | undefined; blok?: boolean; sorot?: boolean;
}) {
  return (
    <div className={blok ? '' : 'min-w-0'}>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-[13px] mt-0.5 leading-relaxed whitespace-pre-wrap
                     ${sorot ? 'text-aksen-800 font-semibold' : 'text-slate-700'}`}>
        {nilai?.trim() || '—'}
      </p>
    </div>
  );
}

function Paginasi({ halaman, totalHalaman, total, onPindah }: {
  halaman: number; totalHalaman: number; total: number; onPindah: (h: number) => void;
}) {
  if (totalHalaman <= 1) {
    return <p className="text-[11px] text-slate-400 text-center py-2">{angka(total)} laporan</p>;
  }
  return (
    <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
      <p className="text-[11px] text-slate-500">
        Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
        <span className="font-bold tabular-nums">{totalHalaman}</span>
        <span className="text-slate-400"> · {angka(total)} laporan</span>
      </p>
      <div className="flex items-center gap-2">
        <Tombol rupa="kedua" disabled={halaman === 0}
          onClick={() => onPindah(halaman - 1)} className="text-[12px] py-2">
          Sebelumnya
        </Tombol>
        <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman}
          onClick={() => onPindah(halaman + 1)} className="text-[12px] py-2">
          Berikutnya
        </Tombol>
      </div>
    </nav>
  );
}
