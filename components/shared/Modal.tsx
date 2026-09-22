'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * components/shared/Modal.tsx — dialog terpusat.
 *
 * Dirender lewat portal ke document.body, bukan di tempat ia dipanggil.
 * Alasannya bukan kerapian: modal yang bersarang di dalam kartu ikut terkena
 * `overflow-hidden` dan `transform` induknya, sehingga di beberapa halaman ia
 * terpotong atau posisinya melenceng dari tengah layar.
 */
export function Modal({
  buka, onTutup, judul, keterangan, children, kaki, lebar = 'sedang',
}: {
  buka: boolean;
  onTutup: () => void;
  judul: string;
  keterangan?: string;
  children: React.ReactNode;
  kaki?: React.ReactNode;
  lebar?: 'kecil' | 'sedang' | 'lebar';
}) {
  const [terpasang, setTerpasang] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTerpasang(true), []);

  useEffect(() => {
    if (!buka) return;

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    document.addEventListener('keydown', onKey);

    // Halaman di belakang dikunci supaya jari yang menggulir di ponsel tidak
    // menggeser daftar di belakang modal, yang membuat posisi baca hilang
    // begitu modalnya ditutup.
    const overflowAsli = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowAsli;
    };
  }, [buka, onTutup]);

  if (!terpasang || !buka) return null;

  const LEBAR = { kecil: 'max-w-sm', sedang: 'max-w-lg', lebar: 'max-w-3xl' }[lebar];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label={judul}
    >
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onTutup}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative w-full ${LEBAR} bg-white shadow-modal outline-none
                    rounded-t-panel sm:rounded-kartu
                    max-h-[92vh] sm:max-h-[85vh] flex flex-col
                    animate-[naik_.22s_cubic-bezier(.22,1,.36,1)]`}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3 flex-shrink-0 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 leading-snug">{judul}</h2>
            {keterangan && <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{keterangan}</p>}
          </div>
          <button
            type="button" onClick={onTutup} aria-label="Tutup"
            className="flex-shrink-0 w-8 h-8 grid place-items-center rounded-kecil text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">{children}</div>

        {kaki && (
          <footer className="flex-shrink-0 px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2
                             pb-[max(1rem,env(safe-area-inset-bottom))]">
            {kaki}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Konfirmasi untuk tindakan yang tidak bisa dibatalkan. */
export function Konfirmasi({
  buka, onTutup, onSetuju, judul, pesan, labelSetuju = 'Ya, lanjutkan', bahaya, memproses,
}: {
  buka: boolean;
  onTutup: () => void;
  onSetuju: () => void;
  judul: string;
  pesan: string;
  labelSetuju?: string;
  bahaya?: boolean;
  memproses?: boolean;
}) {
  return (
    <Modal
      buka={buka} onTutup={onTutup} judul={judul} lebar="kecil"
      kaki={
        <>
          <button
            type="button" onClick={onTutup} disabled={memproses}
            className="rounded-kontrol px-4 py-2.5 text-sm font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button" onClick={onSetuju} disabled={memproses}
            className={`rounded-kontrol px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50
                        ${bahaya ? 'bg-[#e34948] hover:bg-[#c93c3b]' : 'bg-aksen-700 hover:bg-aksen-800'}`}
          >
            {memproses ? 'Memproses…' : labelSetuju}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600 leading-relaxed">{pesan}</p>
    </Modal>
  );
}
