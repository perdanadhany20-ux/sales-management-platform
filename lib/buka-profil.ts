// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
/**
 * Membuka modal Profil Akun (components/shared/ProfilAkun.tsx) dari mana saja.
 * Sengaja berupa event, bukan impor langsung: header & sidebar tidak perlu
 * menarik seluruh isi halaman Profil, dan tidak terjadi impor melingkar
 * dengan Shell.
 */
export const ACARA_BUKA_PROFIL = 'sm:buka-profil';

export function bukaProfil() {
  window.dispatchEvent(new Event(ACARA_BUKA_PROFIL));
}
