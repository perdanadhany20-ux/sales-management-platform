// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Kolom, KataSandi, Teks, Tombol, Lencana } from '@/components/shared/FormParts';
import { PanelGalat, useToast } from '@/components/shared/Feedback';
import { tanggalPendek, waktuPendek } from '@/lib/format';

/**
 * components/shared/KeamananAkun.tsx — dua bagian keamanan di Profil:
 *   1. Verifikasi dua langkah (TOTP + kode cadangan)
 *   2. Perangkat aktif (sesi di perangkat lain bisa diputus)
 * Semua logika & penyimpanan ada di server (/api/auth/2fa, /api/auth/sesi).
 */

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Permintaan gagal.');
  return data as T;
}

/* ══ Verifikasi dua langkah ═══════════════════════════════════════════════ */

type Tahap = 'diam' | 'pindai' | 'cadangan' | 'matikan' | 'buatCadangan';

export function DuaLangkah() {
  const toast = useToast();
  const [status, setStatus] = useState<{ aktif: boolean; sisa_cadangan: number; diaktifkan_at: string | null } | null>(null);
  const [tahap, setTahap] = useState<Tahap>('diam');
  const [qr, setQr] = useState<{ rahasia: string; qr: string } | null>(null);
  const [kode, setKode] = useState('');
  const [sandi, setSandi] = useState('');
  const [cadangan, setCadangan] = useState<string[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [proses, setProses] = useState(false);

  const muat = useCallback(async () => {
    try { setStatus(await api('/api/auth/2fa')); } catch { /* panel tetap tampil */ }
  }, []);
  useEffect(() => { void muat(); }, [muat]);

  const reset = () => { setTahap('diam'); setKode(''); setSandi(''); setGalat(null); setQr(null); };

  async function jalankan(fn: () => Promise<void>) {
    setGalat(null); setProses(true);
    try { await fn(); } catch (e) { setGalat(e instanceof Error ? e.message : 'Gagal.'); } finally { setProses(false); }
  }

  const mulai = () => jalankan(async () => {
    setQr(await api('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ aksi: 'mulai' }) }));
    setTahap('pindai');
  });

  const aktifkan = (e: React.FormEvent) => { e.preventDefault(); void jalankan(async () => {
    const r = await api<{ kode_cadangan: string[] }>('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ aksi: 'aktifkan', kode }) });
    setCadangan(r.kode_cadangan); setTahap('cadangan'); setKode(''); setQr(null);
    toast('sukses', 'Verifikasi dua langkah aktif.');
    void muat();
  }); };

  const buatCadangan = (e: React.FormEvent) => { e.preventDefault(); void jalankan(async () => {
    const r = await api<{ kode_cadangan: string[] }>('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ aksi: 'cadangan', sandi }) });
    setCadangan(r.kode_cadangan); setTahap('cadangan'); setSandi('');
    void muat();
  }); };

  const matikan = (e: React.FormEvent) => { e.preventDefault(); void jalankan(async () => {
    await api('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ aksi: 'matikan', sandi, kode }) });
    toast('info', 'Verifikasi dua langkah dimatikan.');
    reset(); void muat();
  }); };

  function unduhCadangan() {
    const isi = ['Kode cadangan verifikasi dua langkah', `Dibuat: ${new Date().toLocaleString('id-ID')}`,
      'Setiap kode hanya bisa dipakai sekali. Simpan di tempat aman.', '', ...cadangan].join('\r\n');
    const url = URL.createObjectURL(new Blob([isi], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = 'kode-cadangan-2fa.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  if (!status) return <p className="text-[12px] text-slate-400">Memuat…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-bold text-slate-800">Verifikasi dua langkah (2FA)</p>
            {status.aktif
              ? <Lencana label="Aktif" color="#008300" bg="#e0f2e0" />
              : <Lencana label="Belum aktif" color="#b45309" bg="#fef3c7" />}
          </div>
          <p className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">
            {status.aktif
              ? `Aktif sejak ${status.diaktifkan_at ? tanggalPendek(status.diaktifkan_at) : '—'} · ${status.sisa_cadangan} kode cadangan tersisa.`
              : 'Selain kata sandi, masuk juga meminta kode 6 digit dari aplikasi authenticator di HP. Akun tetap aman walau sandi bocor.'}
          </p>
        </div>
        {tahap === 'diam' && (status.aktif ? (
          <div className="flex gap-2">
            <Tombol rupa="kedua" className="text-[12px] py-2" onClick={() => setTahap('buatCadangan')}>Kode Cadangan Baru</Tombol>
            <Tombol rupa="bahaya" className="text-[12px] py-2" onClick={() => setTahap('matikan')}>Matikan</Tombol>
          </div>
        ) : (
          <Tombol className="text-[12px] py-2" memuat={proses} onClick={mulai}>Aktifkan 2FA</Tombol>
        ))}
      </div>

      {galat && tahap === 'diam' && <PanelGalat pesan={galat} />}

      {tahap === 'pindai' && qr && (
        <form onSubmit={aktifkan} className="rounded-kontrol border border-slate-200 bg-slate-50 p-3 flex flex-col gap-3">
          <ol className="text-[12px] text-slate-600 list-decimal pl-4 space-y-1 leading-relaxed">
            <li>Pasang <b>Google Authenticator</b>, <b>Microsoft Authenticator</b>, atau <b>Authy</b> di HP.</li>
            <li>Pindai kode QR ini (atau ketik kunci di bawahnya).</li>
            <li>Masukkan kode 6 digit yang muncul di aplikasi.</li>
          </ol>
          <div className="flex items-center gap-4 flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qr} alt="Kode QR authenticator" width={168} height={168} className="rounded-lg border border-slate-200 bg-white" />
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em]">Kunci manual</p>
              <code className="block mt-1 text-[12.5px] font-bold text-slate-800 break-all select-all">
                {qr.rahasia.match(/.{1,4}/g)?.join(' ')}
              </code>
            </div>
          </div>
          {galat && <PanelGalat pesan={galat} />}
          <Kolom label="Kode dari aplikasi" wajib>
            {(id) => <Teks id={id} value={kode} onChange={(e) => setKode(e.target.value)} inputMode="numeric"
              autoComplete="one-time-code" maxLength={7} placeholder="123456" disabled={proses} />}
          </Kolom>
          <div className="flex justify-end gap-2">
            <Tombol rupa="kedua" className="text-[12px] py-2" onClick={reset}>Batal</Tombol>
            <Tombol type="submit" className="text-[12px] py-2" memuat={proses} disabled={kode.replace(/\s/g, '').length !== 6}>
              Aktifkan
            </Tombol>
          </div>
        </form>
      )}

      {tahap === 'cadangan' && (
        <div className="rounded-kontrol border border-amber-300 bg-amber-50 p-3 flex flex-col gap-3">
          <p className="text-[12px] text-amber-900 leading-relaxed">
            <b>Simpan kode cadangan ini sekarang</b> — hanya ditampilkan sekali. Pakai salah satunya bila HP hilang;
            setiap kode hanya berlaku sekali.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {cadangan.map((k) => (
              <code key={k} className="rounded bg-white border border-amber-200 px-2 py-1 text-center text-[13px] font-bold text-slate-800">{k}</code>
            ))}
          </div>
          <div className="flex justify-end gap-2 flex-wrap">
            <Tombol rupa="kedua" className="text-[12px] py-2"
              onClick={() => { void navigator.clipboard?.writeText(cadangan.join('\n')); toast('sukses', 'Kode cadangan disalin.'); }}>
              Salin
            </Tombol>
            <Tombol rupa="kedua" className="text-[12px] py-2" onClick={unduhCadangan}>Unduh .txt</Tombol>
            <Tombol className="text-[12px] py-2" onClick={() => { setCadangan([]); reset(); }}>Sudah Saya Simpan</Tombol>
          </div>
        </div>
      )}

      {(tahap === 'matikan' || tahap === 'buatCadangan') && (
        <form onSubmit={tahap === 'matikan' ? matikan : buatCadangan}
          className="rounded-kontrol border border-slate-200 bg-slate-50 p-3 flex flex-col gap-3">
          <p className="text-[12px] text-slate-600">
            {tahap === 'matikan'
              ? 'Untuk mematikan 2FA, konfirmasi dengan kata sandi dan kode authenticator saat ini.'
              : 'Kode cadangan lama akan hangus. Konfirmasi dengan kata sandi Anda.'}
          </p>
          {galat && <PanelGalat pesan={galat} />}
          <Kolom label="Kata Sandi" wajib>
            {(id) => <KataSandi id={id} nilai={sandi} onUbah={setSandi} disabled={proses} autoComplete="current-password" />}
          </Kolom>
          {tahap === 'matikan' && (
            <Kolom label="Kode authenticator" wajib>
              {(id) => <Teks id={id} value={kode} onChange={(e) => setKode(e.target.value)} inputMode="numeric"
                autoComplete="one-time-code" maxLength={7} placeholder="123456" disabled={proses} />}
            </Kolom>
          )}
          <div className="flex justify-end gap-2">
            <Tombol rupa="kedua" className="text-[12px] py-2" onClick={reset}>Batal</Tombol>
            <Tombol type="submit" rupa={tahap === 'matikan' ? 'bahaya' : 'utama'} className="text-[12px] py-2" memuat={proses}
              disabled={!sandi || (tahap === 'matikan' && kode.replace(/\s/g, '').length !== 6)}>
              {tahap === 'matikan' ? 'Matikan 2FA' : 'Buat Kode Baru'}
            </Tombol>
          </div>
        </form>
      )}
    </div>
  );
}

/* ══ Perangkat aktif ══════════════════════════════════════════════════════ */

interface Sesi {
  id: string; user_agent: string | null; ip: string | null;
  created_at: string; last_seen_at: string | null; expires_at: string; ini: boolean;
}

/** "Chrome · Android" dari user-agent — cukup untuk mengenali perangkat. */
export function namaPerangkat(ua: string | null): string {
  if (!ua) return 'Perangkat tidak dikenal';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Lainnya';
  const app = /; wv\)/.test(ua) || /SalesManagementApp/i.test(ua) ? 'Aplikasi Android'
    : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${app} · ${os}`;
}

export function PerangkatAktif({ onBerubah }: { onBerubah?: () => void }) {
  const toast = useToast();
  const [sesi, setSesi] = useState<Sesi[] | null>(null);
  const [proses, setProses] = useState<string | null>(null);

  const muat = useCallback(async () => {
    try { setSesi((await api<{ sesi: Sesi[] }>('/api/auth/sesi')).sesi); } catch { setSesi([]); }
  }, []);
  useEffect(() => { void muat(); }, [muat]);

  async function putus(body: object, kunci: string) {
    setProses(kunci);
    try {
      await api('/api/auth/sesi', { method: 'DELETE', body: JSON.stringify(body) });
      toast('sukses', 'Sesi diputus.');
      await muat(); onBerubah?.();
    } catch (e) { toast('galat', e instanceof Error ? e.message : 'Gagal memutus sesi.'); }
    finally { setProses(null); }
  }

  if (!sesi) return <p className="text-[12px] text-slate-400">Memuat perangkat…</p>;
  const lain = sesi.filter((s) => !s.ini).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-slate-800">Perangkat aktif</p>
        {lain > 0 && (
          <Tombol rupa="bahaya" className="text-[11.5px] py-1.5 px-3" memuat={proses === 'semua'}
            onClick={() => putus({ semua_kecuali_ini: true }, 'semua')}>
            Keluarkan {lain} perangkat lain
          </Tombol>
        )}
      </div>
      <ul className="divide-y divide-slate-100 rounded-kontrol border border-slate-200">
        {sesi.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
            <span aria-hidden="true" className="text-lg">{/Android|iOS/.test(namaPerangkat(s.user_agent)) ? '📱' : '💻'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[12.5px] font-semibold text-slate-800 truncate">{namaPerangkat(s.user_agent)}</p>
                {s.ini && <Lencana label="Perangkat ini" color="#008300" bg="#e0f2e0" />}
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {s.ip ?? 'IP tidak tercatat'} · masuk {tanggalPendek(s.created_at)} {waktuPendek(s.created_at)}
                {s.last_seen_at && ` · aktif ${waktuPendek(s.last_seen_at)}`}
              </p>
            </div>
            {!s.ini && (
              <Tombol rupa="kedua" className="text-[11.5px] py-1.5 px-3" memuat={proses === s.id}
                onClick={() => putus({ id: s.id }, s.id)}>
                Putus
              </Tombol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
