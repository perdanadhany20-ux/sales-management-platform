// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif, keluar } from '@/lib/auth';
import { isPengawas, LABEL_PERAN, type Peran } from '@/lib/constants';
import { tanggalPendek, waktuPendek, angka, rupiahRingkas } from '@/lib/format';
import { MENU_APLIKASI } from '@/components/shared/Shell';
import { useMenuSaya } from '@/lib/menu-akses';
import {
  statusPengingat, nyalakanPengingat, matikanPengingat, type StatusPengingat,
} from '@/lib/notifikasi';
import { Kolom, KataSandi, Teks, Tombol } from '@/components/shared/FormParts';
import { PilihCari } from '@/components/shared/PilihCari';
import { PanelGalat, LayarMemuat, useToast } from '@/components/shared/Feedback';
import { KartuAplikasi } from '@/components/shared/KartuAplikasi';
import { DuaLangkah, PerangkatAktif } from '@/components/shared/KeamananAkun';
import { NotifikasiPush } from '@/components/shared/NotifikasiPush';
import { Modal } from '@/components/shared/Modal';
import { ACARA_BUKA_PROFIL } from '@/lib/buka-profil';

/**
 * Profil Akun — ditampilkan sebagai modal di atas halaman yang sedang dibuka
 * (ModalProfil, dibuka dari avatar header & kartu nama sidebar), bukan
 * halaman tersendiri: membuka profil tidak boleh membuang konteks kerja.
 * Rute /profil tetap ada sebagai halaman awal cadangan (lib/menu-akses).
 *
 * Isinya kartu identitas lengkap, bukan sekadar formulir ganti sandi.
 *
 * Susunannya mengikuti pola profil Work Management yang dipakai Mas Putu:
 * satu spanduk identitas di atas, lalu dua kolom — kiri berisi data dan
 * keamanan, kanan berisi peran dan hak akses. Yang membedakan dari contohnya:
 * tidak ada satu pun angka di halaman ini yang dikarang. Hak akses modul
 * dibaca dari daftar menu yang sama yang dipakai navigasi, struktur
 * organisasi dari tabel users, dan ringkasan aktivitas dari tabel aslinya.
 *
 * Peran TIDAK bisa disunting di sini, dan itu disengaja: peran menentukan apa
 * yang boleh dilihat seseorang. Halaman yang bisa disunting pemiliknya sendiri
 * bukan tempatnya. Kontak (email & telepon) boleh diubah, lewat route handler
 * yang hanya mengizinkan dua kolom itu.
 */

interface Profil {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: boolean;
  created_at: string;
  division: string | null;
  sales_division: string | null;
  position: string | null;
  event_code: string | null;
  joined_at: string | null;
  approval_status: string;
  address: string | null;
  manager_id: string | null;
}

interface Rekan { id: string; full_name: string; role: string; active: boolean }
interface OrangRingkas { id: string; full_name: string; role: string }

interface Ringkasan { laporan: number; pipeline: number; nilai: number; meeting: number }

function salam(): string {
  const j = new Date().getHours();
  if (j < 11) return 'Selamat pagi';
  if (j < 15) return 'Selamat siang';
  if (j < 18) return 'Selamat sore';
  return 'Selamat malam';
}

const LEVEL_AKSES: Record<string, { label: string; warna: string; bg: string }> = {
  ADMIN:   { label: 'Full Access',      warna: '#008300', bg: '#e0f2e0' },
  MANAGER: { label: 'Akses Pengawasan', warna: '#1d4ed8', bg: '#dbeafe' },
  SALES:   { label: 'Akses Lapangan',   warna: '#0891b2', bg: '#e0f2fe' },
};

export function IsiProfil({ onTutup }: { onTutup?: () => void } = {}) {
  const { pengguna, memuat, muatUlang } = usePenggunaAktif();
  const toast = useToast();
  const router = useRouter();

  const [profil, setProfil] = useState<Profil | null>(null);
  const [sandiDiperbarui, setSandiDiperbarui] = useState<string | null>(null);
  const [jumlahSesi, setJumlahSesi] = useState(0);
  const [sesiIni, setSesiIni] = useState<{ created_at: string; expires_at: string } | null>(null);
  const [rekan, setRekan] = useState<Rekan[]>([]);
  const [ringkas, setRingkas] = useState<Ringkasan>({ laporan: 0, pipeline: 0, nilai: 0, meeting: 0 });
  const [atasan, setAtasan] = useState<OrangRingkas | null>(null);
  const [bawahan, setBawahan] = useState<OrangRingkas[]>([]);

  const [ubahKontak, setUbahKontak] = useState(false);
  const [email, setEmail] = useState('');
  const [telepon, setTelepon] = useState('');
  const [divisi, setDivisi] = useState('');
  const [salesDivisi, setSalesDivisi] = useState('');
  const [jabatan, setJabatan] = useState('');
  const [alamat, setAlamat] = useState('');
  const [opsi, setOpsi] = useState<{ divisions: string[]; sales_divisions: string[]; positions: string[] }>(
    { divisions: [], sales_divisions: [], positions: [] },
  );
  const [simpanKontak, setSimpanKontak] = useState(false);

  const [bukaSandi, setBukaSandi] = useState(false);
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [galatSandi, setGalatSandi] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  const [cariModul, setCariModul] = useState('');
  const [pengingat, setPengingat] = useState<StatusPengingat>('mati');

  // Dibaca di effect, bukan saat render: statusPengingat() menyentuh
  // window.Notification dan localStorage, yang tidak ada saat komponen ini
  // dirender di server.
  useEffect(() => { setPengingat(statusPengingat()); }, []);

  const muatProfil = useCallback(async () => {
    const res = await fetch('/api/profil', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    setProfil(data.profil);
    setSandiDiperbarui(data.sandi_diperbarui);
    setJumlahSesi(data.jumlah_sesi ?? 0);
    setSesiIni(data.sesi_ini ?? null);
    setEmail(data.profil?.email ?? '');
    setTelepon(data.profil?.phone ?? '');
    setDivisi(data.profil?.division ?? '');
    setSalesDivisi(data.profil?.sales_division ?? '');
    setJabatan(data.profil?.position ?? '');
    setAlamat(data.profil?.address ?? '');
    setAtasan(data.atasan ?? null);
    setBawahan(data.bawahan ?? []);
  }, []);

  useEffect(() => { void muatProfil(); }, [muatProfil]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/opsi-pendaftaran');
        if (!res.ok) return;
        const data = await res.json();
        setOpsi({
          divisions: data.opsi?.divisions ?? [],
          sales_divisions: data.opsi?.sales_divisions ?? [],
          positions: data.opsi?.positions ?? [],
        });
      } catch { /* pilihan kosong — kolomnya tetap bisa dikosongkan */ }
    })();
  }, []);

  useEffect(() => {
    if (!pengguna) return;
    (async () => {
      const [orang, laporan, pipeline, meeting] = await Promise.all([
        supabase.from('users').select('id, full_name, role, active').eq('active', true).order('full_name'),
        supabase.from('sm_daily_reports').select('id', { count: 'exact', head: true })
          .eq('sales_user_id', pengguna.id),
        supabase.from('sm_pipeline').select('project_value').eq('sales_user_id', pengguna.id),
        supabase.from('sm_schedules').select('id', { count: 'exact', head: true })
          .eq('assigned_to', pengguna.id).eq('status', 'COMPLETED'),
      ]);

      setRekan((orang.data ?? []) as Rekan[]);
      const nilai = ((pipeline.data ?? []) as { project_value: number }[])
        .reduce((t, p) => t + Number(p.project_value ?? 0), 0);
      setRingkas({
        laporan: laporan.count ?? 0,
        pipeline: (pipeline.data ?? []).length,
        nilai,
        meeting: meeting.count ?? 0,
      });
    })();
  }, [pengguna]);

  const menuSaya = useMenuSaya(pengguna?.id, pengguna?.role);
  const modul = useMemo(() => {
    const daftar = menuSaya ? MENU_APLIKASI.filter((m) => menuSaya.includes(m.kunci)) : [];
    const k = cariModul.trim().toLowerCase();
    return {
      semua: daftar,
      tersaring: k ? daftar.filter((m) => m.label.toLowerCase().includes(k)) : daftar,
    };
  }, [menuSaya, cariModul]);

  if (memuat) return <LayarMemuat />;
  if (!pengguna) return null;

  const peran = (pengguna.role.toUpperCase() as Peran);
  const level = LEVEL_AKSES[peran] ?? LEVEL_AKSES.SALES;

  const pengawasLain = rekan.filter((r) => isPengawas(r.role) && r.id !== pengguna.id);
  const timSales = rekan.filter((r) => r.role === 'SALES' && r.id !== pengguna.id);

  async function simpanKontakBaru(e: React.FormEvent) {
    e.preventDefault();
    setSimpanKontak(true);
    try {
      const res = await fetch('/api/profil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email, phone: telepon,
          division: divisi, sales_division: salesDivisi,
          address: alamat,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast('galat', data?.error ?? 'Gagal menyimpan kontak.'); return; }
      setProfil(data.profil);
      setUbahKontak(false);
      toast('sukses', 'Kontak diperbarui.');
    } catch {
      toast('galat', 'Jaringan bermasalah. Coba lagi.');
    } finally {
      setSimpanKontak(false);
    }
  }

  async function gantiSandi(e: React.FormEvent) {
    e.preventDefault();
    setGalatSandi(null);

    if (baru !== ulangi) { setGalatSandi('Konfirmasi kata sandi tidak cocok.'); return; }

    setMemproses(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password_lama: lama, password_baru: baru }),
      });
      const data = await res.json();
      if (!res.ok) { setGalatSandi(data?.error ?? 'Gagal mengganti kata sandi.'); return; }

      toast('sukses', 'Kata sandi diperbarui. Sesi di perangkat lain telah dikeluarkan.');
      setLama(''); setBaru(''); setUlangi(''); setBukaSandi(false);
      void muatProfil();
      void muatUlang();
    } catch {
      setGalatSandi('Jaringan bermasalah. Coba lagi.');
    } finally {
      setMemproses(false);
    }
  }

  const diModal = Boolean(onTutup);
  const statusAkun = profil ? (profil.approval_status === 'DISETUJUI'
    ? (profil.active ? 'Aktif & terverifikasi' : 'Terverifikasi, sedang nonaktif')
    : profil.approval_status === 'MENUNGGU'
      ? 'Menunggu verifikasi admin' : 'Pendaftaran ditolak') : null;

  const spanduk = (
    <header className={`relative overflow-hidden flex-shrink-0 text-white
                        bg-gradient-to-br from-aksen-800 via-aksen-700 to-aksen-500
                        ${diModal ? '' : 'rounded-kartu shadow-bento'}`}>
      <div aria-hidden="true" className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden="true" className="absolute left-1/3 -bottom-24 w-64 h-40 rounded-full bg-sky-300/10 blur-3xl" />

      <div className={`relative px-5 sm:px-7 py-5 sm:py-6 flex flex-wrap items-center gap-4 ${diModal ? 'pr-14 sm:pr-16' : ''}`}>
        <div className="flex-1 min-w-[220px]">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/75">
            {salam()} · <span className="normal-case tracking-normal font-semibold">@{pengguna.username}</span>
          </p>
          <h1 className="text-2xl sm:text-[32px] font-black tracking-tight leading-tight mt-1.5">
            {pengguna.full_name}
          </h1>
          <div className="flex items-center gap-2 flex-wrap mt-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-bold">
              <Ikon nama="perisai" kecil /> {LABEL_PERAN[peran] ?? pengguna.role}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold
                              ${profil?.active === false ? 'bg-[#e34948]' : 'bg-white/20'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${profil?.active === false ? 'bg-white' : 'bg-emerald-300'}`} />
              {profil?.active === false ? 'Nonaktif' : 'Aktif'}
            </span>
          </div>
        </div>

        <div className="flex items-stretch gap-2.5">
          <KotakAngka nilai={modul.semua.length} label="Modul" />
          <KotakAngka nilai={jumlahSesi} label="Sesi" kuning />
        </div>
      </div>

      {onTutup && (
        <button
          type="button" onClick={onTutup} aria-label="Tutup profil"
          className="absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </header>
  );

  const isi = (
      <div className="grid grid-cols-1 satulayar:grid-cols-12 gap-4 items-start">

        {/* ══ Kolom kiri ══ */}
        <div className="satulayar:col-span-7 flex flex-col gap-4">

          <Panel ikon="orang" judul="Informasi Pribadi & Kontak" rapat={!ubahKontak}
            aksi={!ubahKontak && (
              <button type="button" onClick={() => setUbahKontak(true)}
                className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">
                Ubah
              </button>
            )}>
            {ubahKontak ? (
              <form onSubmit={simpanKontakBaru} className="flex flex-col gap-3">
                <Kolom label="Email" bantuan="Dipakai admin untuk menghubungi Anda.">
                  {(id) => (
                    <Teks id={id} type="email" value={email} disabled={simpanKontak}
                      onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.co.id" />
                  )}
                </Kolom>
                <Kolom label="No. Telepon / WA">
                  {(id) => (
                    <Teks id={id} type="tel" value={telepon} disabled={simpanKontak}
                      onChange={(e) => setTelepon(e.target.value)} placeholder="08xxxxxxxxxx" />
                  )}
                </Kolom>
                <div className="grid grid-cols-1 formulir:grid-cols-3 gap-3">
                  <Kolom label="Divisi">
                    {(id) => (
                      <PilihCari id={id} nilai={divisi} onUbah={setDivisi}
                        disabled={simpanKontak} bolehKosong labelKosong="— belum diisi —"
                        opsi={opsi.divisions.map((d) => ({ value: d, label: d }))} />
                    )}
                  </Kolom>
                  <Kolom label="Sales Division">
                    {(id) => (
                      <PilihCari id={id} nilai={salesDivisi} onUbah={setSalesDivisi}
                        disabled={simpanKontak || divisi.toLowerCase() !== 'sales'}
                        bolehKosong labelKosong="— belum diisi —"
                        opsi={opsi.sales_divisions.map((d) => ({ value: d, label: d }))} />
                    )}
                  </Kolom>
                  {/* Posisi menentukan letak di struktur organisasi, jadi hanya
                      Admin yang boleh mengubahnya — bukan pemiliknya sendiri. */}
                  <Kolom label="Posisi" bantuan="Diatur Admin. Hubungi Admin bila tidak sesuai.">
                    {(id) => <Teks id={id} value={jabatan || 'Belum diisi'} readOnly disabled />}
                  </Kolom>
                </div>

                <Kolom label="Alamat Lengkap">
                  {(id) => (
                    <Teks id={id} value={alamat} disabled={simpanKontak}
                      onChange={(e) => setAlamat(e.target.value)} placeholder="Sesuai domisili" />
                  )}
                </Kolom>

                <div className="flex justify-end gap-2">
                  <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => {
                    setUbahKontak(false);
                    setEmail(profil?.email ?? '');
                    setTelepon(profil?.phone ?? '');
                    setDivisi(profil?.division ?? '');
                    setSalesDivisi(profil?.sales_division ?? '');
                    setJabatan(profil?.position ?? '');
                    setAlamat(profil?.address ?? '');
                  }}>Batal</Tombol>
                  <Tombol type="submit" className="text-[12px] py-2" memuat={simpanKontak}>Simpan</Tombol>
                </div>
              </form>
            ) : (
              <dl className="flex flex-col">
                <Baris ikon="pagar" label="Username" nilai={`@${pengguna.username}`} />
                <Baris ikon="orang" label="Nama Lengkap" nilai={pengguna.full_name} />
                <Baris ikon="surel" label="Email" nilai={profil?.email} />
                <Baris ikon="hp" label="No. Telepon / WA" nilai={profil?.phone} />
                <Baris ikon="gedung" label="Divisi" nilai={profil?.division} />
                <Baris ikon="sasaran" label="Sales Division" nilai={profil?.sales_division} />
                <Baris ikon="tas" label="Jabatan / Posisi" nilai={profil?.position} />
                <Baris ikon="bintang" label="Peran" nilai={LABEL_PERAN[peran] ?? pengguna.role} />
                <Baris ikon="rumah" label="Alamat" nilai={profil?.address} />
                <Baris ikon="tiket" label="Kode Acara" nilai={profil?.event_code} />
                <Baris ikon="kalender" label="Bergabung Sejak"
                  nilai={profil ? tanggalPendek(profil.joined_at ?? profil.created_at) : null} />
                <Baris ikon="centang" label="Status Akun" nilai={statusAkun}
                  hijau={profil?.approval_status === 'DISETUJUI' && profil.active} />
                <Baris ikon="kunci" label="Sandi Diperbarui"
                  nilai={sandiDiperbarui ? tanggalPendek(sandiDiperbarui) : 'Belum pernah diganti'} />
              </dl>
            )}
          </Panel>

          <Panel ikon="struktur" judul="Struktur Organisasi">
            <div className="flex flex-col gap-3.5">
              <Kelompok label="Atasan" warna="text-[#c2410c]" kosong="Belum ada atasan terdaftar"
                orang={atasan ? [atasan] : []} />
              {bawahan.length > 0 && (
                <Kelompok label="Bawahan" warna="text-[#15803d]" kosong="" orang={bawahan} />
              )}
              <Kelompok label="Pengawas (Manager & Admin)" warna="text-aksen-700"
                kosong="Belum ada pengawas lain terdaftar" orang={pengawasLain} />
              <Kelompok label={peran === 'SALES' ? 'Rekan Sales' : 'Tim Sales'} warna="text-[#0e7490]"
                kosong="Belum ada Sales terdaftar" orang={timSales} />
            </div>
          </Panel>

          <Panel ikon="gembok" judul="Keamanan & Sandi">
            <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-100">
              <div>
                <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em]">Sesi saat ini</p>
                <p className="text-[12.5px] font-bold text-[#008300] mt-1 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#008300]" /> Online &amp; terotentikasi
                </p>
                {sesiIni && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Masuk {tanggalPendek(sesiIni.created_at)} {waktuPendek(sesiIni.created_at)} ·
                    berakhir {waktuPendek(sesiIni.expires_at)}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {jumlahSesi} sesi aktif di seluruh perangkat
              </p>
            </div>

            {!bukaSandi ? (
              <div className="grid grid-cols-2 gap-2 pt-3">
                <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => setBukaSandi(true)}>
                  Ubah Kata Sandi
                </Tombol>
                <Tombol rupa="bahaya" className="text-[12px] py-2"
                  onClick={async () => { await keluar(); router.replace('/'); }}>
                  Keluar dari Akun
                </Tombol>
              </div>
            ) : (
              <form onSubmit={gantiSandi} className="flex flex-col gap-3 pt-3">
                {galatSandi && <PanelGalat pesan={galatSandi} />}

                <Kolom label="Kata Sandi Saat Ini" wajib>
                  {(id) => (
                    <KataSandi id={id} nilai={lama} onUbah={setLama}
                      disabled={memproses} autoComplete="current-password" />
                  )}
                </Kolom>

                <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3">
                  <Kolom label="Kata Sandi Baru" wajib
                    bantuan="Minimal 8 karakter, memuat huruf dan angka.">
                    {(id) => (
                      <KataSandi id={id} nilai={baru} onUbah={setBaru}
                        disabled={memproses} autoComplete="new-password" />
                    )}
                  </Kolom>
                  <Kolom label="Ulangi Kata Sandi Baru" wajib
                    galat={ulangi && baru !== ulangi ? 'Belum cocok.' : null}>
                    {(id, invalid) => (
                      <KataSandi id={id} nilai={ulangi} onUbah={setUlangi} invalid={invalid}
                        disabled={memproses} autoComplete="new-password" />
                    )}
                  </Kolom>
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Setelah diganti, sesi Anda di perangkat lain akan dikeluarkan. Sesi di
                  perangkat ini tetap berjalan.
                </p>

                <div className="flex justify-end gap-2">
                  <Tombol rupa="kedua" className="text-[12px] py-2"
                    onClick={() => { setBukaSandi(false); setLama(''); setBaru(''); setUlangi(''); setGalatSandi(null); }}>
                    Batal
                  </Tombol>
                  <Tombol type="submit" className="text-[12px] py-2" memuat={memproses}
                    disabled={!lama || !baru || !ulangi}>
                    Simpan Kata Sandi
                  </Tombol>
                </div>
              </form>
            )}
          </Panel>

          <Panel ikon="gembok" judul="Verifikasi Dua Langkah & Perangkat">
            <div className="flex flex-col gap-4">
              <DuaLangkah />
              <div className="border-t border-slate-100 pt-3">
                <PerangkatAktif onBerubah={muatProfil} />
              </div>
            </div>
          </Panel>
        </div>

        {/* ══ Kolom kanan ══ */}
        <div className="satulayar:col-span-5 flex flex-col gap-4">

          <Panel ikon="hp" judul="Aplikasi di HP">
            <KartuAplikasi />
          </Panel>

          <Panel ikon="label" judul="Peran Pengguna" jumlah="1 Peran">
            <span className="inline-flex items-center rounded-lg bg-aksen-50 border border-aksen-200 px-3 py-1.5 text-[12px] font-bold text-aksen-800">
              {LABEL_PERAN[peran] ?? pengguna.role}
            </span>
            <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em] mt-3.5">Level akses</p>
            <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold mt-1.5"
              style={{ color: level.warna, background: level.bg }}>
              <Ikon nama="gembok" kecil /> {level.label}
            </span>
            <p className="text-[11.5px] text-slate-500 mt-2.5 leading-relaxed">
              {peran === 'ADMIN'
                ? 'Seluruh modul, pengelolaan akun, dan konfigurasi platform.'
                : peran === 'MANAGER'
                  ? 'Melihat data seluruh tim, menugaskan jadwal, dan menyetujui override meeting.'
                  : 'Data milik sendiri: laporan, pipeline, dan meeting yang ditugaskan kepada Anda.'}
            </p>
          </Panel>

          <Panel ikon="gembok" judul="Hak Akses Modul" jumlah={String(modul.semua.length)}>
            <Teks
              type="search" value={cariModul} onChange={(e) => setCariModul(e.target.value)}
              placeholder="Cari modul…" aria-label="Cari modul"
            />
            {modul.tersaring.length === 0 ? (
              <p className="text-[11px] text-slate-400 mt-3">Tidak ada modul yang cocok.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 mt-3">
                {modul.tersaring.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} onClick={onTutup}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:border-aksen-300 hover:bg-aksen-50 hover:text-aksen-800 px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-700 transition-colors">
                      <span className="text-slate-400 [&>svg]:w-3.5 [&>svg]:h-3.5">{m.ikon}</span>
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10.5px] text-slate-400 mt-3 leading-relaxed">
              Daftar ini ditentukan admin lewat Admin Panel. Mengetik URL modul yang tidak ada di
              sini langsung tetap ditolak, bukan cuma disembunyikan dari menu.
            </p>
          </Panel>

          <Panel ikon="lonceng" judul="Pengingat">
            <p className="text-[12px] text-slate-600 leading-relaxed">
              {pengingat === 'tidak_didukung'
                ? 'Peramban ini tidak mendukung notifikasi. Lencana di header tetap berjalan seperti biasa.'
                : pengingat === 'ditolak'
                  ? 'Notifikasi diblokir untuk situs ini. Izinkan lewat pengaturan situs di peramban Anda, lalu buka halaman ini lagi.'
                  : pengingat === 'menyala'
                    ? 'Pengingat aktif untuk laporan harian yang belum diisi, meeting yang menunggu, dan jadwal yang lewat tanggal.'
                    : 'Dapatkan pengingat saat laporan harian belum diisi, meeting menunggu check-in, atau jadwal lewat tanggal.'}
            </p>

            <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
              Pengingat muncul selama aplikasi terbuka di salah satu tab peramban, paling
              banyak sekali per jenis per hari. Tidak ada surel maupun WhatsApp yang
              dikirim, dan nomor Anda tidak pernah diteruskan ke layanan lain.
            </p>

            {(pengingat === 'mati' || pengingat === 'menyala') && (
              <div className="mt-3">
                {pengingat === 'menyala' ? (
                  <Tombol rupa="kedua" className="text-[12px] py-2 w-full"
                    onClick={() => { matikanPengingat(); setPengingat(statusPengingat()); }}>
                    Matikan Pengingat
                  </Tombol>
                ) : (
                  <Tombol className="text-[12px] py-2 w-full"
                    onClick={async () => {
                      const hasil = await nyalakanPengingat();
                      setPengingat(hasil);
                      if (hasil === 'menyala') toast('sukses', 'Pengingat dinyalakan.');
                      else if (hasil === 'ditolak') toast('galat', 'Izin notifikasi ditolak peramban.');
                    }}>
                    Nyalakan Pengingat
                  </Tombol>
                )}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-slate-100">
              <NotifikasiPush />
            </div>
          </Panel>

          <Panel ikon="grafik" judul="Ringkasan Aktivitas">
            <div className="grid grid-cols-2 gap-2">
              <Kotak label="Laporan Harian" nilai={angka(ringkas.laporan)} />
              <Kotak label="Baris Pipeline" nilai={angka(ringkas.pipeline)} />
              <Kotak label="Nilai Pipeline" nilai={rupiahRingkas(ringkas.nilai)} />
              <Kotak label="Jadwal Selesai" nilai={angka(ringkas.meeting)} />
            </div>
            <p className="text-[10.5px] text-slate-400 mt-3 leading-relaxed">
              Dihitung langsung dari data Anda, bukan dari cache.
            </p>
          </Panel>
        </div>
      </div>
  );

  // Di modal: spanduk tetap di atas, hanya isinya yang bergulir.
  if (diModal) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {spanduk}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-slate-50 p-4 sm:p-5
                        pb-[max(1rem,env(safe-area-inset-bottom))]">
          {isi}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      {spanduk}
      {isi}
    </div>
  );
}

/**
 * Dipasang sekali di layout aplikasi. Dibuka lewat bukaProfil() (lib/buka-profil)
 * dari mana saja; tertutup sendiri saat pengguna pindah halaman.
 */
export function ModalProfil() {
  const [buka, setBuka] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onBuka = () => setBuka(true);
    window.addEventListener(ACARA_BUKA_PROFIL, onBuka);
    return () => window.removeEventListener(ACARA_BUKA_PROFIL, onBuka);
  }, []);

  useEffect(() => { setBuka(false); }, [pathname]);

  return (
    <Modal buka={buka} onTutup={() => setBuka(false)} judul="Profil Akun" lebar="penuh" polos blur>
      <IsiProfil onTutup={() => setBuka(false)} />
    </Modal>
  );
}

/* ── Bagian kecil ─────────────────────────────────────────────────────────── */

/** Ikon garis 24×24 (gaya Lucide) — satu tempat, supaya semua panel seragam. */
const JALUR_IKON = {
  orang: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1',
  pagar: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  surel: 'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 7l-10 6L2 7',
  hp: 'M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zM12 18h.01',
  gedung: 'M6 2h12a2 2 0 012 2v18H4V4a2 2 0 012-2zM9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01',
  sasaran: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  tas: 'M4 7h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2zM16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16',
  bintang: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  rumah: 'M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V10zM9 22V12h6v10',
  tiket: 'M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2v2zM13 5v2M13 11v2M13 17v2',
  kalender: 'M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM16 2v4M8 2v4M3 10h18',
  centang: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3',
  kunci: 'M7.5 21a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11.4 11.6L21 2M15.5 7.5l3 3L22 7l-3-3',
  struktur: 'M9 2h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM5 16v-3a1 1 0 011-1h12a1 1 0 011 1v3M12 12V8',
  gembok: 'M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zM7 11V7a5 5 0 0110 0v4',
  perisai: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  label: 'M12 2H2v10l9.29 9.29a1 1 0 001.41 0l8.59-8.59a1 1 0 000-1.41L12 2zM7 7h.01',
  lonceng: 'M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0',
  grafik: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
} as const;
type NamaIkon = keyof typeof JALUR_IKON;

function Ikon({ nama, kecil }: { nama: NamaIkon; kecil?: boolean }) {
  const s = kecil ? 13 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
      <path d={JALUR_IKON[nama]} />
    </svg>
  );
}

function KotakAngka({ nilai, label, kuning }: { nilai: number; label: string; kuning?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-center min-w-[78px] flex flex-col justify-center
                     ${kuning ? 'bg-amber-400 text-amber-950' : 'bg-slate-950/30 text-white'}`}>
      <p className="text-[26px] font-black leading-none tabular-nums">{nilai}</p>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] mt-1.5 opacity-80">{label}</p>
    </div>
  );
}

function Panel({ ikon, judul, jumlah, aksi, rapat, children }: {
  ikon: NamaIkon;
  judul: string;
  jumlah?: string;
  aksi?: React.ReactNode;
  /** Tanpa padding isi — barisnya sendiri yang memberi jarak tepi. */
  rapat?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-kartu border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,.05)] overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
        <span className="text-slate-500"><Ikon nama={ikon} /></span>
        <h2 className="text-[11px] font-bold text-slate-700 uppercase tracking-[0.14em] flex-1">{judul}</h2>
        {jumlah && (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
            {jumlah}
          </span>
        )}
        {aksi}
      </header>
      <div className={rapat ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

function Baris({ ikon, label, nilai, hijau }: {
  ikon: NamaIkon; label: string; nilai: string | null | undefined; hijau?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-slate-400"><Ikon nama={ikon} kecil /></span>
      <dt className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em] flex-1 min-w-0">{label}</dt>
      <dd className={`text-[13.5px] text-right min-w-0 truncate
                      ${!nilai ? 'text-slate-400 italic' : hijau ? 'font-bold text-[#059669]' : 'font-semibold text-slate-800'}`}>
        {hijau && nilai && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#059669] mr-1.5 align-middle" />}
        {nilai || 'Belum diisi'}
      </dd>
    </div>
  );
}

function Kelompok({ label, warna, orang, kosong }: {
  label: string; warna: string; orang: { id: string; full_name: string; role: string }[]; kosong: string;
}) {
  return (
    <div>
      <p className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${warna}`}>{label}</p>
      {orang.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic mt-1">{kosong}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 mt-1.5">
          {orang.map((o) => (
            <li key={o.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700">
              {o.full_name}
              <span className="text-[10px] font-bold text-slate-400">
                {LABEL_PERAN[o.role as Peran] ?? o.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kotak({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
      <p className="text-[15px] font-black text-slate-800 tabular-nums leading-none">{nilai}</p>
      <p className="text-[10px] font-semibold text-slate-500 mt-1 leading-tight">{label}</p>
    </div>
  );
}
