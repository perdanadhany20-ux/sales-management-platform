'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * components/shared/Feedback.tsx — toast, keadaan kosong, memuat, dan galat.
 *
 * §70 menuntut setiap halaman utama punya keempatnya. Dikumpulkan di satu
 * berkas supaya bentuknya seragam di seluruh platform — bukan tiap halaman
 * mengarang gaya "belum ada data" sendiri-sendiri.
 */

// ── Toast ───────────────────────────────────────────────────────────────────

type RupaToast = 'sukses' | 'galat' | 'info';

interface Toast { id: number; rupa: RupaToast; pesan: string }

const GAYA: Record<RupaToast, { bg: string; border: string; ikon: string }> = {
  sukses: { bg: '#e0f2e0', border: '#008300', ikon: '✓' },
  galat:  { bg: '#fce3e3', border: '#e34948', ikon: '!' },
  info:   { bg: '#e3edfb', border: '#2a78d6', ikon: 'i' },
};

const KonteksToast = createContext<(rupa: RupaToast, pesan: string) => void>(() => {});

export function useToast() {
  return useContext(KonteksToast);
}

export function PenyediaToast({ children }: { children: React.ReactNode }) {
  const [daftar, setDaftar] = useState<Toast[]>([]);
  const [terpasang, setTerpasang] = useState(false);

  // Portal butuh document.body, yang tidak ada saat render di server. Tanpa
  // penjaga ini Next.js melaporkan ketidakcocokan hidrasi.
  useEffect(() => setTerpasang(true), []);

  const tampilkan = useCallback((rupa: RupaToast, pesan: string) => {
    const id = Date.now() + Math.random();
    setDaftar((d) => [...d, { id, rupa, pesan }]);
    setTimeout(() => setDaftar((d) => d.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <KonteksToast.Provider value={tampilkan}>
      {children}
      {terpasang && createPortal(
        <div
          className="fixed z-[60] bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm"
          role="status"
          aria-live="polite"
        >
          {daftar.map((t) => {
            const g = GAYA[t.rupa];
            return (
              <div
                key={t.id}
                className="flex items-start gap-2.5 rounded-kartu px-4 py-3 shadow-toast animate-[masuk_.2s_ease-out]"
                style={{ background: g.bg, borderLeft: `3px solid ${g.border}` }}
              >
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full grid place-items-center text-[11px] font-black text-white mt-0.5"
                  style={{ background: g.border }}
                  aria-hidden="true"
                >
                  {g.ikon}
                </span>
                <p className="text-[13px] font-medium text-slate-800 leading-snug">{t.pesan}</p>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </KonteksToast.Provider>
  );
}

// ── Keadaan kosong ──────────────────────────────────────────────────────────

/**
 * §70: keadaan kosong harus menawarkan langkah berikutnya, bukan sekadar
 * memberitahu bahwa tidak ada apa-apa. "Belum ada Pipeline" menutup
 * percakapan; "Belum ada Pipeline — buat peluang pertama Anda" membukanya.
 */
export function Kosong({
  judul, keterangan, aksi, ikon,
}: {
  judul: string; keterangan?: string; aksi?: React.ReactNode; ikon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-2">
      {ikon && <div className="text-slate-300 mb-1">{ikon}</div>}
      <p className="text-sm font-bold text-slate-700">{judul}</p>
      {keterangan && <p className="text-[13px] text-slate-500 max-w-xs leading-relaxed">{keterangan}</p>}
      {aksi && <div className="mt-3">{aksi}</div>}
    </div>
  );
}

// ── Memuat ──────────────────────────────────────────────────────────────────

/**
 * Kerangka, bukan pemutar berputar. Bentuknya menyerupai isi yang akan datang
 * sehingga tata letaknya tidak melompat saat data tiba — pergeseran yang
 * paling terasa di ponsel, tepat ketika jari sudah bergerak menuju tombol.
 */
export function KerangkaBaris({ jumlah = 5 }: { jumlah?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: jumlah }).map((_, i) => (
        <div key={i} className="h-14 rounded-kontrol bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

export function KerangkaKartu({ tinggi = 180 }: { tinggi?: number }) {
  return <div className="rounded-kartu bg-slate-100 animate-pulse" style={{ height: tinggi }} aria-hidden="true" />;
}

export function LayarMemuat({ pesan = 'Memuat…' }: { pesan?: string }) {
  return (
    <div className="min-h-[60vh] grid place-items-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <span className="w-8 h-8 rounded-full border-[3px] border-aksen-200 border-t-aksen-700 animate-spin" />
        <p className="text-sm text-slate-500">{pesan}</p>
      </div>
    </div>
  );
}

// ── Galat ───────────────────────────────────────────────────────────────────

export function PanelGalat({ pesan, onCoba }: { pesan: string; onCoba?: () => void }) {
  return (
    <div
      className="rounded-kartu border border-[#e34948]/30 bg-[#fce3e3] px-4 py-3 flex items-start gap-3"
      role="alert"
    >
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#e34948] text-white grid place-items-center text-[11px] font-black mt-0.5">
        !
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-slate-800 leading-snug">{pesan}</p>
        {onCoba && (
          <button
            type="button" onClick={onCoba}
            className="mt-1.5 text-[12px] font-bold text-[#c93c3b] underline underline-offset-2"
          >
            Coba lagi
          </button>
        )}
      </div>
    </div>
  );
}
