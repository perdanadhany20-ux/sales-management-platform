// Hak Cipta © 2026 DWP. Seluruh hak dilindungi. Dilarang menyalin, mengubah,
// atau menggunakan tanpa izin tertulis dari DWP. Lihat berkas LICENSE.
import { Shell } from '@/components/shared/Shell';
import { ModalProfil } from '@/components/shared/ProfilAkun';

/**
 * Layout untuk seluruh halaman yang menuntut sesi. Route group `(app)` tidak
 * ikut muncul di URL — /dashboard tetap /dashboard — tapi memberi satu tempat
 * memasang kerangka navigasi, alih-alih mengulangnya di tiap modul.
 */
export default function LayoutAplikasi({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Shell>{children}</Shell>
      <ModalProfil />
    </>
  );
}
