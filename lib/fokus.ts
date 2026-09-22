'use client';

import { useEffect } from 'react';

/**
 * lib/fokus.ts — membawa pemakai ke BARIS yang ia klik, bukan sekadar ke
 * halamannya.
 *
 * Dipakai bersama lib/intip.ts: jendela kecil di header menautkan
 * `/meeting?fokus=<id>`, dan halaman tujuannya memakai hook di sini untuk
 * membuka atau menyorot baris itu begitu datanya selesai dimuat.
 *
 * Penanda dibaca dari window.location, BUKAN lewat useSearchParams(). Seluruh
 * halaman aplikasi ini dirender statis; useSearchParams() pada halaman statis
 * menuntut pembungkus <Suspense> dan menggagalkan build tanpa itu. Membacanya
 * di dalam effect menghindari persoalan itu seluruhnya — dan effect memang
 * satu-satunya tempat yang benar, karena window tidak ada saat render server.
 */

export function idFokus(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('fokus');
  return id && id.length > 0 ? id : null;
}

/**
 * Hapus penanda dari alamat tanpa memuat ulang halaman.
 *
 * Kalau dibiarkan, menyegarkan halaman akan menyorot baris yang sama lagi —
 * dan lebih buruk, tombol "kembali" peramban akan memutar ulang sorotan yang
 * sudah tidak relevan.
 */
function bersihkanAlamat(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('fokus');
  window.history.replaceState(null, '', url.toString());
}

/**
 * Sorot baris yang ditunjuk begitu datanya siap.
 *
 * @param siap  true ketika daftar sudah selesai dimuat. Tanpa ini, elemennya
 *              belum ada di DOM saat dicari dan sorotannya tidak pernah muncul.
 * @param onTemu opsional: dipanggil dengan id-nya alih-alih sekadar menyorot.
 *               Dipakai halaman Meeting, yang lebih tepat MEMBUKA panel
 *               eksekusinya daripada menggulir ke kartunya.
 */
export function useFokusBaris(siap: boolean, onTemu?: (id: string) => void): void {
  useEffect(() => {
    if (!siap) return;

    const id = idFokus();
    if (!id) return;

    if (onTemu) {
      onTemu(id);
      bersihkanAlamat();
      return;
    }

    const elemen = document.getElementById(`baris-${id}`);
    if (!elemen) {
      // Barisnya bisa saja berada di luar rentang tanggal atau halaman
      // paginasi yang sedang terbuka. Penandanya tetap dibersihkan supaya
      // tidak menggantung, dan halamannya tampil apa adanya.
      bersihkanAlamat();
      return;
    }

    elemen.scrollIntoView({ behavior: 'smooth', block: 'center' });
    elemen.classList.add('sorot-fokus');

    // Sorotan dilepas sesudah animasinya selesai supaya tidak menempel
    // permanen pada baris yang kebetulan pernah dituju.
    const timer = setTimeout(() => elemen.classList.remove('sorot-fokus'), 2600);
    bersihkanAlamat();

    return () => clearTimeout(timer);
  }, [siap, onTemu]);
}
