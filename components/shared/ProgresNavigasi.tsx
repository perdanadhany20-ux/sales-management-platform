// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Bilah progres di atas layar saat pindah halaman (gaya NProgress): maju
 * perlahan sampai ±85% selama menunggu, lalu penuh dan memudar saat halaman
 * siap. Dikendalikan `aktif` dari useSedangNavigasi (lib/navigasi-muat.ts).
 */
export function ProgresNavigasi({ aktif }: { aktif: boolean }) {
  const [lebar, setLebar] = useState(0);
  const [tampil, setTampil] = useState(false);
  const pewaktu = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (aktif) {
      setTampil(true);
      setLebar(10);
      pewaktu.current = setInterval(() => setLebar((l) => (l < 85 ? l + (85 - l) * 0.12 : l)), 200);
      return () => { if (pewaktu.current) clearInterval(pewaktu.current); };
    }
    if (!tampil) return;
    setLebar(100);
    const t = setTimeout(() => { setTampil(false); setLebar(0); }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktif]);

  return (
    <div role="progressbar" aria-label="Memuat halaman" aria-hidden={!tampil}
      className={`fixed top-0 inset-x-0 z-[70] h-[3px] pointer-events-none transition-opacity duration-300
                  ${tampil ? 'opacity-100' : 'opacity-0'}`}>
      <div className="h-full rounded-r-full bg-gradient-to-r from-aksen-400 to-aksen-700 transition-[width] duration-200 ease-out
                      shadow-[0_0_10px_rgb(var(--aksen-600)/0.55),0_0_4px_rgb(var(--aksen-600)/0.4)]"
        style={{ width: `${lebar}%` }} />
    </div>
  );
}
