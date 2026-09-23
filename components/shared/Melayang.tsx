'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * components/shared/Melayang.tsx — panel melayang yang tidak bisa terpotong.
 *
 * Dibuat setelah bug yang nyata: seluruh jendela intip dan panel notifikasi di
 * header TIDAK PERNAH TERLIHAT, padahal kodenya benar dan datanya termuat.
 *
 * Sebabnya halus. Deretan lencana di header memakai `overflow-x-auto` supaya
 * bisa digulir mendatar di layar sempit. Menurut spesifikasi CSS, begitu SATU
 * sumbu diberi `auto`, sumbu lainnya berhenti bernilai `visible` — ia ikut
 * menjadi `auto`. Akibatnya panel yang diposisikan `absolute` di bawah tombol
 * terpotong tepat di batas tinggi nav-nya, dan yang tersisa di layar hanya
 * beberapa piksel yang tidak terbaca sebagai apa pun.
 *
 * Menaikkan z-index tidak menolong: yang terjadi bukan tertutup elemen lain,
 * melainkan terpotong induknya sendiri. Satu-satunya jalan keluar adalah
 * keluar dari induk itu — panel dirender lewat portal ke document.body, lalu
 * diposisikan dari koordinat tombol pemicunya.
 *
 * Pelajaran yang layak diingat: `overflow-x-auto` pada wadah yang memuat
 * dropdown, tooltip, atau popover apa pun akan selalu memotongnya.
 */

export function Melayang({ pemicuRef, onTutup, lebar = 300, children, label }: {
  /** Tombol yang memicu panel ini; dipakai menghitung posisinya. */
  pemicuRef: React.RefObject<HTMLElement>;
  onTutup: () => void;
  lebar?: number;
  children: React.ReactNode;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [posisi, setPosisi] = useState<{ atas: number; kiri: number } | null>(null);

  // useLayoutEffect, bukan useEffect: posisinya dihitung SEBELUM peramban
  // menggambar. Dengan useEffect, panel sempat tampil satu frame di pojok kiri
  // atas lalu meloncat ke tempatnya — kedipan yang terlihat jelas.
  useLayoutEffect(() => {
    function hitung() {
      const pemicu = pemicuRef.current;
      if (!pemicu) return;

      const r = pemicu.getBoundingClientRect();
      const lebarPanel = Math.min(lebar, window.innerWidth - 16);

      // Rata kanan terhadap tombolnya, lalu dijaga tetap di dalam layar.
      // Tanpa penjagaan ini, lencana paling kanan di ponsel akan melahirkan
      // panel yang separuhnya di luar layar dan tidak bisa digulir ke sana.
      let kiri = r.right - lebarPanel;
      kiri = Math.max(8, Math.min(kiri, window.innerWidth - lebarPanel - 8));

      setPosisi({ atas: r.bottom + 8, kiri });
    }

    hitung();

    // Header-nya sticky, jadi posisinya berubah saat halaman digulir.
    window.addEventListener('scroll', hitung, true);
    window.addEventListener('resize', hitung);
    return () => {
      window.removeEventListener('scroll', hitung, true);
      window.removeEventListener('resize', hitung);
    };
  }, [pemicuRef, lebar]);

  useEffect(() => {
    function klik(e: MouseEvent) {
      const t = e.target as Node;
      // Klik pada tombol pemicunya sendiri tidak ditangani di sini —
      // tombolnya sudah punya logika buka/tutup sendiri, dan menutupnya dari
      // dua tempat membuat panel berkedip tertutup lalu terbuka lagi.
      if (panelRef.current?.contains(t)) return;
      if (pemicuRef.current?.contains(t)) return;
      onTutup();
    }
    function tombol(e: KeyboardEvent) { if (e.key === 'Escape') onTutup(); }

    document.addEventListener('mousedown', klik);
    document.addEventListener('keydown', tombol);
    return () => {
      document.removeEventListener('mousedown', klik);
      document.removeEventListener('keydown', tombol);
    };
  }, [onTutup, pemicuRef]);

  if (typeof document === 'undefined' || !posisi) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        top: posisi.atas,
        left: posisi.kiri,
        width: Math.min(lebar, typeof window !== 'undefined' ? window.innerWidth - 16 : lebar),
      }}
      className="z-[60] bg-white rounded-kartu border border-slate-200 shadow-dropdown
                 overflow-hidden animate-[masuk_.14s_ease-out]"
    >
      {children}
    </div>,
    document.body,
  );
}
