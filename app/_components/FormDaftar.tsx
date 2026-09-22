'use client';

import { useEffect, useState } from 'react';
import { KataSandi } from '@/components/shared/FormParts';

/**
 * Formulir pendaftaran mandiri.
 *
 * Susunannya mengikuti formulir baseline milik Mas Putu: dua kolom, identitas
 * di kiri dan data organisasi di kanan, dengan "Kode Acara" opsional di bawah.
 *
 * Satu bidang yang tidak ada pada baseline tapi wajib di sini: USERNAME.
 * Platform ini masuk dengan username, bukan email (lihat migrasi 001 dan
 * /api/auth/login). Menyembunyikannya lalu menurunkannya dari email akan
 * menghasilkan username yang tidak pernah diketahui pemiliknya — dan orang
 * yang tidak tahu username-nya tidak bisa masuk sama sekali.
 *
 * Tidak ada pilihan PERAN di sini, dan itu disengaja. Peran menentukan apa
 * yang boleh dilihat seseorang; membiarkan pendaftar memilihnya sendiri sama
 * saja meniadakan seluruh model wewenang. Setiap pendaftar menjadi Sales, dan
 * hanya admin yang bisa menaikkannya.
 */

interface Opsi {
  divisions: string[];
  sales_divisions: string[];
  positions: string[];
  registration_open: boolean;
}

const OPSI_BAWAAN: Opsi = {
  divisions: [],
  sales_divisions: [],
  positions: [],
  registration_open: true,
};

export function FormDaftar({ onSelesai, onKembali, warnaUtama, warnaUtama2 }: {
  onSelesai: (pesan: string) => void;
  onKembali: () => void;
  warnaUtama: string;
  warnaUtama2: string;
}) {
  const [opsi, setOpsi] = useState<Opsi>(OPSI_BAWAAN);

  const [username, setUsername] = useState('');
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [sandi, setSandi] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [divisi, setDivisi] = useState('');
  const [salesDivisi, setSalesDivisi] = useState('');
  const [jabatan, setJabatan] = useState('');
  const [hp, setHp] = useState('');
  const [kode, setKode] = useState('');

  const [galat, setGalat] = useState('');
  const [memproses, setMemproses] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/opsi-pendaftaran');
        if (!res.ok) return;
        const data = await res.json();
        setOpsi({ ...OPSI_BAWAAN, ...(data.opsi ?? {}) });
      } catch {
        /* jaringan bermasalah — formulir tetap bisa diisi dengan pilihan kosong */
      }
    })();
  }, []);

  // Sales Division hanya relevan bagi yang divisinya Sales. Menampilkannya
  // kepada orang Teknis hanya membuat mereka menebak-nebak isian yang tidak
  // ada hubungannya dengan pekerjaannya.
  const perluSalesDivision = divisi.toLowerCase() === 'sales';

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setGalat('');

    if (sandi !== ulangi) { setGalat('Konfirmasi kata sandi tidak cocok.'); return; }

    setMemproses(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, full_name: nama, email, password: sandi, phone: hp,
          division: divisi, sales_division: perluSalesDivision ? salesDivisi : null,
          position: jabatan, event_code: kode,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setGalat(data?.error ?? 'Pendaftaran gagal.'); return; }
      onSelesai(data.message ?? 'Pendaftaran diterima.');
    } catch {
      setGalat('Jaringan bermasalah. Coba lagi.');
    } finally {
      setMemproses(false);
    }
  }

  if (opsi.registration_open === false) {
    return (
      <div className="text-center py-6">
        <p className="text-base font-black text-slate-900">Pendaftaran ditutup</p>
        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">
          Saat ini akun hanya dibuat oleh admin. Hubungi admin Anda untuk dibuatkan akses.
        </p>
        <button type="button" onClick={onKembali}
          className="mt-4 text-[13px] font-bold underline underline-offset-2"
          style={{ color: warnaUtama }}>
          Kembali ke halaman masuk
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={kirim} className="flex flex-col gap-4">
      <header>
        <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Daftar Akun</h2>
        <p className="text-slate-500 text-[13px] mt-1">
          Lengkapi data untuk mendaftar. Akun akan diverifikasi admin.
        </p>
      </header>

      <div className="grid grid-cols-1 formulir:grid-cols-2 gap-x-4 gap-y-3.5">

        <Bidang label="Nama Lengkap" wajib>
          {(id) => (
            <Isian id={id} value={nama} onChange={setNama} required
              placeholder="Nama lengkap" autoComplete="name" disabled={memproses} />
          )}
        </Bidang>

        <Bidang label="Divisi" wajib>
          {(id) => (
            <Pilih id={id} value={divisi} onChange={setDivisi} required disabled={memproses}
              kosong="— Pilih Divisi —" opsi={opsi.divisions} />
          )}
        </Bidang>

        <Bidang label="Username" wajib
          bantuan="Dipakai untuk masuk. Huruf kecil, angka, titik, atau strip.">
          {(id) => (
            <Isian id={id} value={username}
              onChange={(v) => setUsername(v.toLowerCase())} required
              placeholder="nama.anda" autoComplete="username" disabled={memproses} />
          )}
        </Bidang>

        <Bidang label="Sales Division" wajib={perluSalesDivision}>
          {(id) => (
            <Pilih id={id} value={salesDivisi} onChange={setSalesDivisi}
              required={perluSalesDivision}
              disabled={memproses || !perluSalesDivision}
              kosong={perluSalesDivision ? '— Pilih Sales Division —' : 'Hanya untuk divisi Sales'}
              opsi={opsi.sales_divisions} />
          )}
        </Bidang>

        <Bidang label="Email" wajib>
          {(id) => (
            <Isian id={id} type="email" value={email} onChange={setEmail} required
              placeholder="nama@perusahaan.co.id" autoComplete="email" disabled={memproses} />
          )}
        </Bidang>

        <Bidang label="Jabatan / Posisi">
          {(id) => (
            <Pilih id={id} value={jabatan} onChange={setJabatan} disabled={memproses}
              kosong="— Pilih Jabatan —" opsi={opsi.positions} />
          )}
        </Bidang>

        <Bidang label="Password" wajib bantuan="Minimal 8 karakter, memuat huruf dan angka.">
          {(id) => (
            <KataSandi id={id} nilai={sandi} onUbah={setSandi}
              disabled={memproses} autoComplete="new-password" />
          )}
        </Bidang>

        <Bidang label="No. HP">
          {(id) => (
            <Isian id={id} type="tel" value={hp} onChange={setHp}
              placeholder="08xx…" autoComplete="tel" disabled={memproses} />
          )}
        </Bidang>

        <Bidang label="Konfirmasi Password" wajib
          galat={ulangi && sandi !== ulangi ? 'Belum cocok.' : null}>
          {(id, invalid) => (
            <KataSandi id={id} nilai={ulangi} onUbah={setUlangi} invalid={invalid}
              disabled={memproses} autoComplete="new-password" placeholder="ulangi password" />
          )}
        </Bidang>

        <Bidang label="Kode Acara (opsional)">
          {(id) => (
            <Isian id={id} value={kode} onChange={setKode} disabled={memproses}
              placeholder="Isi hanya jika diberikan admin" />
          )}
        </Bidang>
      </div>

      {galat && (
        <p role="alert" className="px-4 py-2.5 rounded-kontrol text-[13px] font-medium
                                   text-[#c93c3b] bg-[#fce3e3] border border-[#e34948]/30">
          {galat}
        </p>
      )}

      <button
        type="submit" disabled={memproses}
        className="w-full text-white py-3.5 rounded-kontrol font-bold text-sm tracking-wide
                   shadow-lg transition-all flex items-center justify-center gap-2
                   disabled:cursor-not-allowed hover:opacity-90"
        style={{
          background: `linear-gradient(to right, ${warnaUtama2}, ${warnaUtama})`,
          opacity: memproses ? 0.75 : 1,
        }}
      >
        {memproses ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Mengirim…
          </>
        ) : 'Daftar'}
      </button>

      <p className="text-center text-[12px] text-slate-500">
        Sudah punya akun?{' '}
        <button type="button" onClick={onKembali}
          className="font-bold underline underline-offset-2" style={{ color: warnaUtama }}>
          Masuk di sini
        </button>
      </p>
    </form>
  );
}

/* ── Bagian kecil ─────────────────────────────────────────────────────────── */

function Bidang({ label, wajib, galat, bantuan, children }: {
  label: string;
  wajib?: boolean;
  galat?: string | null;
  bantuan?: string;
  children: (id: string, invalid: boolean) => React.ReactNode;
}) {
  const id = `daftar-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-[11px] font-bold text-slate-600 tracking-widest uppercase">
        {label}
        {wajib && <span className="text-[#e34948] ml-0.5" aria-hidden="true">*</span>}
      </label>
      {children(id, Boolean(galat))}
      {galat
        ? <p className="text-[11px] font-medium text-[#e34948]" role="alert">{galat}</p>
        : bantuan && <p className="text-[11px] text-slate-400">{bantuan}</p>}
    </div>
  );
}

const KELAS_ISIAN =
  `w-full border border-slate-200 rounded-kontrol px-4 py-3 text-sm font-medium
   text-slate-800 bg-white outline-none transition-all
   placeholder:text-slate-400 placeholder:font-normal
   focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15
   disabled:bg-slate-50 disabled:text-slate-400`;

function Isian({ id, value, onChange, type = 'text', ...sisa }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id} type={type} value={value}
      onChange={(e) => onChange(e.target.value)}
      autoCapitalize="none" autoCorrect="off"
      className={KELAS_ISIAN}
      {...sisa}
    />
  );
}

function Pilih({ id, value, onChange, opsi, kosong, ...sisa }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  opsi: string[];
  kosong: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      id={id} value={value} onChange={(e) => onChange(e.target.value)}
      className={`${KELAS_ISIAN} appearance-none bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
      }}
      {...sisa}
    >
      <option value="">{kosong}</option>
      {opsi.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
