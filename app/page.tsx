'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { masuk } from '@/lib/auth';
import { Kolom, Teks, Tombol } from '@/components/shared/FormParts';
import { PanelGalat } from '@/components/shared/Feedback';

export default function HalamanMasuk() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [sandi, setSandi] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  // Kalau cookie sesinya masih hidup, langsung masuk ke dashboard daripada
  // memaksa orang mengetik ulang kredensial yang tidak diperlukan.
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
    setGalat(null);
    setMemproses(true);
    try {
      await masuk(username.trim(), sandi);
      router.replace('/dashboard');
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal masuk.');
      setMemproses(false);
    }
  }

  return (
    <main className="min-h-[100dvh] grid place-items-center p-4
                     bg-gradient-to-br from-slate-100 via-slate-50 to-aksen-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-7">
          <div className="w-14 h-14 rounded-kartu bg-gradient-to-br from-aksen-700 to-aksen-500
                          grid place-items-center shadow-bento">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Sales Management</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Masuk untuk melanjutkan</p>
          </div>
        </div>

        <form
          onSubmit={kirim}
          className="bg-white rounded-panel shadow-kartu p-6 flex flex-col gap-4"
        >
          {galat && <PanelGalat pesan={galat} />}

          <Kolom label="Username" wajib>
            {(id) => (
              <Teks
                id={id} value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" autoCorrect="off"
                required disabled={memproses} placeholder="nama.anda"
              />
            )}
          </Kolom>

          <Kolom label="Kata Sandi" wajib>
            {(id) => (
              <Teks
                id={id} type="password" value={sandi} onChange={(e) => setSandi(e.target.value)}
                autoComplete="current-password" required disabled={memproses} placeholder="••••••••"
              />
            )}
          </Kolom>

          <Tombol type="submit" memuat={memproses} className="mt-1 w-full py-3">
            {memproses ? 'Memeriksa…' : 'Masuk'}
          </Tombol>
        </form>

        <p className="text-center text-[11px] text-slate-400 mt-5">
          Lupa kata sandi? Hubungi admin untuk mengatur ulang.
        </p>
      </div>
    </main>
  );
}
