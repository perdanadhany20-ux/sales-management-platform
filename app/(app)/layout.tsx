import { Shell } from '@/components/shared/Shell';

/**
 * Layout untuk seluruh halaman yang menuntut sesi. Route group `(app)` tidak
 * ikut muncul di URL — /dashboard tetap /dashboard — tapi memberi satu tempat
 * memasang kerangka navigasi, alih-alih mengulangnya di tiap modul.
 */
export default function LayoutAplikasi({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
