'use client';

import { useState } from 'react';
import { tanggalPendek, waktuPendek } from '@/lib/format';
import { Tombol, Lencana, AreaTeks, Kolom, Pilihan, Teks } from '@/components/shared/FormParts';
import { Kosong, KerangkaKartu, useToast } from '@/components/shared/Feedback';
import { useLisensi, type Lisensi } from '@/lib/lisensi/use-lisensi';
import {
  KUNCI_FITUR, LABEL_PAKET, PAKET, REGISTRY_FITUR, paketMinimum,
  type JenisPermintaan, type KunciFitur, type Paket, type StatusLisensi, type StatusPermintaan,
} from '@/lib/lisensi/kontrak';

/**
 * Admin → Lisensi.
 *
 * Menjawab enam pertanyaan Admin pelanggan (§25): lisensi apa yang saya
 * punya, fitur apa yang tercakup, kapan berakhir, apakah sedang menunggu
 * persetujuan, apakah ditolak, dan kenapa sebuah fitur tidak tersedia.
 *
 * Halaman ini TIDAK bisa mengubah lisensi. Yang bisa dilakukan hanya
 * mengajukan permintaan ke penyedia platform; keputusannya datang dari
 * License Authority dan baru berlaku setelah terverifikasi.
 */

const WARNA_STATUS: Record<StatusLisensi, { label: string; color: string; bg: string }> = {
  ACTIVE:        { label: 'AKTIF',            color: '#006b00', bg: '#e0f2e0' },
  EXPIRING_SOON: { label: 'SEGERA BERAKHIR',  color: '#7a5300', bg: '#fff4d6' },
  PENDING:       { label: 'MENUNGGU',         color: '#1e40af', bg: '#e0e8fb' },
  EXPIRED:       { label: 'BERAKHIR',         color: '#8f2c2b', bg: '#fce3e3' },
  SUSPENDED:     { label: 'DITANGGUHKAN',     color: '#7a5300', bg: '#fde9c4' },
  REVOKED:       { label: 'DICABUT',          color: '#475569', bg: '#e2e8f0' },
  REPLACED:      { label: 'DIGANTI',          color: '#475569', bg: '#e2e8f0' },
};

const WARNA_PERMINTAAN: Record<StatusPermintaan, { label: string; color: string; bg: string }> = {
  DRAFT:            { label: 'Draf',             color: '#475569', bg: '#f1f5f9' },
  PENDING_APPROVAL: { label: 'Menunggu',         color: '#1e40af', bg: '#e0e8fb' },
  APPROVED:         { label: 'Disetujui',        color: '#006b00', bg: '#e0f2e0' },
  REJECTED:         { label: 'Tidak disetujui',  color: '#8f2c2b', bg: '#fce3e3' },
  CANCELLED:        { label: 'Dibatalkan',       color: '#475569', bg: '#f1f5f9' },
};

const LABEL_JENIS: Record<JenisPermintaan, string> = {
  NEW: 'Lisensi baru',
  EXTENSION: 'Perpanjangan',
  CHANGE_PACKAGE: 'Perubahan paket',
};

const DURASI = [
  { hari: 30, label: '1 Bulan' },
  { hari: 90, label: '3 Bulan' },
  { hari: 180, label: '6 Bulan' },
  { hari: 365, label: '1 Tahun' },
  { hari: 730, label: '2 Tahun' },
];

function tanggalPanjang(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function TabLisensi() {
  const { lisensi, muatUlang } = useLisensi();

  if (!lisensi) return <KerangkaKartu tinggi={260} />;

  const d = lisensi.detail;
  const belumAktivasi = Boolean(d && !d.dikonfigurasi && !lisensi.mode_pengembangan);
  // Lisensi DICABUT bersifat final: tidak bisa diperpanjang — yang dibutuhkan
  // adalah lisensi baru (Kode Aktivasi baru), sama seperti platform yang belum punya kode.
  const perluLisensiBaru = !belumAktivasi && (lisensi.status === 'REVOKED' || lisensi.status === 'REPLACED')
    && d?.sumber !== 'env';
  const tanpaLisensi = belumAktivasi || perluLisensiBaru;

  return (
    <div className="flex flex-col gap-4">
      {/* Belum ada kode / lisensi dicabut: tempel kode baru, atau ajukan ke penyedia. */}
      {tanpaLisensi && <KartuAktivasi baru={perluLisensiBaru} onBerhasil={muatUlang} />}
      {tanpaLisensi && <KartuPengajuan baru={perluLisensiBaru} />}
      {/* Permintaan di atas: tindakan utama Admin setelah platform terhubung. */}
      {!tanpaLisensi && <KartuPermintaan lisensi={lisensi} onBerubah={muatUlang} />}
      <KartuStatus lisensi={lisensi} onSegarkan={muatUlang} />
      <KartuFitur lisensi={lisensi} />
      <KartuRiwayat lisensi={lisensi} />
      {!tanpaLisensi && d?.sumber === 'aktivasi' && <KartuAktivasi ganti onBerhasil={muatUlang} />}
    </div>
  );
}

/* ── Kode Aktivasi ────────────────────────────────────────────────────────── */

/**
 * Admin menempel Kode Aktivasi yang diterbitkan penyedia platform. Tidak ada
 * yang tersimpan sebelum Kantor Pusat mengakui kodenya; kode yang tersimpan
 * tidak pernah ditampilkan kembali.
 */
function KartuAktivasi({ ganti = false, baru = false, onBerhasil }: { ganti?: boolean; baru?: boolean; onBerhasil: () => Promise<unknown> }) {
  const toast = useToast();
  const [buka, setBuka] = useState(!ganti);
  const [kode, setKode] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    setMengirim(true);
    try {
      const res = await fetch('/api/lisensi/aktivasi', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGalat(data.error ?? 'Aktivasi gagal.'); return; }
      toast('sukses', `Platform terhubung ke lisensi ${data.perusahaan}.`);
      setKode('');
      setBuka(false);
      await onBerhasil();
      // Menu dihitung ulang dari lisensi baru.
      window.location.reload();
    } catch {
      setGalat('Jaringan bermasalah. Coba lagi.');
    } finally {
      setMengirim(false);
    }
  }

  if (ganti && !buka) {
    return (
      <div className="text-right">
        <button type="button" onClick={() => setBuka(true)}
          className="text-[12px] font-semibold text-slate-500 hover:text-aksen-700 underline underline-offset-2">
          Ganti Kode Aktivasi
        </button>
      </div>
    );
  }

  return (
    <section className="bg-white rounded-kartu border-2 border-aksen-200 p-4 sm:p-5">
      <h3 className="text-[15px] font-black text-slate-900">
        {ganti ? 'Ganti Kode Aktivasi' : baru ? 'Tempel Kode Aktivasi baru' : 'Aktifkan Lisensi Platform'}
      </h3>
      <p className="text-[12px] text-slate-500 mt-1 mb-3 leading-relaxed max-w-2xl">
        Tempel <b>Kode Aktivasi</b> yang Anda terima dari penyedia platform (diawali <code>SMPA1-</code>).
        Kode diperiksa langsung ke penyedia lisensi sebelum disimpan.
      </p>
      <form onSubmit={kirim} className="flex flex-col gap-3 max-w-2xl">
        <Kolom label="Kode Aktivasi" wajib galat={galat}>
          {(id, invalid) => (
            <AreaTeks id={id} rows={3} value={kode} aria-invalid={invalid} spellCheck={false} autoComplete="off"
              placeholder="SMPA1-…" className="font-mono text-[12px]"
              onChange={(e) => setKode(e.target.value)} />
          )}
        </Kolom>
        <div className="flex gap-2 justify-end">
          {ganti && <Tombol type="button" rupa="hantu" onClick={() => setBuka(false)}>Batal</Tombol>}
          <Tombol type="submit" memuat={mengirim} disabled={!kode.trim()}>Aktifkan</Tombol>
        </div>
      </form>
    </section>
  );
}

/**
 * Belum punya Kode Aktivasi: ajukan ke penyedia platform. Pengajuan hanya
 * menjadi pemberitahuan Telegram bagi developer — Kode Aktivasi tetap
 * diterbitkan dan dikirim developer secara manual, lalu ditempel di atas.
 */
function KartuPengajuan({ baru = false }: { baru?: boolean }) {
  const [perusahaan, setPerusahaan] = useState('');
  const [kontak, setKontak] = useState('');
  const [paket, setPaket] = useState<Paket>('PROFESSIONAL');
  const [jenis, setJenis] = useState<'TRIAL' | 'STANDARD'>('TRIAL');
  const [durasi, setDurasi] = useState(365);
  const [catatan, setCatatan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [terkirim, setTerkirim] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);
    setMengirim(true);
    try {
      const res = await fetch('/api/lisensi/pengajuan', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perusahaan, kontak, paket, jenis, durasi_hari: durasi, catatan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGalat(data.error ?? 'Pengajuan gagal dikirim.'); return; }
      setTerkirim(true);
    } catch {
      setGalat('Jaringan bermasalah. Coba lagi.');
    } finally {
      setMengirim(false);
    }
  }

  if (terkirim) {
    return (
      <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5">
        <h3 className="text-[15px] font-black text-slate-900">✓ Pengajuan terkirim</h3>
        <p className="text-[12px] text-slate-500 mt-1 leading-relaxed max-w-2xl">
          Penyedia platform akan meninjau pengajuan Anda dan mengirimkan <b>Kode Aktivasi</b> lewat kontak
          <b> {kontak}</b>. Setelah diterima, tempel kodenya pada kolom Kode Aktivasi di atas.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5">
      <h3 className="text-[15px] font-black text-slate-900">
        {baru ? 'Ajukan lisensi baru' : 'Belum punya Kode Aktivasi? Ajukan lisensi'}
      </h3>
      <p className="text-[12px] text-slate-500 mt-1 mb-3 leading-relaxed max-w-2xl">
        Pengajuan dikirim ke penyedia platform. Kode Aktivasi akan dikirim penyedia ke kontak Anda setelah disetujui.
      </p>
      <form onSubmit={kirim} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <Kolom label="Nama perusahaan" wajib>
          {(id) => <Teks id={id} value={perusahaan} maxLength={160} placeholder="PT ABC" onChange={(e) => setPerusahaan(e.target.value)} />}
        </Kolom>
        <Kolom label="Kontak (WhatsApp / email)" wajib>
          {(id) => <Teks id={id} value={kontak} maxLength={120} placeholder="0812… / nama@perusahaan.com" onChange={(e) => setKontak(e.target.value)} />}
        </Kolom>
        <Kolom label="Paket lisensi" wajib>
          {(id) => (
            <Pilihan id={id} value={paket} onChange={(e) => setPaket(e.target.value as Paket)}>
              {PAKET.map((p) => <option key={p} value={p}>{LABEL_PAKET[p]}</option>)}
            </Pilihan>
          )}
        </Kolom>
        <Kolom label="Jenis" wajib>
          {(id) => (
            <Pilihan id={id} value={jenis} onChange={(e) => setJenis(e.target.value as 'TRIAL' | 'STANDARD')}>
              <option value="TRIAL">Trial (masa coba ditentukan penyedia)</option>
              <option value="STANDARD">Berlangganan</option>
            </Pilihan>
          )}
        </Kolom>
        {jenis === 'STANDARD' && (
          <Kolom label="Durasi" wajib>
            {(id) => (
              <Pilihan id={id} value={durasi} onChange={(e) => setDurasi(Number(e.target.value))}>
                {DURASI.map((d) => <option key={d.hari} value={d.hari}>{d.label}</option>)}
              </Pilihan>
            )}
          </Kolom>
        )}
        <div className="sm:col-span-2">
          <Kolom label="Catatan (opsional)" galat={galat}>
            {(id, invalid) => (
              <AreaTeks id={id} rows={2} value={catatan} maxLength={500} aria-invalid={invalid}
                onChange={(e) => setCatatan(e.target.value)} />
            )}
          </Kolom>
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <Tombol type="submit" memuat={mengirim} disabled={perusahaan.trim().length < 2 || kontak.trim().length < 3}>
            Kirim pengajuan
          </Tombol>
        </div>
      </form>
    </section>
  );
}

/* ── Status ───────────────────────────────────────────────────────────────── */

function KartuStatus({ lisensi, onSegarkan }: { lisensi: Lisensi; onSegarkan: () => Promise<unknown> }) {
  const toast = useToast();
  const [memeriksa, setMemeriksa] = useState(false);
  const d = lisensi.detail;
  const warna = lisensi.status ? WARNA_STATUS[lisensi.status] : null;

  async function periksa() {
    setMemeriksa(true);
    try {
      const res = await fetch('/api/lisensi/verifikasi', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      await onSegarkan();
      toast(res.ok && data.ok ? 'sukses' : 'galat', data.pesan ?? data.error ?? 'Pemeriksaan gagal.');
    } catch {
      toast('galat', 'Jaringan bermasalah. Coba lagi.');
    } finally {
      setMemeriksa(false);
    }
  }

  const baris: [string, React.ReactNode][] = [
    ['Perusahaan', d?.perusahaan ?? '—'],
    ['Paket', lisensi.paket ? `${lisensi.paket}${lisensi.trial ? ' (Trial)' : ''}` : '—'],
    ['Berlaku sejak', tanggalPanjang(d?.mulai)],
    ['Berlaku sampai', tanggalPanjang(d?.berakhir)],
    ['Sisa', lisensi.sisa_hari === null ? '—' : lisensi.sisa_hari > 0 ? `${lisensi.sisa_hari} hari` : 'Sudah berakhir'],
    ['ID Lisensi', d?.license_id ?? '—'],
  ];

  return (
    <section className="bg-white rounded-kartu border border-slate-200 overflow-hidden">
      <header className="px-4 sm:px-5 py-4 border-b border-slate-100 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.14em]">Status Lisensi</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h2 className="text-base font-black text-slate-900">{lisensi.judul}</h2>
            {warna && <Lencana {...warna} />}
            {lisensi.trial && <Lencana label="TRIAL" color="#6d28d9" bg="#ede9fe" />}
            {lisensi.mode_pengembangan && <Lencana label="PENGEMBANGAN" color="#475569" bg="#e2e8f0" />}
          </div>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed max-w-xl">{lisensi.keterangan}</p>
        </div>
        <Tombol rupa="kedua" onClick={periksa} memuat={memeriksa} className="!py-2 text-[12px]">
          Periksa sekarang
        </Tombol>
      </header>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-100">
        {baris.map(([k, v]) => (
          <div key={k} className="bg-white px-4 sm:px-5 py-3 min-w-0">
            <dt className="text-[11px] font-semibold text-slate-400">{k}</dt>
            <dd className="text-[13px] font-bold text-slate-800 mt-0.5 truncate">{v}</dd>
          </div>
        ))}
      </dl>

      <footer className="px-4 sm:px-5 py-2.5 border-t border-slate-100 bg-slate-50/70 text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Pemeriksaan terakhir:{' '}
          <b className="text-slate-700">
            {d?.terakhir_terverifikasi ? `${tanggalPendek(d.terakhir_terverifikasi)} ${waktuPendek(d.terakhir_terverifikasi)}` : 'belum pernah'}
          </b>
        </span>
        {d?.galat_terakhir && d.terakhir_gagal && (
          <span className="text-[#8f2c2b]">
            Gagal {tanggalPendek(d.terakhir_gagal)} {waktuPendek(d.terakhir_gagal)} — {d.galat_terakhir}
          </span>
        )}
        {d && !d.dikonfigurasi && !lisensi.mode_pengembangan && (
          <span className="text-[#8f2c2b]">Platform ini belum diaktifkan — masukkan Kode Aktivasi di atas.</span>
        )}
        {d && <span className="ml-auto">Versi aplikasi {d.versi}</span>}
      </footer>
    </section>
  );
}

/* ── Fitur ────────────────────────────────────────────────────────────────── */

function KartuFitur({ lisensi }: { lisensi: Lisensi }) {
  const aktif = REGISTRY_FITUR.filter((f) => lisensi.fitur.includes(f.key));
  const tidak = REGISTRY_FITUR.filter((f) => !lisensi.fitur.includes(f.key));

  return (
    <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5 grid gap-5 md:grid-cols-2">
      <div>
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Fitur tersedia</h3>
        {aktif.length === 0 ? (
          <p className="text-[12px] text-slate-400">Belum ada fitur yang aktif.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {aktif.map((f) => (
              <li key={f.key} className="flex items-start gap-2">
                <span className="text-[#008300] font-black text-[13px] leading-5" aria-hidden="true">✓</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-slate-800">{f.display_name}</span>
                  <span className="block text-[11px] text-slate-500 leading-snug">{f.description}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Tidak tersedia</h3>
        {tidak.length === 0 ? (
          <p className="text-[12px] text-slate-400">Seluruh fitur tercakup lisensi Anda.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tidak.map((f) => {
              const min = paketMinimum(f.key);
              return (
                <li key={f.key} className="flex items-start gap-2 text-slate-400">
                  <span className="text-[13px] leading-5" aria-hidden="true">•</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-500">{f.display_name}</span>
                    {lisensi.berlaku && min && (
                      <span className="block text-[11px] leading-snug">Tersedia di paket {LABEL_PAKET[min]}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── Permintaan ───────────────────────────────────────────────────────────── */

function KartuPermintaan({ lisensi, onBerubah }: { lisensi: Lisensi; onBerubah: () => Promise<unknown> }) {
  const toast = useToast();
  const permintaan = lisensi.detail?.permintaan ?? [];
  const menunggu = permintaan.find((p) => p.status === 'PENDING_APPROVAL');
  // Lisensi yang DICABUT sudah tidak bisa diperpanjang atau diubah paketnya —
  // yang tersisa adalah mengajukan lisensi baru.
  const punyaLisensi = Boolean(lisensi.detail?.license_id) && lisensi.status !== 'PENDING'
    && lisensi.status !== null && lisensi.status !== 'REVOKED' && lisensi.status !== 'REPLACED';

  const [jenis, setJenis] = useState<JenisPermintaan | null>(null);
  const [paket, setPaket] = useState<Paket>((lisensi.detail?.paket_kode as Paket) ?? 'STARTER');
  const [durasi, setDurasi] = useState(365);
  const [catatan, setCatatan] = useState('');
  const [fiturCustom, setFiturCustom] = useState<Record<string, boolean>>(lisensi.detail?.fitur_peta ?? {});
  const [mengirim, setMengirim] = useState(false);

  const jenisAktif: JenisPermintaan | null = punyaLisensi ? jenis : 'NEW';

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (!jenisAktif) return;
    setMengirim(true);
    try {
      const res = await fetch('/api/lisensi/permintaan', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: jenisAktif,
          requested_package: jenisAktif === 'EXTENSION' ? (lisensi.detail?.paket_kode ?? paket) : paket,
          duration_days: jenisAktif === 'CHANGE_PACKAGE' ? null : durasi,
          requested_features: paket === 'CUSTOM' ? fiturCustom : undefined,
          notes: catatan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast('galat', data.error ?? 'Permintaan gagal dikirim.'); return; }
      toast('sukses', 'Permintaan terkirim. Anda akan diberi tahu setelah penyedia platform memutuskan.');
      setJenis(null);
      setCatatan('');
      await onBerubah();
    } catch {
      toast('galat', 'Jaringan bermasalah. Coba lagi.');
    } finally {
      setMengirim(false);
    }
  }

  async function batalkan(id: string) {
    setMengirim(true);
    try {
      const res = await fetch('/api/lisensi/permintaan', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'batal', id }),
      });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? 'sukses' : 'galat', res.ok ? 'Permintaan dibatalkan.' : (data.error ?? 'Gagal membatalkan.'));
      await onBerubah();
    } finally {
      setMengirim(false);
    }
  }

  const terbaru = permintaan[0];

  return (
    <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5">
      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">Permintaan Lisensi</h3>

      {/* Hasil keputusan terakhir (§68). Alasan hanya bila memang dituliskan. */}
      {/* Status lisensi SEKARANG didahulukan: permintaan yang dulu disetujui
          tidak boleh tetap tampil hijau setelah lisensinya dicabut. */}
      {lisensi.status === 'REVOKED' && (
        <div className="mb-3 rounded-kontrol bg-[#e2e8f0] text-slate-700 px-3 py-2.5 text-[12px]">
          <b>Lisensi dicabut oleh penyedia platform.</b> Modul berlisensi tidak tersedia; seluruh data tetap
          tersimpan dan kembali terbuka bila lisensi baru disetujui.
        </div>
      )}
      {lisensi.status === 'SUSPENDED' && (
        <div className="mb-3 rounded-kontrol bg-[#fde9c4] text-[#7a5300] px-3 py-2.5 text-[12px]">
          <b>Lisensi ditangguhkan sementara oleh penyedia platform.</b> Hubungi penyedia platform untuk
          mengaktifkannya kembali. Data tidak terhapus.
        </div>
      )}
      {lisensi.status === 'EXPIRED' && (
        <div className="mb-3 rounded-kontrol bg-[#fce3e3] text-[#8f2c2b] px-3 py-2.5 text-[12px]">
          <b>Lisensi sudah berakhir</b> pada {tanggalPanjang(lisensi.detail?.berakhir)}. Ajukan perpanjangan untuk
          membuka kembali modulnya.
        </div>
      )}
      {lisensi.berlaku && terbaru && !menunggu && terbaru.status === 'APPROVED' && terbaru.processed_at && (
        <div className="mb-3 rounded-kontrol bg-[#e0f2e0] text-[#0b4f0b] px-3 py-2.5 text-[12px]">
          <b>✓ Lisensi disetujui.</b> {LABEL_PAKET[terbaru.requested_package]} aktif, berlaku sampai {tanggalPanjang(lisensi.detail?.berakhir)}.
        </div>
      )}
      {terbaru && !menunggu && terbaru.status === 'REJECTED' && (
        <div className="mb-3 rounded-kontrol bg-[#fce3e3] text-[#8f2c2b] px-3 py-2.5 text-[12px]">
          <b>Permintaan lisensi tidak disetujui.</b>
          {terbaru.reason ? <> Alasan: {terbaru.reason}</> : null}
        </div>
      )}

      {menunggu ? (
        <div className="rounded-kontrol border border-aksen-100 bg-aksen-50 px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-aksen-800">Sebuah permintaan masih menunggu persetujuan penyedia platform.</p>
            <p className="text-[12px] text-slate-600 mt-0.5">
              {LABEL_JENIS[menunggu.kind]} · {LABEL_PAKET[menunggu.requested_package]}
              {menunggu.duration_days ? ` · ${menunggu.duration_days} hari` : ''} · diajukan {tanggalPendek(menunggu.requested_at)}
            </p>
          </div>
          <Tombol rupa="kedua" className="!py-2 text-[12px]" memuat={mengirim} onClick={() => batalkan(menunggu.id)}>
            Batalkan
          </Tombol>
        </div>
      ) : punyaLisensi && !jenis ? (
        <div className="flex flex-wrap gap-2">
          <p className="w-full text-[12px] text-slate-500 mb-1">Lisensi saat ini: <b className="text-slate-800">{lisensi.paket}</b></p>
          {lisensi.trial ? (
            <Tombol onClick={() => setJenis('NEW')}>Ajukan lisensi penuh</Tombol>
          ) : (
            <>
              <Tombol rupa="kedua" onClick={() => setJenis('CHANGE_PACKAGE')}>Ajukan perubahan paket</Tombol>
              <Tombol rupa="kedua" onClick={() => setJenis('EXTENSION')}>Ajukan perpanjangan</Tombol>
            </>
          )}
          <p className="w-full text-[11px] text-slate-400 mt-1">
            Perubahan paket menerbitkan lisensi baru; platform ini beralih ke lisensi baru secara otomatis.
          </p>
        </div>
      ) : (
        <form onSubmit={kirim} className="grid gap-3 sm:grid-cols-2 max-w-2xl">
          {jenisAktif !== 'EXTENSION' && (
            <Kolom label="Paket lisensi" wajib>
              {(id) => (
                <Pilihan id={id} value={paket} onChange={(e) => setPaket(e.target.value as Paket)}>
                  {PAKET.map((p) => <option key={p} value={p}>{LABEL_PAKET[p]}</option>)}
                </Pilihan>
              )}
            </Kolom>
          )}
          {jenisAktif !== 'CHANGE_PACKAGE' && (
            <Kolom label="Durasi" wajib>
              {(id) => (
                <Pilihan id={id} value={durasi} onChange={(e) => setDurasi(Number(e.target.value))}>
                  {DURASI.map((d) => <option key={d.hari} value={d.hari}>{d.label}</option>)}
                </Pilihan>
              )}
            </Kolom>
          )}
          {paket === 'CUSTOM' && jenisAktif !== 'EXTENSION' && (
            <fieldset className="sm:col-span-2">
              <legend className="text-[12px] font-semibold text-slate-700 mb-1.5">Fitur yang diminta</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {KUNCI_FITUR.map((k: KunciFitur) => (
                  <label key={k} className="flex items-center gap-2 text-[12px] text-slate-700">
                    <input type="checkbox" checked={Boolean(fiturCustom[k])}
                      onChange={(e) => setFiturCustom((f) => ({ ...f, [k]: e.target.checked }))} />
                    {REGISTRY_FITUR.find((f) => f.key === k)?.display_name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Kolom label="Catatan" className="sm:col-span-2" bantuan="Opsional. Mis. kebutuhan jumlah pengguna atau tanggal mulai.">
            {(id) => <AreaTeks id={id} rows={2} maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} />}
          </Kolom>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            {punyaLisensi && <Tombol type="button" rupa="hantu" onClick={() => setJenis(null)}>Batal</Tombol>}
            <Tombol type="submit" memuat={mengirim}>
              {jenisAktif === 'EXTENSION' ? 'Ajukan Perpanjangan' : jenisAktif === 'CHANGE_PACKAGE' ? 'Ajukan Perubahan' : 'Ajukan Lisensi'}
            </Tombol>
          </div>
        </form>
      )}

      {permintaan.length > 0 && (
        <div className="mt-5">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Riwayat permintaan</h4>
          <ul className="divide-y divide-slate-100">
            {permintaan.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <Lencana {...WARNA_PERMINTAAN[p.status]} />
                <span className="font-semibold text-slate-700">{LABEL_JENIS[p.kind]} · {LABEL_PAKET[p.requested_package]}</span>
                {p.duration_days ? <span className="text-slate-500">{p.duration_days} hari</span> : null}
                <span className="text-slate-400 ml-auto">{tanggalPendek(p.requested_at)}</span>
                {p.status === 'REJECTED' && p.reason && <span className="w-full text-slate-500">Alasan: {p.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── Riwayat peristiwa ────────────────────────────────────────────────────── */

function KartuRiwayat({ lisensi }: { lisensi: Lisensi }) {
  const peristiwa = lisensi.peristiwa ?? [];
  return (
    <section className="bg-white rounded-kartu border border-slate-200 p-4 sm:p-5">
      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Pemberitahuan Lisensi</h3>
      {peristiwa.length === 0 ? (
        <Kosong judul="Belum ada pemberitahuan" keterangan="Perubahan status, persetujuan, dan perpanjangan lisensi akan tercatat di sini." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {peristiwa.map((p) => (
            <li key={p.id} className="py-2.5 flex gap-3">
              <span className="text-[11px] text-slate-400 w-24 flex-shrink-0 tabular-nums">
                {tanggalPendek(p.created_at)} {waktuPendek(p.created_at)}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-bold text-slate-800">{p.detail?.judul ?? judulAksi(p.action)}</span>
                {p.detail?.keterangan && <span className="block text-[11px] text-slate-500">{p.detail.keterangan}</span>}
                {p.actor_name && p.actor_name !== 'Sistem Lisensi' && (
                  <span className="block text-[11px] text-slate-400">oleh {p.actor_name}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function judulAksi(aksi: string): string {
  const peta: Record<string, string> = {
    license_requested: 'Permintaan lisensi dikirim',
    license_request_cancelled: 'Permintaan lisensi dibatalkan',
    license_verification_failed: 'Pemeriksaan lisensi tidak berhasil',
    license_verified: 'Lisensi diperiksa',
  };
  return peta[aksi] ?? 'Pembaruan lisensi';
}
