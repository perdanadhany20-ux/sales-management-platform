'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { masuk } from '@/lib/auth';
import { KataSandi } from '@/components/shared/FormParts';

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
  const [username, setUsername] = useState('');
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState('');
  const [memproses, setMemproses] = useState(false);
  const [berhasil, setBerhasil] = useState(false);

  useEffect(() => {
    let batal = false;
    (async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!batal && res.ok) router.replace('/dashboard');
    })().catch(() => { /* belum ada sesi — tetap di halaman ini */ });
    return () => { batal = true; };
  }, [router]);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGalat('');
    setMemproses(true);
    try {
      await masuk(username.trim(), sandi);
      // Kepastian bahwa sandinya benar tampil lebih dulu, sebelum pengalihan.
      // Tanpa jeda singkat ini, layar berganti begitu cepat sehingga yang
      // terasa justru ragu — apakah tadi berhasil atau halamannya error.
      setBerhasil(true);
      setTimeout(() => router.replace('/dashboard'), 450);
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
        style={{ background: 'linear-gradient(145deg, #1e3a8a 0%, #1d4ed8 48%, #2563eb 100%)' }}
      >
        <BentukLatar />

        <div className="relative flex items-center gap-3">
          <LogoKotak ukuran={40} />
          <span className="text-lg font-bold tracking-tight">
            Sales Management <span className="font-normal text-white/70">· Platform</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[40px] leading-[1.1] font-black mb-4 tracking-tight">
            Aktivitas Sales yang<br />bisa dipertanggungjawabkan.
          </h1>
          <p className="text-white/80 text-base leading-relaxed mb-8">
            Laporan harian, pipeline dengan margin yang dihitung sendiri oleh sistem,
            dan meeting yang terbukti dihadiri — lengkap dengan verifikasi lokasi
            dan bukti foto.
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
          © {new Date().getFullYear()} Sales Management Platform
        </p>
      </aside>

      {/* ── KANAN: kartu formulir ── */}
      <section className="relative flex-1 flex items-center justify-center p-4 sm:p-8
                          bg-gradient-to-br from-slate-100 via-white to-aksen-50">
        <div className="w-full max-w-md bg-white/95 backdrop-blur-xl rounded-panel shadow-kartu
                        border border-white p-6 sm:p-8">

          {/* Identitas untuk ponsel — di desktop sudah ada di panel kiri. */}
          <div className="flex lg:hidden items-center gap-2.5 mb-6">
            <LogoKotak ukuran={38} biru />
            <span className="text-base font-bold text-slate-800">
              Sales Management <span className="text-slate-400 font-normal">· Platform</span>
            </span>
          </div>

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
                  : 'linear-gradient(to right, #1e3a8a, #2563eb)',
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

          <p className="text-center text-[11px] text-slate-400 mt-6">
            Lupa kata sandi? Hubungi admin untuk mengatur ulang.
          </p>
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

function LogoKotak({ ukuran, biru }: { ukuran: number; biru?: boolean }) {
  return (
    <span
      className="rounded-kontrol grid place-items-center flex-shrink-0"
      style={{
        width: ukuran, height: ukuran,
        background: biru
          ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)'
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

