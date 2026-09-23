'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { masuk } from '@/lib/auth';
import { halamanAwal } from '@/lib/menu-akses';
import { KataSandi } from '@/components/shared/FormParts';
import { useBranding, type Branding } from '@/lib/branding';
import { FormDaftar } from './_components/FormDaftar';

/**
 * Halaman masuk — tata letak dua sisi mengikuti pola Work Management (§60):
 * panel branding di kiri, kartu formulir di kanan.
 *
 * Panel kiri disembunyikan di bawah lg dan itu bukan sekadar penghematan
 * ruang: di ponsel, panel setinggi layar akan mendorong formulirnya ke bawah
 * lipatan, sehingga hal pertama yang dilihat orang yang hendak masuk justru
 * bukan kolom isiannya. Identitas platform tetap muncul di ponsel, tapi
 * sebagai baris ringkas di dalam kartu.
 *
 * Latar memakai gradien dan bentuk CSS, bukan gambar. Work Management memakai
 * foto bermerek; di sini fotonya belum ada, dan memasang placeholder kosong
 * akan terlihat seperti aset yang gagal dimuat — bukan seperti keputusan.
 */
export default function HalamanMasuk() {
  const router = useRouter();
  const { branding } = useBranding();
  const [username, setUsername] = useState('');
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState('');
  const [memproses, setMemproses] = useState(false);
  const [berhasil, setBerhasil] = useState(false);
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk');
  const [pesanDaftar, setPesanDaftar] = useState('');

  useEffect(() => {
    let batal = false;
    (async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (batal || !res.ok) return;
      const data = await res.json();
      const tujuan = data.user ? await halamanAwal(data.user.id, data.user.role) : '/dashboard';
      if (!batal) router.replace(tujuan);
    })().catch(() => { /* belum ada sesi — tetap di halaman ini */ });
    return () => { batal = true; };
  }, [router]);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGalat('');
    setMemproses(true);
    try {
      const pengguna = await masuk(username.trim(), sandi);
      const tujuan = await halamanAwal(pengguna.id, pengguna.role);
      // Kepastian bahwa sandinya benar tampil lebih dulu, sebelum pengalihan.
      // Tanpa jeda singkat ini, layar berganti begitu cepat sehingga yang
      // terasa justru ragu — apakah tadi berhasil atau halamannya error.
      setBerhasil(true);
      setTimeout(() => router.replace(tujuan), 450);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal masuk.');
      setMemproses(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] bg-slate-100">

      {/* ── KIRI: panel branding (desktop) ── */}
      <aside
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 text-white overflow-hidden"
        style={{
          background: `linear-gradient(145deg, ${branding.warna_utama_2} 0%, ${branding.warna_utama} 48%, ${branding.warna_utama} 100%)`,
        }}
      >
        {/* Foto latar, bila admin memasangnya. Digelapkan supaya teks putih di
            atasnya tetap terbaca berapa pun terang fotonya. */}
        {branding.latar_login_url && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center opacity-35"
            style={{ backgroundImage: `url(${branding.latar_login_url})` }}
          />
        )}
        <BentukLatar />

        <div className="relative flex items-center gap-3">
          <LogoLogin branding={branding} ukuran={40} />
          <span className="text-lg font-bold tracking-tight">
            {branding.nama_platform}
            {branding.nama_portal && (
              <span className="font-normal text-white/70"> · {branding.nama_portal}</span>
            )}
          </span>
        </div>

        <div className="relative max-w-lg">
          {/*
            Judul sengaja PENDEK dan tanpa <br /> paksa.
            Versi sebelumnya berbunyi "Aktivitas Sales yang bisa
            dipertanggungjawabkan" dengan pemutus baris manual di tengahnya.
            Hasilnya pecah buruk: "dipertanggungjawabkan" panjangnya 21 huruf
            dan tidak bisa dipenggal peramban, sehingga ia terlempar sendirian
            ke baris ketiga dan menyisakan baris kedua berisi satu kata "bisa".
            Pemutus baris manual selalu berakhir begitu — ia benar pada satu
            lebar layar dan salah pada semua lebar lainnya.

            text-balance membiarkan peramban membagi barisnya rata sendiri,
            dan ukuran clamp() menyusut mengikuti lebar kolom.
          */}
          <h1 className="text-[clamp(28px,3.1vw,38px)] leading-[1.14] font-black mb-4 tracking-tight text-balance">
            Aktivitas Sales yang bisa dibuktikan.
          </h1>
          <p className="text-white/80 text-[15px] leading-relaxed mb-8 text-pretty">
            Laporan harian, pipeline dengan margin yang dihitung sistem, dan meeting
            yang terbukti dihadiri — lengkap dengan verifikasi lokasi dan foto bukti.
          </p>
          <ul className="flex flex-wrap gap-2.5 list-none p-0 m-0">
            {[
              ['📝', 'Daily Report'],
              ['📊', 'Sales Pipeline'],
              ['🗓️', 'Request Schedule'],
              ['📍', 'Meeting GPS & Evidence'],
            ].map(([ikon, label]) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-kontrol bg-white/12
                           backdrop-blur text-sm font-semibold border border-white/15"
              >
                <span aria-hidden="true">{ikon}</span> {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-white/50 text-xs">
          © {new Date().getFullYear()} {branding.nama_perusahaan || branding.nama_platform}
          {branding.kredit && <span className="ml-2">· {branding.kredit}</span>}
        </p>
      </aside>

      {/* ── KANAN: kartu formulir ── */}
      <section className="relative flex-1 flex items-center justify-center p-4 sm:p-8
                          bg-gradient-to-br from-slate-100 via-white to-aksen-50">
        <div className={`w-full bg-white/95 backdrop-blur-xl rounded-panel shadow-kartu
                         border border-white p-6 sm:p-8 transition-[max-width] duration-300
                         ${mode === 'daftar' ? 'max-w-2xl' : 'max-w-md'}`}>

          {/* Identitas untuk ponsel — di desktop sudah ada di panel kiri. */}
          <div className="flex lg:hidden items-center gap-2.5 mb-6">
            <LogoLogin branding={branding} ukuran={38} biru />
            <span className="text-base font-bold text-slate-800 truncate">
              {branding.nama_pendek || branding.nama_platform}
            </span>
          </div>

          {pesanDaftar && (
            <div role="status"
              className="mb-5 px-4 py-3 rounded-kontrol text-[13px] leading-relaxed
                         text-[#1a6b1a] bg-[#e0f2e0] border border-[#008300]/30">
              <b className="font-bold block mb-0.5">Pendaftaran terkirim</b>
              {pesanDaftar}
            </div>
          )}

          {mode === 'daftar' ? (
            <FormDaftar
              warnaUtama={branding.warna_utama}
              warnaUtama2={branding.warna_utama_2}
              onKembali={() => setMode('masuk')}
              onSelesai={(pesan) => { setPesanDaftar(pesan); setMode('masuk'); }}
            />
          ) : (
          <>
          <header className="mb-7">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Selamat Datang
            </h2>
            <p className="text-slate-500 text-sm mt-1.5">Masuk ke akun Anda untuk melanjutkan</p>
          </header>

          <form onSubmit={kirim} className="flex flex-col gap-4">
            <div>
              <label htmlFor="username" className="block text-[11px] font-bold mb-2 text-slate-600 tracking-widest uppercase">
                Username
              </label>
              <input
                id="username" type="text" value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" autoCorrect="off"
                required disabled={memproses} placeholder="nama.anda"
                className="w-full border border-slate-200 rounded-kontrol px-4 py-3 text-sm font-medium
                           text-slate-800 bg-white outline-none transition-all
                           placeholder:text-slate-400 placeholder:font-normal
                           focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15
                           disabled:bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="sandi" className="block text-[11px] font-bold mb-2 text-slate-600 tracking-widest uppercase">
                Kata Sandi
              </label>
              {/* Tombol tampil/sembunyikan ikut serta dari komponennya — lihat
                  catatan di KataSandi soal kenapa ia tidak boleh opsional. */}
              <KataSandi
                id="sandi" nilai={sandi} onUbah={setSandi}
                disabled={memproses} autoComplete="current-password"
              />
            </div>

            {galat && (
              <p role="alert" className="px-4 py-2.5 rounded-kontrol text-[13px] font-medium
                                         text-[#c93c3b] bg-[#fce3e3] border border-[#e34948]/30">
                {galat}
              </p>
            )}

            <button
              type="submit"
              disabled={memproses}
              className="w-full text-white py-3.5 rounded-kontrol font-bold text-sm tracking-wide mt-1
                         shadow-lg transition-all flex items-center justify-center gap-2
                         disabled:cursor-not-allowed hover:opacity-90"
              style={{
                background: berhasil
                  ? 'linear-gradient(to right, #047857, #008300)'
                  : `linear-gradient(to right, ${branding.warna_utama_2}, ${branding.warna_utama})`,
                opacity: memproses && !berhasil ? 0.75 : 1,
              }}
            >
              {berhasil ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Berhasil masuk
                </>
              ) : memproses ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Memverifikasi…
                </>
              ) : (
                'Masuk'
              )}
            </button>
          </form>

          <p className="text-center text-[12px] text-slate-500 mt-6">
            Belum punya akun?{' '}
            <button type="button" onClick={() => { setMode('daftar'); setPesanDaftar(''); }}
              className="font-bold underline underline-offset-2"
              style={{ color: branding.warna_utama }}>
              Daftar di sini
            </button>
          </p>

          <p className="text-center text-[11px] text-slate-400 mt-2">
            Lupa kata sandi? Hubungi admin untuk mengatur ulang.
            {branding.kontak_bantuan && (
              <><br /><span className="font-semibold text-slate-500">{branding.kontak_bantuan}</span></>
            )}
          </p>
          </>
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * Bentuk dekoratif di panel kiri. aria-hidden dan pointer-events-none —
 * murni hiasan, jadi ia tidak boleh muncul di pembaca layar maupun
 * menghalangi klik.
 */
function BentukLatar() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute -top-28 -right-24 w-[380px] h-[380px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,.13) 0%, transparent 68%)' }} />
      <div className="absolute -bottom-36 -left-24 w-[440px] h-[440px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,.09) 0%, transparent 68%)' }} />
      <div className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }} />
    </div>
  );
}

/**
 * Logo pada halaman masuk. Memakai berkas yang diunggah admin bila ada;
 * kalau belum, lencana bawaan — bukan kotak kosong yang terlihat seperti
 * gambar yang gagal dimuat.
 */
function LogoLogin({ branding, ukuran, biru }: {
  branding: Branding; ukuran: number; biru?: boolean;
}) {
  if (branding.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logo_url} alt={branding.nama_platform}
        className="rounded-kontrol object-contain flex-shrink-0 bg-white/90"
        style={{ width: ukuran, height: ukuran }}
      />
    );
  }
  return <LogoKotak ukuran={ukuran} biru={biru} warna={branding.warna_utama} />;
}

function LogoKotak({ ukuran, biru, warna = '#1d4ed8' }: {
  ukuran: number; biru?: boolean; warna?: string;
}) {
  return (
    <span
      className="rounded-kontrol grid place-items-center flex-shrink-0"
      style={{
        width: ukuran, height: ukuran,
        background: biru
          ? `linear-gradient(135deg, ${warna}, ${warna}cc)`
          : 'rgba(255,255,255,0.16)',
        border: biru ? 'none' : '1px solid rgba(255,255,255,0.22)',
      }}
    >
      <svg width={ukuran * 0.46} height={ukuran * 0.46} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

