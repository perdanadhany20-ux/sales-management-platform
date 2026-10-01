// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLisensi } from '@/lib/lisensi/use-lisensi';
import { tanggalPendek, waktuPendek, angka } from '@/lib/format';
import {
  DEFINISI_IMPOR, MAKS_BARIS_IMPOR, validasiBaris, type JenisImpor,
} from '@/lib/impor-data';
import { bacaBerkasImpor, unduhTemplate, type HasilBaca } from '@/lib/impor-excel';
import { Tombol, Lencana } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { Konfirmasi } from '@/components/shared/Modal';
import { useToast } from '@/components/shared/Feedback';
import { KUNCI_JENIS_IMPOR } from '@/components/shared/TombolImpor';

/**
 * Admin Panel → Impor Data. Memasukkan data lama dari Excel dalam empat
 * langkah: pilih jenis data → unduh template → unggah → periksa pratinjau
 * lalu impor. Setiap baris dinilai di sini (pratinjau) DAN di server
 * (yang menentukan); duplikat dilewati; satu kali impor bisa dibatalkan utuh.
 */

interface Akun { id: string; username: string; full_name: string; role: string; active: boolean }
interface Riwayat { id: string; jenis: JenisImpor; nama_berkas: string | null; jumlah: number; dilewati: number; dibuat_oleh: string | null; created_at: string; dibatalkan_at: string | null }
interface HasilImpor { impor_id: string | null; masuk: number; dilewati: { no: number; alasan: string }[]; ditolak: { no: number; galat: string[] }[] }

const IKON_JENIS: Record<JenisImpor, string> = { customer: '👥', daily_report: '📝', pipeline: '📈', schedule: '📅' };
const HREF_JENIS: Record<JenisImpor, string> = { customer: '/customer', daily_report: '/daily-report', pipeline: '/pipeline', schedule: '/schedule' };

export function TabImpor() {
  const toast = useToast();
  const { lisensi } = useLisensi();
  const [akun, setAkun] = useState<Akun[]>([]);
  const [jenis, setJenis] = useState<JenisImpor | null>(null);
  const [salesBawaan, setSalesBawaan] = useState('');
  const [berkas, setBerkas] = useState<File | null>(null);
  const [baca, setBaca] = useState<HasilBaca | null>(null);
  const [galatBaca, setGalatBaca] = useState<string | null>(null);
  const [membaca, setMembaca] = useState(false);
  const [hanyaMasalah, setHanyaMasalah] = useState(false);
  const [mengimpor, setMengimpor] = useState(false);
  const [hasil, setHasil] = useState<HasilImpor | null>(null);
  const [riwayat, setRiwayat] = useState<Riwayat[]>([]);
  const [akanBatal, setAkanBatal] = useState<Riwayat | null>(null);
  const [membatalkan, setMembatalkan] = useState(false);
  const [seret, setSeret] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const muatRiwayat = useCallback(async () => {
    const r = await fetch('/api/admin/impor', { credentials: 'include' });
    if (r.ok) setRiwayat(((await r.json()).riwayat ?? []) as Riwayat[]);
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/users', { credentials: 'include' });
      if (r.ok) setAkun((((await r.json()).users ?? []) as Akun[]).filter((u) => u.active));
    })();
    void muatRiwayat();
    // Dibuka dari tombol "Impor Excel" di halaman modul → jenisnya langsung terpilih.
    try {
      const j = sessionStorage.getItem(KUNCI_JENIS_IMPOR) as JenisImpor | null;
      if (j && j in DEFINISI_IMPOR) setJenis(j);
      sessionStorage.removeItem(KUNCI_JENIS_IMPOR);
    } catch { /* mode privat */ }
  }, [muatRiwayat]);

  const jenisTersedia = (Object.keys(DEFINISI_IMPOR) as JenisImpor[])
    .filter((j) => !lisensi || lisensi.fitur.includes(DEFINISI_IMPOR[j].fitur as never));
  const namaAkun = useMemo(() => Object.fromEntries(akun.map((u) => [u.id, u.full_name])), [akun]);
  const salesDulu = useMemo(() => [...akun].sort((a, b) => Number(b.role === 'SALES') - Number(a.role === 'SALES') || a.full_name.localeCompare(b.full_name)), [akun]);

  // Pratinjau: nilai setiap baris dengan aturan yang sama dengan server.
  const pratinjau = useMemo(() => {
    if (!baca || !jenis) return null;
    const peta = new Map<string, string>();
    for (const u of akun) { peta.set(u.username.toLowerCase().trim(), u.id); if (!peta.has(u.full_name.toLowerCase().trim())) peta.set(u.full_name.toLowerCase().trim(), u.id); }
    const konteks = {
      cariSales: (t: string) => peta.get(t.toLowerCase().trim().replace(/\s+/g, ' ')) ?? null,
      salesBawaan: salesBawaan || null,
      hariIni: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }),
    };
    const hasilBaris = baca.baris.map((b) => ({ ...b, r: validasiBaris(jenis, b.nilai, konteks) }));
    return { hasilBaris, siap: hasilBaris.filter((h) => h.r.ok).length, masalah: hasilBaris.filter((h) => !h.r.ok).length };
  }, [baca, jenis, akun, salesBawaan]);

  function mulaiUlang() {
    setBerkas(null); setBaca(null); setGalatBaca(null); setHasil(null); setHanyaMasalah(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function pilihBerkas(f: File | null) {
    if (!f || !jenis) return;
    setBerkas(f); setBaca(null); setGalatBaca(null); setHasil(null); setMembaca(true);
    try {
      const h = await bacaBerkasImpor(f, jenis);
      if (h.baris.length === 0) setGalatBaca('Tidak ada baris data di bawah judul kolom.');
      else if (h.baris.length > MAKS_BARIS_IMPOR) setGalatBaca(`Berkas berisi ${angka(h.baris.length)} baris — maksimal ${angka(MAKS_BARIS_IMPOR)} per berkas. Pecah menjadi beberapa berkas.`);
      setBaca(h);
    } catch (e) {
      setGalatBaca(e instanceof Error ? e.message : 'Berkas tidak bisa dibaca.');
    }
    setMembaca(false);
  }

  async function impor() {
    if (!baca || !jenis || !pratinjau) return;
    setMengimpor(true);
    const r = await fetch('/api/admin/impor', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jenis, nama_berkas: berkas?.name ?? null, sales_bawaan: salesBawaan || null, baris: baca.baris }),
    });
    const data = await r.json().catch(() => ({}));
    setMengimpor(false);
    if (!r.ok) { toast('galat', data.error ?? 'Impor gagal.'); return; }
    setHasil(data as HasilImpor);
    toast('sukses', `${angka(data.masuk)} baris masuk ke platform.`);
    void muatRiwayat();
  }

  async function batalkan() {
    if (!akanBatal) return;
    setMembatalkan(true);
    const r = await fetch(`/api/admin/impor?id=${akanBatal.id}`, { method: 'DELETE', credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    setMembatalkan(false);
    if (!r.ok) { toast('galat', data.error ?? 'Gagal membatalkan.'); return; }
    toast('sukses', 'Impor dibatalkan — datanya sudah dihapus.');
    setAkanBatal(null);
    void muatRiwayat();
  }

  const def = jenis ? DEFINISI_IMPOR[jenis] : null;
  const ditampilkan = (pratinjau?.hasilBaris ?? []).filter((h) => !hanyaMasalah || !h.r.ok).slice(0, 200);
  const kolomPratinjau = def ? def.kolom.filter((k) => baca?.dikenali.some((d) => d.kunci === k.kunci) || (k.tipe === 'sales' && salesBawaan)).slice(0, 5) : [];

  return (
    <div className="flex flex-col gap-4">

      {/* ── Langkah 1: jenis data ── */}
      <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 flex flex-col gap-3">
        <Judul nomor={1} judul="Pilih jenis data yang akan dimasukkan" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {jenisTersedia.map((j) => {
            const d = DEFINISI_IMPOR[j];
            const aktif = j === jenis;
            return (
              <button key={j} type="button" onClick={() => { setJenis(j); mulaiUlang(); }}
                aria-pressed={aktif}
                className={`text-left rounded-kontrol border px-3 py-3 transition-colors min-h-[44px]
                  ${aktif ? 'border-aksen-500 bg-aksen-50 ring-2 ring-aksen-600/15' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className="text-[18px]" aria-hidden="true">{IKON_JENIS[j]}</span>
                <span className="block text-[13px] font-bold text-slate-800 mt-1">{d.label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{d.keterangan}</span>
              </button>
            );
          })}
        </div>
      </section>

      {def && jenis && (
        <>
          {/* ── Langkah 2: template ── */}
          <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 flex flex-col gap-3">
            <Judul nomor={2} judul="Siapkan berkas Excel" />
            <p className="text-[12px] text-slate-600 leading-relaxed">
              Pakai template supaya kolomnya pasti cocok — atau langsung unggah spreadsheet lama Anda:
              judul kolom dikenali dari sebutan umum (mis. <i>Tgl</i>, <i>Perusahaan</i>, <i>Kegiatan</i>).
              Kolom wajib: <b>{def.kolom.filter((k) => k.wajib).map((k) => k.judul).join(', ')}</b>
              {def.kolom.some((k) => k.tipe === 'sales') && ', dan Sales (atau pilih Pemilik bawaan di langkah 3)'}.
            </p>
            <div>
              <Tombol rupa="kedua" onClick={() => void unduhTemplate(jenis, salesDulu.map((u) => ({ username: u.username, full_name: u.full_name })))
                .catch((e: unknown) => { console.error(e); toast('galat', `Gagal membuat template: ${e instanceof Error ? e.message : String(e)}`); })}>
                ⬇ Unduh Template {def.label}
              </Tombol>
            </div>
          </section>

          {/* ── Langkah 3: unggah ── */}
          <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 flex flex-col gap-3">
            <Judul nomor={3} judul="Unggah berkas" />
            <div className="flex flex-col gap-1 max-w-sm">
              <label htmlFor="impor-sales" className="text-[11px] font-semibold text-slate-600">Pemilik bawaan (opsional)</label>
              <PilihCari id="impor-sales" nilai={salesBawaan} onUbah={setSalesBawaan} bolehKosong labelKosong="Tidak ada — pakai kolom Sales"
                opsi={salesDulu.map((u) => ({ value: u.id, label: `${u.full_name} (@${u.username})` }))} />
              <p className="text-[10.5px] text-slate-400">Dipakai untuk baris yang kolom Sales-nya kosong — praktis bila satu berkas milik satu Sales.</p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setSeret(true); }}
              onDragLeave={() => setSeret(false)}
              onDrop={(e) => { e.preventDefault(); setSeret(false); void pilihBerkas(e.dataTransfer.files?.[0] ?? null); }}
              className={`rounded-kartu border-2 border-dashed px-4 py-6 text-center transition-colors
                ${seret ? 'border-aksen-500 bg-aksen-50' : 'border-slate-300 bg-slate-50'}`}>
              <p className="text-[13px] font-bold text-slate-700">{berkas ? berkas.name : 'Seret berkas ke sini'}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">.xlsx atau .csv · maksimal {angka(MAKS_BARIS_IMPOR)} baris</p>
              <div className="mt-3 flex justify-center gap-2">
                <Tombol onClick={() => inputRef.current?.click()} memuat={membaca}>{berkas ? 'Ganti Berkas' : 'Pilih Berkas'}</Tombol>
                {berkas && <Tombol rupa="kedua" onClick={mulaiUlang}>Hapus</Tombol>}
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" aria-label="Pilih berkas Excel"
                onChange={(e) => void pilihBerkas(e.target.files?.[0] ?? null)} />
            </div>
            {galatBaca && <p role="alert" className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2">{galatBaca}</p>}
          </section>

          {/* ── Langkah 4: pratinjau & impor ── */}
          {baca && pratinjau && !galatBaca && (
            <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 flex flex-col gap-3">
              <Judul nomor={4} judul="Periksa, lalu impor" />

              <div className="flex flex-wrap gap-2">
                <Lencana label={`${angka(baca.baris.length)} baris dibaca`} color="#1d4ed8" bg="#dbeafe" />
                <Lencana label={`${angka(pratinjau.siap)} siap masuk`} color="#008300" bg="#e0f2e0" />
                {pratinjau.masalah > 0 && <Lencana label={`${angka(pratinjau.masalah)} bermasalah`} color="#e34948" bg="#fce3e3" />}
              </div>

              <p className="text-[11.5px] text-slate-500">
                Kolom dikenali: {baca.dikenali.map((d) => `${d.judul} → ${def.kolom.find((k) => k.kunci === d.kunci)?.judul}`).join(' · ')}
                {baca.diabaikan.length > 0 && <span className="block text-slate-400">Diabaikan: {baca.diabaikan.join(', ')}</span>}
              </p>
              {baca.hilang.length > 0 && (
                <p className="text-[12px] text-[#8f2c2b] bg-[#fce3e3] rounded-kontrol px-3 py-2">
                  Kolom wajib tidak ditemukan: <b>{baca.hilang.join(', ')}</b>. Tambahkan kolom itu di berkas (lihat template), lalu unggah ulang.
                </p>
              )}

              {pratinjau.masalah > 0 && (
                <label className="flex items-center gap-2 text-[12px] text-slate-600 min-h-[32px]">
                  <input type="checkbox" checked={hanyaMasalah} onChange={(e) => setHanyaMasalah(e.target.checked)} className="w-4 h-4" />
                  Tampilkan hanya baris bermasalah
                </label>
              )}

              {/* Tabel pratinjau melebar penuh; di layar sempit tiap baris jadi kartu. */}
              <ul className="flex flex-col gap-1.5">
                {ditampilkan.map((h) => (
                  <li key={h.no} className={`rounded-kontrol border px-3 py-2 ${h.r.ok ? 'border-slate-200' : 'border-[#f3b8b7] bg-[#fff7f7]'}`}>
                    <div className="flex items-start gap-2">
                      <span className={`text-[11px] font-black w-5 flex-shrink-0 ${h.r.ok ? 'text-[#008300]' : 'text-[#e34948]'}`} aria-label={h.r.ok ? 'siap' : 'bermasalah'}>{h.r.ok ? '✓' : '!'}</span>
                      <span className="text-[11px] font-bold text-slate-400 w-14 flex-shrink-0">Baris {h.no}</span>
                      <span className="min-w-0 flex-1 text-[12px] text-slate-700">
                        {kolomPratinjau.map((k) => {
                          const v = k.tipe === 'sales' ? (h.r.ok ? namaAkun[h.r.baris.sales_user_id] : h.nilai[k.kunci]) : h.nilai[k.kunci];
                          return v ? <span key={k.kunci} className="mr-3"><span className="text-slate-400">{k.judul}:</span> {String(v)}</span> : null;
                        })}
                        {!h.r.ok && <span className="block text-[11.5px] text-[#8f2c2b] mt-0.5">{h.r.galat.join(' ')}</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {(hanyaMasalah ? pratinjau.masalah : baca.baris.length) > 200 && (
                <p className="text-[11px] text-slate-400">Menampilkan 200 baris pertama.</p>
              )}

              {!hasil ? (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Tombol onClick={impor} memuat={mengimpor} disabled={pratinjau.siap === 0 || baca.hilang.length > 0}>
                    Impor {angka(pratinjau.siap)} baris
                  </Tombol>
                  <p className="text-[11px] text-slate-500 leading-snug max-w-xl">
                    {pratinjau.masalah > 0 ? `${angka(pratinjau.masalah)} baris bermasalah akan dilewati — perbaiki di Excel lalu unggah ulang kapan saja. ` : ''}
                    Data yang sudah ada di platform otomatis dilewati. Impor ini bisa dibatalkan utuh dari Riwayat Impor.
                  </p>
                </div>
              ) : (
                <div className="rounded-kartu border border-[#b7e0b7] bg-[#f3fbf3] p-3 flex flex-col gap-2">
                  <p className="text-[13px] font-bold text-[#0f5f0f]">
                    Selesai — {angka(hasil.masuk)} baris masuk ke platform.
                  </p>
                  <p className="text-[12px] text-slate-600">
                    {hasil.dilewati.length > 0 && `${angka(hasil.dilewati.length)} dilewati karena sudah ada. `}
                    {hasil.ditolak.length > 0 && `${angka(hasil.ditolak.length)} ditolak (lihat daftar di atas). `}
                  </p>
                  {hasil.dilewati.length > 0 && (
                    <details className="text-[11.5px] text-slate-500">
                      <summary className="cursor-pointer font-semibold">Baris yang dilewati</summary>
                      <p className="mt-1">{hasil.dilewati.map((d) => `Baris ${d.no}`).join(', ')}</p>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Link href={HREF_JENIS[jenis]} className="inline-flex items-center rounded-kontrol bg-aksen-700 text-white px-3 py-2 text-[12px] font-bold">
                      Buka {def.label} →
                    </Link>
                    <Tombol rupa="kedua" onClick={mulaiUlang} className="text-[12px] py-2">Impor berkas lain</Tombol>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Riwayat ── */}
      <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 flex flex-col gap-3">
        <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Riwayat Impor</h2>
        {riwayat.length === 0 ? (
          <p className="text-[12px] text-slate-400">Belum pernah ada impor.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {riwayat.map((r) => (
              <li key={r.id} className="rounded-kontrol border border-slate-200 px-3 py-2 flex items-center gap-3 flex-wrap">
                <span className="text-[16px]" aria-hidden="true">{IKON_JENIS[r.jenis]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-slate-800 truncate">
                    {DEFINISI_IMPOR[r.jenis]?.label} · {angka(r.jumlah)} baris
                    {r.dibatalkan_at && <span className="ml-2"><Lencana label="Dibatalkan" color="#e34948" bg="#fce3e3" /></span>}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {r.nama_berkas ?? 'tanpa nama'} · {tanggalPendek(r.created_at)} {waktuPendek(r.created_at)}
                    {r.dibuat_oleh && namaAkun[r.dibuat_oleh] ? ` · ${namaAkun[r.dibuat_oleh]}` : ''}
                    {r.dilewati > 0 ? ` · ${angka(r.dilewati)} dilewati` : ''}
                  </span>
                </span>
                {!r.dibatalkan_at && (
                  <Tombol rupa="kedua" onClick={() => setAkanBatal(r)} className="text-[12px] py-1.5">Batalkan</Tombol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Konfirmasi
        buka={Boolean(akanBatal)}
        onTutup={() => setAkanBatal(null)}
        onSetuju={batalkan}
        memproses={membatalkan}
        bahaya
        judul="Batalkan impor ini?"
        pesan={`${angka(akanBatal?.jumlah ?? 0)} baris ${akanBatal ? DEFINISI_IMPOR[akanBatal.jenis]?.label : ''} dari berkas "${akanBatal?.nama_berkas ?? ''}" akan dihapus permanen. Customer yang terbentuk dari impor ini ikut dihapus bila belum dipakai catatan lain. Data yang diketik langsung di platform tidak tersentuh.`}
        labelSetuju="Batalkan Impor"
      />
    </div>
  );
}

function Judul({ nomor, judul }: { nomor: number; judul: string }) {
  return (
    <h2 className="flex items-center gap-2 text-[13.5px] font-black text-slate-900">
      <span className="w-6 h-6 rounded-full bg-aksen-700 text-white grid place-items-center text-[11px] font-black flex-shrink-0">{nomor}</span>
      {judul}
    </h2>
  );
}
