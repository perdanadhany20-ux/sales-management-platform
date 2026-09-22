'use client';

import { useState } from 'react';
import { usePenggunaAktif, keluar } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { LABEL_PERAN, type Peran } from '@/lib/constants';
import { BentoGrid, BentoCard } from '@/components/shared/Bento';
import { Kolom, KataSandi, Tombol } from '@/components/shared/FormParts';
import { PanelGalat, LayarMemuat, useToast } from '@/components/shared/Feedback';

/**
 * Profil akun — identitas sendiri dan penggantian kata sandi.
 *
 * Tidak ada penyuntingan peran di sini, dan itu disengaja: peran menentukan
 * apa yang boleh dilihat seseorang, jadi menaruhnya di halaman yang bisa
 * disunting pemiliknya sendiri akan membuat seluruh model wewenang tidak ada
 * artinya. Perubahan peran hanya lewat Admin Panel.
 */
export default function HalamanProfil() {
  const { pengguna, memuat } = usePenggunaAktif();
  const toast = useToast();
  const router = useRouter();

  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  if (memuat) return <LayarMemuat />;
  if (!pengguna) return null;

  async function gantiSandi(e: React.FormEvent) {
    e.preventDefault();
    setGalat(null);

    if (baru !== ulangi) {
      setGalat('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setMemproses(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password_lama: lama, password_baru: baru }),
      });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Gagal mengganti kata sandi.'); return; }

      toast('sukses', 'Kata sandi diperbarui. Sesi di perangkat lain telah dikeluarkan.');
      setLama(''); setBaru(''); setUlangi('');
    } catch {
      setGalat('Jaringan bermasalah. Coba lagi.');
    } finally {
      setMemproses(false);
    }
  }

  const inisial = pengguna.full_name.trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <header>
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Profil Akun</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">Identitas Anda dan keamanan akun.</p>
      </header>

      <BentoGrid>
        <BentoCard rentang={4} tinggi="sedang" rupa="sorot" judul="Identitas">
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <span className="w-16 h-16 rounded-full bg-white/20 border border-white/25 grid place-items-center text-xl font-black text-white">
              {inisial || '?'}
            </span>
            <div>
              <p className="text-base font-black text-white leading-tight">{pengguna.full_name}</p>
              <p className="text-[12px] text-white/70 mt-0.5">@{pengguna.username}</p>
            </div>
            <span className="inline-flex items-center rounded-kecil bg-white/18 border border-white/20 px-3 py-1 text-[11px] font-bold text-white">
              {LABEL_PERAN[pengguna.role as Peran] ?? pengguna.role}
            </span>
          </div>
        </BentoCard>

        <BentoCard rentang={8} tinggi="sedang" judul="Ganti Kata Sandi">
          <form onSubmit={gantiSandi} className="flex flex-col gap-3.5">
            {galat && <PanelGalat pesan={galat} />}

            <Kolom label="Kata Sandi Saat Ini" wajib>
              {(id) => (
                <KataSandi id={id} nilai={lama} onUbah={setLama}
                  disabled={memproses} autoComplete="current-password" />
              )}
            </Kolom>

            <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3.5">
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

            <div>
              <Tombol type="submit" memuat={memproses}
                disabled={!lama || !baru || !ulangi}>
                {memproses ? 'Menyimpan…' : 'Simpan Kata Sandi'}
              </Tombol>
            </div>
          </form>
        </BentoCard>

        <BentoCard rentang={12} tinggi="auto" rupa="garis" judul="Sesi">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-[12px] text-slate-600 leading-relaxed max-w-md">
              Keluar akan menghapus sesi ini dari server, bukan sekadar dari peramban —
              cookie yang terlanjur disalin pun ikut tidak berlaku lagi.
            </p>
            <Tombol
              rupa="bahaya"
              onClick={async () => { await keluar(); router.replace('/'); }}
            >
              Keluar dari Akun
            </Tombol>
          </div>
        </BentoCard>
      </BentoGrid>
    </div>
  );
}
