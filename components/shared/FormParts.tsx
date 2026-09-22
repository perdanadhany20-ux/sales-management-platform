'use client';

import { useId } from 'react';

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
