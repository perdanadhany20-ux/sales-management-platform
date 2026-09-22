'use client';

import { useId, useState } from 'react';

/**
 * components/shared/FormParts.tsx — bagian-bagian formulir.
 *
 * Label selalu terikat ke input lewat id yang dibangkitkan useId. Itu bukan
 * sekadar formalitas aksesibilitas: tanpa keterikatan itu, mengetuk label di
 * ponsel tidak memindahkan fokus ke kolomnya — dan pada formulir Daily Report
 * yang panjang, itu terasa seperti aplikasinya tidak merespons.
 */

const DASAR_INPUT =
  'w-full rounded-kontrol border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 outline-none transition-colors ' +
  'focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15 ' +
  'disabled:bg-slate-50 disabled:text-slate-500 ' +
  'aria-[invalid=true]:border-[#e34948] aria-[invalid=true]:ring-[#e34948]/15';

export function Kolom({
  label, wajib, galat, bantuan, children, className = '',
}: {
  label: string;
  wajib?: boolean;
  galat?: string | null;
  bantuan?: string;
  children: (id: string, invalid: boolean) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const invalid = Boolean(galat);

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      <label htmlFor={id} className="text-[12px] font-semibold text-slate-700">
        {label}
        {wajib && <span className="text-[#e34948] ml-0.5" aria-hidden="true">*</span>}
      </label>
      {children(id, invalid)}
      {galat
        ? <p className="text-[11px] font-medium text-[#e34948]" role="alert">{galat}</p>
        : bantuan && <p className="text-[11px] text-slate-500">{bantuan}</p>}
    </div>
  );
}

export function Teks(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${DASAR_INPUT} ${props.className ?? ''}`} />;
}

export function AreaTeks(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${DASAR_INPUT} resize-y min-h-[84px] ${props.className ?? ''}`} />;
}

/**
 * `<select>` polos — JANGAN dipakai untuk memilih data (Sales, customer,
 * lokasi, kategori, satuan). Untuk itu pakai `PilihCari`, yang membawa kotak
 * pencarian; daftar-daftar itu bertambah panjang seiring waktu dan menggulir
 * mencarinya cepat jadi menyiksa, terutama di ponsel.
 *
 * Yang tersisa untuk komponen ini hanya pilihan yang jumlahnya memang tetap
 * sedikit dan tidak akan pernah bertambah — mis. arah urutan naik/turun.
 */
export function Pilihan(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${DASAR_INPUT} pr-8 ${props.className ?? ''}`} />;
}

/**
 * Kolom uang: tampil "100.000.000" sambil melaporkan angka murni ke pemanggil.
 *
 * inputMode="numeric" memunculkan papan tombol angka di ponsel. Tipe input
 * tetap "text", bukan "number": type=number menolak titik pemisah ribuan,
 * memunculkan tombol panah naik-turun yang tidak ada gunanya untuk nilai
 * proyek, dan di beberapa peramban diam-diam membulatkan nilai besar.
 */
export function Uang({
  nilai, onUbah, id, invalid, ...rest
}: {
  nilai: number;
  onUbah: (n: number) => void;
  id?: string;
  invalid?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 pointer-events-none">
        Rp
      </span>
      <input
        {...rest}
        id={id}
        aria-invalid={invalid}
        type="text"
        inputMode="numeric"
        value={nilai ? nilai.toLocaleString('id-ID') : ''}
        onChange={(e) => {
          const bersih = e.target.value.replace(/[^\d]/g, '');
          const n = bersih === '' ? 0 : Number(bersih);
          // Number() pada string sangat panjang menghasilkan nilai di luar
          // jangkauan aman; dibatasi supaya tidak ada angka ajaib yang lolos
          // ke database.
          onUbah(Number.isSafeInteger(n) ? n : 0);
        }}
        className={`${DASAR_INPUT} pl-9 text-right font-semibold tabular-nums`}
      />
    </div>
  );
}

/**
 * Kolom kata sandi — SELALU dengan tombol tampil/sembunyikan.
 *
 * Dibuat sebagai komponen tersendiri, bukan sekadar `<Teks type="password">`,
 * supaya aturannya tidak bergantung pada ingatan siapa pun: setiap tempat
 * yang meminta kata sandi — masuk, daftar, ganti sandi, admin membuat akun —
 * memakai ini dan otomatis mendapat togglenya.
 *
 * Alasannya praktis: kata sandi diketik tanpa umpan balik apa pun, dan di
 * papan tombol ponsel salah ketik satu huruf tidak terlihat sama sekali.
 * Tanpa tombol ini, satu-satunya cara memastikan adalah menghapus semuanya
 * lalu mengetik ulang.
 */
export function KataSandi({
  id, nilai, onUbah, invalid, disabled, placeholder = '••••••••', autoComplete = 'current-password',
}: {
  id?: string;
  nilai: string;
  onUbah: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [lihat, setLihat] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={lihat ? 'text' : 'password'}
        value={nilai}
        onChange={(e) => onUbah(e.target.value)}
        aria-invalid={invalid}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${DASAR_INPUT} pr-11`}
      />
      <button
        type="button"
        // tabIndex -1: Tab dari kolom sandi harus sampai ke tombol kirim,
        // bukan tersangkut di tombol mata ini.
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setLihat((v) => !v)}
        aria-label={lihat ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
      >
        {lihat ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

type RupaTombol = 'utama' | 'kedua' | 'bahaya' | 'hantu';

const RUPA_TOMBOL: Record<RupaTombol, string> = {
  utama:   'bg-aksen-700 text-white hover:bg-aksen-800 shadow-sm',
  kedua:   'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  bahaya:  'bg-[#e34948] text-white hover:bg-[#c93c3b] shadow-sm',
  hantu:   'text-slate-600 hover:bg-slate-100',
};

export function Tombol({
  rupa = 'utama', memuat, className = '', children, ...rest
}: {
  rupa?: RupaTombol;
  memuat?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      // Tombol yang sedang memproses ikut dinonaktifkan. Tanpa ini, ketukan
      // ganda di ponsel — yang sangat lazim saat jaringan lambat — mengirim
      // dua laporan harian sekaligus.
      disabled={rest.disabled || memuat}
      className={`inline-flex items-center justify-center gap-2 rounded-kontrol px-4 py-2.5
                  text-sm font-semibold transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                  focus-visible:outline-aksen-600
                  ${RUPA_TOMBOL[rupa]} ${className}`}
    >
      {memuat && (
        <span
          className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

/** Lencana status kecil; warnanya datang dari lib/constants.ts. */
export function Lencana({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center rounded-kecil px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}
