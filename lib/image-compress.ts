'use client';

/**
 * lib/image-compress.ts — kompresi foto bukti sebelum diunggah.
 *
 * Kamera ponsel modern menghasilkan berkas 4–8 MB. Mengunggahnya apa adanya
 * berarti Sales di lapangan dengan sinyal seadanya menunggu lama, sering
 * gagal di tengah jalan, dan kuota Storage habis jauh lebih cepat dari
 * perkiraan. Mengecilkannya di perangkat jauh lebih murah daripada
 * mengirimnya lalu memprosesnya di server.
 */

const LEBAR_MAKS = 1600;
const LEBAR_THUMB = 320;

async function gambarDariFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Berkas ini bukan gambar yang bisa dibaca.'));
      img.src = url;
    });
    return img;
  } finally {
    // Dibebaskan di finally, bukan sesudah onload: kalau berkasnya rusak dan
    // onerror yang jalan, URL objeknya tetap harus dilepas — kalau tidak,
    // memorinya tertahan sampai halaman ditutup.
    URL.revokeObjectURL(url);
  }
}

function keBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar.'))),
      'image/jpeg',
      quality,
    );
  });
}

function skalakan(img: HTMLImageElement, lebarMaks: number): HTMLCanvasElement {
  const rasio = Math.min(1, lebarMaks / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * rasio);
  canvas.height = Math.round(img.height * rasio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban ini tidak mendukung pemrosesan gambar.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface FotoSiap {
  utama: Blob;
  thumb: Blob;
  lebar: number;
  tinggi: number;
}

/**
 * Hasilkan versi unggah + thumbnail sekaligus dari satu pembacaan berkas.
 *
 * Thumbnail dibuat di sini, bukan belakangan di server, supaya daftar meeting
 * dan halaman audit bisa menampilkan puluhan bukti tanpa mengunduh puluhan
 * foto penuh — persoalan yang §63 sebut sebagai beban gambar yang tidak perlu.
 */
export async function siapkanFoto(file: File): Promise<FotoSiap> {
  const img = await gambarDariFile(file);

  const kanvasUtama = skalakan(img, LEBAR_MAKS);
  const kanvasThumb = skalakan(img, LEBAR_THUMB);

  const [utama, thumb] = await Promise.all([
    keBlob(kanvasUtama, 0.82),
    keBlob(kanvasThumb, 0.7),
  ]);

  return { utama, thumb, lebar: kanvasUtama.width, tinggi: kanvasUtama.height };
}
