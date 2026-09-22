'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * components/shared/PilihCari.tsx — combobox dengan kotak pencarian.
 *
 * Ini pengganti baku `<select>` di SELURUH formulir platform ini: setiap kali
 * orang memilih sesuatu saat menyunting atau menambah data, harus ada cara
 * mencarinya. `<select>` polos memaksa menggulir daftar yang panjang, dan di
 * ponsel daftar itu muncul sebagai roda putar yang lebih buruk lagi. Aturan
 * ini berlaku walau daftarnya sekarang masih pendek — daftar Sales, lokasi,
 * dan customer bertambah seiring waktu, dan mengganti komponennya belakangan
 * selalu lebih mahal daripada memakai yang benar sejak awal.
 *
 * Diadaptasi dari SearchableSelect FieldServices, dengan tiga tambahan yang
 * di sana belum ada: navigasi papan tombol, peran ARIA combobox, dan
 * penggulungan otomatis ke pilihan yang sedang disorot.
 */

export interface OpsiPilih {
  value: string;
  label: string;
  /** Baris keterangan kecil di bawah label, mis. jabatan atau alamat. */
  keterangan?: string;
}

export function PilihCari({
  nilai, onUbah, opsi, placeholder = '— pilih —', disabled, invalid, id,
  bolehKosong, labelKosong = 'Semua',
}: {
  nilai: string;
  onUbah: (v: string) => void;
  opsi: OpsiPilih[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  /** Sediakan pilihan "kosongkan" — dipakai penyaring, bukan formulir wajib. */
  bolehKosong?: boolean;
  labelKosong?: string;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState('');
  const [sorot, setSorot] = useState(0);

  const wadahRef = useRef<HTMLDivElement>(null);
  const pemicuRef = useRef<HTMLButtonElement>(null);
  const daftarRef = useRef<HTMLDivElement>(null);
  const idDaftar = useId();

  const semua: OpsiPilih[] = bolehKosong
    ? [{ value: '', label: labelKosong }, ...opsi]
    : opsi;

  const kata = cari.trim().toLowerCase();
  const tersaring = kata
    ? semua.filter((o) =>
        o.label.toLowerCase().includes(kata) ||
        (o.keterangan ?? '').toLowerCase().includes(kata))
    : semua;

  const dipilih = semua.find((o) => o.value === nilai);

  useEffect(() => {
    if (!buka) return;
    const tutup = (e: MouseEvent) => {
      if (wadahRef.current && !wadahRef.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [buka]);

  // Sorotan dikembalikan ke atas setiap kali kata kuncinya berubah. Tanpa ini,
  // sorotan bisa tertinggal di indeks yang sudah tidak ada setelah daftarnya
  // menyusut, dan menekan Enter memilih hal yang tidak terlihat di layar.
  useEffect(() => { setSorot(0); }, [cari]);

  useEffect(() => {
    if (!buka || !daftarRef.current) return;
    const el = daftarRef.current.children[sorot] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [sorot, buka]);

  function pilih(v: string) {
    onUbah(v);
    setBuka(false);
    setCari('');
    // Fokus dikembalikan ke pemicunya supaya urutan Tab tidak melompat ke awal
    // halaman setelah daftarnya menutup.
    pemicuRef.current?.focus();
  }

  function tombolDaftar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSorot((s) => Math.min(s + 1, tersaring.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSorot((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = tersaring[sorot];
      if (o) pilih(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBuka(false);
      pemicuRef.current?.focus();
    }
  }

  return (
    <div ref={wadahRef} className="relative">
      <button
        ref={pemicuRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-controls={buka ? idDaftar : undefined}
        aria-invalid={invalid}
        onClick={() => { setBuka((b) => !b); setCari(''); }}
        onKeyDown={(e) => {
          if (!buka && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setBuka(true);
          }
        }}
        className="w-full rounded-kontrol border border-slate-300 bg-white px-3 py-2.5 text-sm text-left
                   flex items-center justify-between gap-2 outline-none transition-colors
                   focus:border-aksen-600 focus:ring-2 focus:ring-aksen-600/15
                   disabled:bg-slate-50 disabled:cursor-not-allowed
                   aria-[invalid=true]:border-[#e34948]"
      >
        <span className={`truncate ${dipilih && dipilih.value !== '' ? 'text-slate-800' : 'text-slate-400'}`}>
          {dipilih?.label ?? placeholder}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
          className={`flex-shrink-0 text-slate-400 transition-transform ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {buka && (
        <div className="absolute z-30 mt-1 w-full rounded-kontrol border border-slate-200 bg-white shadow-dropdown overflow-hidden">
          <input
            autoFocus
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={tombolDaftar}
            placeholder="Cari…"
            autoComplete="off"
            aria-label="Cari pilihan"
            className="w-full text-sm px-3 py-2.5 border-b border-slate-100 outline-none
                       placeholder:text-slate-400"
          />

          <div
            ref={daftarRef}
            id={idDaftar}
            role="listbox"
            className="max-h-60 overflow-y-auto"
          >
            {tersaring.length === 0 ? (
              <p className="text-[12px] text-slate-400 text-center py-4">
                Tidak ada yang cocok dengan “{cari.trim()}”.
              </p>
            ) : (
              tersaring.map((o, i) => {
                const aktif = o.value === nilai;
                return (
                  <button
                    key={o.value || '__kosong__'}
                    type="button"
                    role="option"
                    aria-selected={aktif}
                    onMouseEnter={() => setSorot(i)}
                    onClick={() => pilih(o.value)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors
                                ${i === sorot ? 'bg-aksen-50' : ''}
                                ${aktif ? 'font-bold text-aksen-800' : 'text-slate-700'}`}
                  >
                    <span className="block truncate">{o.label}</span>
                    {o.keterangan && (
                      <span className="block text-[11px] text-slate-400 truncate">{o.keterangan}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
