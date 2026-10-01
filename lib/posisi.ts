// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/**
 * lib/posisi.ts — jenjang posisi dalam struktur organisasi.
 *
 * Daftar ini TETAP, bukan pengaturan yang bisa disunting: urutannya menentukan
 * siapa boleh membawahi siapa di pohon organisasi (Admin → Struktur
 * Organisasi). Padanannya di database: sm_peringkat_posisi() dan constraint
 * users_position_jenjang (migrasi 036) — ketiganya harus selalu sama.
 *
 * Posisi berbeda dari PERAN. Peran (Sales, Manager, Admin, …) menentukan hak
 * akses di aplikasi; posisi menentukan letak seseorang di struktur. Seorang
 * Supervisor bisa saja berperan Sales.
 *
 * Dipakai di browser dan di route handler, jadi modul ini sengaja tanpa
 * dependensi.
 */

export const DAFTAR_POSISI = ['Staff', 'Supervisor', 'Manager', 'General Manager', 'Direktur'] as const;

export type Posisi = (typeof DAFTAR_POSISI)[number];

export function posisiSah(nilai: unknown): nilai is Posisi {
  return typeof nilai === 'string' && (DAFTAR_POSISI as readonly string[]).includes(nilai);
}

/** 1 = Staff … 5 = Direktur; 0 bila belum diisi atau tidak dikenal. */
export function peringkatPosisi(nilai: string | null | undefined): number {
  return nilai ? (DAFTAR_POSISI as readonly string[]).indexOf(nilai) + 1 : 0;
}

export const GAYA_POSISI: Record<Posisi, { color: string; bg: string }> = {
  'Staff':           { color: '#475569', bg: '#f1f5f9' },
  'Supervisor':      { color: '#0891b2', bg: '#cffafe' },
  'Manager':         { color: '#1d4ed8', bg: '#dbeafe' },
  'General Manager': { color: '#7c3aed', bg: '#ede9fe' },
  'Direktur':        { color: '#be123c', bg: '#ffe4e6' },
};
