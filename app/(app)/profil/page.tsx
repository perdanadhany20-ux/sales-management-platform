'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { usePenggunaAktif, keluar } from '@/lib/auth';
import { isPengawas, LABEL_PERAN, type Peran } from '@/lib/constants';
import { tanggalPendek, waktuPendek, angka, rupiahRingkas } from '@/lib/format';
import { MENU_APLIKASI } from '@/components/shared/Shell';
import {
  statusPengingat, nyalakanPengingat, matikanPengingat, type StatusPengingat,
} from '@/lib/notifikasi';
import { Kolom, KataSandi, Teks, Tombol } from '@/components/shared/FormParts';
import { PanelGalat, LayarMemuat, useToast } from '@/components/shared/Feedback';

/**
 * Profil Akun — kartu identitas lengkap, bukan sekadar formulir ganti sandi.
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
}

interface Rekan { id: string; full_name: string; role: string; active: boolean }

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

export default function HalamanProfil() {
  const { pengguna, memuat, muatUlang } = usePenggunaAktif();
  const toast = useToast();
  const router = useRouter();

  const [profil, setProfil] = useState<Profil | null>(null);
  const [sandiDiperbarui, setSandiDiperbarui] = useState<string | null>(null);
  const [jumlahSesi, setJumlahSesi] = useState(0);
  const [sesiIni, setSesiIni] = useState<{ created_at: string; expires_at: string } | null>(null);
  const [rekan, setRekan] = useState<Rekan[]>([]);
  const [ringkas, setRingkas] = useState<Ringkasan>({ laporan: 0, pipeline: 0, nilai: 0, meeting: 0 });

  const [ubahKontak, setUbahKontak] = useState(false);
  const [email, setEmail] = useState('');
  const [telepon, setTelepon] = useState('');
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
  }, []);

  useEffect(() => { void muatProfil(); }, [muatProfil]);

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

  const modul = useMemo(() => {
    const peran = pengguna?.role ?? '';
    const daftar = MENU_APLIKASI.filter((m) => !m.untuk || m.untuk(peran));
    const k = cariModul.trim().toLowerCase();
    return {
      semua: daftar,
      tersaring: k ? daftar.filter((m) => m.label.toLowerCase().includes(k)) : daftar,
    };
  }, [pengguna?.role, cariModul]);

  if (memuat) return <LayarMemuat />;
  if (!pengguna) return null;

  const peran = (pengguna.role.toUpperCase() as Peran);
  const level = LEVEL_AKSES[peran] ?? LEVEL_AKSES.SALES;
  const inisial = pengguna.full_name.trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();

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
        body: JSON.stringify({ email, phone: telepon }),
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

  return (
    <div className="flex flex-col gap-4 max-w-6xl">

      {/* ── Spanduk identitas ── */}
      <header className="relative overflow-hidden rounded-kartu bg-gradient-to-br from-aksen-800 via-aksen-700 to-aksen-500 text-white shadow-bento">
        <div
          aria-hidden="true"
          className="absolute -right-10 -top-16 w-56 h-56 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative px-5 sm:px-6 py-5 flex flex-wrap items-start gap-4">
          <span className="w-14 h-14 rounded-full bg-white/20 border border-white/30 grid place-items-center text-lg font-black flex-shrink-0">
            {inisial || '?'}
          </span>

          <div className="flex-1 min-w-[200px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/70">
              {salam()} · {profil?.email ?? `@${pengguna.username}`}
            </p>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-tight mt-1">
              {pengguna.full_name}
            </h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="inline-flex items-center gap-1 rounded-kecil bg-white/20 border border-white/25 px-2.5 py-1 text-[11px] font-bold">
                🛡 {LABEL_PERAN[peran] ?? pengguna.role}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-kecil px-2.5 py-1 text-[11px] font-bold
                                ${profil?.active === false ? 'bg-[#e34948] text-white' : 'bg-white/20 border border-white/25'}`}>
                ● {profil?.active === false ? 'Nonaktif' : 'Aktif'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <KotakAngka nilai={modul.semua.length} label="MODUL" />
            <KotakAngka nilai={jumlahSesi} label="SESI" kuning />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 satulayar:grid-cols-12 gap-4 items-start">

        {/* ══ Kolom kiri ══ */}
        <div className="satulayar:col-span-7 flex flex-col gap-4">

          <Panel ikon="👤" judul="Informasi Pribadi & Kontak"
            aksi={!ubahKontak && (
              <button type="button" onClick={() => setUbahKontak(true)}
                className="text-[11px] font-bold text-aksen-700 hover:underline underline-offset-2">
                Ubah kontak
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
                <div className="flex justify-end gap-2">
                  <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => {
                    setUbahKontak(false);
                    setEmail(profil?.email ?? '');
                    setTelepon(profil?.phone ?? '');
                  }}>Batal</Tombol>
                  <Tombol type="submit" className="text-[12px] py-2" memuat={simpanKontak}>Simpan</Tombol>
                </div>
              </form>
            ) : (
              <dl className="flex flex-col">
                <Baris ikon="#" label="Username" nilai={pengguna.username} />
                <Baris ikon="🧾" label="Nama Lengkap" nilai={pengguna.full_name} />
                <Baris ikon="✉️" label="Email" nilai={profil?.email} />
                <Baris ikon="📱" label="No. Telepon / WA" nilai={profil?.phone} />
                <Baris ikon="⭐" label="Peran" nilai={LABEL_PERAN[peran] ?? pengguna.role} />
                <Baris ikon="📅" label="Bergabung Sejak"
                  nilai={profil ? tanggalPendek(profil.created_at) : null} />
                <Baris ikon="🔑" label="Sandi Diperbarui"
                  nilai={sandiDiperbarui ? tanggalPendek(sandiDiperbarui) : 'Belum pernah diganti'} />
              </dl>
            )}
          </Panel>

          <Panel ikon="🏢" judul="Struktur Organisasi">
            <div className="flex flex-col gap-3">
              <Kelompok
                label="Pengawas (Manager & Admin)"
                kosong="Belum ada pengawas lain terdaftar."
                orang={pengawasLain}
              />
              <Kelompok
                label={peran === 'SALES' ? 'Rekan Sales' : 'Tim Sales'}
                kosong="Belum ada Sales terdaftar."
                orang={timSales}
              />
            </div>
          </Panel>

          <Panel ikon="🔐" judul="Keamanan & Sandi">
            <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-100">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Sesi saat ini</p>
                <p className="text-[12px] font-bold text-[#008300] mt-0.5">● Online &amp; terotentikasi</p>
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
              <div className="flex items-center gap-2 flex-wrap pt-3">
                <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => setBukaSandi(true)}>
                  🔑 Ubah Kata Sandi
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
        </div>

        {/* ══ Kolom kanan ══ */}
        <div className="satulayar:col-span-5 flex flex-col gap-4">

          <Panel ikon="🎫" judul="Peran Pengguna" jumlah="1 Peran">
            <span className="inline-flex items-center rounded-kecil bg-aksen-50 border border-aksen-200 px-3 py-1.5 text-[12px] font-bold text-aksen-800">
              {LABEL_PERAN[peran] ?? pengguna.role}
            </span>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-3">Level akses</p>
            <span className="inline-flex items-center rounded-kecil px-3 py-1.5 text-[12px] font-bold mt-1"
              style={{ color: level.warna, background: level.bg }}>
              🔓 {level.label}
            </span>
            <p className="text-[11px] text-slate-500 mt-2.5 leading-relaxed">
              {peran === 'ADMIN'
                ? 'Seluruh modul, pengelolaan akun, dan konfigurasi platform.'
                : peran === 'MANAGER'
                  ? 'Melihat data seluruh tim, menugaskan jadwal, dan menyetujui override meeting.'
                  : 'Data milik sendiri: laporan, pipeline, dan meeting yang ditugaskan kepada Anda.'}
            </p>
          </Panel>

          <Panel ikon="📦" judul="Hak Akses Modul" jumlah={`${modul.semua.length} modul`}>
            <Teks
              type="search" value={cariModul} onChange={(e) => setCariModul(e.target.value)}
              placeholder="🔍 Cari modul…" aria-label="Cari modul"
            />
            {modul.tersaring.length === 0 ? (
              <p className="text-[11px] text-slate-400 mt-3">Tidak ada modul yang cocok.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 mt-3">
                {modul.tersaring.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href}
                      className="inline-flex items-center gap-1.5 rounded-kecil bg-slate-100 hover:bg-aksen-50 hover:text-aksen-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors">
                      <span className="text-slate-400">{m.ikon}</span>
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
              Daftar ini mengikuti peran Anda. Penyembunyian menu hanya merapikan tampilan —
              yang benar-benar menolak akses adalah aturan di database.
            </p>
          </Panel>

          <Panel ikon="🔔" judul="Pengingat">
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
                  <Tombol rupa="kedua" className="text-[12px] py-2"
                    onClick={() => { matikanPengingat(); setPengingat(statusPengingat()); }}>
                    Matikan Pengingat
                  </Tombol>
                ) : (
                  <Tombol className="text-[12px] py-2"
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
          </Panel>

          <Panel ikon="📊" judul="Ringkasan Aktivitas Anda">
            <div className="grid grid-cols-2 gap-2">
              <Kotak label="Laporan Harian" nilai={angka(ringkas.laporan)} />
              <Kotak label="Baris Pipeline" nilai={angka(ringkas.pipeline)} />
              <Kotak label="Nilai Pipeline" nilai={rupiahRingkas(ringkas.nilai)} />
              <Kotak label="Jadwal Selesai" nilai={angka(ringkas.meeting)} />
            </div>
            <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
              Dihitung langsung dari data Anda, bukan dari cache.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── Bagian kecil ─────────────────────────────────────────────────────────── */

function KotakAngka({ nilai, label, kuning }: { nilai: number; label: string; kuning?: boolean }) {
  return (
    <div className={`rounded-kartu px-3.5 py-2.5 text-center min-w-[68px]
                     ${kuning ? 'bg-[#eda100] text-white' : 'bg-slate-900/25 border border-white/15'}`}>
      <p className="text-lg font-black leading-none tabular-nums">{nilai}</p>
      <p className="text-[9px] font-bold uppercase tracking-wider mt-1 opacity-80">{label}</p>
    </div>
  );
}

function Panel({ ikon, judul, jumlah, aksi, children }: {
  ikon: string;
  judul: string;
  jumlah?: string;
  aksi?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-kartu border border-slate-200 shadow-bento overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
        <span aria-hidden="true" className="text-[13px]">{ikon}</span>
        <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide flex-1">{judul}</h2>
        {jumlah && (
          <span className="rounded-kecil bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {jumlah}
          </span>
        )}
        {aksi}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Baris({ ikon, label, nilai }: { ikon: string; label: string; nilai: string | null | undefined }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <span aria-hidden="true" className="text-[12px] w-4 text-center text-slate-400">{ikon}</span>
      <dt className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex-1 min-w-0">{label}</dt>
      <dd className={`text-[13px] font-semibold text-right min-w-0 truncate ${nilai ? 'text-slate-800' : 'text-slate-400 italic font-normal'}`}>
        {nilai || 'Belum diisi'}
      </dd>
    </div>
  );
}

function Kelompok({ label, orang, kosong }: { label: string; orang: { id: string; full_name: string; role: string }[]; kosong: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-[#eda100] uppercase tracking-wide">{label}</p>
      {orang.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic mt-1">{kosong}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 mt-1.5">
          {orang.map((o) => (
            <li key={o.id}
              className="inline-flex items-center gap-1.5 rounded-kecil bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
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
    <div className="rounded-kontrol bg-slate-50 border border-slate-200 px-3 py-2.5">
      <p className="text-sm font-black text-slate-800 tabular-nums leading-none">{nilai}</p>
      <p className="text-[10px] font-semibold text-slate-500 mt-1 leading-tight">{label}</p>
    </div>
  );
}
