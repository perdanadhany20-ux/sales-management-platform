// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif } from '@/lib/auth';
import { useFokusBaris } from '@/lib/fokus';
import { isPengawas, isAdmin } from '@/lib/constants';
import { tanggalPendek, rupiah, rupiahRingkas, angka, polaIlike } from '@/lib/format';
import { KEHANGATAN, kehangatan, type CustomerRingkasan, type Kehangatan } from '@/lib/customer';
import { BentoGrid, BentoCard, AngkaJangkar, BarisBento } from '@/components/shared/Bento';
import { DonutLegenda } from '@/components/shared/Charts';
import { Tombol, Teks, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Kosong, KerangkaBaris, PanelGalat, useToast } from '@/components/shared/Feedback';
import { Konfirmasi } from '@/components/shared/Modal';
import { Tabel, TombolIkon } from '@/components/shared/Tabel';
import { TombolEkspor } from '@/components/shared/TombolEkspor';
import { TombolImpor } from '@/components/shared/TombolImpor';
import { selTanggal, BATAS_BARIS_EKSPOR } from '@/lib/ekspor-excel';
import { FormCustomer } from './_components/FormCustomer';
import { PanelCustomer } from './_components/PanelCustomer';
import { pesanGalat } from '@/lib/pesan-galat';

/**
 * Customer — data master pelanggan beserta riwayatnya (migrasi 042).
 *
 * Sebelum menu ini ada, customer hanya lahir diam-diam dari isian laporan,
 * pipeline, dan jadwal; tidak ada tempat untuk menjawab "customer ini sudah
 * kita apakan saja?" atau "siapa yang lama tidak kita kunjungi?". Di sini
 * setiap customer membawa angka penjualan, jumlah meeting & laporan, dan
 * penanda kehangatan (kapan terakhir disentuh), lengkap dengan kontak yang
 * bisa langsung ditelepon atau di-WhatsApp dari HP.
 *
 * Isolasi tetap dari RLS: Sales melihat customer miliknya, atasan melihat
 * milik timnya, Admin melihat semuanya. Hanya Admin yang boleh menghapus.
 */

const PER_HALAMAN = 20;

/** Bagian query builder Supabase yang dipakai penyaring di halaman ini. */
interface Penyaring {
  eq(k: string, v: string): Penyaring;
  gte(k: string, v: string): Penyaring;
  lt(k: string, v: string): Penyaring;
  is(k: string, v: null): Penyaring;
  or(s: string): Penyaring;
}

export default function HalamanCustomer() {
  const { pengguna } = usePenggunaAktif();
  const toast = useToast();
  const pengawas = isPengawas(pengguna?.role);
  const admin = isAdmin(pengguna?.role);

  const [daftar, setDaftar] = useState<CustomerRingkasan[]>([]);
  const [ringkasSemua, setRingkasSemua] = useState<Pick<CustomerRingkasan, 'aktivitas_terakhir' | 'nilai_terbuka' | 'nilai_won'>[]>([]);
  const [namaOrang, setNamaOrang] = useState<Record<string, string>>({});
  const [daftarSales, setDaftarSales] = useState<{ id: string; full_name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const [halaman, setHalaman] = useState(0);
  const [filterPemilik, setFilterPemilik] = useState('');
  const [filterHangat, setFilterHangat] = useState('');
  const [urutan, setUrutan] = useState('aktivitas');
  const [cari, setCari] = useState('');
  const [cariTertunda, setCariTertunda] = useState('');

  const [formBuka, setFormBuka] = useState(false);
  const [sedangSunting, setSedangSunting] = useState<CustomerRingkasan | null>(null);
  const [dibuka, setDibuka] = useState<CustomerRingkasan | null>(null);
  const [akanHapus, setAkanHapus] = useState<CustomerRingkasan | null>(null);
  const [menghapus, setMenghapus] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setCariTertunda(cari); setHalaman(0); }, 350);
    return () => clearTimeout(t);
  }, [cari]);

  /** Penyaring kehangatan diterjemahkan ke rentang tanggal aktivitas terakhir. */
  const terapkan = useCallback(<Q,>(asal: Q): Q => {
    let q = asal as unknown as Penyaring;
    const hari = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); };
    if (filterPemilik) q = q.eq('created_by', filterPemilik);
    if (filterHangat === 'AKTIF') q = q.gte('aktivitas_terakhir', hari(14));
    if (filterHangat === 'SAPA') q = q.lt('aktivitas_terakhir', hari(14)).gte('aktivitas_terakhir', hari(45));
    if (filterHangat === 'DINGIN') q = q.lt('aktivitas_terakhir', hari(45));
    if (filterHangat === 'BARU') q = q.is('aktivitas_terakhir', null);
    if (cariTertunda.trim()) {
      const k = polaIlike(cariTertunda.trim());
      q = q.or(`name.ilike.${k},city.ilike.${k},contact_person.ilike.${k},segment.ilike.${k},kontak_terakhir.ilike.${k}`);
    }
    return q as unknown as Q;
  }, [filterPemilik, filterHangat, cariTertunda]);

  const urutkan = useMemo(() => ({
    aktivitas: { kolom: 'aktivitas_terakhir', naik: false },
    nama: { kolom: 'name', naik: true },
    terbuka: { kolom: 'nilai_terbuka', naik: false },
    menang: { kolom: 'nilai_won', naik: false },
    baru: { kolom: 'created_at', naik: false },
  } as Record<string, { kolom: string; naik: boolean }>)[urutan], [urutan]);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    const q = terapkan(supabase.from('sm_customer_ringkasan').select('*', { count: 'exact' }))
      .order(urutkan.kolom, { ascending: urutkan.naik, nullsFirst: false })
      .order('name', { ascending: true })
      .range(halaman * PER_HALAMAN, halaman * PER_HALAMAN + PER_HALAMAN - 1);
    // Kartu ringkasan dihitung dari SELURUH customer yang boleh dilihat,
    // bukan dari 20 baris halaman ini.
    const qRingkas = supabase.from('sm_customer_ringkasan').select('aktivitas_terakhir, nilai_terbuka, nilai_won').limit(5000);
    const [{ data, error, count }, rs] = await Promise.all([q, filterPemilik ? qRingkas.eq('created_by', filterPemilik) : qRingkas]);
    if (error) { setGalat(pesanGalat(error)); setMemuat(false); return; }
    setDaftar((data ?? []) as CustomerRingkasan[]);
    setTotal(count ?? 0);
    setRingkasSemua((rs.data ?? []) as typeof ringkasSemua);
    setMemuat(false);
  }, [terapkan, urutkan, halaman, filterPemilik]);

  useEffect(() => { void muat(); }, [muat]);

  const bukaDariFokus = useCallback(async (id: string) => {
    const ada = daftar.find((x) => x.id === id);
    if (ada) { setDibuka(ada); return; }
    const { data } = await supabase.from('sm_customer_ringkasan').select('*').eq('id', id).maybeSingle();
    if (data) setDibuka(data as CustomerRingkasan);
  }, [daftar]);
  useFokusBaris(!memuat, (id) => { void bukaDariFokus(id); });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('users').select('id, full_name, role').eq('active', true).order('full_name');
      const semua = (data ?? []) as { id: string; full_name: string; role: string }[];
      setNamaOrang(Object.fromEntries(semua.map((u) => [u.id, u.full_name])));
      setDaftarSales(semua);
    })();
  }, []);

  const ambilSemua = useCallback(async () => {
    const { data, error } = await terapkan(supabase.from('sm_customer_ringkasan').select('*'))
      .order(urutkan.kolom, { ascending: urutkan.naik, nullsFirst: false }).limit(BATAS_BARIS_EKSPOR + 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as CustomerRingkasan[];
  }, [terapkan, urutkan]);

  const ringkas = useMemo(() => {
    const per: Record<Kehangatan, number> = { AKTIF: 0, SAPA: 0, DINGIN: 0, BARU: 0 };
    for (const c of ringkasSemua) per[kehangatan(c)] += 1;
    return {
      per,
      jumlah: ringkasSemua.length,
      terbuka: ringkasSemua.reduce((t, c) => t + Number(c.nilai_terbuka ?? 0), 0),
      menang: ringkasSemua.reduce((t, c) => t + Number(c.nilai_won ?? 0), 0),
    };
  }, [ringkasSemua]);

  async function hapus() {
    if (!akanHapus) return;
    setMenghapus(true);
    const { error } = await supabase.from('sm_customers').delete().eq('id', akanHapus.id);
    setMenghapus(false);
    if (error) { toast('galat', `Gagal menghapus: ${pesanGalat(error)}`); return; }
    toast('sukses', 'Customer dihapus.');
    setAkanHapus(null);
    void muat();
  }

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const bolehSunting = (c: CustomerRingkasan) => admin || c.created_by === pengguna?.id;
  const terbuka = useMemo(() => (dibuka ? daftar.find((c) => c.id === dibuka.id) ?? dibuka : null), [dibuka, daftar]);
  const baru = () => { setSedangSunting(null); setFormBuka(true); };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Customer</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
            Data pelanggan, kontaknya, dan seluruh riwayat — siapa yang aktif, siapa yang perlu disapa lagi.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TombolImpor jenis="customer" />
          <TombolEkspor
            ambil={ambilSemua}
            susun={(baris) => ({
              namaBerkas: 'customer',
              namaSheet: 'Customer',
              judul: 'Daftar Customer',
              keterangan: [
                filterPemilik ? `Pemilik: ${namaOrang[filterPemilik] ?? '—'}` : 'Pemilik: semua yang boleh Anda lihat',
                filterHangat ? `Kehangatan: ${KEHANGATAN[filterHangat as Kehangatan].label}` : 'Kehangatan: semua',
              ],
              kolom: [
                { judul: 'Customer', lebar: 30, nilai: (c) => c.name },
                { judul: 'Segmen', lebar: 16, nilai: (c) => c.segment ?? '' },
                { judul: 'Kota', lebar: 16, nilai: (c) => c.city ?? '' },
                { judul: 'Kontak', lebar: 22, nilai: (c) => c.contact_person ?? c.kontak_terakhir ?? '' },
                { judul: 'Jabatan', lebar: 18, nilai: (c) => c.contact_position ?? c.jabatan_terakhir ?? '' },
                { judul: 'Telepon', lebar: 16, nilai: (c) => c.phone ?? c.telepon_terakhir ?? '' },
                { judul: 'Email', lebar: 24, nilai: (c) => c.email ?? '' },
                { judul: 'Alamat', lebar: 30, nilai: (c) => c.address ?? '' },
                { judul: 'Pemilik', lebar: 18, nilai: (c) => (c.created_by ? namaOrang[c.created_by] ?? '—' : '—') },
                { judul: 'Peluang', format: 'angka', lebar: 10, nilai: (c) => Number(c.jumlah_pipeline) },
                { judul: 'Pipeline Terbuka (Rp)', format: 'rupiah', lebar: 20, nilai: (c) => Number(c.nilai_terbuka) },
                { judul: 'Nilai WON (Rp)', format: 'rupiah', lebar: 18, nilai: (c) => Number(c.nilai_won) },
                { judul: 'Meeting Selesai', format: 'angka', lebar: 14, nilai: (c) => Number(c.jadwal_selesai) },
                { judul: 'Laporan', format: 'angka', lebar: 10, nilai: (c) => Number(c.jumlah_laporan) },
                { judul: 'Aktivitas Terakhir', format: 'tanggal', lebar: 16, nilai: (c) => selTanggal(c.aktivitas_terakhir) },
                { judul: 'Kehangatan', lebar: 18, nilai: (c) => KEHANGATAN[kehangatan(c)].label },
              ],
              baris,
              ringkasan: [
                { label: 'Jumlah customer', nilai: baris.length },
                { label: 'Total pipeline terbuka (Rp)', nilai: baris.reduce((t, c) => t + Number(c.nilai_terbuka ?? 0), 0) },
                { label: 'Total nilai WON (Rp)', nilai: baris.reduce((t, c) => t + Number(c.nilai_won ?? 0), 0) },
              ],
            })}
          />
          <Tombol onClick={baru}>+ Customer Baru</Tombol>
        </div>
      </header>

      <BentoGrid>
        <BentoCard rentang={3} tinggi="pendek" rupa="sorot" judul="Customer">
          <AngkaJangkar terang nilai={angka(ringkas.jumlah)}
            keterangan={`${angka(ringkas.per.AKTIF)} aktif dalam 14 hari terakhir`} />
        </BentoCard>
        <BentoCard rentang={3} tinggi="pendek" judul="Pipeline Terbuka">
          <AngkaJangkar nilai={rupiahRingkas(ringkas.terbuka)} keterangan={`Sudah menang ${rupiahRingkas(ringkas.menang)}`} />
        </BentoCard>
        <BentoCard rentang={6} tinggi={ringkas.jumlah === 0 ? 'pendek' : 'sedang'} judul="Kehangatan Customer">
          {ringkas.jumlah === 0 ? (
            <p className="text-slate-400 text-[13px] py-1">Belum ada data</p>
          ) : (
            <div className="flex flex-col gap-2">
              <DonutLegenda judul="" ukuran={112} nilaiTengah={ringkas.jumlah} labelTengah="CUSTOMER"
                data={(Object.keys(KEHANGATAN) as Kehangatan[])
                  .map((k) => ({ label: KEHANGATAN[k].label, value: ringkas.per[k], color: KEHANGATAN[k].color }))
                  .filter((d) => d.value > 0)} />
              {ringkas.per.DINGIN + ringkas.per.SAPA > 0 && (
                <button type="button" onClick={() => { setFilterHangat(ringkas.per.DINGIN > 0 ? 'DINGIN' : 'SAPA'); setHalaman(0); }} className="text-left">
                  <BarisBento warna="#e34948"
                    kiri={<>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">Perlu dihubungi lagi</p>
                      <p className="text-[10px] text-slate-500 leading-tight mt-0.5">Lebih dari 14 hari tanpa laporan, pipeline, atau meeting. Ketuk untuk melihat.</p>
                    </>}
                    kanan={<span className="text-sm font-black text-slate-700 tabular-nums">{ringkas.per.DINGIN + ringkas.per.SAPA}</span>} />
                </button>
              )}
            </div>
          )}
        </BentoCard>
      </BentoGrid>

      {/* ── Penyaring ── */}
      <div className="bg-white rounded-kartu border border-slate-200 p-3 sm:p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[170px]">
          <label htmlFor="cu-hangat" className="text-[11px] font-semibold text-slate-600">Kehangatan</label>
          <PilihCari id="cu-hangat" nilai={filterHangat} onUbah={(v) => { setFilterHangat(v); setHalaman(0); }}
            bolehKosong labelKosong="Semua"
            opsi={(Object.keys(KEHANGATAN) as Kehangatan[]).map((k) => ({ value: k, label: KEHANGATAN[k].label }))} />
        </div>
        {pengawas && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label htmlFor="cu-pemilik" className="text-[11px] font-semibold text-slate-600">Pemilik</label>
            <PilihCari id="cu-pemilik" nilai={filterPemilik} onUbah={(v) => { setFilterPemilik(v); setHalaman(0); }}
              bolehKosong labelKosong="Semua"
              opsi={daftarSales.map((s) => ({ value: s.id, label: s.full_name }))} />
          </div>
        )}
        <div className="flex flex-col gap-1 min-w-[170px]">
          <label htmlFor="cu-urut" className="text-[11px] font-semibold text-slate-600">Urutkan</label>
          <PilihCari id="cu-urut" nilai={urutan} onUbah={(v) => { setUrutan(v || 'aktivitas'); setHalaman(0); }}
            opsi={[
              { value: 'aktivitas', label: 'Aktivitas terbaru' },
              { value: 'nama', label: 'Nama A–Z' },
              { value: 'terbuka', label: 'Pipeline terbuka terbesar' },
              { value: 'menang', label: 'Nilai WON terbesar' },
              { value: 'baru', label: 'Baru ditambahkan' },
            ]} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="cu-cari" className="text-[11px] font-semibold text-slate-600">Cari</label>
          <Teks id="cu-cari" type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Nama, kota, kontak, atau segmen…" />
        </div>
      </div>

      {galat ? (
        <PanelGalat pesan={`Gagal memuat customer: ${galat}`} onCoba={muat} />
      ) : memuat ? (
        <KerangkaBaris jumlah={5} />
      ) : daftar.length === 0 ? (
        <div className="bg-white rounded-kartu border border-slate-200">
          {cariTertunda || filterHangat || filterPemilik ? (
            <Kosong judul="Tidak ada yang cocok" keterangan="Coba ubah kata pencarian atau penyaringnya."
              aksi={<Tombol rupa="kedua" onClick={() => { setCari(''); setFilterHangat(''); setFilterPemilik(''); }}>Hapus penyaring</Tombol>} />
          ) : (
            <Kosong judul="Belum ada customer"
              keterangan="Customer juga otomatis bertambah saat Anda mengisi laporan harian, pipeline, atau jadwal dengan nama baru."
              aksi={<Tombol onClick={baru}>+ Customer Baru</Tombol>} />
          )}
        </div>
      ) : (
        <>
          <Tabel
            data={daftar}
            kunci={(c) => c.id}
            kolom={[
              {
                label: 'Customer', className: 'w-[30%]',
                urut: (c) => c.name,
                render: (c) => {
                  const h = KEHANGATAN[kehangatan(c)];
                  return (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button type="button" onClick={() => setDibuka(c)} className="font-bold text-slate-900 truncate hover:text-aksen-700 text-left">{c.name}</button>
                        <Lencana label={h.label} color={h.color} bg={h.bg} />
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        {[c.segment, c.city].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  );
                },
              },
              {
                label: 'Kontak', className: 'w-[22%]',
                render: (c) => {
                  const k = c.contact_person ?? c.kontak_terakhir;
                  const t = c.phone ?? c.telepon_terakhir;
                  return k || t ? (
                    <div className="min-w-0 text-[12px]">
                      <p className="font-semibold text-slate-700 truncate">{k ?? '—'}</p>
                      {t && <p className="text-[11px] text-slate-500 truncate">{t}</p>}
                    </div>
                  ) : <span className="text-[11px] text-slate-400">Belum ada</span>;
                },
              },
              {
                label: 'Catatan', className: 'w-[22%]',
                render: (c) => (
                  <span className="text-[11px] text-slate-500">
                    {angka(c.jumlah_pipeline)} peluang · {angka(c.jadwal_selesai)}/{angka(c.jumlah_jadwal)} meeting · {angka(c.jumlah_laporan)} laporan
                    {c.aktivitas_terakhir && <span className="block text-slate-400">terakhir {tanggalPendek(c.aktivitas_terakhir)}</span>}
                  </span>
                ),
              },
              {
                label: 'Terbuka / WON', className: 'w-40 text-right',
                urut: (c) => Number(c.nilai_terbuka),
                render: (c) => (
                  <div className="text-right">
                    <p className="font-bold text-slate-900 tabular-nums">{rupiah(c.nilai_terbuka)}</p>
                    {Number(c.nilai_won) > 0 && (
                      <p className="text-[11px] font-semibold tabular-nums text-[#008300]">WON {rupiahRingkas(c.nilai_won)}</p>
                    )}
                  </div>
                ),
              },
              ...(pengawas ? [{
                label: 'Pemilik', className: 'w-32',
                render: (c: CustomerRingkasan) => (
                  <Lencana label={(c.created_by && namaOrang[c.created_by]) || '—'} color="#1d4ed8" bg="#dbeafe" />
                ),
              }] : []),
            ]}
            aksi={(c) => (
              <>
                <TombolIkon rupa="lihat" label="Lihat riwayat" onClick={() => setDibuka(c)} />
                {bolehSunting(c) && (
                  <TombolIkon rupa="sunting" label="Sunting" onClick={() => { setSedangSunting(c); setFormBuka(true); }} />
                )}
                {admin && <TombolIkon rupa="hapus" label="Hapus" onClick={() => setAkanHapus(c)} />}
              </>
            )}
          />

          {totalHalaman > 1 ? (
            <nav className="flex items-center justify-between gap-3 py-1" aria-label="Paginasi">
              <p className="text-[11px] text-slate-500">
                Halaman <span className="font-bold tabular-nums">{halaman + 1}</span> dari{' '}
                <span className="font-bold tabular-nums">{totalHalaman}</span>
                <span className="text-slate-400"> · {angka(total)} customer</span>
              </p>
              <div className="flex items-center gap-2">
                <Tombol rupa="kedua" disabled={halaman === 0} onClick={() => setHalaman(halaman - 1)} className="text-[12px] py-2">Sebelumnya</Tombol>
                <Tombol rupa="kedua" disabled={halaman + 1 >= totalHalaman} onClick={() => setHalaman(halaman + 1)} className="text-[12px] py-2">Berikutnya</Tombol>
              </div>
            </nav>
          ) : (
            <p className="text-[11px] text-slate-400 text-center py-1">{angka(total)} customer</p>
          )}
        </>
      )}

      {formBuka && (
        <FormCustomer buka={formBuka} onTutup={() => setFormBuka(false)} onTersimpan={muat} awal={sedangSunting} />
      )}

      {terbuka && (
        <PanelCustomer
          buka={Boolean(dibuka)}
          onTutup={() => setDibuka(null)}
          customer={terbuka}
          namaOrang={namaOrang}
          bolehSunting={bolehSunting(terbuka)}
          onSunting={() => { setSedangSunting(terbuka); setDibuka(null); setFormBuka(true); }}
        />
      )}

      <Konfirmasi
        buka={Boolean(akanHapus)}
        onTutup={() => setAkanHapus(null)}
        onSetuju={hapus}
        memproses={menghapus}
        bahaya
        judul="Hapus customer ini?"
        pesan={`${akanHapus?.name ?? ''} akan dihapus dari daftar customer. Laporan, pipeline, jadwal, dan proyek yang memakai nama ini TIDAK ikut terhapus — hanya kehilangan tautannya ke data master.`}
        labelSetuju="Hapus"
      />
    </div>
  );
}
