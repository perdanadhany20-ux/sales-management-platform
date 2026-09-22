'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * components/shared/DropdownMengambang.tsx — panel kecil yang menempel di
 * bawah tombol pemicunya (notifikasi, jendela intip, dsb), dirender lewat
 * portal ke document.body.
 *
 * BUKAN SEKADAR KERAPIAN — sama seperti Modal.tsx, ini memperbaiki bug nyata.
 * Tombol pemicunya duduk di dalam `<nav>` header yang punya `overflow-x-auto`
 * (perlu untuk menggulir mendatar di layar sempit). CSS punya aturan yang
 * jarang diketahui: begitu `overflow-x` diset ke selain `visible`,
 * `overflow-y` browser otomatis ikut menjadi `auto` — bukan `visible` seperti
 * yang terlihat dari kelasnya. Akibatnya panel absolute-positioned di dalam
 * nav itu SECARA DIAM-DIAM TERPOTONG: ia ada di DOM, posisinya benar,
 * `display`-nya `block`, tapi tidak pernah terlihat sepiksel pun — persis
 * seperti tombolnya tidak melakukan apa-apa saat ditekan. Portal ke
 * document.body melepaskannya dari nav sama sekali, sehingga overflow nav
 * tidak lagi relevan baginya.
 *
 * Posisinya dihitung dari `getBoundingClientRect()` pemicunya, bukan CSS
 * `position: absolute` relatif ke pemicu — karena begitu dipindah ke portal,
 * panel ini tidak lagi punya induk yang posisinya relatif terhadap tombol.
 */
export function DropdownMengambang({
  buka, onTutup, triggerRef, anchor = 'kanan', lebar = 288, children,
}: {
  buka: boolean;
  onTutup: () => void;
  triggerRef: RefObject<HTMLElement>;
  /** Panel rata kanan atau kiri terhadap tepi pemicunya. */
  anchor?: 'kanan' | 'kiri';
  lebar?: number;
  children: React.ReactNode;
}) {
  const [terpasang, setTerpasang] = useState(false);
  const [posisi, setPosisi] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTerpasang(true), []);

  useEffect(() => {
    if (!buka) { setPosisi(null); return; }

    function hitung() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const kiri = anchor === 'kanan'
        ? Math.min(r.right - lebar, window.innerWidth - lebar - 8)
        : r.left;
      setPosisi({ top: r.bottom + 8, left: Math.max(8, kiri) });
    }

    hitung();
    // Sengaja dihitung ulang saat digulir atau jendela diubah ukurannya:
    // panel ini "mengambang" di atas layar (position: fixed), bukan
    // mengikuti tombolnya secara alami seperti anak CSS biasa — tanpa
    // pendengar ini ia akan tertinggal di tempat lama begitu halaman
    // digulir sedikit saja.
    window.addEventListener('scroll', hitung, true);
    window.addEventListener('resize', hitung);
    return () => {
      window.removeEventListener('scroll', hitung, true);
      window.removeEventListener('resize', hitung);
    };
  }, [buka, triggerRef, anchor, lebar]);

  useEffect(() => {
    if (!buka) return;
    const klik = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onTutup();
    };
    const tombol = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    document.addEventListener('mousedown', klik);
    document.addEventListener('keydown', tombol);
    return () => {
      document.removeEventListener('mousedown', klik);
      document.removeEventListener('keydown', tombol);
    };
  }, [buka, onTutup, triggerRef]);

  if (!terpasang || !buka || !posisi) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: posisi.top, left: posisi.left, width: lebar, zIndex: 70 }}
    >
      {children}
    </div>,
    document.body,
  );
}
